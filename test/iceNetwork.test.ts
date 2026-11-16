// Connection scenarios of the TFAF adapter over a simulated network (helpers/simNetwork.ts): home routers, a TURN and a
// STUN server, outages, loss and changing router mappings. Timeouts are shortened, so each scenario runs in seconds.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { IceAdapterEvents, IceServerConfig } from '../src/main/game/iceAdapter.ts';
import type { IceTimings } from '../src/main/ice/iceTimings.ts';
import { TfafIceAdapter } from '../src/main/ice/tfafIceAdapter.ts';
import { Feature, LOCAL_FEATURES } from '../src/main/ice/tfafProtocol.ts';
import type { GamePeer } from '../src/shared/contract.ts';
import { FakeTurnServer, type TurnMode } from './helpers/fakeTurnServer.ts';
import { type NatOptions, type SimHost, type SimNat, SimNetwork } from './helpers/simNetwork.ts';

const FAST: IceTimings = {
  gatherTimeoutMs: 800,
  turnGraceMs: 150,
  checkTimeoutMs: 3_000,
  minCheckTimeMs: 800,
  nominationWaitMs: 400,
  pacingMs: 5,
  checkRetransmission: { initialRtoMs: 40, maxRtoMs: 200, attempts: 6 },
  stunRetransmission: { initialRtoMs: 50, maxRtoMs: 200, attempts: 4 },
  consentIntervalMs: 60,
  retryFailedPairsMs: 1_500,
  pathStatsWindowMs: 2_000,
  turnRefreshMs: null,
  answerTimeoutMs: 1_500,
  retryDelayMs: 300,
  attemptWindowMs: 4_000,
  shortConnectionMs: 1_500,
  slowRetryAfterMs: 3_000,
  slowRetryDelayMs: 1_000,
  helloIntervalMs: 100,
  pingIntervalMs: 60,
  livenessTimeoutMs: 500,
  echoIntervalMs: 100,
  echoTimeoutMs: 1_500,
  statsIntervalMs: 60_000,
  bridgeMaxMs: 6_000,
  bridgeStableMs: 500,
  preparedAnswerMs: 3_000,
  pathSilenceMs: 200,
  pathAliveMs: 300,
  pathSwitchHoldMs: 800,
};

/** A TFAF adapter from before reconnects without dropping and managed paths. */
const OLD_TFAF = LOCAL_FEATURES & ~(Feature.signaling | Feature.pathManagement);

const NAT_A = '203.0.113.1';
const NAT_B = '203.0.113.2';
const TURN_IP = '198.51.100.10';
const STUN_IP = '198.51.100.20';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until the check holds; resolves with the time it took. */
async function until(check: () => boolean, what: string, timeoutMs = 5_000): Promise<number> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await sleep(10);
  }
  return Date.now() - startedAt;
}

/** The lobby server between the players: it relays IceMsg, and a player's connection to it can be dead. */
class Lobby {
  readonly sent: { from: number; to: number; message: unknown }[] = [];
  readonly players = new Map<number, Player>();
  private readonly dead = new Set<number>();

  setDead(playerId: number, dead: boolean): void {
    if (dead) {
      this.dead.add(playerId);
    } else {
      this.dead.delete(playerId);
    }
  }

  relay(from: number, to: number, message: unknown): void {
    this.sent.push({ from, to, message });
    if (this.dead.has(from) || this.dead.has(to)) {
      return;
    }
    setTimeout(() => this.players.get(to)?.adapter.iceMessage(from, message), 3);
  }

  signalsSent(): number {
    return this.sent.filter(({ message }) => typeof message === 'string' && message.includes('"tfaf":2')).length;
  }
}

interface Player {
  id: number;
  login: string;
  adapter: TfafIceAdapter;
  logs: string[];
  statuses: Map<number, GamePeer>;
  inbox: string[];
  suspects: number;
}

