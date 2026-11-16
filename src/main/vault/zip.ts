// Streaming zip extractor for vault archives (stored and deflated entries, no ZIP64, no encryption).
// Entry paths are validated against path traversal and every entry is checked against its declared size and CRC.

import { createReadStream, createWriteStream } from 'node:fs';
import { type FileHandle, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { crc32, createInflateRaw, inflateRaw } from 'node:zlib';
import { t } from '../i18n.ts';

const inflateRawAsync = promisify(inflateRaw);

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  isDirectory: boolean;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ExtractOptions {
  maxTotalBytes?: number;
  onProgress?: (fraction: number) => void;
  /** Only the entries it accepts are extracted. */
  filter?: (entry: ZipEntry) => boolean;
  signal?: AbortSignal;
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT_LENGTH = 0xffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 ** 3;

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new ZipError(t('main.zip.corrupted'));
  }
  return buffer;
}

/** How many bytes from the end of an archive always contain its end-of-central-directory record. */
export const ZIP_TAIL_LENGTH = END_OF_CENTRAL_DIRECTORY_SIZE + MAX_COMMENT_LENGTH;

export interface CentralDirectoryLocation {
  entryCount: number;
  offset: number;
  size: number;
}

/** Finds the central directory from the last bytes of an archive of `archiveSize` bytes. */
export function locateCentralDirectory(tail: Buffer, archiveSize: number): CentralDirectoryLocation {
  let eocd = -1;
  for (let i = tail.length - END_OF_CENTRAL_DIRECTORY_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new ZipError(t('main.zip.notZip'));
  }
  const entryCount = tail.readUInt16LE(eocd + 10);
  const size = tail.readUInt32LE(eocd + 12);
  const offset = tail.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError(t('main.zip.zip64'));
  }
  if (offset + size > archiveSize) {
    throw new ZipError(t('main.zip.corrupted'));
  }
  return { entryCount, offset, size };
}

async function readEntries(handle: FileHandle): Promise<ZipEntry[]> {
  const { size } = await handle.stat();
  if (size < END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new ZipError(t('main.zip.notZip'));
  }
  const tailLength = Math.min(size, ZIP_TAIL_LENGTH);
  const location = locateCentralDirectory(await readAt(handle, size - tailLength, tailLength), size);
  return parseCentralDirectory(await readAt(handle, location.offset, location.size), location.entryCount);
}

/** Entries of a central directory; the CRC32 and sizes in it describe every file of the archive. */
export function parseCentralDirectory(directory: Buffer, entryCount: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let i = 0; i < entryCount; i++) {
    if (offset + CENTRAL_DIRECTORY_HEADER_SIZE > directory.length || directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipError(t('main.zip.corrupted'));
    }
    const flags = directory.readUInt16LE(offset + 8);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const nameStart = offset + CENTRAL_DIRECTORY_HEADER_SIZE;
    if (nameStart + nameLength > directory.length) {
      throw new ZipError(t('main.zip.corrupted'));
    }
    const name = directory
      .subarray(nameStart, nameStart + nameLength)
      .toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1')
      .replace(/\\/g, '/');
    const entry: ZipEntry = {
      name,
      isDirectory: name.endsWith('/'),
      method: directory.readUInt16LE(offset + 10),
      flags,
      crc32: directory.readUInt32LE(offset + 16),
      compressedSize: directory.readUInt32LE(offset + 20),
      uncompressedSize: directory.readUInt32LE(offset + 24),
      localHeaderOffset: directory.readUInt32LE(offset + 42),
    };
    if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
      throw new ZipError(t('main.zip.zip64'));
    }
    entries.push(entry);
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const handle = await open(zipPath, 'r');
  try {
    return await readEntries(handle);
  } finally {
    await handle.close();
  }
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 ** 2;

/**
 * Reads whole files of an archive into memory. Names match case-insensitively, as in the game's file system; a file the
 * archive lacks is missing from the result.
 */
export async function readZipFiles(zipPath: string, names: readonly string[], maxFileBytes = DEFAULT_MAX_FILE_BYTES): Promise<Map<string, Buffer>> {
  const wanted = new Map(names.map((name) => [name.toLowerCase(), name]));
  const handle = await open(zipPath, 'r');
  try {
    const files = new Map<string, Buffer>();
    for (const entry of await readEntries(handle)) {
      const name = wanted.get(entry.name.toLowerCase());
      if (name === undefined || entry.isDirectory || files.has(name)) {
        continue;
      }
      files.set(name, await readEntryData(handle, entry, maxFileBytes));
    }
    return files;
  } finally {
    await handle.close();
  }
}

