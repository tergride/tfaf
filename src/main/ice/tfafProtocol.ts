// TFAF extensions on top of the channel shared with the Java adapter. Control packets start with 't' and duplicated
// game packets with 'D'. The Java adapter drops unknown prefixes with a warning, so control packets go to a peer only
// until it either answers the handshake or stays silent, and 'D' only to peers that announced the feature.

import { FINGERPRINT_BYTES, type GameFingerprint, type ModFingerprint } from '../game/fingerprint.ts';

export const CONTROL_PREFIX = 0x74; // 't'
export const DUPLICATED_PREFIX = 0x44; // 'D'
export const PROTOCOL_VERSION = 1;

export const Feature = {
  /** Pings in both directions: either side notices a dead connection within seconds. */
  liveness: 1 << 0,
  /** Understands 'D' packets and drops the second copy. */
  duplication: 1 << 1,
  /** Sends the fingerprint of its game files with the hello. */
  fingerprint: 1 << 2,
  /** Adds the fingerprint of each sim mod after it. */
  modFingerprints: 1 << 3,
  /** Follows the host into the game it creates again with other mods (`rehost`). */
  rehost: 1 << 4,
  /** Tells what its game was started with (`launcher`) and leaves when the host disconnects it (`kick`). */
  launcherInfo: 1 << 5,
  /** Takes part in a lobby inside the launcher (`lobbyData`). */
  launcherLobby: 1 << 6,
  /** Adds the key of the map its fingerprint describes after the mods. */
  mapKey: 1 << 7,
  /**
   * Takes TFAF messages through the lobby server (signaling.ts), keeps the old connection open while it reconnects
   * and says `bye` when it leaves.
   */
  signaling: 1 << 8,
  /** Keeps several pairs checked and sends over the best one (IceAgent.enablePathManagement). */
  pathManagement: 1 << 9,
} as const;

export const LOCAL_FEATURES =
  Feature.liveness |
  Feature.duplication |
  Feature.fingerprint |
  Feature.modFingerprints |
  Feature.rehost |
  Feature.launcherInfo |
  Feature.launcherLobby |
  Feature.mapKey |
  Feature.signaling |
  Feature.pathManagement;

/** The longest `launcher` text, so the message stays one small datagram. */
export const MAX_LAUNCHER_INFO_BYTES = 1000;
const MAX_KICK_FEATURES = 16;

export type ControlMessage =
  | { type: 'hello'; version: number; features: number; seen: boolean; fingerprint: GameFingerprint | null }
  | { type: 'ping'; seq: number; sentAt: number }
  | { type: 'pong'; seq: number; sentAt: number; lossPermille: number }
  | { type: 'restart' }
  /** From the host: the game closes and is created again with these mods; `id` tells repeats apart. */
  | { type: 'rehost'; id: number; modUids: string[] }
  | { type: 'rehostAck'; id: number }
  /** The sender's TFAF version and the lobby features its game was started with, as JSON (lobbyFeatures.ts). */
  | { type: 'launcher'; info: string }
  | { type: 'launcherAck' }
  /** From the host: it disconnects us, since our game lacks these required lobby features. */
  | { type: 'kick'; features: string[] }
  /** A part of a message of the lobby inside the launcher (reliableMessages.ts). */
  | { type: 'lobbyData'; id: number; index: number; total: number; payload: Buffer }
  | { type: 'lobbyAck'; id: number; index: number }
  /** The sender leaves the game: nobody has to reconnect to it. */
  | { type: 'bye' };

const TYPE_CODES = {
  hello: 1,
  ping: 2,
  pong: 3,
  restart: 4,
  rehost: 5,
  rehostAck: 6,
  launcher: 7,
  launcherAck: 8,
  kick: 9,
  lobbyData: 10,
  lobbyAck: 11,
  bye: 12,
} as const;

// The uids of a rehost, each behind its length, as many as fit into one datagram; the player takes the full list from
// the new game anyway and only downloads early what it got here.
const MAX_REHOST_LENGTH = 1100;

const HELLO_LENGTH = 8;
// After the plain hello: a byte telling which parts are known, then the three parts. Older TFAF reads only the start.
const FINGERPRINT_PARTS = ['gameFiles', 'map', 'mods'] as const;
const FINGERPRINT_LENGTH = 1 + FINGERPRINT_PARTS.length * FINGERPRINT_BYTES;
// Then a mod count and per mod its key, a byte telling whether the digest is known and the digest, and the map's key if
// known. The cap keeps the hello in one small datagram.
const MOD_ENTRY_LENGTH = FINGERPRINT_BYTES + 1 + FINGERPRINT_BYTES;
export const MAX_MOD_FINGERPRINTS = 32;

