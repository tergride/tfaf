// A simulated IPv4 network for ICE tests: hosts behind home routers (NAT) or on the internet, delays, loss, outages
// and NAT mappings that change. The ICE agent talks to it through UdpTransport, exactly as to node:dgram.
//
// A router maps an inside address to one public port for every destination (endpoint-independent mapping, as most
// home routers do) unless it is symmetric. Its filtering decides who may send in: `port` lets in only the addresses
// and ports the inside host sent to, `address` any port of those addresses, `open` everyone. Hosts behind the same
// router reach each other by their inside addresses; through the public address only with hairpinning.

import {
  type Address,
  addressKey,
  Attr,
  decodeStun,
  encodeStun,
  Method,
  xorAddressAttribute,
} from '../../src/main/ice/stun.ts';
import type { UdpSocket, UdpTransport } from '../../src/main/ice/udpTransport.ts';

export type NatFiltering = 'port' | 'address' | 'open';

export interface NatOptions {
  filtering?: NatFiltering;
  symmetric?: boolean;
  hairpin?: boolean;
}

interface Mapping {
  inside: Address;
  publicPort: number;
  /** Destinations the inside host sent to, as `ip:port`. */
  sentTo: Set<string>;
}

export class SimNat {
  readonly publicIp: string;
  readonly filtering: NatFiltering;
  readonly symmetric: boolean;
  readonly hairpin: boolean;
  /** False cuts the internet for everyone behind the router; their local network still works. */
  uplink = true;
  private nextPort = 40_000;
  private byKey = new Map<string, Mapping>();
  private byPort = new Map<number, Mapping>();

  constructor(publicIp: string, options: NatOptions) {
    this.publicIp = publicIp;
    this.filtering = options.filtering ?? 'port';
    this.symmetric = options.symmetric ?? false;
    this.hairpin = options.hairpin ?? false;
  }

  /** Forgets every mapping, as a router restart or a VPN reconnect does: new flows get new public ports. */
  rebind(): void {
    this.byKey.clear();
    this.byPort.clear();
  }

  outbound(inside: Address, to: Address): Address {
    const key = this.symmetric ? `${addressKey(inside)}>${addressKey(to)}` : addressKey(inside);
    let mapping = this.byKey.get(key);
    if (!mapping) {
      mapping = { inside, publicPort: this.nextPort++, sentTo: new Set() };
      this.byKey.set(key, mapping);
      this.byPort.set(mapping.publicPort, mapping);
    }
    mapping.sentTo.add(addressKey(to));
    return { address: this.publicIp, port: mapping.publicPort };
  }

  inbound(publicPort: number, from: Address): Address | null {
    const mapping = this.byPort.get(publicPort);
    if (!mapping) {
      return null;
    }
    const allowed =
      this.filtering === 'open' ||
      (this.filtering === 'address' && [...mapping.sentTo].some((key) => key.startsWith(`${from.address}:`))) ||
      mapping.sentTo.has(addressKey(from));
    return allowed ? mapping.inside : null;
  }
}

export class SimHost {
  readonly ip: string;
  readonly nat: SimNat | null;
  /** False takes the host off every network, its local one included (Wi-Fi off). */
  online = true;
  readonly transport: UdpTransport;
  private nextPort = 50_000;

  constructor(network: SimNetwork, ip: string, nat: SimNat | null) {
    this.ip = ip;
    this.nat = nat;
    this.transport = { createSocket: () => new SimSocket(network, this) };
  }

  ephemeralPort(): number {
    return this.nextPort++;
  }

  /** Answers STUN binding requests on the port, as a public STUN server. */
  async startStunServer(port = 3478): Promise<UdpSocket> {
    const socket = this.transport.createSocket();
    await socket.bind(this.ip, port);
    socket.onMessage((data, from) => {
      const request = decodeStun(data);
      if (request?.cls === 'request' && request.method === Method.binding) {
        socket.send(
          encodeStun({
            method: Method.binding,
            cls: 'success',
            transactionId: request.transactionId,
            attributes: [xorAddressAttribute(Attr.xorMappedAddress, from)],
          }),
          from,
        );
      }
    });
    return socket;
  }

}

export interface Impairment {
  /** Matches packets whose sender is this IP: an inside address, a router's public one or a server's. */
  from?: string;
  to?: string;
  /** Applies in both directions between `from` and `to`. */
  both?: boolean;
  drop?: boolean;
  /** Share of packets lost, 0 to 1. */
  loss?: number;
  delayMs?: number;
  /** Ends on its own at this time (Date.now() scale). */
  until?: number;
}

class SimSocket implements UdpSocket {
  readonly host: SimHost;
  private readonly network: SimNetwork;
  private bound: Address | null = null;
  private readonly listeners: ((data: Buffer, from: Address) => void)[] = [];
  private closed = false;

  constructor(network: SimNetwork, host: SimHost) {
    this.network = network;
    this.host = host;
  }

