// ICE agent for one remote player (RFC 8445, single UDP component). Interoperates with ice4j as used by the FAF Java
// ICE adapter: short-term credentials from the candidate exchange, regular nomination by the controlling agent, and
// the controlled agent selecting the pair once it is both nominated and checked.
//
// The controlling agent nominates a direct pair as soon as one succeeds; while only relayed pairs did, it waits a
// little for a direct one, so a TURN server that answers faster does not carry the whole game.
//
// Between TFAF adapters paths can be managed after the connection is up (enablePathManagement): the succeeded pairs
// stay checked, so their round trip and loss are known, traffic can move to another pair at once, checks from a new
// address of the peer add a pair (its NAT mapping changed), and a TURN allocation the server lost is replaced.

import { randomBytes } from 'node:crypto';
import {
  ALL_CANDIDATES,
  type Candidate,
  type CandidatePolicy,
  candidatePriority,
  type CandidateType,
  type IceParameters,
  isAllowed,
  pairPriority,
  peerReflexivePriority,
} from './candidates.ts';
import { DEFAULT_ICE_TIMINGS, type IceTimings } from './iceTimings.ts';
import {
  type Address,
  addressKey,
  Attr,
  decodeStun,
  type DecodedStunMessage,
  encodeStun,
  findAttribute,
  isStunMessage,
  Method,
  newTransactionId,
  readErrorCode,
  readMappedAddress,
  readString,
  readUint32,
  sameAddress,
  type StunAttribute,
  stringAttribute,
  uint32Attribute,
  verifyFingerprint,
  verifyIntegrity,
  xorAddressAttribute,
} from './stun.ts';
import { type Retransmission, type StunResponse, StunTransactions } from './transactions.ts';
import { TurnAllocation, type TurnServer } from './turn.ts';
import { systemUdp, type UdpSocket, type UdpTransport } from './udpTransport.ts';

export interface IceAgentOptions {
  controlling: boolean;
  /** IPv4 addresses for host candidates; reflexive and relayed candidates are gathered from the first one. */
  hostAddresses: string[];
  stunServers: Address[];
  turnServers: TurnServer[];
  /** Which local candidates are offered. */
  policy: CandidatePolicy;
  /** Which remote candidates are accepted; all by default. */
  remotePolicy?: CandidatePolicy;
  transport?: UdpTransport;
  timings?: IceTimings;
  log(message: string): void;
}

export interface SelectedPair {
  localType: CandidateType;
  remoteType: CandidateType;
  local: Address;
  remote: Address;
}

/** A succeeded pair as path management sees it. */
export interface PathInfo {
  id: string;
  /** Either end is a TURN relay. */
  relay: boolean;
  description: string;
  /** 90th percentile of the check round trips in the stats window; null without an answer in it. */
  rttMs: number | null;
  /** Share of unanswered checks in the stats window, in percent. */
  lossPercent: number;
  lastResponseAt: number | null;
}

export interface IceAgentEvents {
  onConnected(pair: SelectedPair): void;
  onFailed(reason: string): void;
  /** A datagram from the peer that is not STUN, i.e. the adapter's own traffic. */
  onData(data: Buffer): void;
}

interface HostBase {
  kind: 'host';
  socket: UdpSocket;
  candidate: Candidate;
  allocations: TurnAllocation[];
}

interface RelayBase {
  kind: 'relay';
  allocation: TurnAllocation;
  server: TurnServer;
  candidate: Candidate;
}

type LocalBase = HostBase | RelayBase;

interface PathSample {
  at: number;
  rttMs: number | null;
}

interface CandidatePair {
  id: string;
  local: LocalBase;
  remote: Candidate;
  remoteAddress: Address;
  priority: bigint;
  state: 'waiting' | 'inProgress' | 'succeeded' | 'failed';
  useCandidateReceived: boolean;
  samples: PathSample[];
  lastResponseAt: number | null;
  consentInFlight: boolean;
}

interface IncomingCheck {
  base: LocalBase;
  from: Address;
  priority: number;
  useCandidate: boolean;
}

type AgentState = 'new' | 'gathering' | 'gathered' | 'checking' | 'connected' | 'failed' | 'closed';

const MAX_EARLY_CHECKS = 32;
// The active pair, the best pair of the other kind and one more are kept checked.
const MAX_TRACKED_PATHS = 3;
// Relayed paths that stay silent this many consent intervals while a direct one answers get their allocation refreshed.
const SILENT_RELAY_INTERVALS = 4;
const MAX_PAIRS = 64;
const ICE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomIceString(length: number): string {
  return [...randomBytes(length)].map((byte) => ICE_CHARS[byte % ICE_CHARS.length]).join('');
}

