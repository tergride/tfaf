// Minimal TURN server for tests: long-term credentials, allocations with permissions, Send/Data indications and
// channels. Runs on the loopback interface, or on a host of the simulated network (simNetwork.ts).
//
// Modes for failure tests: `silent` answers nothing, `noRelay` allocates but relays nothing between the players.

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
  readUint32,
  readXorAddress,
  type StunAttribute,
  stringAttribute,
  uint32Attribute,
  verifyIntegrity,
  xorAddressAttribute,
} from '../../src/main/ice/stun.ts';
import { systemUdp, type UdpSocket, type UdpTransport } from '../../src/main/ice/udpTransport.ts';

const REALM = 'tfaf.test';
const NONCE = 'nonce-1';

export type TurnMode = 'normal' | 'silent' | 'noRelay';

interface Allocation {
  client: Address;
  relay: UdpSocket;
  relayed: Address;
  permissions: Set<string>;
  channelsByPeer: Map<string, number>;
  peersByChannel: Map<number, Address>;
}

export interface FakeTurnOptions {
  transport?: UdpTransport;
  /** The IP the server and its relays bind to. */
  ip?: string;
  port?: number;
  mode?: TurnMode;
}

export class FakeTurnServer {
  readonly username = 'player';
  readonly credential = 'secret';
  readonly stats = { allocations: 0, relayedToPeers: 0, channelData: 0 };
  mode: TurnMode;
  private readonly socket: UdpSocket;
  private readonly transport: UdpTransport;
  private readonly ip: string;
  private readonly allocations = new Map<string, Allocation>();
  private readonly key = longTermKey(this.username, REALM, this.credential);

  private constructor(socket: UdpSocket, transport: UdpTransport, ip: string, mode: TurnMode) {
    this.socket = socket;
    this.transport = transport;
    this.ip = ip;
    this.mode = mode;
    socket.onMessage((data, from) => this.onMessage(data, from));
  }

  static async start(options: FakeTurnOptions = {}): Promise<FakeTurnServer> {
    const transport = options.transport ?? systemUdp;
    const ip = options.ip ?? '127.0.0.1';
    const socket = transport.createSocket();
    await socket.bind(ip, options.port ?? 0);
    return new FakeTurnServer(socket, transport, ip, options.mode ?? 'normal');
  }

  get address(): Address {
    return this.socket.address();
  }

  /** Drops every allocation, as a server does for a client whose address changed. */
  forgetAllocations(): void {
    for (const allocation of this.allocations.values()) {
      allocation.relay.close();
    }
    this.allocations.clear();
  }

  close(): void {
    this.forgetAllocations();
    this.socket.close();
  }

  private onMessage(data: Buffer, from: Address): void {
    if (this.mode === 'silent') {
      return;
    }
    const allocation = this.allocations.get(addressKey(from));
    if (isChannelData(data)) {
      const decoded = decodeChannelData(data);
      const peer = decoded && allocation?.peersByChannel.get(decoded.channel);
      if (decoded && allocation && peer) {
        this.stats.channelData++;
        this.relayToPeer(allocation, peer, decoded.payload);
      }
      return;
    }
    const message = decodeStun(data);
    if (!message) {
      return;
    }
    if (message.cls === 'indication' && message.method === Method.send && allocation) {
      const peer = readXorAddress(message, Attr.xorPeerAddress);
      const payload = findAttribute(message, Attr.data);
      if (peer && payload) {
        this.relayToPeer(allocation, peer, payload);
      }
      return;
    }
    if (message.cls !== 'request') {
      return;
    }
    if (!findAttribute(message, Attr.messageIntegrity)) {
      this.respond(message, from, 'error', [errorCode(401), stringAttribute(Attr.realm, REALM), stringAttribute(Attr.nonce, NONCE)], false);
      return;
    }
    if (!verifyIntegrity(message, this.key)) {
      this.respond(message, from, 'error', [errorCode(401)], false);
      return;
    }
    void this.onRequest(message, from, allocation);
  }

  private async onRequest(message: DecodedStunMessage, from: Address, allocation: Allocation | undefined): Promise<void> {
    if (message.method === Method.allocate) {
      if (allocation) {
        this.respond(message, from, 'error', [errorCode(437)], true);
        return;
      }
      const relay = this.transport.createSocket();
      await relay.bind(this.ip, 0);
      const created: Allocation = {
        client: from,
        relay,
        relayed: relay.address(),
        permissions: new Set(),
        channelsByPeer: new Map(),
        peersByChannel: new Map(),
      };
      relay.onMessage((data, peer) => this.onRelayed(created, data, peer));
      this.allocations.set(addressKey(from), created);
      this.stats.allocations++;
      this.respond(message, from, 'success', [
        xorAddressAttribute(Attr.xorRelayedAddress, created.relayed),
        xorAddressAttribute(Attr.xorMappedAddress, from),
        uint32Attribute(Attr.lifetime, 600),
      ], true);
      return;
    }
    if (!allocation) {
      this.respond(message, from, 'error', [errorCode(437)], true);
      return;
    }
    const peer = readXorAddress(message, Attr.xorPeerAddress);
    switch (message.method) {
      case Method.createPermission:
        if (peer) {
          allocation.permissions.add(peer.address);
        }
        break;
      case Method.channelBind: {
        const channel = (readUint32(message, Attr.channelNumber) ?? 0) >>> 16;
        if (peer) {
          allocation.permissions.add(peer.address);
          allocation.channelsByPeer.set(addressKey(peer), channel);
          allocation.peersByChannel.set(channel, peer);
        }
        break;
      }
      case Method.refresh:
        if (readUint32(message, Attr.lifetime) === 0) {
          allocation.relay.close();
          this.allocations.delete(addressKey(from));
        }
        break;
    }
    this.respond(message, from, 'success', [], true);
  }

  private relayToPeer(allocation: Allocation, peer: Address, payload: Buffer): void {
    if (this.mode === 'noRelay' || !allocation.permissions.has(peer.address)) {
      return;
    }
    this.stats.relayedToPeers++;
    allocation.relay.send(payload, peer);
  }

  private onRelayed(allocation: Allocation, payload: Buffer, peer: Address): void {
    if (this.mode !== 'normal' || !allocation.permissions.has(peer.address)) {
      return;
    }
    const channel = allocation.channelsByPeer.get(addressKey(peer));
    const data =
      channel !== undefined
        ? encodeChannelData(channel, payload)
        : encodeStun({
            method: Method.data,
            cls: 'indication',
            transactionId: newTransactionId(),
            attributes: [xorAddressAttribute(Attr.xorPeerAddress, peer), { type: Attr.data, value: payload }],
          });
    this.socket.send(data, allocation.client);
  }

  private respond(
    request: DecodedStunMessage,
    to: Address,
    cls: 'success' | 'error',
    attributes: StunAttribute[],
    sign: boolean,
  ): void {
    const response = encodeStun(
      { method: request.method, cls, transactionId: request.transactionId, attributes },
      sign ? { integrityKey: this.key, fingerprint: true } : {},
    );
    this.socket.send(response, to);
  }
}

function errorCode(code: number): StunAttribute {
  const value = Buffer.alloc(4);
  value[2] = Math.floor(code / 100);
  value[3] = code % 100;
  return { type: Attr.errorCode, value };
}
