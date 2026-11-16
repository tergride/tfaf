// Our adapter against the official Java adapter (faf-ice-adapter, ice4j) on this computer, without the game: a fake
// game on each side, both roles, and a reconnect after an outage on our side. The Java adapter parses every IceMsg
// strictly, so its log must not show a message it could not read.
//
// After a connection attempt the Java adapter leaves out its host candidates for two minutes (and then everything but
// relays), and on one computer only host candidates connect, so the outages come two minutes into the connection, as
// they would mid-game. The two pairs run side by side; the whole run takes about two and a half minutes.
//
// Opt-in, since it needs the Java runtime the launcher downloads: set TFAF_JAVA_ICE_ADAPTER to the runtime folder
// (C:\ProgramData\TFAF\runtime when set to 1).
//   $env:TFAF_JAVA_ICE_ADAPTER = '1'; node --test test/javaInterop.test.ts

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { IceAdapter, IceAdapterEvents } from '../src/main/game/iceAdapter.ts';
import { JavaIceAdapter } from '../src/main/game/javaIceAdapter.ts';
import type { JavaIceAdapterRuntime, RuntimeComponents } from '../src/main/game/runtimeComponents.ts';
import { TfafIceAdapter } from '../src/main/ice/tfafIceAdapter.ts';
import { systemUdp, type UdpSocket, type UdpTransport } from '../src/main/ice/udpTransport.ts';
import { type FakeGame, launchFakeGame } from './helpers/fakeGame.ts';

const LOOPBACK = '127.0.0.1';
// The Java adapter's window for counting connection attempts (PeerIceModule.FORCE_SRFLX_RELAY_INTERVAL), and a margin.
const JAVA_ATTEMPT_WINDOW_MS = 2 * 60 * 1000 + 5_000;
// Longer than the echo timeout of both adapters.
const OUTAGE_MS = 13_000;

function findRuntime(setting: string | undefined): JavaIceAdapterRuntime | null {
  if (!setting) {
    return null;
  }
  const directory = setting === '1' ? path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'TFAF', 'runtime') : setting;
  if (!existsSync(directory)) {
    return null;
  }
  const entries = readdirSync(directory);
  const jar = entries.find((name) => /^faf-ice-adapter-.*\.jar$/.test(name));
  const jre = entries.find((name) => /^jdk-.*-jre$/.test(name));
  const java = jre ? path.join(directory, jre, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : null;
  const logback = path.join(directory, 'ice-adapter-logback.xml');
  if (!jar || !java || !existsSync(java) || !existsSync(logback)) {
    return null;
  }
  return { javaPath: java, jarPath: path.join(directory, jar), logbackConfigPath: logback };
}

const runtime = findRuntime(process.env.TFAF_JAVA_ICE_ADAPTER);

/** Real UDP that can be cut off, as our side of an outage. */
class SwitchableUdp implements UdpTransport {
  blocked = false;

  createSocket(): UdpSocket {
    const inner = systemUdp.createSocket();
    return {
      bind: (address, port) => inner.bind(address, port),
      send: (data, to) => {
        if (!this.blocked) {
          inner.send(data, to);
        }
      },
      onMessage: (listener) =>
        inner.onMessage((data, from) => {
          if (!this.blocked) {
            listener(data, from);
          }
        }),
      onError: (listener) => inner.onError(listener),
      address: () => inner.address(),
      close: () => inner.close(),
    };
  }
}

interface Side {
  id: number;
  login: string;
  adapter: IceAdapter;
  game: FakeGame | null;
  logs: string[];
}

/** The lobby server between the two adapters; a dead connection to it drops IceMsg. */
class Lobby {
  dead = false;
  readonly sides = new Map<number, Side>();