function isRelayPair(pair: CandidatePair): boolean {
  return pair.local.kind === 'relay' || pair.remote.type === 'relay';
}

function percentile90(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)]!;
}

export class IceAgent {
  readonly ufrag = randomIceString(8);
  private readonly password = randomIceString(24);
  private readonly localKey = Buffer.from(this.password, 'utf8');
  private readonly tieBreaker = randomBytes(8);
  private readonly options: IceAgentOptions;
  private readonly timings: IceTimings;
  private readonly transport: UdpTransport;
  private readonly events: IceAgentEvents;
  private readonly transactions = new StunTransactions();
  private readonly hosts: HostBase[] = [];
  private readonly relays: RelayBase[] = [];
  private readonly reflexive: Candidate[] = [];
  private readonly remoteCandidates: Candidate[] = [];
  private readonly pairs: CandidatePair[] = [];
  private readonly foundations = new Map<string, string>();
  private state: AgentState = 'new';
  private remote: { ufrag: string; key: Buffer } | null = null;
  private triggered: CandidatePair[] = [];
  private earlyChecks: IncomingCheck[] = [];
  private nominating: CandidatePair | null = null;
  private selected: CandidatePair | null = null;
  private active: CandidatePair | null = null;
  private pacer: NodeJS.Timeout | null = null;
  private deadline: NodeJS.Timeout | null = null;
  private nominationTimer: NodeJS.Timeout | null = null;
  private nominationWaitOver = false;
  private consentTimer: NodeJS.Timeout | null = null;
  private lastFailedRetry = 0;
  private relaySilentIntervals = 0;
  private pathManagement = false;
  private checksStarted = 0;

  constructor(options: IceAgentOptions, events: IceAgentEvents) {
    this.options = options;
    this.timings = options.timings ?? DEFAULT_ICE_TIMINGS;
    this.transport = options.transport ?? systemUdp;
    this.events = events;
  }

  /** Binds the local sockets and collects host, server reflexive and relayed candidates. */
  async gather(): Promise<IceParameters> {
    if (this.state !== 'new') {
      throw new Error('ICE candidates were already gathered');
    }
    this.state = 'gathering';
    for (const [index, address] of this.options.hostAddresses.entries()) {
      const socket = this.transport.createSocket();
      try {
        await socket.bind(address, 0);
      } catch (error) {
        socket.close();
        this.log(`cannot bind ${address}: ${String(error)}`);
        continue;
      }
      const base: HostBase = {
        kind: 'host',
        socket,
        candidate: this.candidate('host', { address, port: socket.address().port }, 65535 - index, null),
        allocations: [],
      };
      socket.onMessage((data, from) => this.onHostDatagram(base, data, from));
      socket.onError((error) => this.log(`socket ${addressKey(base.candidate)}: ${error.message}`));
      this.hosts.push(base);
      if (this.isClosed()) {
        socket.close();
      }
    }
    const primary = this.hosts[0];
    if (this.isClosed() || !primary) {
      throw new Error(this.isClosed() ? 'ICE agent closed' : 'No local IPv4 address to bind');
    }

    let late = false;
    // One answering STUN server is enough: the others report the same mapping unless the NAT is symmetric, and some
    // networks only let the first destination of a socket answer.
    const reflexive = Promise.any(
      this.options.stunServers.map(async (server) => {
        if (!(await this.discoverReflexive(primary, server))) {
          throw new Error('no mapping');
        }
      }),
    ).catch(() => {});
    await new Promise<void>((resolve) => {
      let grace: NodeJS.Timeout | null = null;
      const done = (): void => {
        clearTimeout(timer);
        if (grace) {
          clearTimeout(grace);
        }
        resolve();
      };
      const timer = setTimeout(done, this.timings.gatherTimeoutMs);
      // A TURN server that does not answer would hold the candidates back for the whole timeout; once one relay is in,
      // the others get a short grace, since the first relay may still not carry traffic between the players.
      const startGrace = (): void => {
        void reflexive.then(() => {
          grace ??= setTimeout(done, this.timings.turnGraceMs);
        });
      };
      const relays = this.options.turnServers.map((server) =>
        this.allocateRelay(primary, server, () => late).then(() => {
          if (this.relays.length > 0) {
            startGrace();
          }
        }),
      );
      void Promise.all([reflexive, ...relays]).then(done);
    });
    late = true;
    if (this.isClosed()) {
      throw new Error('ICE agent closed');
    }
    this.state = 'gathered';
    const candidates = [...this.hosts.map((host) => host.candidate), ...this.reflexive, ...this.relays.map((relay) => relay.candidate)];
    return {
      ufrag: this.ufrag,
      password: this.password,
      candidates: candidates.filter((candidate) => isAllowed(this.options.policy, candidate.type)),
    };
  }

