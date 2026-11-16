// Our own network adapter, a drop-in replacement for the FAF Java ICE adapter: the same GPGNet behaviour towards the
// game and the same candidate exchange and packet format towards other players, so it connects to players running
// the official client. Runs inside the main process, no Java required.

import { randomInt } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import dgram from 'node:dgram';
import path from 'node:path';
import { describeError } from '../errors.ts';
import type { GameFingerprint } from '../game/fingerprint.ts';
import type { IceAdapterEvents, IceAdapterStartOptions, LobbyAdapter } from '../game/iceAdapter.ts';
import type { PeerLauncher } from '../game/lobbyFeatureChecks.ts';
import { parseAnnouncement, serializeAnnouncement } from '../game/lobbyFeatures.ts';
import { parseCandidatesMessage } from './candidates.ts';
import { type GpgNetArg, type GpgNetMessage, GpgNetServer } from './gpgnet.ts';
import { IceAgent } from './iceAgent.ts';
import { hostAddresses, PUBLIC_STUN_URLS, type ResolvedIceServers, resolveIceServers } from './iceServers.ts';
import { DEFAULT_ICE_TIMINGS, type IceTimings } from './iceTimings.ts';
import { type PeerContext, PeerConnection, type RemoteLauncher } from './peerConnection.ts';
import { parseSignal, serializeSignal } from './signaling.ts';
import { LOCAL_FEATURES, MAX_LAUNCHER_INFO_BYTES } from './tfafProtocol.ts';
import type { UdpTransport } from './udpTransport.ts';

export interface TfafIceAdapterOptions {
  /** Overrides the local addresses for host candidates (tests use the loopback address). */
  hostAddresses?: string[];
  publicStunUrls?: string[];
  /** Tests run the players over a simulated network with shorter timeouts and read the log as it is written. */
  transport?: UdpTransport;
  timings?: IceTimings;
  onLog?: (line: string) => void;
  /** Tests play an older TFAF by announcing fewer features. */
  features?: number;
}

const LOCALHOST = '127.0.0.1';
const MAX_LOGGED_ARGS_LENGTH = 300;
// The game reports no moment at which it hosts, so it gets a little time before the players are named to it. Coming
// from the server, they would arrive later still.
const HOST_SETTLE_MS = 1_000;
// Every player going silent at once is reported once in this interval at most.
const NETWORK_SUSPECT_INTERVAL_MS = 10_000;

/** A launcher whose `launcher` message cannot be read counts as another client. */
function toPeerLauncher(launcher: RemoteLauncher): PeerLauncher {
  if (launcher.kind !== 'tfaf') {
    return launcher;
  }
  const announcement = parseAnnouncement(launcher.info);
  return announcement ? { kind: 'tfaf', announcement } : { kind: 'other' };
}

async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => resolve());
  });
  const { port } = socket.address();
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

export class TfafIceAdapter implements LobbyAdapter {
  private readonly adapterOptions: TfafIceAdapterOptions;
  private options: IceAdapterStartOptions | null = null;
  private events: IceAdapterEvents | null = null;
  private launcherInfo: string | null = null;
  private fingerprint: GameFingerprint | null = null;
  private log: WriteStream | null = null;
  private gpgnet: GpgNetServer | null = null;
  private servers: Promise<ResolvedIceServers> = Promise.resolve({ stun: [], turn: [] });
  private lobbyPort = 0;
  private gameState = 'None';
  private lobbyReady = false;
  private toGame: GpgNetMessage[] = [];
  private readonly peers = new Map<number, PeerConnection>();
  private gameEnded = false;
  // Lobby commands are applied one after another, because opening a peer socket is asynchronous.
  private commands: Promise<void> = Promise.resolve();
  private stopped = false;
  // Without a game (IceAdapterStartOptions.gameless) the commands for it are made up from these once it is released.
  private gameless = false;
  private hostedMap: string | null = null;
  private joinedHost: { login: string; id: number } | null = null;
  private released = false;
  private gameCommanded = false;
  private settleTimer: NodeJS.Timeout | null = null;
  private networkSuspectAt = 0;

  constructor(options: TfafIceAdapterOptions = {}) {
    this.adapterOptions = options;
  }