  relay(from: number, to: number, message: unknown): void {
    if (!this.dead) {
      setTimeout(() => this.sides.get(to)?.adapter.iceMessage(from, message), 5);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await sleep(100);
  }
}

function events(lobby: Lobby, id: number): IceAdapterEvents {
  return {
    onGpgNetMessage: () => {},
    onIceMessage: (remotePlayerId, message) => lobby.relay(id, remotePlayerId, message),
    onConnectionStateChanged: () => {},
    onPeerStatus: () => {},
    onPeerFiles: () => {},
    onPeerRehost: () => {},
    onPeerLauncher: () => {},
    onPeerKick: () => {},
    onLobbyMessage: () => {},
    onPeerRemoved: () => {},
    onNetworkSuspect: () => {},
    onExit: () => {},
  };
}

/**
 * Sends from one game to the other until a packet arrives, the way the games keep sending while they wait for each
 * other. Each call sends its own payload, so a late packet of an earlier call does not count.
 */
async function carries(from: FakeGame, toPeerPort: number, to: FakeGame, timeoutMs: number): Promise<void> {
  const payload = `game packet ${Math.random()}`;
  const startedAt = Date.now();
  let arrived = false;
  const listener = (data: Buffer): void => {
    arrived ||= data.toString() === payload;
  };
  to.lobby.on('message', listener);
  try {
    // eslint-disable-next-line no-unmodified-loop-condition -- the message listener sets it while the loop sleeps
    while (!arrived) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`No game traffic within ${timeoutMs} ms`);
      }
      from.lobby.send(payload, toPeerPort, LOOPBACK);
      await sleep(100);
    }
  } finally {
    to.lobby.off('message', listener);
  }
}

function loggedSince(side: Side, mark: number, pattern: RegExp): boolean {
  return side.logs.slice(mark).some((line) => pattern.test(line));
}

