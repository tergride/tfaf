// STUN messages (RFC 8489) in the subset used by ICE connectivity checks (RFC 8445) and TURN (RFC 8656).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { crc32 } from 'node:zlib';

export interface Address {
  address: string;
  port: number;
}

export function addressKey(address: Address): string {
  return `${address.address}:${address.port}`;
}

export function sameAddress(a: Address, b: Address): boolean {
  return a.address === b.address && a.port === b.port;
}

export const MAGIC_COOKIE = 0x2112a442;
const HEADER_LENGTH = 20;
const FINGERPRINT_XOR = 0x5354554e;
const INTEGRITY_LENGTH = 20;

export const Method = {
  binding: 0x001,
  allocate: 0x003,
  refresh: 0x004,
  send: 0x006,
  data: 0x007,
  createPermission: 0x008,
  channelBind: 0x009,
} as const;

export type StunClass = 'request' | 'indication' | 'success' | 'error';
const CLASS_BITS: Record<StunClass, number> = { request: 0b00, indication: 0b01, success: 0b10, error: 0b11 };
const CLASSES: readonly StunClass[] = ['request', 'indication', 'success', 'error'];

export const Attr = {
  mappedAddress: 0x0001,
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  channelNumber: 0x000c,
  lifetime: 0x000d,
  xorPeerAddress: 0x0012,
  data: 0x0013,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
  xorMappedAddress: 0x0020,
  priority: 0x0024,
  useCandidate: 0x0025,
  fingerprint: 0x8028,
  iceControlled: 0x8029,
  iceControlling: 0x802a,
} as const;

export interface StunAttribute {
  type: number;
  value: Buffer;
}

export interface StunMessage {
  method: number;
  cls: StunClass;
  transactionId: Buffer;
  attributes: StunAttribute[];
}

interface DecodedAttribute extends StunAttribute {
  /** Offset of the attribute header inside the raw message. */
  offset: number;
}

export interface DecodedStunMessage extends StunMessage {
  attributes: DecodedAttribute[];
  raw: Buffer;
}

export function newTransactionId(): Buffer {
  return randomBytes(12);
}

function encodeType(method: number, cls: StunClass): number {
  const c = CLASS_BITS[cls];
  return (method & 0x000f) | ((method & 0x0070) << 1) | ((method & 0x0f80) << 2) | ((c & 1) << 4) | ((c & 2) << 7);
}

function decodeType(type: number): { method: number; cls: StunClass } {
  const c = ((type >> 4) & 1) | ((type >> 7) & 2);
  const method = (type & 0x000f) | ((type >> 1) & 0x0070) | ((type >> 2) & 0x0f80);
  return { method, cls: CLASSES[c] ?? 'request' };
}

function attributeBytes(attribute: StunAttribute): Buffer {
  const padded = (attribute.value.length + 3) & ~3;
  const bytes = Buffer.alloc(4 + padded);
  bytes.writeUInt16BE(attribute.type, 0);
  bytes.writeUInt16BE(attribute.value.length, 2);
  attribute.value.copy(bytes, 4);
  return bytes;
}

export interface EncodeOptions {
  /** Key for MESSAGE-INTEGRITY: the password for ICE, MD5(username:realm:password) for TURN. */
  integrityKey?: Buffer;
  fingerprint?: boolean;
}