  async start(options: IceAdapterStartOptions, events: IceAdapterEvents): Promise<number> {
    this.options = options;
    this.events = events;
    this.gameless = options.gameless === true;
    this.launcherInfo = options.launcher ? serializeAnnouncement(options.launcher, MAX_LAUNCHER_INFO_BYTES) : null;
    this.fingerprint = options.fingerprint;
    this.log = createWriteStream(path.join(options.logsDirectory, `tfaf-ice-adapter-${options.gameId}.log`), { flags: 'a' });
    this.log.on('error', () => {});
    this.write(
      `TFAF ICE adapter: game ${options.gameId}, player ${options.login}(${options.playerId}), force relay: ${options.forceRelay}`,
    );
    this.servers = resolveIceServers(options.iceServers, this.adapterOptions.publicStunUrls ?? PUBLIC_STUN_URLS).then(
      (servers) => {
        this.write(`ICE servers: ${servers.stun.length} STUN, ${servers.turn.length} TURN`);
        return servers;
      },
    );
    this.lobbyPort = await freeUdpPort();
    this.gpgnet = await GpgNetServer.listen({
      onConnected: () => this.onGameConnected(),
      onMessage: (message) => this.onGameMessage(message),
      onDisconnected: (reason) => this.onGameDisconnected(reason),
    });
    this.write(`GPGNet port ${this.gpgnet.port}, lobby port ${this.lobbyPort}`);
    return this.gpgnet.port;
  }

  hostGame(mapName: string): void {
    this.enqueue('HostGame', async () => {
      await this.resetSession();
      if (this.gameless) {
        this.hostedMap ??= mapName;
      } else {
        this.sendToGame('HostGame', [mapName]);
      }
    });
  }

  joinGame(remotePlayerLogin: string, remotePlayerId: number): void {
    this.enqueue('JoinGame', async () => {
      await this.resetSession();
      const peer = await this.connectPeer(remotePlayerLogin, remotePlayerId, false);
      if (this.gameless) {
        this.joinedHost = { login: remotePlayerLogin, id: remotePlayerId };
      } else {
        this.sendToGame('JoinGame', [`${LOCALHOST}:${peer.port}`, remotePlayerLogin, remotePlayerId]);
      }
    });
  }

  connectToPeer(remotePlayerLogin: string, remotePlayerId: number, offer: boolean): void {
    this.enqueue('ConnectToPeer', async () => {
      if (this.gameState === 'Launching' || this.gameState === 'Ended') {
        this.write(`ConnectToPeer ${remotePlayerLogin}(${remotePlayerId}) ignored, game state ${this.gameState}`);
        return;
      }
      const peer = await this.connectPeer(remotePlayerLogin, remotePlayerId, offer);
      if (!this.gameless || this.gameCommanded) {
        this.sendToGame('ConnectToPeer', [`${LOCALHOST}:${peer.port}`, remotePlayerLogin, remotePlayerId]);
      }
    });
  }

  signalingRestored(): void {
    this.enqueue('signalingRestored', () => {
      for (const peer of this.peers.values()) {
        peer.signalingRestored();
      }
    });
  }

  disconnectFromPeer(remotePlayerId: number): void {
    this.enqueue('DisconnectFromPeer', async () => {
      const peer = this.peers.get(remotePlayerId);
      this.peers.delete(remotePlayerId);
      if (peer) {
        this.events?.onPeerRemoved(remotePlayerId);
        await peer.close();
      }
      if (!this.gameless || this.gameCommanded) {
        this.sendToGame('DisconnectFromPeer', [remotePlayerId]);
      }
    });
  }

  sendLobbyMessage(remotePlayerId: number, text: string, key: string | null): boolean {
    return this.peers.get(remotePlayerId)?.sendLobbyMessage(text, key) ?? false;
  }

  setHostedMap(mapName: string): void {
    this.hostedMap = mapName;
  }

  releaseGame(): void {
    this.released = true;
    this.commandGame();
  }

  iceMessage(remotePlayerId: number, message: unknown): void {
    this.enqueue('IceMsg', () => {
      const peer = this.peers.get(remotePlayerId);
      const signal = parseSignal(message);
      if (signal) {
        if (peer && signal.destinationId === this.options?.playerId) {
          peer.onSignal(signal.kind);
        } else {
          this.write(`TFAF signal ${signal.kind} from ${remotePlayerId} ignored`);
        }
        return;
      }
      const parsed = parseCandidatesMessage(message);
      if (!parsed || !peer) {
        this.write(`IceMsg from ${remotePlayerId} ignored: ${parsed ? 'unknown player' : 'invalid message'}`);
        return;
      }
      // Answering gathers candidates for several seconds; later commands do not wait for it.
      void peer.onRemoteCandidates(parsed.parameters);
    });
  }

