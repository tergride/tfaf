// The TFAF logo for the screen a game shows in place of its lobby. The game's bitmaps read DDS, and an uncompressed
// one needs nothing but a header in front of the pixels Electron's nativeImage gives (BGRA on Windows).

const HEADER_SIZE = 124;
const PIXEL_FORMAT_SIZE = 32;
// DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PITCH | DDSD_PIXELFORMAT
const HEADER_FLAGS = 0x1 | 0x2 | 0x4 | 0x8 | 0x1000;
// DDPF_ALPHAPIXELS | DDPF_RGB
const PIXEL_FLAGS = 0x1 | 0x40;
const DDSCAPS_TEXTURE = 0x1000;

/** An uncompressed 32-bit DDS of BGRA pixels, rows from the top. */
export function ddsFromBgra(width: number, height: number, bgra: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || bgra.length !== width * height * 4) {
    throw new Error(`Pixels do not match ${width}×${height}`);
  }
  const header = Buffer.alloc(4 + HEADER_SIZE);
  header.write('DDS ', 0, 'ascii');
  header.writeUInt32LE(HEADER_SIZE, 4);
  header.writeUInt32LE(HEADER_FLAGS, 8);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(width * 4, 20);
  const pixelFormat = 4 + 72;
  header.writeUInt32LE(PIXEL_FORMAT_SIZE, pixelFormat);
  header.writeUInt32LE(PIXEL_FLAGS, pixelFormat + 4);
  header.writeUInt32LE(32, pixelFormat + 12);
  header.writeUInt32LE(0x00ff0000, pixelFormat + 16);
  header.writeUInt32LE(0x0000ff00, pixelFormat + 20);
  header.writeUInt32LE(0x000000ff, pixelFormat + 24);
  header.writeUInt32LE(0xff000000, pixelFormat + 28);
  header.writeUInt32LE(DDSCAPS_TEXTURE, pixelFormat + PIXEL_FORMAT_SIZE);
  return Buffer.concat([header, bgra]);
}