  /** Starts connectivity checks against the remote candidates. */
  start(remote: IceParameters): void {
    if (this.state !== 'gathered') {
      throw new Error('ICE candidates have to be gathered before the checks');
    }
    this.state = 'checking';
    this.checksStarted = Date.now();
    this.remote = { ufrag: remote.ufrag, key: Buffer.from(remote.password, 'utf8') };
    const remotePolicy = this.options.remotePolicy ?? ALL_CANDIDATES;
    for (const candidate of remote.candidates) {
      if (isAllowed(remotePolicy, candidate.type)) {
        this.addRemoteCandidate(candidate);
      }
    }
    for (const relay of this.relays) {
      this.permitPeers(relay);
    }
    const early = this.earlyChecks;
    this.earlyChecks = [];
    for (const check of early) {
      this.onValidatedCheck(check);
    }
    this.pacer = setInterval(() => this.tick(), this.timings.pacingMs);
    this.deadline = setTimeout(() => this.fail('connectivity checks timed out'), this.timings.checkTimeoutMs);
  }

  /** Sends a datagram over the active pair; returns false while there is none. */
  send(data: Buffer): boolean {
    const pair = this.active ?? this.selected;
    if (this.state !== 'connected' || !pair) {
      return false;
    }
    this.sendFrom(pair.local, pair.remoteAddress, data);
    return true;
  }

  /** Sends a datagram over one of the managed paths, whichever is active. */
  sendVia(pathId: string, data: Buffer): boolean {
    const pair = this.pairs.find((candidate) => candidate.id === pathId);
    if (this.state !== 'connected' || !pair || pair.state !== 'succeeded') {
      return false;
    }
    this.sendFrom(pair.local, pair.remoteAddress, data);
    return true;
  }

  /**
   * Keeps the succeeded pairs checked from now on and only lets data in from pairs that passed a check. Only for a
   * TFAF peer, which checks its pairs as well: another adapter may send from an address the agent never checked.
   */
  enablePathManagement(): void {
    if (this.pathManagement || this.isClosed()) {
      return;
    }
    this.pathManagement = true;
    if (this.state === 'connected') {
      this.startConsent();
    }
  }

  get managesPaths(): boolean {
    return this.pathManagement;
  }

  /** The kept pairs with their round trip and loss; empty unless paths are managed. */
  paths(now = Date.now()): PathInfo[] {
    if (!this.pathManagement || this.state !== 'connected') {
      return [];
    }
    return this.trackedPairs(now).map((pair) => this.pathInfo(pair, now));
  }

  activePathId(): string | null {
    return (this.active ?? this.selected)?.id ?? null;
  }

  /** Whether the active pair goes through a TURN relay; null before the connection is up. */
  activeIsRelay(): boolean | null {
    const pair = this.active ?? this.selected;
    return pair ? isRelayPair(pair) : null;
  }

  describePath(pathId: string): string {
    const pair = this.pairs.find((candidate) => candidate.id === pathId);
    return pair ? this.describe(pair) : pathId;
  }

  /** Moves the traffic to another succeeded pair. */
  use(pathId: string): boolean {
    const pair = this.pairs.find((candidate) => candidate.id === pathId);
    if (!pair || pair.state !== 'succeeded' || this.state !== 'connected') {
      return false;
    }
    this.active = pair;
    if (pair.local.kind === 'relay') {
      pair.local.allocation
        .bindChannel(pair.remoteAddress)
        .catch((error: unknown) => this.log(`TURN channel: ${String(error)}`));
    }
    return true;
  }

  close(): void {
    if (this.state === 'closed') {
      return;
    }
    this.state = 'closed';
    this.stopTimers();
    this.stopConsent();
    this.transactions.cancelAll();
    for (const host of this.hosts) {
      for (const allocation of host.allocations) {
        allocation.close();
      }
      host.socket.close();
    }
  }

