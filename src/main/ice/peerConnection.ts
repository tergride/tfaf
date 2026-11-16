// Connection to one remote player, the counterpart of Peer and PeerIceModule in the Java adapter. The game sends its
// UDP packets for the player to a local socket; they travel over ICE prefixed with 'd'. The offering side sends 'e'
// echo packets every second, the answering side returns them, and the offerer reconnects after 10 seconds of silence.
//
// Between two TFAF adapters a handshake enables the extensions of tfafProtocol.ts: pings in both directions, so either
// side notices a dead connection within 3 seconds, duplicated game packets while the peer reports packet loss, the
// fingerprints of both sides' game files, the host's notice that it creates the game again with other mods, what each
// side's game was started with, the host's notice that it disconnects the player, and the messages of a lobby inside
// the launcher.
//
// Peers that announced Feature.signaling reconnect without dropping the old connection: it stays open as a bridge and
// carries the traffic if its path comes back before the new connection is up. The answering side asks for the new
// offer through the lobby server and gathers its answer ahead of it. Peers that announced Feature.pathManagement keep
// several pairs checked and send over the best one.

import dgram from 'node:dgram';
import type { GamePeer } from '../../shared/contract.ts';
import { compareFingerprints, type GameFingerprint } from '../game/fingerprint.ts';
import { ReliableMessages } from '../game/tfafLobby/reliableMessages.ts';
import { AttemptHistory, type Route } from './attemptHistory.ts';
import { type CandidatePolicy, type IceParameters, serializeCandidatesMessage } from './candidates.ts';
import type { IceAgent, IceAgentEvents, SelectedPair } from './iceAgent.ts';
import type { IceTimings } from './iceTimings.ts';
import { PathSelector, pathScore } from './pathSelector.ts';
import { PeerStats } from './peerStats.ts';
import type { SignalKind } from './signaling.ts';
import {
  CONTROL_PREFIX,
  type ControlMessage,
  decodeControl,
  decodeDuplicated,
  Deduplicator,
  DUPLICATED_PREFIX,
  DuplicationPolicy,
  encodeControl,
  encodeDuplicated,
  Feature,
  IncomingLoss,
  PROTOCOL_VERSION,
} from './tfafProtocol.ts';

/** A player's launcher as the handshake tells it. */
export type RemoteLauncher =
  /** Another adapter, or a TFAF adapter older than 0.6.0. */
  | { kind: 'other' }
  /** TFAF 0.6.0: it follows a rehost (`rehost`) but does not tell what its game was started with. */
  | { kind: 'legacy' }
  /** `info`: what its game was started with, as the `launcher` message carries it. */
  | { kind: 'tfaf'; info: string };

export interface AgentRequest {
  controlling: boolean;
  policy: CandidatePolicy;
  remotePolicy: CandidatePolicy;
}

export interface PeerContext {
  localId: number;
  /** UDP port the game listens on for traffic from all peers. */
  lobbyPort: number;
  forceRelay: boolean;
  timings: IceTimings;
  /** What we announce in the hello: LOCAL_FEATURES, fewer in tests that play an older TFAF. */
  localFeatures: number;
  /** Our game files, sent with the handshake and again when they change; null when they were not checked. */
  fingerprint(): GameFingerprint | null;
  /** The player's game files, once its handshake brought them and whenever they change. */
  onFiles(remoteId: number, remoteLogin: string, fingerprint: GameFingerprint): void;
  /** The player announced that it creates its game again with these mods (tfafProtocol.ts `rehost`), once per id. */
  onRehost(remoteId: number, remoteLogin: string, modUids: string[]): void;
  /** What our game was started with (tfafProtocol.ts `launcher`); null tells the players nothing. */
  launcherInfo: string | null;
  /** What the player's launcher is, once the handshake tells it; again only when that changes. */
  onLauncher(remoteId: number, remoteLogin: string, launcher: RemoteLauncher): void;
  /** The player, our host, disconnects us for lacking these lobby features (tfafProtocol.ts `kick`), once per connection. */
  onKick(remoteId: number, remoteLogin: string, features: string[]): void;
  /** A message of the lobby inside the launcher (reliableMessages.ts), complete and once. */
  onLobbyMessage(remoteId: number, remoteLogin: string, text: string): void;
  createAgent(request: AgentRequest, events: IceAgentEvents, log: (message: string) => void): Promise<IceAgent>;
  sendCandidates(remoteId: number, message: string): void;
  /** A TFAF message through the lobby server (signaling.ts); only for peers with Feature.signaling. */
  sendSignal(remoteId: number, kind: SignalKind): void;
  /** The connection went silent; when all do at once, our own network is the likely cause. */
  onSilent(remoteId: number): void;
  onStatus(status: GamePeer): void;
  isGameEnded(): boolean;
  log(message: string): void;
}

type PeerState = 'new' | 'gathering' | 'awaitingCandidates' | 'checking' | 'connected' | 'disconnected';

interface PreparedAnswer {
  agent: IceAgent;
  parameters: IceParameters;
  gatheredInMs: number;
  at: number;
}