describe('TFAF adapter with the Java adapter', { skip: runtime ? false : 'set TFAF_JAVA_ICE_ADAPTER to run it', concurrency: 2 }, () => {
  let logsDirectory = '';
  const sides: Side[] = [];

  before(async () => {
    logsDirectory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-java-interop-'));
  });

  after(async () => {
    for (const side of sides) {
      side.adapter.stop();
      side.game?.close();
    }
    // The Java adapter gets a few seconds to quit before it is killed.
    await sleep(3_500);
    await rm(logsDirectory, { recursive: true, force: true });
  });

  async function start(lobby: Lobby, kind: 'tfaf' | 'java', id: number, login: string, gameId: number, transport?: UdpTransport): Promise<Side> {
    const logs: string[] = [];
    const adapter: IceAdapter =
      kind === 'tfaf'
        ? new TfafIceAdapter({ publicStunUrls: [], transport, onLog: (line) => logs.push(line) })
        : new JavaIceAdapter({ ensureJavaIceAdapter: async () => runtime! } as unknown as RuntimeComponents);
    const side: Side = { id, login, adapter, game: null, logs };
    sides.push(side);
    lobby.sides.set(id, side);
    const gpgPort = await adapter.start(
      {
        gameId,
        playerId: id,
        login,
        forceRelay: false,
        lobbyInitMode: 'normal',
        iceServers: [],
        logsDirectory,
        fingerprint: null,
        launcher: null,
      },
      events(lobby, id),
    );
    side.game = await launchFakeGame(gpgPort, 20_000, 500);
    return side;
  }

  /** The server's commands: the host offers to the guest; resolves with the game ports for each other. */
  async function connect(host: Side, guest: Side): Promise<{ hostToGuest: number; guestToHost: number }> {
    host.adapter.hostGame('scmp_009');
    await host.game!.next('HostGame');
    guest.adapter.joinGame(host.login, host.id);
    host.adapter.connectToPeer(guest.login, guest.id, true);
    const join = await guest.game!.next('JoinGame');
    const connectTo = await host.game!.next('ConnectToPeer');
    return { hostToGuest: Number(String(connectTo.args[0]).split(':')[1]), guestToHost: Number(String(join.args[0]).split(':')[1]) };
  }

  async function javaLog(gameId: number): Promise<string> {
    return readFile(path.join(logsDirectory, `ice-adapter-${gameId}.log`), 'utf8').catch(() => '');
  }

  /** On failure both logs go to the output: the Java adapter's view is what tells interop problems apart. */
  async function diagnosed(ours: Side, gameId: number, body: () => Promise<void>): Promise<void> {
    try {
      await body();
    } catch (error) {
      console.log(`--- TFAF adapter ${ours.login}\n${ours.logs.join('\n')}`);
      // The adapter's own lines, without ice4j's harvesting noise and the telemetry it cannot reach.
      const java = (await javaLog(gameId))
        .split(/\r?\n/)
        .filter((line) => / c\.f\.i\./.test(line) && !/TelemetryDebugger|JJsonPeer|Sending (Notification|Response)/.test(line))
        .slice(-120)
        .join('\n');
      console.log(`--- Java adapter (game ${gameId})\n${java}`);
      throw error;
    }
  }

  it('connects when we offer, and offers again once the lobby is back after an outage on our side', async () => {
    const lobby = new Lobby();
    const transport = new SwitchableUdp();
    const ours = await start(lobby, 'tfaf', 501, 'alpha', 9001, transport);
    const java = await start(lobby, 'java', 502, 'beta', 9001);
    await diagnosed(ours, 9001, async () => {
      const ports = await connect(ours, java);
      await carries(ours.game!, ports.hostToGuest, java.game!, 20_000);
      await carries(java.game!, ports.guestToHost, ours.game!, 5_000);
      await sleep(JAVA_ATTEMPT_WINDOW_MS);
      await carries(ours.game!, ports.hostToGuest, java.game!, 5_000);

      // Our network and our lobby connection go away together for longer than the echo timeout.
      const mark = ours.logs.length;
      transport.blocked = true;
      lobby.dead = true;
      await sleep(OUTAGE_MS);
      transport.blocked = false;
      lobby.dead = false;
      ours.adapter.signalingRestored();
      await until(() => loggedSince(ours, mark, /beta\(502\): connected: /), 'the reconnect', 30_000);
      await carries(ours.game!, ports.hostToGuest, java.game!, 10_000);
      await carries(java.game!, ports.guestToHost, ours.game!, 10_000);
      assert.ok(loggedSince(ours, mark, /no echo answers/));
      assert.ok(loggedSince(ours, mark, /the lobby server is back, offering again/));
      assert.doesNotMatch(await javaLog(9001), /Failed to parse iceMsg/);
    });
  });

  it('connects when the Java adapter offers, and follows its new offer after an outage on our side', async () => {
    const lobby = new Lobby();
    const transport = new SwitchableUdp();
    const java = await start(lobby, 'java', 601, 'gamma', 9002);
    const ours = await start(lobby, 'tfaf', 602, 'delta', 9002, transport);
    await diagnosed(ours, 9002, async () => {
      const ports = await connect(java, ours);
      await carries(java.game!, ports.hostToGuest, ours.game!, 20_000);
      await carries(ours.game!, ports.guestToHost, java.game!, 5_000);
      // Without the TFAF handshake the Java peer is known as another adapter, and nothing TFAF goes to it.
      await until(() => loggedSince(ours, 0, /no answer to the TFAF handshake/), 'the end of the handshake', 10_000);
      await sleep(JAVA_ATTEMPT_WINDOW_MS);

      const mark = ours.logs.length;
      transport.blocked = true;
      await sleep(OUTAGE_MS);
      transport.blocked = false;
      await until(() => loggedSince(ours, mark, /gamma\(601\): connected: /), 'the reconnect', 30_000);
      await carries(java.game!, ports.hostToGuest, ours.game!, 10_000);
      await carries(ours.game!, ports.guestToHost, java.game!, 10_000);
      assert.ok(loggedSince(ours, mark, /new offer received, restarting/));
      assert.doesNotMatch(await javaLog(9002), /Failed to parse iceMsg/);
    });
  });
});