  // A method rather than a comparison, so TypeScript does not keep the state narrowed across awaits.
  private isClosed(): boolean {
    return this.state === 'closed';
  }

  private candidate(type: CandidateType, address: Address, localPreference: number, related: Address | null): Candidate {
    const key = `${type}|${type === 'host' ? address.address : (related?.address ?? address.address)}`;
    let foundation = this.foundations.get(key);
    if (!foundation) {
      foundation = String(this.foundations.size + 1);
      this.foundations.set(key, foundation);
    }
    return {
      type,
      address: address.address,
      port: address.port,
      priority: candidatePriority(type, localPreference),
      foundation,
      relatedAddress: related?.address ?? null,
      relatedPort: related?.port ?? 0,
    };
  }

  private async discoverReflexive(base: HostBase, server: Address): Promise<boolean> {
    const transactionId = newTransactionId();
    const request = encodeStun({ method: Method.binding, cls: 'request', transactionId, attributes: [] });
    try {
      const { message } = await this.transactions.request(
        transactionId,
        () => base.socket.send(request, server),
        this.timings.stunRetransmission,
      );
      const mapped = message.cls === 'success' ? readMappedAddress(message) : null;
      if (mapped) {
        this.addReflexive(base, mapped);
      }
      return mapped !== null;
    } catch {
      return false;
    }
  }

  private async allocateRelay(base: HostBase, server: TurnServer, isLate: () => boolean): Promise<void> {
    const relay = await this.allocate(base, server);
    if (!relay) {
      return;
    }
    if (isLate() || this.state !== 'gathering') {
      relay.allocation.close();
      return;
    }
    this.addRelay(base, relay);
    if (relay.allocation.mapped) {
      this.addReflexive(base, relay.allocation.mapped);
    }
  }

  private async allocate(base: HostBase, server: TurnServer): Promise<RelayBase | null> {
    const holder: { relay: RelayBase | null } = { relay: null };
    try {
      const allocation = await TurnAllocation.allocate(
        server,
        {
          transactions: this.transactions,
          send: (data) => base.socket.send(data, server.address),
          log: (message) => this.log(message),
        },
        {
          refreshMs: this.timings.turnRefreshMs,
          onLost: () => {
            if (holder.relay) {
              this.onAllocationLost(base, holder.relay);
            }
          },
        },
      );
      // Faster relays are preferred among relayed candidates.
      const preference = 65535 - Math.min(allocation.rttMs, 65535);
      holder.relay = {
        kind: 'relay',
        allocation,
        server,
        candidate: this.candidate('relay', allocation.relayed, preference, allocation.mapped),
      };
      this.log(`TURN ${addressKey(server.address)}: relayed ${addressKey(allocation.relayed)}, ${allocation.rttMs} ms`);
      return holder.relay;
    } catch (error) {
      this.log(`TURN ${addressKey(server.address)}: ${String(error)}`);
      return null;
    }
  }

  private addRelay(base: HostBase, relay: RelayBase): void {
    base.allocations.push(relay.allocation);
    this.relays.push(relay);
  }

  /** The server forgot the allocation, typically because our address changed: a new one takes its place. */
  private onAllocationLost(base: HostBase, lost: RelayBase): void {
    const index = this.relays.indexOf(lost);
    if (index === -1 || this.isClosed()) {
      return;
    }
    this.relays.splice(index, 1);
    const allocationIndex = base.allocations.indexOf(lost.allocation);
    if (allocationIndex !== -1) {
      base.allocations.splice(allocationIndex, 1);
    }
    lost.allocation.close();
    for (const pair of this.pairs) {
      if (pair.local === lost) {
        pair.state = 'failed';
      }
    }
    if (this.active?.local === lost) {
      this.active = null;
    }
    if (!this.pathManagement || this.state !== 'connected') {
      return;
    }
    void this.allocate(base, lost.server).then((relay) => {
      if (!relay) {
        return;
      }
      if (this.isClosed()) {
        relay.allocation.close();
        return;
      }
      this.addRelay(base, relay);
      this.permitPeers(relay);
      for (const remote of this.remoteCandidates) {
        this.consentCheck(this.addPair(relay, remote));
      }
    });
  }

  private permitPeers(relay: RelayBase): void {
    for (const ip of new Set(this.remoteCandidates.map((candidate) => candidate.address))) {
      relay.allocation.createPermission(ip).catch((error: unknown) => this.log(`TURN permission for ${ip}: ${String(error)}`));
    }
  }