  async bind(address: string, port: number): Promise<void> {
    if (address !== this.host.ip) {
      throw new Error(`EADDRNOTAVAIL ${address}`);
    }
    const local = { address, port: port === 0 ? this.host.ephemeralPort() : port };
    this.network.register(this, local);
    this.bound = local;
  }

  send(data: Buffer, to: Address): void {
    if (!this.closed && this.bound) {
      this.network.route(this, this.bound, Buffer.from(data), to);
    }
  }

  onMessage(listener: (data: Buffer, from: Address) => void): void {
    this.listeners.push(listener);
  }

  onError(): void {}

  address(): Address {
    if (!this.bound) {
      throw new Error('not bound');
    }
    return this.bound;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.bound) {
      this.network.unregister(this.bound);
    }
  }

  deliver(data: Buffer, from: Address): void {
    if (this.closed) {
      return;
    }
    for (const listener of this.listeners) {
      listener(data, from);
    }
  }
}

export class SimNetwork {
  /** One-way delay of every hop over the internet, in ms; the local network takes 1 ms. */
  internetDelayMs = 5;
  readonly stats = { delivered: 0, dropped: 0 };
  private readonly hosts = new Map<string, SimHost>();
  private readonly nats = new Map<string, SimNat>();
  private readonly sockets = new Map<string, SimSocket>();
  private impairments: Impairment[] = [];

  nat(publicIp: string, options: NatOptions = {}): SimNat {
    const nat = new SimNat(publicIp, options);
    this.nats.set(publicIp, nat);
    return nat;
  }

  host(ip: string, nat: SimNat | null = null): SimHost {
    const host = new SimHost(this, ip, nat);
    this.hosts.set(ip, host);
    return host;
  }

  /** Adds an impairment; the returned function removes it. */
  impair(impairment: Impairment): () => void {
    this.impairments.push(impairment);
    return () => {
      this.impairments = this.impairments.filter((other) => other !== impairment);
    };
  }

  register(socket: SimSocket, local: Address): void {
    const key = addressKey(local);
    if (this.sockets.has(key)) {
      throw new Error(`EADDRINUSE ${key}`);
    }
    this.sockets.set(key, socket);
  }

  unregister(local: Address): void {
    this.sockets.delete(addressKey(local));
  }

  route(socket: SimSocket, local: Address, data: Buffer, to: Address): void {
    const sender = socket.host;
    if (!sender.online) {
      this.stats.dropped++;
      return;
    }
    const target = this.hosts.get(to.address);
    // A host on the same local network, reached by its inside address.
    if (target?.nat) {
      if (target.nat !== sender.nat) {
        this.stats.dropped++;
        return;
      }
      this.send(target.ip, data, local, to, 1, [sender.ip], [target.ip]);
      return;
    }
    if (sender.nat && !sender.nat.uplink) {
      this.stats.dropped++;
      return;
    }
    const from = sender.nat ? sender.nat.outbound(local, to) : local;
    const outer = [sender.ip, from.address];
    const nat = this.nats.get(to.address);
    if (nat) {
      if ((nat === sender.nat && !nat.hairpin) || !nat.uplink) {
        this.stats.dropped++;
        return;
      }
      const inside = nat.inbound(to.port, from);
      const insideHost = inside ? this.hosts.get(inside.address) : undefined;
      if (!inside || !insideHost) {
        this.stats.dropped++;
        return;
      }
      const hops = nat === sender.nat ? 1 : sender.nat ? 2 : 1;
      this.send(inside.address, data, from, inside, hops * this.internetDelayMs, outer, [nat.publicIp, inside.address]);
      return;
    }
    if (!target) {
      this.stats.dropped++;
      return;
    }
    this.send(target.ip, data, from, to, (sender.nat ? 2 : 1) * this.internetDelayMs, outer, [target.ip]);
  }

  private send(
    toIp: string,
    data: Buffer,
    from: Address,
    to: Address,
    baseDelayMs: number,
    fromIps: string[],
    toIps: string[],
  ): void {
    let delayMs = baseDelayMs;
    const now = Date.now();
    this.impairments = this.impairments.filter((impairment) => impairment.until === undefined || impairment.until > now);
    for (const impairment of this.impairments) {
      const forward = matches(impairment.from, fromIps) && matches(impairment.to, toIps);
      const backward = impairment.both === true && matches(impairment.from, toIps) && matches(impairment.to, fromIps);
      if (!forward && !backward) {
        continue;
      }
      if (impairment.drop || (impairment.loss !== undefined && Math.random() < impairment.loss)) {
        this.stats.dropped++;
        return;
      }
      delayMs += impairment.delayMs ?? 0;
    }
    setTimeout(() => {
      const host = this.hosts.get(toIp);
      const socket = this.sockets.get(addressKey(to));
      if (!host?.online || !socket) {
        this.stats.dropped++;
        return;
      }
      this.stats.delivered++;
      socket.deliver(data, from);
    }, delayMs);
  }
}

function matches(ip: string | undefined, candidates: string[]): boolean {
  return ip === undefined || candidates.includes(ip);
}