interface World {
  network: SimNetwork;
  natA: SimNat;
  natB: SimNat;
  a: SimHost;
  b: SimHost;
  turns: FakeTurnServer[];
  servers: IceServerConfig[];
  stunUrls: string[];
  lobby: Lobby;
  players: Player[];
}

let logsDirectory = '';
const worlds: World[] = [];

async function createWorld(
  options: { natA?: NatOptions; natB?: NatOptions; sameNetwork?: boolean; turnModes?: TurnMode[] } = {},
): Promise<World> {
  const network = new SimNetwork();
  const natA = network.nat(NAT_A, options.natA);
  const natB = options.sameNetwork ? natA : network.nat(NAT_B, options.natB);
  const a = network.host('192.168.1.10', natA);
  const b = network.host(options.sameNetwork ? '192.168.1.11' : '192.168.2.20', natB);
  const turns: FakeTurnServer[] = [];
  const servers: IceServerConfig[] = [];
  for (const [index, mode] of (options.turnModes ?? ['normal']).entries()) {
    const ip = `198.51.100.${10 + index}`;
    const turn = await FakeTurnServer.start({ transport: network.host(ip).transport, ip, port: 3478, mode });
    turns.push(turn);
    servers.push({ urls: [`turn:${ip}:3478`], username: turn.username, credential: turn.credential });
  }
  await network.host(STUN_IP).startStunServer();
  const world: World = {
    network,
    natA,
    natB,
    a,
    b,
    turns,
    servers,
    stunUrls: [`stun:${STUN_IP}:3478`],
    lobby: new Lobby(),
    players: [],
  };
  worlds.push(world);
  return world;
}

async function startPlayer(world: World, host: SimHost, id: number, login: string, features = LOCAL_FEATURES): Promise<Player> {
  const logs: string[] = [];
  const adapter = new TfafIceAdapter({
    hostAddresses: [host.ip],
    publicStunUrls: world.stunUrls,
    transport: host.transport,
    timings: FAST,
    onLog: (line) => logs.push(line),
    features,
  });
  const player: Player = { id, login, adapter, logs, statuses: new Map(), inbox: [], suspects: 0 };
  const events: IceAdapterEvents = {
    onGpgNetMessage: () => {},
    onIceMessage: (remotePlayerId, message) => world.lobby.relay(id, remotePlayerId, message),
    onConnectionStateChanged: () => {},
    onPeerStatus: (status) => player.statuses.set(status.playerId, status),
    onPeerFiles: () => {},
    onPeerRehost: () => {},
    onPeerLauncher: () => {},
    onPeerKick: () => {},
    onLobbyMessage: (_remotePlayerId, _login, text) => player.inbox.push(text),
    onPeerRemoved: () => {},
    onNetworkSuspect: () => player.suspects++,
    onExit: () => {},
  };
  await adapter.start(
    {
      gameId: 300 + id,
      playerId: id,
      login,
      forceRelay: false,
      lobbyInitMode: 'normal',
      iceServers: world.servers,
      logsDirectory,
      fingerprint: null,
      launcher: null,
      gameless: true,
    },
    events,
  );
  world.lobby.players.set(id, player);
  world.players.push(player);
  return player;
}

/** The server's commands: the host offers to the guest that joins it. */
async function connect(host: Player, guest: Player): Promise<void> {
  host.adapter.hostGame('scmp_009');
  guest.adapter.joinGame(host.login, host.id);
  host.adapter.connectToPeer(guest.login, guest.id, true);
  await until(() => isConnected(host, guest) && isConnected(guest, host), 'the players to connect');
}

function status(player: Player, other: Player): GamePeer | undefined {
  return player.statuses.get(other.id);
}

function isConnected(player: Player, other: Player): boolean {
  return status(player, other)?.state === 'connected';
}

async function twoPlayers(world: World, features: [number, number] = [LOCAL_FEATURES, LOCAL_FEATURES]): Promise<[Player, Player]> {
  const host = await startPlayer(world, world.a, 1, 'alpha', features[0]);
  const guest = await startPlayer(world, world.b, 2, 'beta', features[1]);
  await connect(host, guest);
  // The TFAF handshake has to be through before the extensions work.
  await until(() => status(host, guest)?.tfaf === true && status(guest, host)?.tfaf === true, 'the TFAF handshake');
  return [host, guest];
}

