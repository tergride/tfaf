// DirectDraw Surface textures as the game ships them: DXT1/3/5 with or without mips, and uncompressed ones described
// by bit masks (A8R8G8B8 masks, R8G8B8 water ramps, 16-bit and luminance odd ones), which become RGBA here.

import type { MapTexture, MapTextureFormat } from '../../shared/contract.ts';

const DDS_MAGIC = 0x20534444;
const HEADER_SIZE = 128;
const FLAG_MIPMAP_COUNT = 0x20000;
const PF_ALPHA_PIXELS = 0x1;
const PF_ALPHA = 0x2;
const PF_FOURCC = 0x4;
const PF_RGB = 0x40;
const PF_LUMINANCE = 0x20000;
const MAX_SIDE = 16384;

const BLOCK_FORMATS: Record<string, { format: MapTextureFormat; blockBytes: number }> = {
  DXT1: { format: 'dxt1', blockBytes: 8 },
  DXT2: { format: 'dxt3', blockBytes: 16 },
  DXT3: { format: 'dxt3', blockBytes: 16 },
  DXT4: { format: 'dxt5', blockBytes: 16 },
  DXT5: { format: 'dxt5', blockBytes: 16 },
};

/** The texture, or null for a file that is not a DDS or has a layout the map view does not draw (DX10, volumes). */
export function readDds(file: Uint8Array): MapTexture | null {
  const data = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (data.length < HEADER_SIZE || data.readUInt32LE(0) !== DDS_MAGIC) {
    return null;
  }
  const flags = data.readUInt32LE(8);
  const height = data.readUInt32LE(12);
  const width = data.readUInt32LE(16);
  if (width === 0 || height === 0 || width > MAX_SIDE || height > MAX_SIDE) {
    return null;
  }
  const declaredLevels = flags & FLAG_MIPMAP_COUNT ? Math.max(1, data.readUInt32LE(28)) : 1;
  const pixelFlags = data.readUInt32LE(80);
  const fourCc = data.toString('latin1', 84, 88);

  if (pixelFlags & PF_FOURCC) {
    const block = BLOCK_FORMATS[fourCc];
    if (!block) {
      return null;
    }
    const levels = takeLevels(data, width, height, declaredLevels, (w, h) => Math.ceil(w / 4) * Math.ceil(h / 4) * block.blockBytes);
    return levels.length > 0 ? { format: block.format, width, height, levels } : null;
  }

  const bitCount = data.readUInt32LE(88);
  if (!(pixelFlags & (PF_RGB | PF_LUMINANCE | PF_ALPHA)) || ![8, 16, 24, 32].includes(bitCount)) {
    return null;
  }
  const masks = [92, 96, 100, 104].map((offset) => data.readUInt32LE(offset)) as [number, number, number, number];
  const bytesPerPixel = bitCount / 8;
  const raw = takeLevels(data, width, height, declaredLevels, (w, h) => w * h * bytesPerPixel);
  if (raw.length === 0) {
    return null;
  }
  const channels = channelMasks(pixelFlags, masks);
  const levels = raw.map((level) => toRgba(level, bytesPerPixel, channels));
  return { format: 'rgba8', width, height, levels };
}

/** The complete levels the file holds; a truncated tail is dropped. */
function takeLevels(
  data: Buffer,
  width: number,
  height: number,
  declared: number,
  size: (width: number, height: number) => number,
): Uint8Array[] {
  const levels: Uint8Array[] = [];
  let offset = HEADER_SIZE;
  let w = width;
  let h = height;
  for (let level = 0; level < declared; level++) {
    const bytes = size(w, h);
    if (offset + bytes > data.length) {
      break;
    }
    levels.push(new Uint8Array(data.subarray(offset, offset + bytes)));
    offset += bytes;
    if (w === 1 && h === 1) {
      break;
    }
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return levels;
}

type ChannelMasks = [number, number, number, number];

/** Masks of red, green, blue and alpha; luminance repeats into the colour, alpha-only textures are white. */
function channelMasks(pixelFlags: number, [red, green, blue, alpha]: ChannelMasks): ChannelMasks {
  const alphaMask = pixelFlags & (PF_ALPHA_PIXELS | PF_ALPHA) ? alpha : 0;
  if (pixelFlags & PF_LUMINANCE) {
    return [red, red, red, alphaMask];
  }
  if (!(pixelFlags & PF_RGB)) {
    return [0, 0, 0, alphaMask];
  }
  return [red, green, blue, alphaMask];
}

function toRgba(level: Uint8Array, bytesPerPixel: number, masks: ChannelMasks): Uint8Array {
  const pixels = level.length / bytesPerPixel;
  const rgba = new Uint8Array(pixels * 4);
  // A8R8G8B8 and X8R8G8B8, the masks of every map: BGRA in memory.
  if (bytesPerPixel === 4 && masks[0] === 0xff0000 && masks[1] === 0xff00 && masks[2] === 0xff && (masks[3] >>> 0 === 0xff000000 || masks[3] === 0)) {
    const opaque = masks[3] === 0;
    for (let i = 0; i < level.length; i += 4) {
      rgba[i] = level[i + 2]!;
      rgba[i + 1] = level[i + 1]!;
      rgba[i + 2] = level[i]!;
      rgba[i + 3] = opaque ? 255 : level[i + 3]!;
    }
    return rgba;
  }
  const channels = masks.map((mask, index) => {
    if (mask === 0) {
      return { mask: 0, shift: 0, max: 1, fill: index === 3 || masks[0] === 0 ? 255 : 0 };
    }
    let shift = 0;
    while (((mask >>> shift) & 1) === 0) {
      shift++;
    }
    return { mask, shift, max: mask >>> shift, fill: 0 };
  });
  for (let i = 0; i < pixels; i++) {
    let value = 0;
    for (let byte = 0; byte < bytesPerPixel; byte++) {
      value |= level[i * bytesPerPixel + byte]! << (8 * byte);
    }
    value >>>= 0;
    for (let c = 0; c < 4; c++) {
      const channel = channels[c]!;
      rgba[i * 4 + c] = channel.mask === 0 ? channel.fill : Math.round(((((value & channel.mask) >>> 0) >>> channel.shift) * 255) / channel.max);
    }
  }
  return rgba;
}
