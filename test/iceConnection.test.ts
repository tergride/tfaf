import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { GamePeer } from '../src/shared/contract.ts';
import type { GameFingerprint } from '../src/main/game/fingerprint.ts';
import type { IceAdapterEvents, IceAdapterStartOptions } from '../src/main/game/iceAdapter.ts';
import type { PeerLauncher } from '../src/main/game/lobbyFeatureChecks.ts';
import { announceFeatures, type FeatureAnnouncement } from '../src/main/game/lobbyFeatures.ts';
import { ALL_CANDIDATES, type CandidatePolicy } from '../src/main/ice/candidates.ts';
import { IceAgent, type SelectedPair } from '../src/main/ice/iceAgent.ts';
import { decodeStun } from '../src/main/ice/stun.ts';
import { TfafIceAdapter } from '../src/main/ice/tfafIceAdapter.ts';
import { StunTransactions } from '../src/main/ice/transactions.ts';
import { type RelayedPacket, TurnAllocation, type TurnServer } from '../src/main/ice/turn.ts';
import { launchFakeGame, receiveOn } from './helpers/fakeGame.ts';
import { FakeTurnServer } from './helpers/fakeTurnServer.ts';

const LOOPBACK = '127.0.0.1';

function waitFor<T>(register: (resolve: (value: T) => void) => void, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), timeoutMs);
    register((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

interface TestAgent {
  agent: IceAgent;
  connected: Promise<SelectedPair>;
  received: Buffer[];
  nextData(): Promise<Buffer>;
}

function createAgent(controlling: boolean, policy: CandidatePolicy, turnServers: TurnServer[] = []): TestAgent {
  const received: Buffer[] = [];
  let onData: ((data: Buffer) => void) | null = null;
  let onConnected: (pair: SelectedPair) => void = () => {};
  let onFailed: (reason: string) => void = () => {};
  const connected = new Promise<SelectedPair>((resolve, reject) => {
    onConnected = resolve;
    onFailed = (reason) => reject(new Error(reason));
  });
  const agent = new IceAgent(
    { controlling, hostAddresses: [LOOPBACK], stunServers: [], turnServers, policy, log: () => {} },
    {
      onConnected: (pair) => onConnected(pair),
      onFailed: (reason) => onFailed(reason),
      onData: (data) => {
        received.push(data);
        onData?.(data);
      },
    },
  );
  return {
    agent,
    connected,
    received,
    nextData: () =>
      waitFor((resolve) => {
        onData = (data) => {
          onData = null;
          resolve(data);
        };
      }),
  };
}

async function connectPair(offerer: TestAgent, answerer: TestAgent): Promise<[SelectedPair, SelectedPair]> {
  const offer = await offerer.agent.gather();
  const answer = await answerer.agent.gather();
  answerer.agent.start(offer);
  offerer.agent.start(answer);
  return Promise.all([offerer.connected, answerer.connected]);
}

describe('ICE agent', () => {
  it('connects two agents over host candidates and carries data both ways', async () => {
    const offerer = createAgent(true, ALL_CANDIDATES);
    const answerer = createAgent(false, ALL_CANDIDATES);
    try {
      const [offererPair, answererPair] = await connectPair(offerer, answerer);
      assert.equal(offererPair.localType, 'host');
      // Both sides use the pair the controlling agent nominated.
      assert.deepEqual(offererPair.remote, answererPair.local);
      assert.deepEqual(answererPair.remote, offererPair.local);

      const toAnswerer = answerer.nextData();
      assert.ok(offerer.agent.send(Buffer.from('dfrom offerer')));
      assert.equal((await toAnswerer).toString(), 'dfrom offerer');
      const toOfferer = offerer.nextData();
      assert.ok(answerer.agent.send(Buffer.from('efrom answerer')));
      assert.equal((await toOfferer).toString(), 'efrom answerer');
    } finally {
      offerer.agent.close();
      answerer.agent.close();
    }
  });

  it('connects through a TURN server when only relayed candidates are allowed', async () => {
    const turn = await FakeTurnServer.start();
    const servers: TurnServer[] = [{ address: turn.address, username: turn.username, credential: turn.credential }];
    const relayOnly: CandidatePolicy = { host: false, reflexive: false, relay: true };
    const offerer = createAgent(true, relayOnly, servers);
    const answerer = createAgent(false, relayOnly, servers);
    try {
      const offer = await offerer.agent.gather();
      assert.deepEqual(
        offer.candidates.map((candidate) => candidate.type),
        ['relay'],
      );
      const answer = await answerer.agent.gather();
      answerer.agent.start(offer);
      offerer.agent.start(answer);
      await Promise.all([offerer.connected, answerer.connected]);
      assert.equal(turn.stats.allocations, 2);

      const toAnswerer = answerer.nextData();
      offerer.agent.send(Buffer.from('dthrough the relay'));
      assert.equal((await toAnswerer).toString(), 'dthrough the relay');
      const toOfferer = offerer.nextData();
      answerer.agent.send(Buffer.from('dand back'));
      assert.equal((await toOfferer).toString(), 'dand back');
      assert.ok(turn.stats.relayedToPeers > 0);
    } finally {
      offerer.agent.close();
      answerer.agent.close();
      turn.close();
    }
  });
});

describe('TURN allocation', () => {
  it('relays through permissions and switches to ChannelData after binding a channel', async () => {
    const turn = await FakeTurnServer.start();
    const client = dgram.createSocket('udp4');
    const peer = dgram.createSocket('udp4');
    await Promise.all([
      new Promise<void>((resolve) => client.bind(0, LOOPBACK, () => resolve())),
      new Promise<void>((resolve) => peer.bind(0, LOOPBACK, () => resolve())),
    ]);
    const transactions = new StunTransactions();
    let allocation: TurnAllocation | null = null;
    let onRelayed: ((packet: RelayedPacket) => void) | null = null;
    client.on('message', (data, info) => {
      if (allocation) {
        const packet = allocation.receive(data);
        if (packet) {
          onRelayed?.(packet);
        }
      } else {
        const message = decodeStun(data);
        if (message) {
          transactions.resolve(message, { address: info.address, port: info.port });
        }
      }
    });
    const nextRelayed = (): Promise<RelayedPacket> => waitFor((resolve) => (onRelayed = resolve));
    const peerAddress = { address: LOOPBACK, port: peer.address().port };
    try {
      allocation = await TurnAllocation.allocate(
        { address: turn.address, username: turn.username, credential: turn.credential },
        { transactions, send: (data) => client.send(data, turn.address.port, LOOPBACK), log: () => {} },
      );
      await allocation.createPermission(LOOPBACK);

      let relayed = nextRelayed();
      peer.send('data indication', allocation.relayed.port, LOOPBACK);
      assert.deepEqual(await relayed, { peer: peerAddress, payload: Buffer.from('data indication') });

      await allocation.bindChannel(peerAddress);
      const atPeer = receiveOn(peer);
      allocation.sendTo(peerAddress, Buffer.from('over a channel'));
      assert.equal((await atPeer).data, 'over a channel');
      assert.equal(turn.stats.channelData, 1);

      relayed = nextRelayed();
      peer.send('channel data', allocation.relayed.port, LOOPBACK);
      assert.deepEqual(await relayed, { peer: peerAddress, payload: Buffer.from('channel data') });
    } finally {
      allocation?.close();
      transactions.cancelAll();
      client.close();
      peer.close();
      turn.close();
    }
  });
});


describe('TFAF ICE adapter', () => {
  let logsDirectory: string;

  before(async () => {
    logsDirectory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-ice-test-'));
  });

  after(async () => {
    await rm(logsDirectory, { recursive: true, force: true });
  });

  it('hosts and joins a game between two adapters and relays game traffic', async () => {
    const host = new TfafIceAdapter({ hostAddresses: [LOOPBACK], publicStunUrls: [] });
    const guest = new TfafIceAdapter({ hostAddresses: [LOOPBACK], publicStunUrls: [] });
    // Ready once both sides are connected and have recognised each other as TFAF adapters.
    const statuses = new Map<string, GamePeer>();
    const received = new Map<string, { login: string; fingerprint: GameFingerprint }>();
    let filesReceived: (self: string) => void = () => {};
    const rehosts: { self: string; login: string; modUids: string[] }[] = [];
    const launchers = new Map<string, { login: string; launcher: PeerLauncher }>();
    const kicks: { self: string; login: string; features: string[] }[] = [];
    let bothReady: () => void = () => {};
    const ready = waitFor<void>((resolve) => {
      bothReady = resolve;
    });
    let bothLaunchers: () => void = () => {};
    const launchersKnown = waitFor<void>((resolve) => {
      bothLaunchers = resolve;
    });
    const events = (self: string, other: () => TfafIceAdapter, selfId: number): IceAdapterEvents => ({
      onGpgNetMessage: () => {},
      onIceMessage: (_remotePlayerId, message) => other().iceMessage(selfId, message),
      onConnectionStateChanged: () => {},
      onPeerStatus: (status) => {
        statuses.set(self, status);
        if ([...statuses.values()].filter((peer) => peer.state === 'connected' && peer.tfaf === true).length === 2) {
          bothReady();
        }
      },
      onPeerFiles: (_remotePlayerId, login, fingerprint) => {
        received.set(self, { login, fingerprint });
        filesReceived(self);
      },
      onPeerRehost: (_remotePlayerId, login, modUids) => rehosts.push({ self, login, modUids }),
      onPeerLauncher: (_remotePlayerId, login, launcher) => {
        launchers.set(self, { login, launcher });
        if (launchers.size === 2) {
          bothLaunchers();
        }
      },
      onPeerKick: (_remotePlayerId, login, features) => kicks.push({ self, login, features }),
      onLobbyMessage: () => {},
      onPeerRemoved: () => {},
      onNetworkSuspect: () => {},
      onExit: () => {},
    });
    const options = (
      playerId: number,
      login: string,
      fingerprint: GameFingerprint,
      launcher: FeatureAnnouncement,
    ): IceAdapterStartOptions => ({
      gameId: 100,
      playerId,
      login,
      forceRelay: false,
      lobbyInitMode: 'normal',
      iceServers: [],
      logsDirectory,
      fingerprint,
      launcher,
    });
    // The host's game is isolated, the guest's is not.
    const hostLauncher = announceFeatures(['modIsolation'], '0.7.0');
    const guestLauncher = announceFeatures([], '0.7.1');
    // The same game files, another copy of the map; the host could not read its mods.
    const hostFiles: GameFingerprint = {
      gameFiles: 'aa00000000000001',
      map: 'bb00000000000001',
      mapKey: 'ff00000000000001',
      mods: null,
      modFiles: [{ key: 'dd00000000000001', digest: null }],
    };
    const guestFiles: GameFingerprint = {
      gameFiles: 'aa00000000000001',
      map: 'bb00000000000002',
      mapKey: 'ff00000000000001',
      mods: 'cc00000000000001',
      modFiles: [{ key: 'dd00000000000001', digest: 'ee00000000000001' }],
    };

    const hostGame = await launchFakeGame(
      await host.start(options(1, 'alpha', hostFiles, hostLauncher), events('host', () => guest, 1)),
    );
    const guestGame = await launchFakeGame(
      await guest.start(options(2, 'beta', guestFiles, guestLauncher), events('guest', () => host, 2)),
    );
    try {
      host.hostGame('scmp_009');
      assert.deepEqual((await hostGame.next('HostGame')).args, ['scmp_009']);

      guest.joinGame('alpha', 1);
      const join = await guestGame.next('JoinGame');
      assert.deepEqual(join.args.slice(1), ['alpha', 1]);
      host.connectToPeer('beta', 2, true);
      const connect = await hostGame.next('ConnectToPeer');
      assert.deepEqual(connect.args.slice(1), ['beta', 2]);
      await ready;
      assert.deepEqual(received.get('host'), { login: 'beta', fingerprint: guestFiles });
      assert.deepEqual(received.get('guest'), { login: 'alpha', fingerprint: hostFiles });
      // Each side tells what its game was started with.
      await launchersKnown;
      assert.deepEqual(launchers.get('host'), { login: 'beta', launcher: { kind: 'tfaf', announcement: guestLauncher } });
      assert.deepEqual(launchers.get('guest'), { login: 'alpha', launcher: { kind: 'tfaf', announcement: hostLauncher } });

      // The guest's lobby picked the host's copy of the map: the host gets the new files without a new handshake.
      const guestChanged: GameFingerprint = { ...guestFiles, map: 'bb00000000000001' };
      const resent = waitFor<void>((resolve) => {
        filesReceived = (self) => self === 'host' && resolve();
      });
      guest.updateFingerprint(guestChanged);
      await resent;
      assert.deepEqual(received.get('host'), { login: 'beta', fingerprint: guestChanged });

      // The host creates its game again with other mods: the guest hears it once and confirms long before the timeout.
      const announcedAt = Date.now();
      await host.announceRehost(['mod-a', 'mod-b']);
      assert.ok(Date.now() - announcedAt < 1500);
      assert.deepEqual(rehosts, [{ self: 'guest', login: 'alpha', modUids: ['mod-a', 'mod-b'] }]);

      // Each game sends to the address the adapter gave it for the other player.
      const [, hostPeerPort] = String(connect.args[0]).split(':');
      const [, guestPeerPort] = String(join.args[0]).split(':');
      const atGuest = receiveOn(guestGame.lobby);
      hostGame.lobby.send('from host', Number(hostPeerPort), LOOPBACK);
      assert.deepEqual(await atGuest, { data: 'from host', port: Number(guestPeerPort) });
      const atHost = receiveOn(hostGame.lobby);
      guestGame.lobby.send('from guest', Number(guestPeerPort), LOOPBACK);
      assert.deepEqual(await atHost, { data: 'from guest', port: Number(hostPeerPort) });

      // The host disconnects the guest: the guest hears why once, the host's game drops the guest.
      await host.kickPeer(2, ['modIsolation']);
      assert.deepEqual((await hostGame.next('DisconnectFromPeer')).args, [2]);
      assert.deepEqual(kicks, [{ self: 'guest', login: 'alpha', features: ['modIsolation'] }]);
    } finally {
      host.stop();
      guest.stop();
      hostGame.close();
      guestGame.close();
    }
  });

  it('connects players before the game runs, and keeps them through a game that closes', async () => {
    const host = new TfafIceAdapter({ hostAddresses: [LOOPBACK], publicStunUrls: [] });
    const guest = new TfafIceAdapter({ hostAddresses: [LOOPBACK], publicStunUrls: [] });
    const launcher = announceFeatures(['launcherLobby'], '0.10.0');
    const atGuest: string[] = [];
    const atHost: string[] = [];
    let peersKnown = 0;
    let bothKnown: () => void = () => {};
    const known = waitFor<void>((resolve) => {
      bothKnown = resolve;
    });
    const events = (other: () => TfafIceAdapter, selfId: number, inbox: string[]): IceAdapterEvents => ({
      onGpgNetMessage: () => {},
      onIceMessage: (_remotePlayerId, message) => other().iceMessage(selfId, message),
      onConnectionStateChanged: () => {},
      onPeerStatus: () => {},
      onPeerFiles: () => {},
      onPeerRehost: () => {},
      onPeerLauncher: () => {
        peersKnown++;
        if (peersKnown === 2) {
          bothKnown();
        }
      },
      onPeerKick: () => {},
      onLobbyMessage: (_remotePlayerId, _login, text) => inbox.push(text),
      onPeerRemoved: () => {},
      onNetworkSuspect: () => {},
      onExit: () => {},
    });
    const options = (playerId: number, login: string): IceAdapterStartOptions => ({
      gameId: 101,
      playerId,
      login,
      forceRelay: false,
      lobbyInitMode: 'normal',
      iceServers: [],
      logsDirectory,
      fingerprint: null,
      launcher,
      gameless: true,
    });
    const hostPort = await host.start(options(1, 'alpha'), events(() => guest, 1, atHost));
    const guestPort = await guest.start(options(2, 'beta'), events(() => host, 2, atGuest));
    try {
      // No game yet: the server's commands connect the players, and nothing waits for a game.
      host.hostGame('scmp_009');
      guest.joinGame('alpha', 1);
      host.connectToPeer('beta', 2, true);
      await known;

      assert.equal(host.sendLobbyMessage(2, 'room', 'room'), true);
      assert.equal(guest.sendLobbyMessage(1, 'status', 'status'), true);
      await waitFor<void>((resolve) => {
        const check = setInterval(() => {
          if (atGuest.length > 0 && atHost.length > 0) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });
      assert.deepEqual([atGuest, atHost], [['room'], ['status']]);

      // The host picked another map in the room; the game gets it, and only once it is released.
      host.setHostedMap('scmp_015');
      const hostGame = await launchFakeGame(hostPort);
      const guestGame = await launchFakeGame(guestPort);
      guest.releaseGame();
      host.releaseGame();
      assert.deepEqual((await hostGame.next('HostGame')).args, ['scmp_015']);
      assert.deepEqual((await hostGame.next('ConnectToPeer')).args.slice(1), ['beta', 2]);
      assert.deepEqual((await guestGame.next('JoinGame')).args.slice(1), ['alpha', 1]);

      // A start that failed: the games are gone, the players are not.
      hostGame.close();
      guestGame.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(host.sendLobbyMessage(2, 'again', null), true);
      await waitFor<void>((resolve) => {
        const check = setInterval(() => {
          if (atGuest.length > 1) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      // The next start commands the new game again.
      const secondGame = await launchFakeGame(guestPort);
      guest.releaseGame();
      assert.deepEqual((await secondGame.next('JoinGame')).args.slice(1), ['alpha', 1]);
      secondGame.close();
    } finally {
      host.stop();
      guest.stop();
    }
  });
});
