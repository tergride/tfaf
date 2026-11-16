import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { GamePeer, PeerConnectionState } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { IceAdapter, IceAdapterEvents, IceAdapterStartOptions } from './iceAdapter.ts';
import { JsonRpcClient } from './jsonRpc.ts';
import type { RuntimeComponents } from './runtimeComponents.ts';

const QUIT_GRACE_MS = 3_000;

async function freePort(): Promise<{ port: number; release(): Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(t('main.ice.noLocalPort'));
  }
  return { port: address.port, release: () => new Promise((resolve) => server.close(() => resolve())) };
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * The official faf-ice-adapter (Java, ice4j) controlled over JSON-RPC, like IceAdapterImpl of the official client.
 * Java and the adapter jar are downloaded on first use by RuntimeComponents.
 */
export class JavaIceAdapter implements IceAdapter {
  private readonly runtime: RuntimeComponents;
  private process: ChildProcess | null = null;
  private rpc: JsonRpcClient | null = null;
  private events: IceAdapterEvents | null = null;
  // The adapter reports players by id only; logins come from the lobby commands.
  private readonly peers = new Map<number, GamePeer>();
  private stopping = false;

  constructor(runtime: RuntimeComponents) {
    this.runtime = runtime;
  }

  async start(options: IceAdapterStartOptions, events: IceAdapterEvents): Promise<number> {
    this.events = events;
    const { javaPath, jarPath, logbackConfigPath } = await this.runtime.ensureJavaIceAdapter();

    // Both ports are reserved at the same time so they cannot collide, then released for the adapter to bind.
    const rpcPort = await freePort();
    const gpgPort = await freePort();
    await rpcPort.release();
    await gpgPort.release();

    const args = [
      `-Dlogback.configurationFile=${logbackConfigPath}`,
      '-Dorg.ice4j.ipv6.DISABLED=true',
      '-cp',
      jarPath,
      'com.faforever.iceadapter.IceAdapter',
      '--id',
      String(options.playerId),
      '--game-id',
      String(options.gameId),
      '--login',
      options.login,
      '--rpc-port',
      String(rpcPort.port),
      '--gpgnet-port',
      String(gpgPort.port),
    ];
    if (options.forceRelay) {
      args.push('--force-relay');
    }

    await mkdir(options.logsDirectory, { recursive: true });
    const log = createWriteStream(path.join(options.logsDirectory, `ice-adapter-${options.gameId}.log`), { flags: 'a' });
    const child = spawn(javaPath, args, {
      cwd: path.dirname(jarPath),
      env: { ...process.env, LOG_DIR: path.join(options.logsDirectory, 'iceAdapterLogs') },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once('exit', (code) => {
      log.end();
      this.process = null;
      if (!this.stopping) {
        events.onExit(code === null ? t('main.ice.exitedUnknownCode') : t('main.ice.exitedWithCode', { code }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', (error) => reject(new Error(t('main.ice.spawnFailed', { error: describeError(error) }))));
    });

    try {
      this.rpc = await JsonRpcClient.connect(rpcPort.port, {
        onCall: (method, params) => this.dispatch(method, params, events),
        onClose: () => {
          this.rpc = null;
        },
      });
    } catch (error) {
      this.stop();
      throw new Error(t('main.ice.notResponding', { error: describeError(error) }), { cause: error });
    }

    this.rpc.send('setLobbyInitMode', [options.lobbyInitMode]);
    this.rpc.send('setIceServers', [
      options.iceServers.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential,
      })),
    ]);
    return gpgPort.port;
  }

  hostGame(mapName: string): void {
    this.removePeers();
    this.rpc?.send('hostGame', [mapName]);
  }

  joinGame(remotePlayerLogin: string, remotePlayerId: number): void {
    this.removePeers();
    this.addPeer(remotePlayerLogin, remotePlayerId);
    this.rpc?.send('joinGame', [remotePlayerLogin, remotePlayerId]);
  }

  connectToPeer(remotePlayerLogin: string, remotePlayerId: number, offer: boolean): void {
    this.addPeer(remotePlayerLogin, remotePlayerId);
    this.rpc?.send('connectToPeer', [remotePlayerLogin, remotePlayerId, offer]);
  }

  disconnectFromPeer(remotePlayerId: number): void {
    if (this.peers.delete(remotePlayerId)) {
      this.events?.onPeerRemoved(remotePlayerId);
    }
    this.rpc?.send('disconnectFromPeer', [remotePlayerId]);
  }

  iceMessage(remotePlayerId: number, message: unknown): void {
    this.rpc?.send('iceMsg', [remotePlayerId, message]);
  }

  signalingRestored(): void {}

  async announceRehost(): Promise<void> {}

  async kickPeer(remotePlayerId: number): Promise<void> {
    this.disconnectFromPeer(remotePlayerId);
  }

  updateFingerprint(): void {}

  stop(): void {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    this.rpc?.send('quit', []);
    const child = this.process;
    if (child) {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
      }, QUIT_GRACE_MS);
    }
    setTimeout(() => this.rpc?.close(), QUIT_GRACE_MS);
  }

  private addPeer(login: string, playerId: number): void {
    const peer: GamePeer = {
      playerId,
      login,
      state: 'connecting',
      route: null,
      rttMs: null,
      tfaf: null,
      duplication: false,
      loss: null,
    };
    this.peers.set(playerId, peer);
    this.events?.onPeerStatus(peer);
  }

  private updatePeer(playerId: number, connected: boolean): void {
    const peer = this.peers.get(playerId);
    if (!peer) {
      return;
    }
    const state: PeerConnectionState = connected ? 'connected' : peer.state === 'connecting' ? 'connecting' : 'reconnecting';
    if (state !== peer.state) {
      const updated = { ...peer, state };
      this.peers.set(playerId, updated);
      this.events?.onPeerStatus(updated);
    }
  }

  private removePeers(): void {
    for (const playerId of this.peers.keys()) {
      this.events?.onPeerRemoved(playerId);
    }
    this.peers.clear();
  }

  private dispatch(method: string, params: unknown[], events: IceAdapterEvents): void {
    switch (method) {
      case 'onConnectionStateChanged':
        events.onConnectionStateChanged(typeof params[0] === 'string' ? params[0] : 'unknown');
        break;
      case 'onGpgNetMessageReceived':
        if (typeof params[0] === 'string') {
          events.onGpgNetMessage(params[0], Array.isArray(params[1]) ? params[1] : []);
        }
        break;
      case 'onIceMsg': {
        const remotePlayerId = asInteger(params[1]);
        if (remotePlayerId !== null) {
          events.onIceMessage(remotePlayerId, params[2]);
        }
        break;
      }
      case 'onConnected': {
        const remotePlayerId = asInteger(params[1]);
        if (remotePlayerId !== null) {
          this.updatePeer(remotePlayerId, params[2] === true);
        }
        break;
      }
      case 'onIceConnectionStateChanged': {
        const remotePlayerId = asInteger(params[1]);
        if (remotePlayerId !== null) {
          this.updatePeer(remotePlayerId, params[2] === 'connected' || params[2] === 'completed');
        }
        break;
      }
      default:
        console.warn(`Unknown call from the ICE adapter: ${method}`);
    }
  }
}