export function encodeStun(message: StunMessage, options: EncodeOptions = {}): Buffer {
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(encodeType(message.method, message.cls), 0);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  message.transactionId.copy(header, 8);

  let body = Buffer.concat(message.attributes.map(attributeBytes));
  if (options.integrityKey) {
    // The length covers the MESSAGE-INTEGRITY attribute itself but not a FINGERPRINT that follows it.
    header.writeUInt16BE(body.length + 4 + INTEGRITY_LENGTH, 2);
    const hmac = createHmac('sha1', options.integrityKey).update(header).update(body).digest();
    body = Buffer.concat([body, attributeBytes({ type: Attr.messageIntegrity, value: hmac })]);
  }
  if (options.fingerprint) {
    header.writeUInt16BE(body.length + 8, 2);
    const value = Buffer.alloc(4);
    value.writeUInt32BE((crc32(Buffer.concat([header, body])) ^ FINGERPRINT_XOR) >>> 0, 0);
    body = Buffer.concat([body, attributeBytes({ type: Attr.fingerprint, value })]);
  }
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

export function isStunMessage(data: Buffer): boolean {
  return data.length >= HEADER_LENGTH && (data[0]! & 0xc0) === 0 && data.readUInt32BE(4) === MAGIC_COOKIE;
}

export function decodeStun(data: Buffer): DecodedStunMessage | null {
  if (!isStunMessage(data)) {
    return null;
  }
  const length = data.readUInt16BE(2);
  if (length % 4 !== 0 || HEADER_LENGTH + length !== data.length) {
    return null;
  }
  const attributes: DecodedAttribute[] = [];
  let offset = HEADER_LENGTH;
  while (offset + 4 <= data.length) {
    const type = data.readUInt16BE(offset);
    const valueLength = data.readUInt16BE(offset + 2);
    const end = offset + 4 + valueLength;
    if (end > data.length) {
      return null;
    }
    attributes.push({ type, value: data.subarray(offset + 4, end), offset });
    offset += 4 + ((valueLength + 3) & ~3);
  }
  const { method, cls } = decodeType(data.readUInt16BE(0));
  return { method, cls, transactionId: data.subarray(8, 20), attributes, raw: data };
}

export function findAttribute(message: StunMessage, type: number): Buffer | null {
  return message.attributes.find((attribute) => attribute.type === type)?.value ?? null;
}

/** Checks MESSAGE-INTEGRITY against the raw bytes; messages without it are rejected. */
export function verifyIntegrity(message: DecodedStunMessage, key: Buffer): boolean {
  const attribute = message.attributes.find((candidate) => candidate.type === Attr.messageIntegrity);
  if (!attribute || attribute.value.length !== INTEGRITY_LENGTH) {
    return false;
  }
  const signed = Buffer.from(message.raw.subarray(0, attribute.offset));
  signed.writeUInt16BE(attribute.offset + 4 + INTEGRITY_LENGTH - HEADER_LENGTH, 2);
  const expected = createHmac('sha1', key).update(signed).digest();
  return timingSafeEqual(expected, attribute.value);
}

/** A FINGERPRINT is optional, but when present it has to be the last attribute and match. */
export function verifyFingerprint(message: DecodedStunMessage): boolean {
  const index = message.attributes.findIndex((candidate) => candidate.type === Attr.fingerprint);
  if (index === -1) {
    return true;
  }
  const attribute = message.attributes[index]!;
  if (index !== message.attributes.length - 1 || attribute.value.length !== 4) {
    return false;
  }
  const expected = (crc32(message.raw.subarray(0, attribute.offset)) ^ FINGERPRINT_XOR) >>> 0;
  return attribute.value.readUInt32BE(0) === expected;
}

export function longTermKey(username: string, realm: string, password: string): Buffer {
  return createHash('md5').update(`${username}:${realm}:${password}`).digest();
}

export function stringAttribute(type: number, value: string): StunAttribute {
  return { type, value: Buffer.from(value, 'utf8') };
}

export function uint32Attribute(type: number, value: number): StunAttribute {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0, 0);
  return { type, value: bytes };
}

export function readString(message: StunMessage, type: number): string | null {
  return findAttribute(message, type)?.toString('utf8') ?? null;
}

export function readUint32(message: StunMessage, type: number): number | null {
  const value = findAttribute(message, type);
  return value && value.length >= 4 ? value.readUInt32BE(0) : null;
}

/** XOR-MAPPED-ADDRESS, XOR-PEER-ADDRESS and XOR-RELAYED-ADDRESS, IPv4 only. */
export function xorAddressAttribute(type: number, address: Address): StunAttribute {
  if (!net.isIPv4(address.address)) {
    throw new Error(`IPv4 address expected: ${address.address}`);
  }
  const value = Buffer.alloc(8);
  value.writeUInt8(0x01, 1);
  value.writeUInt16BE(address.port ^ (MAGIC_COOKIE >>> 16), 2);
  const ip = address.address.split('.').reduce((result, octet) => result * 256 + Number(octet), 0);
  value.writeUInt32BE((ip ^ MAGIC_COOKIE) >>> 0, 4);
  return { type, value };
}

function ipv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

export function readXorAddress(message: StunMessage, type: number): Address | null {
  const value = findAttribute(message, type);
  if (!value || value.length < 8 || value[1] !== 0x01) {
    return null;
  }
  return {
    address: ipv4((value.readUInt32BE(4) ^ MAGIC_COOKIE) >>> 0),
    port: value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16),
  };
}

export function readMappedAddress(message: StunMessage): Address | null {
  const xor = readXorAddress(message, Attr.xorMappedAddress);
  if (xor) {
    return xor;
  }
  const value = findAttribute(message, Attr.mappedAddress);
  if (!value || value.length < 8 || value[1] !== 0x01) {
    return null;
  }
  return { address: ipv4(value.readUInt32BE(4)), port: value.readUInt16BE(2) };
}

export function readErrorCode(message: StunMessage): { code: number; reason: string } | null {
  const value = findAttribute(message, Attr.errorCode);
  if (!value || value.length < 4) {
    return null;
  }
  return { code: (value[2]! & 0x07) * 100 + value[3]!, reason: value.subarray(4).toString('utf8') };
}

// TURN ChannelData messages (RFC 8656, section 12.4) start with a channel number in 0x4000-0x7FFF. The first byte of
// FAF game packets ('d', 'e') falls into the same range, so ChannelData is only looked for in packets from TURN servers.
export function isChannelData(data: Buffer): boolean {
  return data.length >= 4 && (data[0]! & 0xc0) === 0x40;
}

export function encodeChannelData(channel: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(channel, 0);
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

export function decodeChannelData(data: Buffer): { channel: number; payload: Buffer } | null {
  if (!isChannelData(data)) {
    return null;
  }
  const length = data.readUInt16BE(2);
  if (4 + length > data.length) {
    return null;
  }
  return { channel: data.readUInt16BE(0), payload: data.subarray(4, 4 + length) };
}
