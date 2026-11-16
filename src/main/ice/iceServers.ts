import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import type { IceServerConfig } from '../game/iceAdapter.ts';
import { type Address, addressKey } from './stun.ts';
import type { TurnServer } from './turn.ts';

export interface IceUrl {
  scheme: 'stun' | 'turn';
  host: string;
  port: number;
  transport: 'udp' | 'tcp';
}

// RFC 7064/7065 URIs ("turn:host:3478?transport=udp"); the "turn://host" form produced by java.net.URI is accepted too.
const ICE_URL = /^(stun|turn):(?:\/\/)?([^:/?#[\]]+)(?::(\d{1,5}))?\/?(?:\?(.*))?$/i;

export function parseIceUrl(url: string): IceUrl | null {
  const match = ICE_URL.exec(url.trim());
  if (!match) {
    return null;
  }
  const [, scheme, host, port, query] = match;
  const portNumber = port ? Number(port) : 3478;
  if (!host || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  const transport = new URLSearchParams(query ?? '').get('transport')?.toLowerCase() === 'tcp' ? 'tcp' : 'udp';
  return { scheme: scheme!.toLowerCase() as IceUrl['scheme'], host, port: portNumber, transport };
}

// The Java adapter always adds these public STUN servers to the servers of the FAF ICE session.
export const PUBLIC_STUN_URLS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302', 'stun:stun.sipgate.net:3478'];

export interface ResolvedIceServers {
  stun: Address[];
  turn: TurnServer[];
}

async function resolveIpv4(host: string): Promise<string | null> {
  if (net.isIPv4(host)) {
    return host;
  }
  try {
    return (await dns.lookup(host, { family: 4 })).address;
  } catch {
    return null;
  }
}

/** Resolves the server addresses once per game. Only UDP is supported; unresolvable servers are skipped. */
export async function resolveIceServers(configs: IceServerConfig[], publicStunUrls: string[]): Promise<ResolvedIceServers> {
  const entries = [
    ...publicStunUrls.map((url) => ({ url, username: '', credential: '' })),
    ...configs.flatMap((config) =>
      config.urls.map((url) => ({ url, username: config.username ?? '', credential: config.credential ?? '' })),
    ),
  ];
  const resolved = await Promise.all(
    entries.map(async (entry) => {
      const url = parseIceUrl(entry.url);
      if (!url || url.transport !== 'udp') {
        return null;
      }
      const ip = await resolveIpv4(url.host);
      return ip ? { ...entry, scheme: url.scheme, address: { address: ip, port: url.port } } : null;
    }),
  );
  const stun = new Map<string, Address>();
  const turn = new Map<string, TurnServer>();
  for (const entry of resolved) {
    if (!entry) {
      continue;
    }
    const key = addressKey(entry.address);
    if (entry.scheme === 'stun') {
      stun.set(key, entry.address);
    } else if (!turn.has(key)) {
      turn.set(key, { address: entry.address, username: entry.username, credential: entry.credential });
    }
  }
  return { stun: [...stun.values()], turn: [...turn.values()] };
}

export function localIpv4Addresses(): string[] {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .map((entry) => entry.address);
  return [...new Set(addresses)];
}

/** The local address the system routes to the target from. Connecting a UDP socket sends no packets. */
export async function routeAddress(target: Address): Promise<string | null> {
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(target.port, target.address, () => resolve());
    });
    return socket.address().address;
  } catch {
    return null;
  } finally {
    socket.close();
  }
}

/** Local addresses for host candidates, the one towards the ICE servers first. */
export async function hostAddresses(towards: Address | null): Promise<string[]> {
  const addresses = localIpv4Addresses();
  const primary = towards ? await routeAddress(towards) : null;
  return primary && addresses.includes(primary) ? [primary, ...addresses.filter((address) => address !== primary)] : addresses;
}
