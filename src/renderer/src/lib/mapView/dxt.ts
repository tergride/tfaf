// DXT1/3/5 decoding on the CPU, for the textures the GPU cannot take compressed: those without mip levels (mips are
// generated from RGBA) and every texture when the browser lacks S3TC.

import type { MapTextureFormat } from '../../../../shared/contract.ts';

function color565(value: number): [number, number, number] {
  return [((value >> 11) & 31) * (255 / 31), ((value >> 5) & 63) * (255 / 63), (value & 31) * (255 / 31)];
}

function decodeColorBlock(data: Uint8Array, offset: number, palette: Float32Array, fourColors: boolean): number {
  const c0 = data[offset]! | (data[offset + 1]! << 8);
  const c1 = data[offset + 2]! | (data[offset + 3]! << 8);
  const p0 = color565(c0);
  const p1 = color565(c1);
  const opaque = fourColors || c0 > c1;
  for (let c = 0; c < 3; c++) {
    palette[c] = p0[c]!;
    palette[4 + c] = p1[c]!;
    palette[8 + c] = opaque ? (2 * p0[c]! + p1[c]!) / 3 : (p0[c]! + p1[c]!) / 2;
    palette[12 + c] = opaque ? (p0[c]! + 2 * p1[c]!) / 3 : 0;
  }
  palette[3] = 255;
  palette[7] = 255;
  palette[11] = 255;
  palette[15] = opaque ? 255 : 0;
  return (data[offset + 4]! | (data[offset + 5]! << 8) | (data[offset + 6]! << 16) | (data[offset + 7]! << 24)) >>> 0;
}

function decodeAlpha5(data: Uint8Array, offset: number, alpha: Uint8Array): void {
  const a0 = data[offset]!;
  const a1 = data[offset + 1]!;
  const palette = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) {
      palette.push(((7 - i) * a0 + i * a1) / 7);
    }
  } else {
    for (let i = 1; i < 5; i++) {
      palette.push(((5 - i) * a0 + i * a1) / 5);
    }
    palette.push(0, 255);
  }
  // 48 bits of 3-bit indices, read in two halves to stay within 32-bit integers.
  const low = data[offset + 2]! | (data[offset + 3]! << 8) | (data[offset + 4]! << 16);
  const high = data[offset + 5]! | (data[offset + 6]! << 8) | (data[offset + 7]! << 16);
  for (let i = 0; i < 8; i++) {
    alpha[i] = palette[(low >> (3 * i)) & 7]!;
    alpha[8 + i] = palette[(high >> (3 * i)) & 7]!;
  }
}

export function decodeDxt(format: Exclude<MapTextureFormat, 'rgba8'>, width: number, height: number, data: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const blockBytes = format === 'dxt1' ? 8 : 16;
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const palette = new Float32Array(16);
  const alpha = new Uint8Array(16);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const offset = (by * blocksX + bx) * blockBytes;
      if (offset + blockBytes > data.length) {
        return rgba;
      }
      let colorOffset = offset;
      if (format === 'dxt3') {
        for (let i = 0; i < 16; i++) {
          alpha[i] = ((data[offset + (i >> 1)]! >> ((i & 1) * 4)) & 15) * 17;
        }
        colorOffset += 8;
      } else if (format === 'dxt5') {
        decodeAlpha5(data, offset, alpha);
        colorOffset += 8;
      }
      const indices = decodeColorBlock(data, colorOffset, palette, format !== 'dxt1');
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) {
          continue;
        }
        const index = (indices >>> (2 * i)) & 3;
        const target = (y * width + x) * 4;
        rgba[target] = palette[index * 4]!;
        rgba[target + 1] = palette[index * 4 + 1]!;
        rgba[target + 2] = palette[index * 4 + 2]!;
        rgba[target + 3] = format === 'dxt1' ? palette[index * 4 + 3]! : alpha[i]!;
      }
    }
  }
  return rgba;
}