const LOCALHOST = '127.0.0.1';
const DATA_PREFIX = 0x64; // 'd'
const ECHO_PREFIX = 0x65; // 'e'
const ECHO_LENGTH = 9;
// A Java adapter logs a warning for every control packet, so the handshake gives up after a few.
const MAX_HELLO_ATTEMPTS = 5;
// The second copy goes a little later, so a short burst of loss does not take both.
const DUPLICATE_DELAY_MS = 10;
const RTT_REPORT_INTERVAL_MS = 2_000;
// Closing a socket right after a send can drop the datagram, so the old agent stays open briefly after a restart.
const RESTART_SEND_GRACE_MS = 200;
// The host closes its game right after a rehost, so it repeats the message only briefly until the player confirms.
const REHOST_INTERVAL_MS = 250;
const REHOST_TIMEOUT_MS = 3_000;
const LAUNCHER_INTERVAL_MS = 250;
const LAUNCHER_TIMEOUT_MS = 3_000;
// The host drops the player right after a kick, so the notice goes a few times without waiting for an answer.
const KICK_REPEATS = 3;
const KICK_INTERVAL_MS = 150;
// Nothing answers a hello the peer has seen, so changed files go a few times.
const FILES_REPEATS = 3;
const FILES_INTERVAL_MS = 250;