function encodeFingerprint(fingerprint: GameFingerprint): Buffer {
  const data = Buffer.alloc(FINGERPRINT_LENGTH);
  let known = 0;
  FINGERPRINT_PARTS.forEach((part, index) => {
    const value = fingerprint[part];
    if (value !== null) {
      known |= 1 << index;
      Buffer.from(value, 'hex').copy(data, 1 + index * FINGERPRINT_BYTES, 0, FINGERPRINT_BYTES);
    }
  });
  data[0] = known;
  return data;
}

function encodeModFingerprints(mods: ModFingerprint[]): Buffer {
  // The host lists the game's mods in the order it chose them, a player in the server's order. Sorted by key, both
  // sides keep the same mods when there are more than fit.
  const sent = [...mods].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, MAX_MOD_FINGERPRINTS);
  const data = Buffer.alloc(1 + sent.length * MOD_ENTRY_LENGTH);
  data[0] = sent.length;
  sent.forEach((mod, index) => {
    const offset = 1 + index * MOD_ENTRY_LENGTH;
    Buffer.from(mod.key, 'hex').copy(data, offset, 0, FINGERPRINT_BYTES);
    if (mod.digest !== null) {
      data[offset + FINGERPRINT_BYTES] = 1;
      Buffer.from(mod.digest, 'hex').copy(data, offset + FINGERPRINT_BYTES + 1, 0, FINGERPRINT_BYTES);
    }
  });
  return data;
}

function decodeFingerprint(data: Buffer): GameFingerprint {
  const known = data.readUInt8(0);
  const part = (index: number): string | null =>
    (known & (1 << index)) !== 0
      ? data.subarray(1 + index * FINGERPRINT_BYTES, 1 + (index + 1) * FINGERPRINT_BYTES).toString('hex')
      : null;
  return { gameFiles: part(0), map: part(1), mapKey: null, mods: part(2), modFiles: null };
}

function decodeMapKey(data: Buffer, modCount: number): string | null {
  const key = data.subarray(1 + modCount * MOD_ENTRY_LENGTH, 1 + modCount * MOD_ENTRY_LENGTH + FINGERPRINT_BYTES);
  return key.length === FINGERPRINT_BYTES ? key.toString('hex') : null;
}

/** Null when the data is cut short. */
function decodeModFingerprints(data: Buffer): ModFingerprint[] | null {
  const count = data.length > 0 ? data.readUInt8(0) : -1;
  if (count < 0 || count > MAX_MOD_FINGERPRINTS || data.length < 1 + count * MOD_ENTRY_LENGTH) {
    return null;
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = 1 + index * MOD_ENTRY_LENGTH;
    return {
      key: data.subarray(offset, offset + FINGERPRINT_BYTES).toString('hex'),
      digest:
        data[offset + FINGERPRINT_BYTES] === 1
          ? data.subarray(offset + FINGERPRINT_BYTES + 1, offset + MOD_ENTRY_LENGTH).toString('hex')
          : null,
    };
  });
}

export function encodeControl(message: ControlMessage): Buffer {
  switch (message.type) {
    case 'hello': {
      const data = Buffer.alloc(HELLO_LENGTH);
      data.writeUInt8(message.version, 2);
      data.writeUInt32BE(message.features >>> 0, 3);
      data.writeUInt8(message.seen ? 1 : 0, 7);
      const hello = withHeader(data, TYPE_CODES.hello);
      const fingerprint = message.fingerprint;
      if (!fingerprint) {
        return hello;
      }
      const { modFiles, mapKey } = fingerprint;
      return Buffer.concat([
        hello,
        encodeFingerprint(fingerprint),
        ...(modFiles ? [encodeModFingerprints(modFiles), ...(mapKey ? [Buffer.from(mapKey, 'hex')] : [])] : []),
      ]);
    }
    case 'ping':
    case 'pong': {
      const data = Buffer.alloc(message.type === 'pong' ? 16 : 14);
      data.writeUInt32BE(message.seq >>> 0, 2);
      data.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(message.sentAt))), 6);
      if (message.type === 'pong') {
        data.writeUInt16BE(Math.min(1000, Math.max(0, Math.round(message.lossPermille))), 14);
      }
      return withHeader(data, TYPE_CODES[message.type]);
    }
    case 'restart':
      return withHeader(Buffer.alloc(2), TYPE_CODES.restart);
    case 'rehost':
      return encodeRehost(message.id, message.modUids);
    case 'rehostAck': {
      const data = Buffer.alloc(6);
      data.writeUInt32BE(message.id >>> 0, 2);
      return withHeader(data, TYPE_CODES.rehostAck);
    }
    case 'launcher': {
      const info = Buffer.from(message.info, 'utf8').subarray(0, MAX_LAUNCHER_INFO_BYTES);
      const head = Buffer.alloc(4);
      head.writeUInt16BE(info.length, 2);
      return Buffer.concat([withHeader(head, TYPE_CODES.launcher), info]);
    }
    case 'launcherAck':
      return withHeader(Buffer.alloc(2), TYPE_CODES.launcherAck);
    case 'kick':
      return encodeKick(message.features);
    case 'lobbyData': {
      const head = Buffer.alloc(10);
      head.writeUInt32BE(message.id >>> 0, 2);
      head.writeUInt16BE(message.index, 6);
      head.writeUInt16BE(message.total, 8);
      return Buffer.concat([withHeader(head, TYPE_CODES.lobbyData), message.payload]);
    }
    case 'lobbyAck': {
      const data = Buffer.alloc(8);
      data.writeUInt32BE(message.id >>> 0, 2);
      data.writeUInt16BE(message.index, 6);
      return withHeader(data, TYPE_CODES.lobbyAck);
    }
    case 'bye':
      return withHeader(Buffer.alloc(2), TYPE_CODES.bye);
  }
}