  private addReflexive(base: HostBase, mapped: Address): void {
    const known = [...this.hosts.map((host) => host.candidate), ...this.reflexive];
    if (this.state !== 'gathering' || known.some((candidate) => sameAddress(candidate, mapped))) {
      return;
    }
    const localPreference = (base.candidate.priority >>> 8) & 0xffff;
    this.reflexive.push(this.candidate('srflx', mapped, localPreference, base.candidate));
  }

  private addRemoteCandidate(candidate: Candidate): void {
    if (this.remoteCandidates.some((known) => sameAddress(known, candidate))) {
      return;
    }
    this.remoteCandidates.push(candidate);
    for (const local of [...this.hosts, ...this.relays]) {
      this.addPair(local, candidate);
    }
  }

  private addPair(local: LocalBase, remote: Candidate): CandidatePair {
    const existing = this.pairs.find((pair) => pair.local === local && sameAddress(pair.remoteAddress, remote));
    if (existing) {
      return existing;
    }
    const [controlling, controlled] = this.options.controlling
      ? [local.candidate.priority, remote.priority]
      : [remote.priority, local.candidate.priority];
    const pair: CandidatePair = {
      id: `${local.kind} ${addressKey(local.candidate)}>${addressKey(remote)}`,
      local,
      remote,
      remoteAddress: { address: remote.address, port: remote.port },
      priority: pairPriority(controlling, controlled),
      state: 'waiting',
      useCandidateReceived: false,
      samples: [],
      lastResponseAt: null,
      consentInFlight: false,
    };
    const index = this.pairs.findIndex((other) => other.priority < pair.priority);
    this.pairs.splice(index === -1 ? this.pairs.length : index, 0, pair);
    return pair;
  }

  private tick(): void {
    if (this.state !== 'checking') {
      return;
    }
    const pair = this.triggered.shift() ?? this.pairs.find((candidate) => candidate.state === 'waiting');
    if (pair) {
      this.check(pair, false);
    } else if (
      Date.now() - this.checksStarted >= this.timings.minCheckTimeMs &&
      this.pairs.length > 0 &&
      !this.nominating &&
      this.pairs.every((candidate) => candidate.state === 'failed')
    ) {
      this.fail('all connectivity checks failed');
    }
  }

  private bindingRequest(transactionId: Buffer, pair: CandidatePair, nominate: boolean): Buffer | null {
    const remote = this.remote;
    if (!remote) {
      return null;
    }
    const attributes: StunAttribute[] = [
      stringAttribute(Attr.username, `${remote.ufrag}:${this.ufrag}`),
      uint32Attribute(Attr.priority, peerReflexivePriority(pair.local.candidate)),
      { type: this.options.controlling ? Attr.iceControlling : Attr.iceControlled, value: this.tieBreaker },
    ];
    if (nominate) {
      attributes.push({ type: Attr.useCandidate, value: Buffer.alloc(0) });
    }
    return encodeStun(
      { method: Method.binding, cls: 'request', transactionId, attributes },
      { integrityKey: remote.key, fingerprint: true },
    );
  }

  private check(pair: CandidatePair, nominate: boolean): void {
    const transactionId = newTransactionId();
    const request = this.bindingRequest(transactionId, pair, nominate);
    if (!request) {
      return;
    }
    if (!nominate) {
      pair.state = 'inProgress';
    }
    this.transactions
      .request(transactionId, () => this.sendFrom(pair.local, pair.remoteAddress, request), this.timings.checkRetransmission)
      .then(
        (response) => this.onCheckResponse(pair, response, nominate),
        () => this.onCheckFailed(pair, nominate),
      );
  }

  private isValidResponse(pair: CandidatePair, response: StunResponse): boolean {
    const { message, from } = response;
    // The response has to come from where the request went (RFC 8445, section 7.2.5.2.1).
    return message.cls === 'success' && this.remote !== null && verifyIntegrity(message, this.remote.key) && sameAddress(from, pair.remoteAddress);
  }

  private onCheckResponse(pair: CandidatePair, response: StunResponse, nominate: boolean): void {
    if ((this.state !== 'checking' && this.state !== 'connected') || !this.remote) {
      return;
    }
    if (!this.isValidResponse(pair, response)) {
      if (response.message.cls === 'error') {
        const error = readErrorCode(response.message);
        this.log(`check ${this.describe(pair)}: error ${error?.code ?? '?'} ${error?.reason ?? ''}`);
      }
      this.onCheckFailed(pair, nominate);
      return;
    }
    pair.state = 'succeeded';
    pair.lastResponseAt = Date.now();
    if (this.options.controlling) {
      if (nominate) {
        this.nominating = null;
        this.select(pair);
      } else {
        this.considerNomination();
      }
    } else if (pair.useCandidateReceived) {
      this.select(pair);
    }
  }

