// TURN client over UDP (RFC 8656): one allocation on a TURN server, used as the relayed ICE candidate.

import {
  type Address,
  addressKey,
  Attr,
  decodeChannelData,
  decodeStun,
  type DecodedStunMessage,
  encodeChannelData,
  encodeStun,
  findAttribute,
  isChannelData,
  longTermKey,
  Method,
  newTransactionId,
  readErrorCode,
  readString,
  readUint32,
  readXorAddress,
  type StunAttribute,
  stringAttribute,
  uint32Attribute,
  xorAddressAttribute,
} from './stun.ts';
import type { Retransmission, StunTransactions } from './transactions.ts';

export interface TurnServer {
  address: Address;
  username: string;
  credential: string;
}

export interface TurnTransport {
  transactions: StunTransactions;
  /** Sends a datagram to the TURN server from the socket the allocation was made on. */
  send(data: Buffer): void;
  log(message: string): void;
}

const REQUESTED_LIFETIME_S = 600;
// Permissions live 5 minutes and channel bindings 10 minutes on the server.
const PERMISSION_REFRESH_MS = 4 * 60 * 1000;
const CHANNEL_REFRESH_MS = 5 * 60 * 1000;
const FIRST_CHANNEL = 0x4000;
const LAST_CHANNEL = 0x7ffe;
const UDP_PROTOCOL = 17;
const RETRANSMISSION: Retransmission = { initialRtoMs: 500, maxRtoMs: 4000, attempts: 5 };

const METHOD_NAMES: Record<number, string> = {
  [Method.allocate]: 'Allocate',
  [Method.refresh]: 'Refresh',
  [Method.createPermission]: 'CreatePermission',
  [Method.channelBind]: 'ChannelBind',
};

export class TurnError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.code = code;
  }
}

export interface TurnAllocationOptions {
  /** Overrides the refresh interval derived from the lifetime the server granted. */
  refreshMs?: number | null;
  /** The server no longer knows the allocation (437) or stopped answering its refreshes. */
  onLost?: () => void;
}

const ALLOCATION_MISMATCH = 437;

interface Credentials {
  username: string;
  realm: string;
  nonce: string;
  key: Buffer;
}

export interface RelayedPacket {
  peer: Address;
  payload: Buffer;
}

export class TurnAllocation {
  readonly server: Address;
  readonly relayed: Address;
  readonly mapped: Address | null;
  readonly rttMs: number;
  private readonly transport: TurnTransport;
  private readonly credentials: Credentials;
  private readonly permissions = new Set<string>();
  private readonly channels = new Map<string, number>();
  private readonly channelPeers = new Map<number, Address>();
  private nextChannel = FIRST_CHANNEL;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly onLost: (() => void) | null;
  private refreshing: Promise<void> | null = null;
  private closed = false;
  private lost = false;

  private constructor(
    server: Address,
    transport: TurnTransport,
    credentials: Credentials,
    allocation: { relayed: Address; mapped: Address | null; lifetimeS: number; rttMs: number },
    options: TurnAllocationOptions,
  ) {
    this.server = server;
    this.transport = transport;
    this.credentials = credentials;
    this.relayed = allocation.relayed;
    this.mapped = allocation.mapped;
    this.rttMs = allocation.rttMs;
    this.onLost = options.onLost ?? null;
    const refreshMs = options.refreshMs ?? Math.max(30, allocation.lifetimeS - 60) * 1000;
    this.every(refreshMs, () => this.refresh());
    this.every(PERMISSION_REFRESH_MS, () => Promise.all([...this.permissions].map((ip) => this.permit(ip))));
    this.every(CHANNEL_REFRESH_MS, () =>
      Promise.all([...this.channels].map(([, channel]) => this.bind(channel, this.channelPeers.get(channel)!))),
    );
  }

  get isLost(): boolean {
    return this.lost;
  }