  async announceRehost(modUids: string[]): Promise<void> {
    const peers = [...this.peers.values()];
    const id = randomInt(1, 2 ** 32);
    const confirmed = await Promise.all(peers.map((peer) => peer.announceRehost(id, modUids)));
    this.write(`rehost with ${modUids.length} mods confirmed by ${confirmed.filter(Boolean).length} of ${peers.length} players`);
  }

  async kickPeer(remotePlayerId: number, features: string[]): Promise<void> {
    await this.peers.get(remotePlayerId)?.kick(features);
    this.disconnectFromPeer(remotePlayerId);
  }

  updateFingerprint(fingerprint: GameFingerprint): void {
    if (JSON.stringify(fingerprint) === JSON.stringify(this.fingerprint)) {
      return;
    }
    this.fingerprint = fingerprint;
    this.write(`our files changed in the lobby, sending them to ${this.peers.size} players`);
    for (const peer of this.peers.values()) {
      void peer.sendFiles();
    }
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.clearSettleTimer();
    this.gpgnet?.close();
    const peers = [...this.peers.values()];
    this.peers.clear();
    void Promise.all(peers.map((peer) => peer.close(true))).finally(() => {
      this.write('stopped');
      this.log?.end();
    });
  }

  private enqueue(name: string, task: () => Promise<void> | void): void {
    this.commands = this.commands
      .then(() => (this.stopped ? undefined : task()))
      .catch((error: unknown) => this.write(`${name} failed: ${describeError(error)}`));
  }

  private async resetSession(): Promise<void> {
    const peers = [...this.peers.values()];
    this.peers.clear();
    this.gameEnded = false;
    for (const peer of peers) {
      this.events?.onPeerRemoved(peer.remoteId);
    }
    await Promise.all(peers.map((peer) => peer.close(true)));
  }

  /** Like the Java adapter, a repeated connect replaces the peer and keeps its port and offer role. */
  private async connectPeer(login: string, id: number, offer: boolean): Promise<PeerConnection> {
    const existing = this.peers.get(id);
    let port = 0;
    if (existing) {
      this.peers.delete(id);
      port = existing.port;
      offer = existing.offer;
      await existing.close();
    }
    const peer = await PeerConnection.open(this.peerContext(), login, id, offer, port);
    this.peers.set(id, peer);
    return peer;
  }

  private peerContext(): PeerContext {
    const options = this.options!;
    const events = this.events!;
    return {
      localId: options.playerId,
      lobbyPort: this.lobbyPort,
      forceRelay: options.forceRelay,
      timings: this.adapterOptions.timings ?? DEFAULT_ICE_TIMINGS,
      localFeatures: this.adapterOptions.features ?? LOCAL_FEATURES,
      fingerprint: () => this.fingerprint,
      onFiles: (remoteId, remoteLogin, fingerprint) => events.onPeerFiles(remoteId, remoteLogin, fingerprint),
      onRehost: (remoteId, remoteLogin, modUids) => events.onPeerRehost(remoteId, remoteLogin, modUids),
      launcherInfo: this.launcherInfo,
      onLauncher: (remoteId, remoteLogin, launcher) => events.onPeerLauncher(remoteId, remoteLogin, toPeerLauncher(launcher)),
      onKick: (remoteId, remoteLogin, features) => events.onPeerKick(remoteId, remoteLogin, features),
      onLobbyMessage: (remoteId, remoteLogin, text) => events.onLobbyMessage(remoteId, remoteLogin, text),
      createAgent: async ({ controlling, policy, remotePolicy }, agentEvents, log) => {
        const servers = await this.servers;
        const towards = servers.turn[0]?.address ?? servers.stun[0] ?? null;
        return new IceAgent(
          {
            controlling,
            hostAddresses: this.adapterOptions.hostAddresses ?? (await hostAddresses(towards)),
            stunServers: servers.stun,
            turnServers: servers.turn,
            policy,
            remotePolicy,
            transport: this.adapterOptions.transport,
            timings: this.adapterOptions.timings,
            log,
          },
          agentEvents,
        );
      },
      sendCandidates: (remoteId, message) => events.onIceMessage(remoteId, message),
      sendSignal: (remoteId, kind) =>
        events.onIceMessage(remoteId, serializeSignal({ kind, sourceId: options.playerId, destinationId: remoteId })),
      onSilent: () => this.checkNetwork(),
      onStatus: (status) => events.onPeerStatus(status),
      isGameEnded: () => this.gameEnded,
      log: (message) => this.write(message),
    };
  }