  private onCheckFailed(pair: CandidatePair, nominate: boolean): void {
    if (this.state !== 'checking') {
      return;
    }
    pair.state = 'failed';
    if (nominate) {
      this.nominating = this.pairs.find((candidate) => candidate.state === 'succeeded') ?? null;
      if (this.nominating) {
        this.check(this.nominating, true);
      }
    } else {
      this.considerNomination();
    }
  }

  /**
   * The best succeeded pair comes first, since the pairs are sorted by priority and every direct pair outranks every
   * relayed one. A direct pair is nominated at once; a relayed one only when no direct pair is left to succeed or the
   * wait is over.
   */
  private considerNomination(): void {
    if (!this.options.controlling || this.selected || this.nominating || this.state !== 'checking') {
      return;
    }
    const best = this.pairs.find((pair) => pair.state === 'succeeded');
    if (!best) {
      return;
    }
    const directPending =
      isRelayPair(best) &&
      this.pairs.some((pair) => !isRelayPair(pair) && (pair.state === 'waiting' || pair.state === 'inProgress'));
    if (directPending && !this.nominationWaitOver) {
      this.nominationTimer ??= setTimeout(() => {
        this.nominationTimer = null;
        this.nominationWaitOver = true;
        this.considerNomination();
      }, this.timings.nominationWaitMs);
      return;
    }
    this.clearNominationTimer();
    this.nominating = best;
    this.check(best, true);
  }

  private onHostDatagram(base: HostBase, data: Buffer, from: Address): void {
    const allocation = base.allocations.find((candidate) => sameAddress(candidate.server, from));
    if (!allocation) {
      this.onDatagram(base, data, from);
      return;
    }
    const relayed = allocation.receive(data);
    const relay = this.relays.find((candidate) => candidate.allocation === allocation);
    if (relayed && relay) {
      this.onDatagram(relay, relayed.payload, relayed.peer);
    }
  }

  private onDatagram(base: LocalBase, data: Buffer, from: Address): void {
    if (this.state === 'closed') {
      return;
    }
    if (!isStunMessage(data)) {
      if (data.length > 0 && this.acceptsDataFrom(base, from)) {
        this.events.onData(data);
      }
      return;
    }
    const message = decodeStun(data);
    if (!message || !verifyFingerprint(message)) {
      return;
    }
    if (message.cls === 'success' || message.cls === 'error') {
      this.transactions.resolve(message, from);
    } else if (message.cls === 'request' && message.method === Method.binding) {
      this.onBindingRequest(base, message, from);
    }
  }

  /** Without path management everything goes through, as with the Java adapter; with it only checked pairs. */
  private acceptsDataFrom(base: LocalBase, from: Address): boolean {
    if (!this.pathManagement) {
      return true;
    }
    return this.pairs.some((pair) => pair.local === base && pair.state === 'succeeded' && sameAddress(pair.remoteAddress, from));
  }

  private onBindingRequest(base: LocalBase, message: DecodedStunMessage, from: Address): void {
    const username = readString(message, Attr.username);
    if (!username?.startsWith(`${this.ufrag}:`) || !verifyIntegrity(message, this.localKey)) {
      return;
    }
    const response = encodeStun(
      {
        method: Method.binding,
        cls: 'success',
        transactionId: message.transactionId,
        attributes: [xorAddressAttribute(Attr.xorMappedAddress, from)],
      },
      { integrityKey: this.localKey, fingerprint: true },
    );
    this.sendFrom(base, from, response);
    const check: IncomingCheck = {
      base,
      from,
      priority: readUint32(message, Attr.priority) ?? 0,
      useCandidate: findAttribute(message, Attr.useCandidate) !== null,
    };
    // The peer may start checking before its candidates reach us through the lobby server.
    if (!this.remote) {
      if (this.earlyChecks.length < MAX_EARLY_CHECKS) {
        this.earlyChecks.push(check);
      }
      return;
    }
    this.onValidatedCheck(check);
  }