function encodeKick(features: string[]): Buffer {
  const entries = features
    .map((feature) => Buffer.from(feature, 'utf8'))
    .filter((bytes) => bytes.length > 0 && bytes.length <= 255)
    .slice(0, MAX_KICK_FEATURES);
  const head = Buffer.alloc(3);
  head[2] = entries.length;
  return Buffer.concat([withHeader(head, TYPE_CODES.kick), ...entries.flatMap((bytes) => [Buffer.of(bytes.length), bytes])]);
}

function decodeKick(data: Buffer): ControlMessage | null {
  if (data.length < 3) {
    return null;
  }
  const features: string[] = [];
  let offset = 3;
  for (let index = 0; index < data.readUInt8(2); index++) {
    const length = data[offset];
    if (length === undefined || offset + 1 + length > data.length) {
      return null;
    }
    features.push(data.toString('utf8', offset + 1, offset + 1 + length));
    offset += 1 + length;
  }
  return { type: 'kick', features };
}

function encodeRehost(id: number, modUids: string[]): Buffer {
  const head = Buffer.alloc(7);
  head.writeUInt32BE(id >>> 0, 2);
  const entries: Buffer[] = [];
  let length = head.length;
  for (const uid of modUids) {
    const bytes = Buffer.from(uid, 'utf8');
    if (bytes.length > 255 || entries.length === 255 || length + 1 + bytes.length > MAX_REHOST_LENGTH) {
      continue;
    }
    entries.push(Buffer.concat([Buffer.of(bytes.length), bytes]));
    length += 1 + bytes.length;
  }
  head[6] = entries.length;
  return Buffer.concat([withHeader(head, TYPE_CODES.rehost), ...entries]);
}

function decodeRehost(data: Buffer): ControlMessage | null {
  if (data.length < 7) {
    return null;
  }
  const modUids: string[] = [];
  let offset = 7;
  for (let index = 0; index < data.readUInt8(6); index++) {
    const length = data[offset];
    if (length === undefined || offset + 1 + length > data.length) {
      return null;
    }
    modUids.push(data.toString('utf8', offset + 1, offset + 1 + length));
    offset += 1 + length;
  }
  return { type: 'rehost', id: data.readUInt32BE(2), modUids };
}

function withHeader(data: Buffer, type: number): Buffer {
  data[0] = CONTROL_PREFIX;
  data[1] = type;
  return data;
}