  /** Every player silent at once: the lobby connection, which carries the reconnects, is likely dead as well. */
  private checkNetwork(): void {
    const now = Date.now();
    const peers = [...this.peers.values()];
    if (peers.length === 0 || now - this.networkSuspectAt < NETWORK_SUSPECT_INTERVAL_MS || !peers.every((peer) => peer.isQuiet(now))) {
      return;
    }
    this.networkSuspectAt = now;
    this.write('every player went silent, checking the lobby connection');
    this.events?.onNetworkSuspect();
  }

  private onGameConnected(): void {
    this.gameState = 'None';
    this.lobbyReady = false;
    this.write('game connected');
    this.events?.onConnectionStateChanged('Connected');
  }

  private onGameMessage({ header, args }: GpgNetMessage): void {
    const options = this.options!;
    if (header === 'GameState') {
      this.gameState = String(args[0] ?? '');
      if (this.gameState === 'Idle') {
        this.gpgnet?.send('CreateLobby', [
          options.lobbyInitMode === 'auto' ? 1 : 0,
          this.lobbyPort,
          options.login,
          options.playerId,
          1,
        ]);
      } else if (this.gameState === 'Lobby') {
        this.lobbyReady = true;
        const pending = this.toGame;
        this.toGame = [];
        for (const message of pending) {
          this.sendToGame(message.header, message.args);
        }
        this.commandGame();
      }
    } else if (header === 'GameEnded') {
      this.gameEnded = true;
    }
    this.write(`from game: ${header} ${JSON.stringify(args).slice(0, MAX_LOGGED_ARGS_LENGTH)}`);
    this.events?.onGpgNetMessage(header, args);
  }

  private onGameDisconnected(reason: string): void {
    this.write(`game disconnected: ${reason}`);
    this.lobbyReady = false;
    if (this.gameless) {
      // The players stay connected for the room; the next game starts over.
      this.clearSettleTimer();
      this.toGame = [];
      this.gameState = 'None';
      this.released = false;
      this.gameCommanded = false;
    } else {
      void this.resetSession();
    }
    this.events?.onConnectionStateChanged('Disconnected');
  }

  /** Tells a game that started without the server's commands whom it hosts or joins, from the current players. */
  private commandGame(): void {
    if (!this.gameless || !this.released || !this.lobbyReady || this.gameCommanded) {
      return;
    }
    this.gameCommanded = true;
    const host = this.joinedHost;
    if (host) {
      const peer = this.peers.get(host.id);
      if (peer) {
        this.sendToGame('JoinGame', [`${LOCALHOST}:${peer.port}`, host.login, host.id]);
      }
      this.connectGameToPlayers(host.id);
      return;
    }
    if (this.hostedMap !== null) {
      this.sendToGame('HostGame', [this.hostedMap]);
    }
    this.settleTimer = setTimeout(() => this.connectGameToPlayers(null), HOST_SETTLE_MS);
  }

  private connectGameToPlayers(exceptId: number | null): void {
    this.settleTimer = null;
    for (const peer of this.peers.values()) {
      if (peer.remoteId !== exceptId) {
        this.sendToGame('ConnectToPeer', [`${LOCALHOST}:${peer.port}`, peer.remoteLogin, peer.remoteId]);
      }
    }
  }

  private clearSettleTimer(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  /** Commands for the game wait until its lobby is up, like in the Java adapter. */
  private sendToGame(header: string, args: GpgNetArg[]): void {
    if (this.lobbyReady && this.gpgnet?.send(header, args)) {
      this.write(`to game: ${header} ${JSON.stringify(args)}`);
      return;
    }
    this.toGame.push({ header, args });
  }

  private write(message: string): void {
    const line = `${new Date().toISOString()} ${message}`;
    this.log?.write(`${line}\n`);
    this.adapterOptions.onLog?.(line);
  }
}