  static async allocate(server: TurnServer, transport: TurnTransport, options: TurnAllocationOptions = {}): Promise<TurnAllocation> {
    const started = performance.now();
    const allocateAttributes = [
      uint32Attribute(Attr.requestedTransport, UDP_PROTOCOL << 24),
      uint32Attribute(Attr.lifetime, REQUESTED_LIFETIME_S),
    ];
    const challenge = await send(transport, server.address, Method.allocate, allocateAttributes, null);
    if (challenge.cls !== 'error' || readErrorCode(challenge)?.code !== 401) {
      throw new TurnError(`TURN server did not ask for credentials: ${describeResponse(challenge)}`);
    }
    const realm = readString(challenge, Attr.realm);
    const nonce = readString(challenge, Attr.nonce);
    if (realm === null || nonce === null) {
      throw new TurnError('TURN server did not send REALM and NONCE');
    }
    const credentials: Credentials = {
      username: server.username,
      realm,
      nonce,
      key: longTermKey(server.username, realm, server.credential),
    };
    const response = await authenticated(transport, server.address, credentials, Method.allocate, allocateAttributes);
    const relayed = readXorAddress(response, Attr.xorRelayedAddress);
    if (!relayed) {
      throw new TurnError('TURN server did not return a relayed IPv4 address');
    }
    return new TurnAllocation(
      server.address,
      transport,
      credentials,
      {
        relayed,
        mapped: readXorAddress(response, Attr.xorMappedAddress),
        lifetimeS: readUint32(response, Attr.lifetime) ?? REQUESTED_LIFETIME_S,
        rttMs: Math.round(performance.now() - started),
      },
      options,
    );
  }

  /**
   * Refreshes the allocation now, for example when nothing comes back through it: a server that no longer knows it
   * (our address changed) or does not answer marks it lost.
   */
  refreshNow(): void {
    if (!this.closed && !this.lost) {
      void this.refresh().catch(() => {});
    }
  }

  /** Allows the peer's IP to send through the relay; data from IPs without a permission is dropped by the server. */
  async createPermission(ip: string): Promise<void> {
    if (this.closed || this.permissions.has(ip)) {
      return;
    }
    this.permissions.add(ip);
    try {
      await this.permit(ip);
    } catch (error) {
      this.permissions.delete(ip);
      throw error;
    }
  }

  /** Switches traffic to the peer from Send indications (36 bytes overhead) to ChannelData (4 bytes). */
  async bindChannel(peer: Address): Promise<void> {
    const key = addressKey(peer);
    if (this.closed || this.channels.has(key) || this.nextChannel > LAST_CHANNEL) {
      return;
    }
    const channel = this.nextChannel++;
    // Known before the response, because the server may relay ChannelData right after accepting the binding.
    this.channelPeers.set(channel, peer);
    try {
      await this.bind(channel, peer);
      this.channels.set(key, channel);
    } catch (error) {
      this.channelPeers.delete(channel);
      throw error;
    }
  }

  sendTo(peer: Address, payload: Buffer): void {
    if (this.closed) {
      return;
    }
    const channel = this.channels.get(addressKey(peer));
    if (channel !== undefined) {
      this.transport.send(encodeChannelData(channel, payload));
      return;
    }
    this.transport.send(
      encodeStun({
        method: Method.send,
        cls: 'indication',
        transactionId: newTransactionId(),
        attributes: [xorAddressAttribute(Attr.xorPeerAddress, peer), { type: Attr.data, value: payload }],
      }),
    );
  }

  /**
   * Handles a datagram received from the TURN server. Returns relayed peer data; responses to our requests are passed
   * on to the transactions.
   */
  receive(data: Buffer): RelayedPacket | null {
    if (isChannelData(data)) {
      const decoded = decodeChannelData(data);
      const peer = decoded ? this.channelPeers.get(decoded.channel) : undefined;
      return decoded && peer ? { peer, payload: decoded.payload } : null;
    }
    const message = decodeStun(data);
    if (!message) {
      return null;
    }
    if (message.cls === 'indication' && message.method === Method.data) {
      const peer = readXorAddress(message, Attr.xorPeerAddress);
      const payload = findAttribute(message, Attr.data);
      return peer && payload ? { peer, payload } : null;
    }
    if (message.cls === 'success' || message.cls === 'error') {
      this.transport.transactions.resolve(message, this.server);
    }
    return null;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    // Releases the allocation right away instead of letting it expire; the answer does not matter.
    this.transport.send(
      encodeStun(
        {
          method: Method.refresh,
          cls: 'request',
          transactionId: newTransactionId(),
          attributes: [uint32Attribute(Attr.lifetime, 0), ...credentialAttributes(this.credentials)],
        },
        { integrityKey: this.credentials.key, fingerprint: true },
      ),
    );
  }