  private onValidatedCheck(check: IncomingCheck): void {
    if (this.state !== 'checking' && this.state !== 'connected') {
      return;
    }
    let pair = this.pairs.find((candidate) => candidate.local === check.base && sameAddress(candidate.remoteAddress, check.from));
    if (!pair) {
      // Once connected, only managed paths learn new addresses: the peer's NAT mapping changed.
      if ((this.state !== 'checking' && !this.pathManagement) || this.pairs.length >= MAX_PAIRS) {
        return;
      }
      let remote = this.remoteCandidates.find((candidate) => sameAddress(candidate, check.from));
      if (!remote) {
        remote = {
          ...this.candidate('prflx', check.from, 0, null),
          priority: check.priority || candidatePriority('prflx', 0),
        };
        this.remoteCandidates.push(remote);
      }
      pair = this.addPair(check.base, remote);
      if (this.state === 'connected') {
        this.log(`the peer checks from a new address: ${this.describe(pair)}`);
      }
    }
    if (check.useCandidate && !this.options.controlling) {
      pair.useCandidateReceived = true;
    }
    if (pair.state === 'succeeded') {
      if (pair.useCandidateReceived && !this.options.controlling) {
        this.select(pair);
      }
      return;
    }
    if (this.state === 'connected') {
      if (this.pathManagement) {
        this.consentCheck(pair);
      }
      return;
    }
    if (pair.state !== 'inProgress' && !this.triggered.includes(pair)) {
      pair.state = 'waiting';
      this.triggered.push(pair);
    }
  }

  private select(pair: CandidatePair): void {
    if (this.selected === pair || this.state === 'closed' || this.state === 'failed') {
      return;
    }
    const first = this.selected === null;
    this.selected = pair;
    this.active = null;
    this.state = 'connected';
    this.triggered = [];
    this.stopTimers();
    this.log(`selected ${this.describe(pair)}`);
    if (pair.local.kind === 'relay') {
      pair.local.allocation
        .bindChannel(pair.remoteAddress)
        .catch((error: unknown) => this.log(`TURN channel: ${String(error)}`));
    }
    if (this.pathManagement) {
      this.startConsent();
    }
    if (first) {
      this.events.onConnected({
        localType: pair.local.candidate.type,
        remoteType: pair.remote.type,
        local: { address: pair.local.candidate.address, port: pair.local.candidate.port },
        remote: pair.remoteAddress,
      });
    }
  }

  private startConsent(): void {
    if (this.consentTimer || this.isClosed()) {
      return;
    }
    this.lastFailedRetry = Date.now();
    for (const pair of this.pairs) {
      if (pair.state === 'succeeded' && pair.lastResponseAt === null) {
        pair.lastResponseAt = Date.now();
      }
    }
    this.consentTimer = setInterval(() => this.consentTick(), this.timings.consentIntervalMs);
    this.consentTick();
  }

  private stopConsent(): void {
    if (this.consentTimer) {
      clearInterval(this.consentTimer);
      this.consentTimer = null;
    }
  }

  /** Succeeded pairs worth checking: the active one, the best direct and relayed ones by score, then the rest. */
  private trackedPairs(now: number): CandidatePair[] {
    const succeeded = this.pairs.filter((pair) => pair.state === 'succeeded');
    const score = (pair: CandidatePair): number => {
      const info = this.pathInfo(pair, now);
      return (info.rttMs ?? 10_000) + 15 * info.lossPercent;
    };
    const ranked = [...succeeded].sort((a, b) => score(a) - score(b));
    const tracked: CandidatePair[] = [];
    const add = (pair: CandidatePair | undefined): void => {
      if (pair && !tracked.includes(pair) && tracked.length < MAX_TRACKED_PATHS) {
        tracked.push(pair);
      }
    };
    const current = this.active ?? this.selected;
    if (current?.state === 'succeeded') {
      add(current);
    }
    add(ranked.find((pair) => !isRelayPair(pair)));
    add(ranked.find((pair) => isRelayPair(pair)));
    for (const pair of ranked) {
      add(pair);
    }
    return tracked;
  }

  private consentTick(): void {
    if (this.state !== 'connected' || !this.pathManagement) {
      return;
    }
    const now = Date.now();
    const tracked = this.trackedPairs(now);
    for (const pair of tracked) {
      this.consentCheck(pair);
    }
    if (now - this.lastFailedRetry >= this.timings.retryFailedPairsMs) {
      this.lastFailedRetry = now;
      for (const pair of this.pairs) {
        if (pair.state !== 'succeeded') {
          this.consentCheck(pair);
        }
      }
    }
    this.watchRelays(tracked, now);
  }