function logsSince(player: Player, index: number, pattern: RegExp): string[] {
  return player.logs.slice(index).filter((line) => pattern.test(line));
}

/** Takes the host off the network for a while. */
async function outage(host: SimHost, ms: number): Promise<void> {
  host.online = false;
  await sleep(ms);
  host.online = true;
}

describe('TFAF adapter over a simulated network', () => {
  before(async () => {
    logsDirectory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-ice-network-'));
  });

  after(async () => {
    for (const world of worlds) {
      for (const player of world.players) {
        player.adapter.stop();
      }
    }
    await sleep(400);
    for (const world of worlds) {
      for (const turn of world.turns) {
        turn.close();
      }
    }
    await rm(logsDirectory, { recursive: true, force: true });
  });

  it('connects two players directly and carries lobby messages', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world);
    assert.equal(status(host, guest)?.route, 'direct');
    assert.ok(logsSince(host, 0, /: selected host \S+ -> srflx/).length > 0);
    assert.equal(host.adapter.sendLobbyMessage(guest.id, 'hello room', null), true);
    await until(() => guest.inbox.includes('hello room'), 'the lobby message');
  });

  it('nominates a direct pair even when a relayed one answers first', async () => {
    const world = await createWorld();
    // The direct path answers late at first, as while the routers' holes are still being punched.
    world.network.impair({ from: NAT_A, to: NAT_B, both: true, delayMs: 80, until: Date.now() + 1_500 });
    const [host, guest] = await twoPlayers(world);
    assert.deepEqual(logsSince(host, 0, /: selected relay/), []);
    assert.ok(logsSince(host, 0, /: selected host \S+ -> srflx/).length > 0);
    assert.equal(status(host, guest)?.route, 'direct');
  });

  it('finishes gathering soon after the first relay when another TURN server stays silent', async () => {
    const world = await createWorld({ turnModes: ['silent', 'normal'] });
    const [host] = await twoPlayers(world);
    const sent = logsSince(host, 0, /sent candidates: .*relay.*, gathered in \d+ ms/);
    assert.ok(sent.length > 0, 'a relayed candidate was offered');
    const gatheredMs = Number(/gathered in (\d+) ms/.exec(sent[0]!)?.[1]);
    assert.ok(gatheredMs < FAST.gatherTimeoutMs - 200, `gathered in ${gatheredMs} ms`);
  });

  it('reconnects over the local network when it is the only path, soon after connecting', async () => {
    const world = await createWorld({ sameNetwork: true });
    world.natA.uplink = false;
    const [host, guest] = await twoPlayers(world, [OLD_TFAF, OLD_TFAF]);
    const mark = host.logs.length;
    await outage(world.b, 700);
    await until(() => logsSince(host, mark, /nothing received/).length > 0, 'the outage to be noticed');
    await until(() => isConnected(host, guest) && isConnected(guest, host), 'the players to reconnect', 6_000);
    assert.ok(logsSince(host, mark, /sent candidates: host/).length > 0, 'host candidates are offered again');
  });

  it('offers direct paths again after a drop and only relays once the direct path keeps breaking', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world, [OLD_TFAF, OLD_TFAF]);
    assert.equal(status(host, guest)?.route, 'direct');

    const firstDrop = host.logs.length;
    world.network.impair({ from: NAT_A, to: NAT_B, both: true, drop: true, until: Date.now() + 600 });
    await until(() => logsSince(host, firstDrop, /nothing received/).length > 0, 'the first drop');
    await until(() => logsSince(host, firstDrop, /connected: /).length > 0, 'the first reconnect', 6_000);
    assert.ok(logsSince(host, firstDrop, /sent candidates: host/).length > 0, 'one drop keeps host candidates');
    // The block is over by the time the checks run, so the direct path is back.
    await until(() => status(host, guest)?.route === 'direct', 'the direct path after the first drop');

    const secondDrop = host.logs.length;
    world.network.impair({ from: NAT_A, to: NAT_B, both: true, drop: true, until: Date.now() + 600 });
    await until(() => logsSince(host, secondDrop, /nothing received/).length > 0, 'the second drop');
    await until(() => logsSince(host, secondDrop, /connected: /).length > 0, 'the second reconnect', 6_000);
    assert.ok(logsSince(host, secondDrop, /sent candidates: relay, gathered/).length > 0, 'a flapping direct path leaves relays only');
    assert.equal(status(host, guest)?.route, 'relay');
  });

  it('offers again at once when the lobby connection comes back', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world, [OLD_TFAF, OLD_TFAF]);
    const mark = host.logs.length;
    world.lobby.setDead(guest.id, true);
    await outage(world.b, 700);
    await until(() => logsSince(host, mark, /sent candidates/).length > 0, 'the offer that gets lost');
    await sleep(1_000);
    world.lobby.setDead(guest.id, false);
    const restoredAt = Date.now();
    host.adapter.signalingRestored();
    guest.adapter.signalingRestored();
    await until(() => isConnected(host, guest) && isConnected(guest, host), 'the players to reconnect', 4_000);
    const tookMs = Date.now() - restoredAt;
    assert.ok(logsSince(host, mark, /the lobby server is back, offering again/).length > 0);
    assert.ok(tookMs < 700, `reconnected ${tookMs} ms after the lobby came back`);
  });

  it('stops reconnecting to a player who said goodbye', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world);
    guest.adapter.stop();
    await until(() => logsSince(host, 0, /the player left/).length > 0, 'the goodbye');
    const mark = host.logs.length;
    await sleep(1_500);
    assert.deepEqual(logsSince(host, mark, /sent candidates/), []);
  });

  it('tries a player who stays away less often after a while', async () => {
    const world = await createWorld();
    const [host] = await twoPlayers(world, [OLD_TFAF, OLD_TFAF]);
    world.b.online = false;
    await until(() => logsSince(host, 0, /unreachable for/).length > 0, 'the slower retries', 8_000);
    const mark = host.logs.length;
    await sleep(2_000);
    assert.ok(logsSince(host, mark, /sent candidates/).length <= 2);
  });

  it('keeps the game going over the old path while the lobby connection is dead', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world);
    world.lobby.setDead(host.id, true);
    world.lobby.setDead(guest.id, true);
    await outage(world.b, 700);
    const backAt = Date.now();
    await until(() => logsSince(host, 0, /the old path works again/).length > 0, 'the old path', 3_000);
    assert.ok(Date.now() - backAt < 600, `the old path worked ${Date.now() - backAt} ms after the network came back`);
    await until(() => isConnected(host, guest) && isConnected(guest, host), 'both players to show the connection');
    assert.equal(host.adapter.sendLobbyMessage(guest.id, 'during the outage', null), true);
    await until(() => guest.inbox.includes('during the outage'), 'the lobby message over the old path');
    assert.ok(host.suspects > 0, 'every player going silent is reported');

    world.lobby.setDead(host.id, false);
    world.lobby.setDead(guest.id, false);
    host.adapter.signalingRestored();
    guest.adapter.signalingRestored();
    await until(() => logsSince(host, 0, /reconnected .* after the connection went silent/).length > 0, 'the new connection', 6_000);
  });

  it('follows a player whose router mapping changed without reconnecting, and replaces the lost TURN allocation', async () => {
    const world = await createWorld({ natB: { filtering: 'address' } });
    const [host, guest] = await twoPlayers(world);
    await sleep(500);
    const hostMark = host.logs.length;
    const guestMark = guest.logs.length;
    world.natA.rebind();
    await until(() => logsSince(guest, guestMark, /the peer checks from a new address/).length > 0, 'the new address', 3_000);
    await until(() => logsSince(guest, guestMark, /: path .* -> /).length > 0, 'the move to the new address', 3_000);
    await until(() => logsSince(host, hostMark, /allocation lost/).length > 0, 'the lost allocation', 5_000);
    await until(() => logsSince(host, hostMark, /TURN \S+: relayed/).length > 0, 'a new allocation', 5_000);
    assert.deepEqual(logsSince(host, hostMark, /nothing received/), []);
    assert.deepEqual(logsSince(guest, guestMark, /nothing received/), []);
    assert.ok(isConnected(host, guest) && isConnected(guest, host));
  });

  it('reconnects through the lobby server when both router mappings changed', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world);
    await sleep(300);
    const mark = host.logs.length;
    world.natA.rebind();
    world.natB.rebind();
    await until(() => logsSince(host, mark, /reconnected .* after the connection went silent/).length > 0, 'the reconnect', 6_000);
    await until(() => isConnected(host, guest) && isConnected(guest, host), 'both players to show the connection');
  });

  it('moves from a relay to the direct path once it opens', async () => {
    const world = await createWorld();
    world.network.impair({ to: TURN_IP, delayMs: 15 });
    world.network.impair({ from: TURN_IP, delayMs: 15 });
    const removeBlock = world.network.impair({ from: NAT_A, to: NAT_B, both: true, drop: true });
    const [host, guest] = await twoPlayers(world);
    assert.equal(status(host, guest)?.route, 'relay');
    removeBlock();
    await until(() => status(host, guest)?.route === 'direct' && status(guest, host)?.route === 'direct', 'the direct path', 6_000);
    assert.ok(logsSince(host, 0, /: path relay .* -> host .*: better/).length > 0);
  });

  it('leaves a lossy path for a clean one', async () => {
    const world = await createWorld();
    world.network.impair({ to: TURN_IP, delayMs: 15 });
    world.network.impair({ from: TURN_IP, delayMs: 15 });
    const [host, guest] = await twoPlayers(world);
    assert.equal(status(host, guest)?.route, 'direct');
    await sleep(300);
    world.network.impair({ from: NAT_A, to: NAT_B, both: true, loss: 0.35 });
    await until(() => status(host, guest)?.route === 'relay', 'the move to the relay', 6_000);
    // At this loss the checks of the direct path also go unanswered for a while, which moves the traffic as well.
    assert.ok(logsSince(host, 0, /: path host .* -> relay /).length > 0);
  });

  it('fails over to the relay at once when the direct path dies', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world);
    await sleep(600);
    const hostMark = host.logs.length;
    const guestMark = guest.logs.length;
    const blockedAt = Date.now();
    world.network.impair({ from: NAT_A, to: NAT_B, both: true, drop: true });
    await until(() => status(host, guest)?.route === 'relay' && status(guest, host)?.route === 'relay', 'the failover', 3_000);
    const tookMs = Date.now() - blockedAt;
    assert.ok(tookMs < FAST.livenessTimeoutMs + 300, `failed over in ${tookMs} ms`);
    assert.deepEqual(logsSince(host, hostMark, /nothing received/), []);
    assert.deepEqual(logsSince(guest, guestMark, /nothing received/), []);
  });

  it('reconnects an older TFAF player the old way and sends it no TFAF signals', async () => {
    const world = await createWorld();
    const [host, guest] = await twoPlayers(world, [LOCAL_FEATURES, OLD_TFAF]);
    const mark = host.logs.length;
    await outage(world.b, 700);
    await until(() => logsSince(host, mark, /nothing received/).length > 0, 'the outage to be noticed');
    await until(() => logsSince(host, mark, /connected: /).length > 0, 'the reconnect', 6_000);
    await until(() => isConnected(host, guest) && isConnected(guest, host), 'both players to show the connection');
    assert.equal(world.lobby.signalsSent(), 0);
    assert.deepEqual(logsSince(host, 0, /the old path works again/), []);
  });
});