  private refresh(): Promise<void> {
    this.refreshing ??= this.request(Method.refresh, [uint32Attribute(Attr.lifetime, REQUESTED_LIFETIME_S)])
      .then(
        () => {},
        (error: unknown) => {
          const mismatch = error instanceof TurnError && error.code === ALLOCATION_MISMATCH;
          const unanswered = !(error instanceof TurnError);
          if ((mismatch || unanswered) && !this.closed && !this.lost) {
            this.lost = true;
            this.transport.log(`TURN ${addressKey(this.server)}: allocation lost (${String(error)})`);
            this.onLost?.();
            return;
          }
          throw error;
        },
      )
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private permit(ip: string): Promise<DecodedStunMessage> {
    return this.request(Method.createPermission, [xorAddressAttribute(Attr.xorPeerAddress, { address: ip, port: 0 })]);
  }

  private bind(channel: number, peer: Address): Promise<DecodedStunMessage> {
    return this.request(Method.channelBind, [
      uint32Attribute(Attr.channelNumber, channel << 16),
      xorAddressAttribute(Attr.xorPeerAddress, peer),
    ]);
  }

  private request(method: number, attributes: StunAttribute[]): Promise<DecodedStunMessage> {
    return authenticated(this.transport, this.server, this.credentials, method, attributes);
  }

  private every(intervalMs: number, task: () => Promise<unknown>): void {
    const timer = setInterval(() => {
      if (!this.closed) {
        task().catch((error: unknown) => this.transport.log(`TURN ${addressKey(this.server)}: ${String(error)}`));
      }
    }, intervalMs);
    timer.unref();
    this.timers.push(timer);
  }
}

function credentialAttributes(credentials: Credentials): StunAttribute[] {
  return [
    stringAttribute(Attr.username, credentials.username),
    stringAttribute(Attr.realm, credentials.realm),
    stringAttribute(Attr.nonce, credentials.nonce),
  ];
}

function describeResponse(message: DecodedStunMessage): string {
  const error = readErrorCode(message);
  return error ? `${error.code} ${error.reason}`.trim() : message.cls;
}

async function send(
  transport: TurnTransport,
  server: Address,
  method: number,
  attributes: StunAttribute[],
  credentials: Credentials | null,
): Promise<DecodedStunMessage> {
  const transactionId = newTransactionId();
  const bytes = encodeStun(
    {
      method,
      cls: 'request',
      transactionId,
      attributes: credentials ? [...attributes, ...credentialAttributes(credentials)] : attributes,
    },
    credentials ? { integrityKey: credentials.key, fingerprint: true } : {},
  );
  const { message } = await transport.transactions.request(transactionId, () => transport.send(bytes), RETRANSMISSION);
  return message;
}

/** Sends an authenticated request, retrying once with the new nonce when the server reports a stale one. */
async function authenticated(
  transport: TurnTransport,
  server: Address,
  credentials: Credentials,
  method: number,
  attributes: StunAttribute[],
): Promise<DecodedStunMessage> {
  for (let attempt = 1; ; attempt++) {
    const response = await send(transport, server, method, attributes, credentials);
    if (response.cls === 'success') {
      return response;
    }
    const code = readErrorCode(response)?.code;
    const nonce = readString(response, Attr.nonce);
    if (attempt === 1 && (code === 438 || code === 401) && nonce !== null) {
      credentials.nonce = nonce;
      continue;
    }
    throw new TurnError(`${METHOD_NAMES[method] ?? 'TURN request'} failed: ${describeResponse(response)}`, code ?? null);
  }
}