  /**
   * Relayed paths that stay silent while a direct one answers mean the TURN server no longer knows our address; a
   * refresh tells for sure and replaces the allocation. A silent network keeps all paths silent and refreshes nothing.
   */
  private watchRelays(tracked: CandidatePair[], now: number): void {
    const alive = (pair: CandidatePair): boolean =>
      pair.lastResponseAt !== null && now - pair.lastResponseAt <= this.timings.pathAliveMs;
    const relayed = tracked.filter((pair) => pair.local.kind === 'relay');
    const directAlive = tracked.some((pair) => pair.local.kind === 'host' && alive(pair));
    if (relayed.length === 0 || !directAlive || relayed.some(alive)) {
      this.relaySilentIntervals = 0;
      return;
    }
    this.relaySilentIntervals++;
    if (this.relaySilentIntervals === SILENT_RELAY_INTERVALS) {
      for (const pair of relayed) {
        if (pair.local.kind === 'relay') {
          pair.local.allocation.refreshNow();
        }
      }
    }
  }

  /** One check without retransmissions: each is a round trip sample or a loss. */
  private consentCheck(pair: CandidatePair): void {
    if (pair.consentInFlight || this.state !== 'connected') {
      return;
    }
    const transactionId = newTransactionId();
    const request = this.bindingRequest(transactionId, pair, false);
    if (!request) {
      return;
    }
    pair.consentInFlight = true;
    const sentAt = Date.now();
    const timeoutMs = Math.max(50, Math.round(this.timings.pathAliveMs / 2));
    const once: Retransmission = { initialRtoMs: timeoutMs, maxRtoMs: timeoutMs, attempts: 1 };
    this.transactions
      .request(transactionId, () => this.sendFrom(pair.local, pair.remoteAddress, request), once)
      .then(
        (response) => {
          pair.consentInFlight = false;
          if (!this.isValidResponse(pair, response)) {
            this.addSample(pair, null);
            return;
          }
          const now = Date.now();
          if (pair.state !== 'succeeded') {
            pair.state = 'succeeded';
            this.log(`path available: ${this.describe(pair)}`);
          }
          pair.lastResponseAt = now;
          this.addSample(pair, now - sentAt);
        },
        () => {
          pair.consentInFlight = false;
          this.addSample(pair, null);
        },
      );
  }

  private addSample(pair: CandidatePair, rttMs: number | null): void {
    const now = Date.now();
    pair.samples.push({ at: now, rttMs });
    const oldest = now - this.timings.pathStatsWindowMs;
    while (pair.samples.length > 0 && pair.samples[0]!.at < oldest) {
      pair.samples.shift();
    }
  }

  private pathInfo(pair: CandidatePair, now: number): PathInfo {
    const oldest = now - this.timings.pathStatsWindowMs;
    const samples = pair.samples.filter((sample) => sample.at >= oldest);
    const answered = samples.flatMap((sample) => (sample.rttMs === null ? [] : [sample.rttMs]));
    return {
      id: pair.id,
      relay: isRelayPair(pair),
      description: this.describe(pair),
      rttMs: percentile90(answered),
      lossPercent: samples.length === 0 ? 0 : (100 * (samples.length - answered.length)) / samples.length,
      lastResponseAt: pair.lastResponseAt,
    };
  }

  private fail(reason: string): void {
    if (this.state !== 'checking') {
      return;
    }
    this.state = 'failed';
    this.stopTimers();
    this.transactions.cancelAll();
    this.log(reason);
    this.events.onFailed(reason);
  }

  private sendFrom(local: LocalBase, to: Address, data: Buffer): void {
    if (local.kind === 'host') {
      local.socket.send(data, to);
    } else {
      local.allocation.sendTo(to, data);
    }
  }

  private clearNominationTimer(): void {
    if (this.nominationTimer) {
      clearTimeout(this.nominationTimer);
      this.nominationTimer = null;
    }
  }

  private stopTimers(): void {
    if (this.pacer) {
      clearInterval(this.pacer);
      this.pacer = null;
    }
    if (this.deadline) {
      clearTimeout(this.deadline);
      this.deadline = null;
    }
    this.clearNominationTimer();
  }

  private describe(pair: CandidatePair): string {
    return `${pair.local.candidate.type} ${addressKey(pair.local.candidate)} -> ${pair.remote.type} ${addressKey(pair.remoteAddress)}`;
  }

  private log(message: string): void {
    this.options.log(message);
  }
}