function bindLocal(port: number): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind({ address: LOCALHOST, port, exclusive: true }, () => {
      socket.off('error', reject);
      resolve(socket);
    });
  });
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export class PeerConnection {
  readonly remoteId: number;
  readonly remoteLogin: string;
  readonly offer: boolean;
  readonly port: number;
  private readonly context: PeerContext;
  private readonly timings: IceTimings;
  private readonly socket: dgram.Socket;
  private agent: IceAgent | null = null;
  private state: PeerState = 'new';
  // Incremented whenever the current attempt is abandoned, so late steps of an old attempt are ignored.
  private generation = 0;
  private readonly history: AttemptHistory;
  private readonly selector: PathSelector;
  private answerTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private echoTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private launcherTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private lastEcho = 0;
  private lastReceived = 0;
  private connectedAt = 0;
  private offerSentAt = 0;
  private closed = false;
  private departed = false;
  private wasConnected = false;
  private slowRetryLogged = false;
  private silentSince: number | null = null;
  private route: GamePeer['route'] = null;
  private rttMs: number | null = null;
  // The connection before a reconnect, kept while its path may come back (TFAF peers with Feature.signaling).
  private bridge: IceAgent | null = null;
  private bridgeLastReceived = 0;
  private bridgeTimer: NodeJS.Timeout | null = null;
  private bridgePingTimer: NodeJS.Timeout | null = null;
  private bridgeBackLogged = false;
  private prepared: Promise<PreparedAnswer | null> | null = null;
  private preparedTimer: NodeJS.Timeout | null = null;
  private alternatePathId: string | null = null;
  // Known across reconnects: whether the peer runs the TFAF adapter and what it supports.
  private tfaf: boolean | null = null;
  private remoteFeatures = 0;
  private remoteFingerprint: string | null = null;
  /** Our files changed while the peer was not known to run TFAF. */
  private filesChanged = false;
  private reportedLauncher: string | null = null;
  // State of the extensions, reset for every new connection.
  private helloConfirmed = false;
  private remoteHelloSeen = false;
  private launcherConfirmed = false;
  private kicked = false;
  private pingSeq = 0;
  private incomingLoss = new IncomingLoss();
  private duplication = new DuplicationPolicy();
  private outgoingSeq = 0;
  private deduplicator = new Deduplicator();
  private stats = new PeerStats();
  private lossOutPermille: number | null = null;
  private lastStatus: GamePeer | null = null;
  private lastStatusAt = 0;
  private rehost: { id: number; done: (confirmed: boolean) => void } | null = null;
  private lastRehostId: number | null = null;
  private readonly lobbyMessages: ReliableMessages;

  private constructor(context: PeerContext, remoteLogin: string, remoteId: number, offer: boolean, socket: dgram.Socket) {
    this.context = context;
    this.timings = context.timings;
    this.remoteLogin = remoteLogin;
    this.remoteId = remoteId;
    this.offer = offer;
    this.socket = socket;
    this.port = socket.address().port;
    this.history = new AttemptHistory(this.timings);
    this.selector = new PathSelector(this.timings);
    this.lobbyMessages = new ReliableMessages({
      sendData: (frame) => this.sendControl({ type: 'lobbyData', ...frame }),
      sendAck: (id, index) => this.sendControl({ type: 'lobbyAck', id, index }),
      onMessage: (text) => this.context.onLobbyMessage(this.remoteId, this.remoteLogin, text),
      log: (message) => this.log(message),
    });
    socket.on('message', (data) => this.onGameData(data));
    socket.on('error', (error) => this.log(`game socket: ${error.message}`));
  }

  /** Opens the local socket for the game, preferably on the given port, and starts offering if this side offers. */
  static async open(context: PeerContext, remoteLogin: string, remoteId: number, offer: boolean, port = 0): Promise<PeerConnection> {
    let socket: dgram.Socket;
    try {
      socket = await bindLocal(port);
    } catch (error) {
      if (port === 0) {
        throw error;
      }
      socket = await bindLocal(0);
    }
    const peer = new PeerConnection(context, remoteLogin, remoteId, offer, socket);
    peer.log(`created, offer: ${offer}, game port ${peer.port}`);
    peer.reportStatus();
    if (offer) {
      void peer.initiate();
    }
    return peer;
  }

  /** The peer takes TFAF messages through the lobby server and keeps the old connection while reconnecting. */
  private get signals(): boolean {
    return this.bothSupport(Feature.signaling);
  }

  private get managesPaths(): boolean {
    return this.bothSupport(Feature.pathManagement);
  }

  private bothSupport(feature: number): boolean {
    return this.tfaf === true && (this.remoteFeatures & feature) !== 0 && (this.context.localFeatures & feature) !== 0;
  }

  /** Silent or not connected: when every peer is quiet at once, our own network is the likely cause. */
  isQuiet(now = Date.now()): boolean {
    return (this.state !== 'connected' && !this.bridgeAlive(now)) || now - this.lastReceived > this.timings.livenessTimeoutMs;
  }

  /** Candidates of the remote player: the answer to our offer, or a (new) offer to answer. */
  async onRemoteCandidates(remote: IceParameters): Promise<void> {
    if (this.closed) {
      return;
    }
    this.departed = false;
    let agent: IceAgent | null;
    if (this.offer) {
      if (this.state !== 'awaitingCandidates') {
        this.log(`candidates received unexpectedly in state ${this.state}`);
        return;
      }
      agent = this.agent;
    } else {
      if (this.state !== 'new' && this.state !== 'disconnected') {
        this.log('new offer received, restarting');
        this.reconnect(false);
      }
      agent = await this.initiate();
    }
    if (!agent || agent !== this.agent || this.state !== 'awaitingCandidates') {
      return;
    }
    this.clearTimer('answerTimer');
    this.state = 'checking';
    this.log(`received candidates: ${remote.candidates.map((candidate) => candidate.type).join(', ') || 'none'}`);
    agent.start(remote);
  }

  /** A TFAF message the player sent through the lobby server (signaling.ts). */
  onSignal(kind: SignalKind): void {
    if (this.closed) {
      return;
    }
    if (kind === 'bye') {
      this.onBye();
      return;
    }
    this.departed = false;
    if (!this.offer || this.context.isGameEnded()) {
      return;
    }
    const now = Date.now();
    if (this.state === 'connected') {
      // The lobby server delivers requests queued during its own outage late; a connection that works stays.
      if (now - this.lastReceived <= this.timings.livenessTimeoutMs) {
        return;
      }
      this.log('the peer asked to reconnect through the lobby server');
      this.reconnect();
    } else if (
      (this.state === 'awaitingCandidates' && now - this.offerSentAt >= this.offerAgainAfterMs) ||
      (this.state === 'disconnected' && this.retryTimer)
    ) {
      this.log('the peer asked for a new offer');
      this.offerAgain();
    }
  }

  /** An offer this old without an answer is presumably lost when the peer asks for one. */
  private get offerAgainAfterMs(): number {
    return Math.min(2_000, this.timings.answerTimeoutMs / 2);
  }

  /**
   * The lobby server connection came back: an offer sent while it was gone may be lost, so one waiting for an answer
   * goes again at once, and a TFAF answering side asks again.
   */
  signalingRestored(): void {
    if (this.closed || this.departed || this.context.isGameEnded()) {
      return;
    }
    if (this.offer) {
      // A fresh offer waited in the lobby's queue and went out with the restored session.
      const offerMayBeLost = this.state === 'awaitingCandidates' && Date.now() - this.offerSentAt >= this.offerAgainAfterMs;
      if (offerMayBeLost || (this.state === 'disconnected' && this.retryTimer)) {
        this.log('the lobby server is back, offering again');
        this.offerAgain();
      }
    } else if (this.signals && this.state === 'disconnected') {
      this.log('the lobby server is back, asking for a new offer');
      this.requestRestart();
    }
  }

  /**
   * Tells the player that we create the game again with these mods and resolves once it confirmed, or with false for
   * a player without the TFAF feature, a broken connection or no answer within 3 seconds.
   */
  announceRehost(id: number, modUids: string[]): Promise<boolean> {
    if (this.state !== 'connected' || this.tfaf !== true || (this.remoteFeatures & Feature.rehost) === 0) {
      return Promise.resolve(false);
    }
    this.rehost?.done(false);
    return new Promise((resolve) => {
      const deadline = Date.now() + REHOST_TIMEOUT_MS;
      let timer: NodeJS.Timeout | null = null;
      const done = (confirmed: boolean): void => {
        if (timer) {
          clearTimeout(timer);
        }
        if (this.rehost?.done === done) {
          this.rehost = null;
        }
        resolve(confirmed);
      };
      const send = (): void => {
        if (Date.now() >= deadline) {
          this.log('the rehost was not confirmed');
          done(false);
          return;
        }
        this.sendControl({ type: 'rehost', id, modUids });
        timer = setTimeout(send, REHOST_INTERVAL_MS);
      };
      this.rehost = { id, done };
      send();
    });
  }

  /** Tells the player that we disconnect it for lacking these lobby features; resolves once the notice went out. */
  async kick(features: string[]): Promise<void> {
    if (this.state !== 'connected' || (this.remoteFeatures & Feature.launcherInfo) === 0) {
      return;
    }
    this.log(`disconnecting the player, its game lacks ${features.join(', ')}`);
    for (let attempt = 0; attempt < KICK_REPEATS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, KICK_INTERVAL_MS));
      }
      this.sendControl({ type: 'kick', features });
    }
  }

  /**
   * Our game files changed: a TFAF peer gets them in another hello and compares again. A connection that comes up later
   * starts with them; a peer still unknown may have got the old ones in the handshake and gets them once it is known.
   */
  async sendFiles(): Promise<void> {
    if (this.state !== 'connected' || this.tfaf === false) {
      return;
    }
    if (this.tfaf === null) {
      this.filesChanged = true;
      return;
    }
    this.filesChanged = false;
    const generation = this.generation;
    for (let attempt = 0; attempt < FILES_REPEATS; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, FILES_INTERVAL_MS));
      }
      if (generation !== this.generation) {
        return;
      }
      this.sendControl({
        type: 'hello',
        version: PROTOCOL_VERSION,
        features: this.context.localFeatures,
        seen: this.remoteHelloSeen,
        fingerprint: this.context.fingerprint(),
      });
    }
  }

  /**
   * Sends a message of the lobby inside the launcher, repeated until the player confirms it or the connection stays
   * away too long; `key`: a newer message with the same key replaces this one. False when the player cannot take it.
   */
  sendLobbyMessage(text: string, key: string | null): boolean {
    return (this.remoteFeatures & Feature.launcherLobby) !== 0 && this.lobbyMessages.send(text, key);
  }

  /** Closes the connection; `farewell` tells a TFAF peer that we leave, so it stops reconnecting to us. */
  async close(farewell = false): Promise<void> {
    if (this.closed) {
      return;
    }
    if (farewell && this.signals) {
      this.log('telling the peer that we leave');
      this.sendControl({ type: 'bye' });
      this.context.sendSignal(this.remoteId, 'bye');
      await new Promise((resolve) => setTimeout(resolve, RESTART_SEND_GRACE_MS));
    }
    if (this.state === 'connected') {
      this.logStats();
    }
    this.rehost?.done(false);
    this.lobbyMessages.close();
    this.closed = true;
    this.generation++;
    this.clearTimers();
    this.closeBridge();
    this.dropPrepared();
    this.agent?.close();
    this.agent = null;
    this.log('closed');
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }

  private async initiate(): Promise<IceAgent | null> {
    if (this.closed || this.departed || (this.state !== 'new' && this.state !== 'disconnected')) {
      return null;
    }
    const generation = ++this.generation;
    this.state = 'gathering';
    let parameters: IceParameters;
    let agent: IceAgent;
    let gatheredInMs: number;
    try {
      const prepared = this.offer ? null : await this.takePrepared();
      if (generation !== this.generation) {
        prepared?.agent.close();
        return null;
      }
      if (prepared) {
        ({ agent, parameters, gatheredInMs } = prepared);
        this.agent = agent;
      } else {
        const startedAt = Date.now();
        agent = await this.createAgent();
        if (generation !== this.generation) {
          agent.close();
          return null;
        }
        this.agent = agent;
        parameters = await agent.gather();
        gatheredInMs = Date.now() - startedAt;
      }
    } catch (error) {
      if (generation === this.generation) {
        this.log(`gathering failed: ${String(error)}`);
        this.connectionLost();
      }
      return null;
    }
    if (generation !== this.generation) {
      return null;
    }
    this.context.sendCandidates(
      this.remoteId,
      serializeCandidatesMessage(this.context.localId, this.remoteId, parameters),
    );
    this.log(
      `sent candidates: ${parameters.candidates.map((candidate) => candidate.type).join(', ') || 'none'}, gathered in ${gatheredInMs} ms`,
    );
    this.state = 'awaitingCandidates';
    if (this.offer) {
      this.offerSentAt = Date.now();
      this.answerTimer = setTimeout(() => {
        if (generation === this.generation && this.state === 'awaitingCandidates') {
          this.log('no answer to the offer');
          this.connectionLost();
        }
      }, this.timings.answerTimeoutMs);
    }
    return agent;
  }

  private createAgent(): Promise<IceAgent> {
    const holder: { agent: IceAgent | null } = { agent: null };
    const now = Date.now();
    return this.context
      .createAgent(
        {
          controlling: this.offer,
          policy: this.history.policy(this.context.forceRelay, now),
          remotePolicy: this.history.remotePolicy(this.context.forceRelay),
        },
        this.agentEvents(holder),
        (message) => this.log(message),
      )
      .then((agent) => {
        holder.agent = agent;
        return agent;
      });
  }

  /** Events of an agent count only while it is the current one; data also while it is the bridge. */
  private agentEvents(holder: { agent: IceAgent | null }): IceAgentEvents {
    return {
      onConnected: (pair) => {
        if (holder.agent === null || holder.agent !== this.agent) {
          return;
        }
        this.onConnected(holder.agent, pair.localType === 'relay' || pair.remoteType === 'relay' ? 'relay' : 'direct', pair);
      },
      onFailed: (reason) => {
        if (holder.agent !== null && holder.agent === this.agent) {
          this.log(`ICE failed: ${reason}`);
          this.connectionLost();
        }
      },
      onData: (data) => {
        if (holder.agent === null) {
          return;
        }
        if (holder.agent === this.agent) {
          this.onPeerData(data, false);
        } else if (holder.agent === this.bridge) {
          this.onPeerData(data, true);
        }
      },
    };
  }

  private onConnected(agent: IceAgent, route: Route, pair: SelectedPair): void {
    const now = Date.now();
    const generation = this.generation;
    this.state = 'connected';
    this.wasConnected = true;
    this.connectedAt = now;
    this.history.connected();
    this.slowRetryLogged = false;
    this.route = route;
    this.lastReceived = now;
    this.helloConfirmed = false;
    this.remoteHelloSeen = false;
    this.launcherConfirmed = false;
    this.kicked = false;
    this.incomingLoss = new IncomingLoss();
    this.duplication = new DuplicationPolicy();
    this.outgoingSeq = 0;
    this.deduplicator = new Deduplicator();
    this.stats = new PeerStats();
    this.lossOutPermille = null;
    this.alternatePathId = null;
    this.statsTimer = setInterval(() => this.logStats(), this.timings.statsIntervalMs);
    this.log(`connected: ${pair.localType} ${pair.local.address}:${pair.local.port} -> ${pair.remoteType} ${pair.remote.address}:${pair.remote.port}`);
    if (this.silentSince !== null) {
      this.log(`reconnected ${seconds(now - this.silentSince)} after the connection went silent`);
      this.silentSince = null;
    }
    if (this.bridge) {
      // The new connection takes over; the old one goes once the new one has proven itself.
      this.armBridgeTimer(this.timings.bridgeStableMs, true);
    }
    if (this.managesPaths) {
      agent.enablePathManagement();
    }
    this.reportStatus();
    if (this.offer) {
      this.startEcho(generation);
    }
    if (this.tfaf !== false) {
      this.startHello(generation);
    }
    if (this.tfaf === true) {
      this.startPings(generation);
    }
  }

  private onGameData(data: Buffer): void {
    const connected = this.state === 'connected' && this.agent !== null;
    const agent = connected ? this.agent : this.bridge;
    if (!agent) {
      return;
    }
    this.stats.gameSent(data.length, this.duplication.enabled);
    if (!this.duplication.enabled) {
      agent.send(Buffer.concat([Buffer.of(DATA_PREFIX), data]));
      return;
    }
    const packet = encodeDuplicated(this.outgoingSeq++, data);
    agent.send(packet);
    // Another path loses other packets than the first one, so the second copy goes there at once when there is one.
    if (connected && this.alternatePathId && agent.sendVia(this.alternatePathId, packet)) {
      return;
    }
    setTimeout(() => {
      if (this.agent === agent || this.bridge === agent) {
        agent.send(packet);
      }
    }, DUPLICATE_DELAY_MS);
  }

  private onPeerData(data: Buffer, viaBridge: boolean): void {
    const now = Date.now();
    this.lastReceived = now;
    if (viaBridge) {
      this.bridgeLastReceived = now;
      if (this.state !== 'connected' && !this.bridgeBackLogged) {
        this.bridgeBackLogged = true;
        this.log(`the old path works again${this.silentSince === null ? '' : ` ${seconds(now - this.silentSince)} after it went silent`}`);
        this.reportStatus();
      }
    }
    switch (data[0]) {
      case DATA_PREFIX:
        this.toGame(data.subarray(1));
        break;
      case DUPLICATED_PREFIX: {
        const packet = decodeDuplicated(data);
        if (!packet) {
          break;
        }
        if (this.deduplicator.accept(packet.seq)) {
          this.toGame(packet.payload);
        } else {
          this.stats.duplicateDropped();
        }
        break;
      }
      case ECHO_PREFIX:
        if (!this.offer) {
          (viaBridge ? this.bridge : this.agent)?.send(data);
        } else {
          this.lastEcho = now;
          // Pings measure the round trip to TFAF peers; echoes are all there is for Java peers.
          if (this.tfaf !== true && data.length === ECHO_LENGTH) {
            this.updateRtt(now - Number(data.readBigInt64BE(1)));
          }
        }
        break;
      case CONTROL_PREFIX: {
        const message = decodeControl(data);
        if (message) {
          this.onControl(message);
        }
        break;
      }
      default:
        // Empty packets and unknown prefixes are dropped.
        break;
    }
  }

  private onControl(message: ControlMessage): void {
    switch (message.type) {
      case 'hello':
        if (this.tfaf !== true) {
          this.log(`the peer runs the TFAF adapter, protocol ${message.version}`);
        }
        this.tfaf = true;
        this.remoteFeatures = message.features;
        if (message.fingerprint) {
          this.onFingerprint(message.fingerprint);
        }
        if ((message.features & Feature.launcherInfo) !== 0) {
          this.sendLauncherInfo(this.generation);
        } else {
          this.reportLauncher({ kind: (message.features & Feature.rehost) !== 0 ? 'legacy' : 'other' });
        }
        this.remoteHelloSeen = true;
        if (message.seen) {
          this.helloConfirmed = true;
          this.clearTimer('helloTimer');
        } else {
          this.sendControl({
            type: 'hello',
            version: PROTOCOL_VERSION,
            features: this.context.localFeatures,
            seen: true,
            fingerprint: this.context.fingerprint(),
          });
        }
        if (this.filesChanged) {
          void this.sendFiles();
        }
        if (this.managesPaths && this.state === 'connected') {
          this.agent?.enablePathManagement();
        }
        this.startPings(this.generation);
        this.reportStatus();
        break;
      case 'ping':
        this.incomingLoss.record(message.seq);
        this.sendControl({ type: 'pong', seq: message.seq, sentAt: message.sentAt, lossPermille: this.incomingLoss.permille() });
        break;
      case 'pong': {
        this.lossOutPermille = message.lossPermille;
        this.updateRtt(Date.now() - message.sentAt);
        if ((this.remoteFeatures & Feature.duplication) !== 0) {
          const before = this.duplication.enabled;
          if (this.duplication.update(message.lossPermille, Date.now()) !== before) {
            this.log(`packet duplication ${before ? 'off' : 'on'}, the peer reports ${message.lossPermille / 10}% loss`);
          }
        }
        this.reportStatus();
        break;
      }
      case 'restart':
        if (this.offer && this.state === 'connected') {
          this.log('the peer asked to reconnect');
          this.reconnect();
        }
        break;
      case 'rehost':
        this.sendControl({ type: 'rehostAck', id: message.id });
        if (message.id !== this.lastRehostId) {
          this.lastRehostId = message.id;
          this.log(`the peer creates its game again with ${message.modUids.length} mods`);
          this.context.onRehost(this.remoteId, this.remoteLogin, message.modUids);
        }
        break;
      case 'rehostAck':
        if (this.rehost?.id === message.id) {
          this.log('the rehost was confirmed');
          this.rehost.done(true);
        }
        break;
      case 'launcher':
        this.sendControl({ type: 'launcherAck' });
        this.reportLauncher({ kind: 'tfaf', info: message.info });
        break;
      case 'launcherAck':
        this.launcherConfirmed = true;
        this.clearTimer('launcherTimer');
        break;
      case 'kick':
        if (!this.kicked) {
          this.kicked = true;
          this.log(`the peer disconnects us, our game lacks ${message.features.join(', ')}`);
          this.context.onKick(this.remoteId, this.remoteLogin, message.features);
        }
        break;
      case 'lobbyData':
        this.lobbyMessages.onData(message);
        break;
      case 'lobbyAck':
        this.lobbyMessages.onAck(message.id, message.index);
        break;
      case 'bye':
        this.onBye();
        break;
    }
  }

  /** The player left: nothing to reconnect to until it offers again or the server connects us anew. */
  private onBye(): void {
    if (this.departed) {
      return;
    }
    this.departed = true;
    this.log('the player left');
    if (this.state === 'connected') {
      this.logStats();
    }
    this.generation++;
    this.clearTimers();
    this.closeBridge();
    this.dropPrepared();
    const agent = this.agent;
    this.agent = null;
    // The bye may have come over this agent; it closes once its socket finished with the packet.
    setTimeout(() => agent?.close(), RESTART_SEND_GRACE_MS);
    this.state = 'disconnected';
    this.reportStatus();
  }

  /** Tells the player what our game was started with, repeated until it confirms, for a few seconds at most. */
  private sendLauncherInfo(generation: number): void {
    const info = this.context.launcherInfo;
    if (info === null || this.launcherConfirmed || this.launcherTimer) {
      return;
    }
    const deadline = Date.now() + LAUNCHER_TIMEOUT_MS;
    const send = (): void => {
      this.launcherTimer = null;
      if (generation !== this.generation || this.launcherConfirmed) {
        return;
      }
      if (Date.now() >= deadline) {
        this.log('what our game was started with was not confirmed');
        return;
      }
      this.sendControl({ type: 'launcher', info });
      this.launcherTimer = setTimeout(send, LAUNCHER_INTERVAL_MS);
    };
    send();
  }

  private reportLauncher(launcher: RemoteLauncher): void {
    const key = JSON.stringify(launcher);
    if (key === this.reportedLauncher) {
      return;
    }
    this.reportedLauncher = key;
    if (launcher.kind === 'tfaf') {
      this.log(`its game was started with ${launcher.info}`);
    }
    this.context.onLauncher(this.remoteId, this.remoteLogin, launcher);
  }

  private onFingerprint(remote: GameFingerprint): void {
    // Every hello repeats it; only a change matters.
    const serialized = JSON.stringify(remote);
    if (serialized === this.remoteFingerprint) {
      return;
    }
    this.remoteFingerprint = serialized;
    const files = compareFingerprints(this.context.fingerprint(), remote);
    this.log(`files compared with ours: game files ${files.gameFiles}, map ${files.map}, mods ${files.mods}`);
    this.context.onFiles(this.remoteId, this.remoteLogin, remote);
  }

  private startHello(generation: number): void {
    let attempts = 0;
    const send = (): void => {
      this.helloTimer = null;
      if (generation !== this.generation || this.helloConfirmed) {
        return;
      }
      if (attempts >= MAX_HELLO_ATTEMPTS) {
        if (this.tfaf === null) {
          this.tfaf = false;
          this.log('no answer to the TFAF handshake, the peer runs another adapter');
          this.reportStatus();
          this.reportLauncher({ kind: 'other' });
        }
        return;
      }
      attempts++;
      this.sendControl({
        type: 'hello',
        version: PROTOCOL_VERSION,
        features: this.context.localFeatures,
        seen: this.remoteHelloSeen,
        fingerprint: this.context.fingerprint(),
      });
      this.helloTimer = setTimeout(send, this.timings.helloIntervalMs);
    };
    send();
  }

  private startPings(generation: number): void {
    if (this.pingTimer) {
      return;
    }
    this.pingTimer = setInterval(() => {
      if (generation !== this.generation) {
        return;
      }
      this.sendControl({ type: 'ping', seq: this.pingSeq++, sentAt: Date.now() });
      const now = Date.now();
      if (now - this.lastReceived > this.timings.livenessTimeoutMs) {
        this.log(`nothing received for ${seconds(this.timings.livenessTimeoutMs)}`);
        this.silentSince = this.lastReceived;
        this.context.onSilent(this.remoteId);
        if (this.signals) {
          if (!this.offer) {
            // The way back may still work even if ours does not; the lobby server carries the request anyway.
            this.sendControl({ type: 'restart' });
          }
          this.reconnect();
        } else if (this.offer) {
          this.connectionLost();
        } else {
          // Only the offerer can start over; the way back may still work even if ours does not.
          this.sendControl({ type: 'restart' });
          this.connectionLost(RESTART_SEND_GRACE_MS);
        }
        return;
      }
      this.managePaths(now);
    }, this.timings.pingIntervalMs);
  }

  /** Moves the traffic to a better path and keeps the second best for duplicated packets. */
  private managePaths(now: number): void {
    const agent = this.agent;
    if (!agent?.managesPaths || this.state !== 'connected') {
      return;
    }
    const paths = agent.paths(now);
    const activeId = agent.activePathId();
    const choice = this.selector.choose(paths, activeId, now);
    if (choice && agent.use(choice.id)) {
      this.log(`path ${activeId === null ? 'none' : agent.describePath(activeId)} -> ${agent.describePath(choice.id)}: ${choice.reason}`);
      this.route = agent.activeIsRelay() ? 'relay' : 'direct';
      this.reportStatus();
    }
    const current = agent.activePathId();
    const alternate = paths
      .filter((path) => path.id !== current && path.lastResponseAt !== null && now - path.lastResponseAt <= this.timings.pathAliveMs)
      .sort((a, b) => pathScore(a) - pathScore(b))[0];
    this.alternatePathId = alternate?.id ?? null;
  }

  private startEcho(generation: number): void {
    this.lastEcho = Date.now();
    this.echoTimer = setInterval(() => {
      if (generation !== this.generation) {
        return;
      }
      const echo = Buffer.alloc(ECHO_LENGTH);
      echo[0] = ECHO_PREFIX;
      echo.writeBigInt64BE(BigInt(Date.now()), 1);
      this.agent?.send(echo);
      if (Date.now() - this.lastEcho > this.timings.echoTimeoutMs) {
        this.log(`no echo answers for ${seconds(this.timings.echoTimeoutMs)}`);
        this.silentSince ??= this.lastEcho;
        this.context.onSilent(this.remoteId);
        if (this.signals) {
          this.reconnect();
        } else {
          this.connectionLost();
        }
      }
    }, this.timings.echoIntervalMs);
  }

  /**
   * Starts over without dropping the old connection when the peer supports it: the old agent becomes the bridge and
   * carries the traffic if its path comes back before the new connection is up. Other peers get connectionLost.
   * `requestOffer`: the answering side asks for a new offer, unless one just arrived.
   */
  private reconnect(requestOffer = true): void {
    if (!this.signals) {
      this.connectionLost();
      return;
    }
    if (this.state === 'disconnected') {
      return;
    }
    const previous = this.state;
    const now = Date.now();
    if (previous === 'connected') {
      this.logStats();
      this.history.lost(this.route ?? 'direct', this.connectedAt, now);
    }
    this.generation++;
    this.clearTimers();
    const agent = this.agent;
    this.agent = null;
    if (agent && previous === 'connected') {
      this.setBridge(agent);
    } else {
      agent?.close();
    }
    this.state = 'disconnected';
    this.reportStatus();
    if (this.closed || this.departed || this.context.isGameEnded()) {
      return;
    }
    if (this.offer) {
      void this.initiate();
    } else if (requestOffer) {
      this.requestRestart();
    }
  }

  private connectionLost(closeDelayMs = 0): void {
    if (this.state === 'disconnected') {
      return;
    }
    const previous = this.state;
    const now = Date.now();
    if (previous === 'connected') {
      this.logStats();
      this.history.lost(this.route ?? 'direct', this.connectedAt, now);
    } else {
      this.history.failed(now);
    }
    this.generation++;
    this.clearTimers();
    const agent = this.agent;
    this.agent = null;
    if (closeDelayMs > 0) {
      setTimeout(() => agent?.close(), closeDelayMs);
    } else {
      agent?.close();
    }
    this.state = 'disconnected';
    this.reportStatus();
    if (this.closed || this.departed || this.context.isGameEnded()) {
      return;
    }
    if (this.history.isSlow(now) && !this.slowRetryLogged) {
      this.slowRetryLogged = true;
      this.log(`unreachable for ${seconds(this.timings.slowRetryAfterMs)}, trying every ${seconds(this.timings.slowRetryDelayMs)}`);
    }
    const delay = this.history.retryDelay(previous === 'connected', now);
    if (this.offer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.initiate();
      }, delay);
    } else if (this.signals) {
      // The answering side cannot offer, but a TFAF offerer that missed the outage takes a request.
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.requestRestart();
      }, Math.max(delay, this.timings.retryDelayMs));
    }
  }

  /** Drops the attempt in progress and offers again right away. */
  private offerAgain(): void {
    this.generation++;
    this.clearTimer('answerTimer');
    this.clearTimer('retryTimer');
    const agent = this.agent;
    this.agent = null;
    agent?.close();
    this.state = 'disconnected';
    void this.initiate();
  }

  /** The answering side asks a TFAF offerer for a new offer and gathers its answer ahead of it. */
  private requestRestart(): void {
    if (this.closed || this.departed || this.offer || !this.signals) {
      return;
    }
    this.clearTimer('retryTimer');
    this.context.sendSignal(this.remoteId, 'restart');
    this.prepareAnswer();
    const now = Date.now();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.state === 'disconnected') {
        this.requestRestart();
      }
    }, this.history.isSlow(now) ? this.timings.slowRetryDelayMs : this.timings.answerTimeoutMs);
  }

  private prepareAnswer(): void {
    if (this.prepared) {
      return;
    }
    const startedAt = Date.now();
    let agent: IceAgent | null = null;
    this.prepared = this.createAgent()
      .then(async (created) => {
        agent = created;
        const parameters = await created.gather();
        return { agent: created, parameters, gatheredInMs: Date.now() - startedAt, at: Date.now() };
      })
      .catch((error: unknown) => {
        this.log(`gathering ahead of the offer failed: ${String(error)}`);
        agent?.close();
        return null;
      });
    this.preparedTimer = setTimeout(() => this.dropPrepared(), this.timings.preparedAnswerMs);
  }

  /** The answer gathered ahead, while it is fresh; it is used once. */
  private async takePrepared(): Promise<PreparedAnswer | null> {
    const pending = this.prepared;
    if (!pending) {
      return null;
    }
    this.prepared = null;
    this.clearTimer('preparedTimer');
    const prepared = await pending;
    if (!prepared) {
      return null;
    }
    if (Date.now() - prepared.at > this.timings.preparedAnswerMs) {
      prepared.agent.close();
      return null;
    }
    return { ...prepared, gatheredInMs: 0 };
  }

  private dropPrepared(): void {
    this.clearTimer('preparedTimer');
    const pending = this.prepared;
    this.prepared = null;
    void pending?.then((prepared) => prepared?.agent.close());
  }

  private setBridge(agent: IceAgent): void {
    this.closeBridge();
    this.bridge = agent;
    this.bridgeLastReceived = 0;
    this.bridgeBackLogged = false;
    this.armBridgeTimer(this.timings.bridgeMaxMs, false);
    // Pings over the old path tell both sides when it works again.
    this.bridgePingTimer = setInterval(() => {
      if (this.state !== 'connected' && this.tfaf === true) {
        this.bridge?.send(encodeControl({ type: 'ping', seq: this.pingSeq++, sentAt: Date.now() }));
      }
    }, this.timings.pingIntervalMs);
  }

  /** `replaced`: the new connection is up, so the bridge goes even while it works; otherwise only once it is silent. */
  private armBridgeTimer(delayMs: number, replaced: boolean): void {
    if (this.bridgeTimer) {
      clearTimeout(this.bridgeTimer);
    }
    this.bridgeTimer = setTimeout(() => {
      this.bridgeTimer = null;
      if (!replaced && this.bridgeAlive(Date.now())) {
        this.armBridgeTimer(this.timings.bridgeMaxMs, false);
        return;
      }
      this.closeBridge();
    }, delayMs);
  }

  private bridgeAlive(now: number): boolean {
    return this.bridge !== null && this.bridgeLastReceived > 0 && now - this.bridgeLastReceived <= this.timings.livenessTimeoutMs;
  }

  private closeBridge(): void {
    if (this.bridgeTimer) {
      clearTimeout(this.bridgeTimer);
      this.bridgeTimer = null;
    }
    if (this.bridgePingTimer) {
      clearInterval(this.bridgePingTimer);
      this.bridgePingTimer = null;
    }
    const bridge = this.bridge;
    this.bridge = null;
    bridge?.close();
  }

  private toGame(payload: Buffer): void {
    this.stats.gameReceived(payload.length);
    this.socket.send(payload, this.context.lobbyPort, LOCALHOST, () => {});
  }

  /** Over the current connection, or over the bridge while there is none. */
  private sendControl(message: ControlMessage): void {
    const agent = this.state === 'connected' && this.agent ? this.agent : (this.bridge ?? this.agent);
    agent?.send(encodeControl(message));
  }

  private updateRtt(sampleMs: number): void {
    if (sampleMs < 0 || sampleMs > 60_000) {
      return;
    }
    this.rttMs = this.rttMs === null ? sampleMs : this.rttMs * 0.8 + sampleMs * 0.2;
    this.stats.roundTrip(sampleMs);
    this.reportStatus();
  }

  private logStats(): void {
    if (!this.stats.isEmpty) {
      const lossIn = this.tfaf === true ? this.incomingLoss.permille() : null;
      this.log(`stats ${this.stats.summary(Date.now(), this.lossOutPermille, lossIn)}`);
    }
    this.stats = new PeerStats();
  }

  /** Reports changes to the UI; changes of the round trip and the loss alone go at most every 2 seconds. */
  private reportStatus(): void {
    if (this.closed) {
      return;
    }
    const now = Date.now();
    const connected = this.state === 'connected';
    const bridged = !connected && this.bridgeAlive(now);
    const route = connected ? this.route : bridged ? (this.bridge?.activeIsRelay() ? 'relay' : 'direct') : null;
    const status: GamePeer = {
      playerId: this.remoteId,
      login: this.remoteLogin,
      state: connected || bridged ? 'connected' : this.wasConnected ? 'reconnecting' : 'connecting',
      route,
      rttMs: (connected || bridged) && this.rttMs !== null ? Math.round(this.rttMs) : null,
      tfaf: this.tfaf,
      duplication: connected && this.duplication.enabled,
      loss:
        connected && this.tfaf === true
          ? { out: (this.lossOutPermille ?? 0) / 10, in: this.incomingLoss.permille() / 10 }
          : null,
    };
    const last = this.lastStatus;
    const sameNumbers =
      last?.rttMs === status.rttMs && last.loss?.out === status.loss?.out && last.loss?.in === status.loss?.in;
    if (
      last &&
      last.state === status.state &&
      last.route === status.route &&
      last.tfaf === status.tfaf &&
      last.duplication === status.duplication &&
      (sameNumbers || now - this.lastStatusAt < RTT_REPORT_INTERVAL_MS)
    ) {
      return;
    }
    this.lastStatus = status;
    this.lastStatusAt = now;
    this.context.onStatus(status);
  }

  private clearTimer(name: 'answerTimer' | 'retryTimer' | 'helloTimer' | 'launcherTimer' | 'preparedTimer'): void {
    const timer = this[name];
    if (timer) {
      clearTimeout(timer);
      this[name] = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer('answerTimer');
    this.clearTimer('retryTimer');
    this.clearTimer('helloTimer');
    this.clearTimer('launcherTimer');
    for (const name of ['echoTimer', 'pingTimer', 'statsTimer'] as const) {
      const timer = this[name];
      if (timer) {
        clearInterval(timer);
        this[name] = null;
      }
    }
  }

  private log(message: string): void {
    this.context.log(`${this.remoteLogin}(${this.remoteId}): ${message}`);
  }
}