export function decodeControl(data: Buffer): ControlMessage | null {
  if (data.length < 2 || data[0] !== CONTROL_PREFIX) {
    return null;
  }
  switch (data[1]) {
    case TYPE_CODES.hello: {
      if (data.length < HELLO_LENGTH) {
        return null;
      }
      const features = data.readUInt32BE(3);
      const fingerprint =
        (features & Feature.fingerprint) !== 0 && data.length >= HELLO_LENGTH + FINGERPRINT_LENGTH
          ? decodeFingerprint(data.subarray(HELLO_LENGTH, HELLO_LENGTH + FINGERPRINT_LENGTH))
          : null;
      if (fingerprint && (features & Feature.modFingerprints) !== 0) {
        const details = data.subarray(HELLO_LENGTH + FINGERPRINT_LENGTH);
        fingerprint.modFiles = decodeModFingerprints(details);
        if (fingerprint.modFiles && (features & Feature.mapKey) !== 0) {
          fingerprint.mapKey = decodeMapKey(details, fingerprint.modFiles.length);
        }
      }
      return { type: 'hello', version: data.readUInt8(2), features, seen: data[7] === 1, fingerprint };
    }
    case TYPE_CODES.ping:
      return data.length >= 14 ? { type: 'ping', seq: data.readUInt32BE(2), sentAt: Number(data.readBigUInt64BE(6)) } : null;
    case TYPE_CODES.pong:
      return data.length >= 16
        ? {
            type: 'pong',
            seq: data.readUInt32BE(2),
            sentAt: Number(data.readBigUInt64BE(6)),
            lossPermille: data.readUInt16BE(14),
          }
        : null;
    case TYPE_CODES.restart:
      return { type: 'restart' };
    case TYPE_CODES.rehost:
      return decodeRehost(data);
    case TYPE_CODES.rehostAck:
      return data.length >= 6 ? { type: 'rehostAck', id: data.readUInt32BE(2) } : null;
    case TYPE_CODES.launcher: {
      const length = data.length >= 4 ? data.readUInt16BE(2) : -1;
      return length >= 0 && data.length >= 4 + length ? { type: 'launcher', info: data.toString('utf8', 4, 4 + length) } : null;
    }
    case TYPE_CODES.launcherAck:
      return { type: 'launcherAck' };
    case TYPE_CODES.kick:
      return decodeKick(data);
    case TYPE_CODES.lobbyData:
      return data.length >= 10
        ? {
            type: 'lobbyData',
            id: data.readUInt32BE(2),
            index: data.readUInt16BE(6),
            total: data.readUInt16BE(8),
            payload: data.subarray(10),
          }
        : null;
    case TYPE_CODES.lobbyAck:
      return data.length >= 8 ? { type: 'lobbyAck', id: data.readUInt32BE(2), index: data.readUInt16BE(6) } : null;
    case TYPE_CODES.bye:
      return { type: 'bye' };
    default:
      return null;
  }
}

export function encodeDuplicated(seq: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = DUPLICATED_PREFIX;
  header.writeUInt32BE(seq >>> 0, 1);
  return Buffer.concat([header, payload]);
}

export function decodeDuplicated(data: Buffer): { seq: number; payload: Buffer } | null {
  return data.length >= 5 && data[0] === DUPLICATED_PREFIX ? { seq: data.readUInt32BE(1), payload: data.subarray(5) } : null;
}

const DEDUPLICATION_WINDOW = 4096;

/** Lets each sequence number through once; remembers the most recent ones. */
export class Deduplicator {
  private readonly seen = new Set<number>();
  private readonly order: number[] = [];

  accept(seq: number): boolean {
    if (this.seen.has(seq)) {
      return false;
    }
    this.seen.add(seq);
    this.order.push(seq);
    if (this.order.length > DEDUPLICATION_WINDOW) {
      this.seen.delete(this.order.shift()!);
    }
    return true;
  }
}

export const LOSS_WINDOW = 40;
const MIN_LOSS_SAMPLES = 20;
const MIN_LOST_PINGS = 2;

/** Share of the peer's last pings that did not arrive, i.e. the loss in the direction from the peer to us. */
export class IncomingLoss {
  private readonly received = new Set<number>();
  private first: number | null = null;
  private highest = -1;

  record(seq: number): void {
    if (this.first === null) {
      this.first = seq;
    }
    if (seq <= this.highest - LOSS_WINDOW) {
      return;
    }
    this.received.add(seq);
    if (seq > this.highest) {
      this.highest = seq;
      for (const old of this.received) {
        if (old <= seq - LOSS_WINDOW) {
          this.received.delete(old);
        }
      }
    }
  }

  /** Loss over the window; a single lost ping or fewer than 10 seconds of pings say too little and count as none. */
  permille(): number {
    if (this.first === null) {
      return 0;
    }
    const expected = Math.min(LOSS_WINDOW, this.highest - this.first + 1);
    const lost = expected - this.received.size;
    if (expected < MIN_LOSS_SAMPLES || lost < MIN_LOST_PINGS) {
      return 0;
    }
    return Math.round((1000 * lost) / expected);
  }
}

// 2 of the last 40 pings (20 seconds) lost turns duplication on; it stays on for at least a minute and goes off again
// once a whole window passed without loss.
const ENABLE_PERMILLE = 50;
const MIN_ENABLED_MS = 60_000;

export class DuplicationPolicy {
  private enabledSince: number | null = null;

  get enabled(): boolean {
    return this.enabledSince !== null;
  }

  /** Takes the loss the peer reported for our direction; returns whether duplication is on afterwards. */
  update(lossPermille: number, now: number): boolean {
    if (this.enabledSince === null) {
      if (lossPermille >= ENABLE_PERMILLE) {
        this.enabledSince = now;
      }
    } else if (lossPermille === 0 && now - this.enabledSince >= MIN_ENABLED_MS) {
      this.enabledSince = null;
    }
    return this.enabled;
  }
}