/** Reads files whose entries were listed before with `readZipEntries`, so a large archive's directory is read once. */
export async function readZipEntryFiles(
  zipPath: string,
  entries: readonly ZipEntry[],
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<Buffer[]> {
  const handle = await open(zipPath, 'r');
  try {
    const files: Buffer[] = [];
    for (const entry of entries) {
      files.push(await readEntryData(handle, entry, maxFileBytes));
    }
    return files;
  } finally {
    await handle.close();
  }
}

async function readEntryData(handle: FileHandle, entry: ZipEntry, maxFileBytes: number): Promise<Buffer> {
  if (entry.uncompressedSize > maxFileBytes) {
    throw new ZipError(t('main.zip.tooLarge'));
  }
  checkSupported(entry);
  const start = await dataStart(handle, entry);
  const stored = await readAt(handle, start, entry.compressedSize);
  const data = entry.method === METHOD_DEFLATED ? await inflateRawAsync(stored, { maxOutputLength: maxFileBytes }) : stored;
  if (data.length !== entry.uncompressedSize) {
    throw new ZipError(t('main.zip.sizeMismatch', { file: entry.name }));
  }
  if (crc32(data) >>> 0 !== entry.crc32 >>> 0) {
    throw new ZipError(t('main.zip.crcMismatch', { file: entry.name }));
  }
  return data;
}

function checkSupported(entry: ZipEntry): void {
  if (entry.flags & FLAG_ENCRYPTED) {
    throw new ZipError(t('main.zip.encrypted'));
  }
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATED) {
    throw new ZipError(t('main.zip.unsupportedMethod', { method: entry.method }));
  }
}

/** Where the data of an entry starts: after its local header, whose name and extra field may differ from the directory's. */
async function dataStart(handle: FileHandle, entry: ZipEntry): Promise<number> {
  const localHeader = await readAt(handle, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  if (localHeader.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipError(t('main.zip.corrupted'));
  }
  return entry.localHeaderOffset + LOCAL_HEADER_SIZE + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28);
}

/** Resolves an entry name inside `targetDir`, rejecting absolute paths, drive letters and `..` segments. */
export function resolveEntryPath(targetDir: string, entryName: string): string {
  const segments = entryName.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  const unsafe =
    entryName.startsWith('/') ||
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || segment.includes(':') || segment.includes('\0'));
  const root = path.resolve(targetDir);
  const resolved = path.resolve(root, ...segments);
  if (unsafe || !resolved.startsWith(root + path.sep)) {
    throw new ZipError(t('main.zip.invalidPath', { path: entryName }));
  }
  return resolved;
}

class EntryVerifier extends Transform {
  private readonly entry: ZipEntry;
  private readonly onBytes: (count: number) => void;
  private written = 0;
  private checksum = 0;

  constructor(entry: ZipEntry, onBytes: (count: number) => void) {
    super();
    this.entry = entry;
    this.onBytes = onBytes;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.written += chunk.length;
    if (this.written > this.entry.uncompressedSize) {
      callback(new ZipError(t('main.zip.sizeMismatch', { file: this.entry.name })));
      return;
    }
    this.checksum = crc32(chunk, this.checksum);
    this.onBytes(chunk.length);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    if (this.written !== this.entry.uncompressedSize) {
      callback(new ZipError(t('main.zip.sizeMismatch', { file: this.entry.name })));
    } else if (this.checksum >>> 0 !== this.entry.crc32 >>> 0) {
      callback(new ZipError(t('main.zip.crcMismatch', { file: this.entry.name })));
    } else {
      callback();
    }
  }
}

export async function extractZip(zipPath: string, targetDir: string, options: ExtractOptions = {}): Promise<void> {
  const handle = await open(zipPath, 'r');
  try {
    const filter = options.filter;
    const entries = filter ? (await readEntries(handle)).filter(filter) : await readEntries(handle);
    const totalBytes = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
    if (totalBytes > (options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES)) {
      throw new ZipError(t('main.zip.tooLarge'));
    }

    let extractedBytes = 0;
    const onBytes = (count: number): void => {
      extractedBytes += count;
      options.onProgress?.(totalBytes > 0 ? extractedBytes / totalBytes : 1);
    };

    for (const entry of entries) {
      options.signal?.throwIfAborted();
      const destination = resolveEntryPath(targetDir, entry.name);
      if (entry.isDirectory) {
        await mkdir(destination, { recursive: true });
        continue;
      }
      checkSupported(entry);
      const start = await dataStart(handle, entry);

      await mkdir(path.dirname(destination), { recursive: true });
      if (entry.uncompressedSize === 0) {
        if (entry.crc32 !== 0) {
          throw new ZipError(t('main.zip.crcMismatch', { file: entry.name }));
        }
        await writeFile(destination, Buffer.alloc(0));
        continue;
      }

      const source = createReadStream(zipPath, { start, end: start + entry.compressedSize - 1 });
      const verifier = new EntryVerifier(entry, onBytes);
      const { signal } = options;
      if (entry.method === METHOD_DEFLATED) {
        await pipeline(source, createInflateRaw(), verifier, createWriteStream(destination), { signal });
      } else {
        await pipeline(source, verifier, createWriteStream(destination), { signal });
      }
    }
  } finally {
    await handle.close();
  }
}
