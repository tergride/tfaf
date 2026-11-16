// Zips a map or mod folder for upload: the folder itself is the archive's root, as Zipper of faf-java-commons does.
// Entries are deflated and streamed to disk; their local headers are written once the sizes and CRC are known.

import type { Dirent } from 'node:fs';
import { createReadStream } from 'node:fs';
import { type FileHandle, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw } from 'node:zlib';
import { t } from '../i18n.ts';
import { ZipError } from './zip.ts';

export interface ZipFolderOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

interface SourceFile {
  /** The name inside the archive, with forward slashes. */
  name: string;
  path: string;
  size: number;
  modified: Date;
}

interface WrittenEntry {
  name: Buffer;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const VERSION_NEEDED = 20;
const FLAG_UTF8 = 0x800;
const METHOD_DEFLATED = 8;
// Without ZIP64 sizes, offsets and the entry count stay below these.
const MAX_ZIP_SIZE = 0xffffffff;
const MAX_ENTRIES = 0xffff;
/** Files Windows Explorer leaves in folders; the vault has no use for them. */
const SKIPPED_FILES = new Set(['thumbs.db', 'desktop.ini']);

/** The files of a folder in a stable order, under the folder's own name. */
export async function listFolderFiles(folder: string): Promise<SourceFile[]> {
  const root = path.basename(folder);
  const files: SourceFile[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries: Dirent[] = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full, name);
      } else if (entry.isFile() && !SKIPPED_FILES.has(entry.name.toLowerCase())) {
        const info = await stat(full);
        files.push({ name, path: full, size: info.size, modified: info.mtime });
      }
    }
  };
  await walk(folder, root);
  return files;
}

/** MS-DOS date and time of a file, which zip headers use; years before 1980 cannot be expressed. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function localHeader(entry: WrittenEntry): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_SIZE);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(METHOD_DEFLATED, 8);
  header.writeUInt16LE(entry.time, 10);
  header.writeUInt16LE(entry.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name]);
}

function centralHeader(entry: WrittenEntry): Buffer {
  const header = Buffer.alloc(CENTRAL_DIRECTORY_HEADER_SIZE);
  header.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(METHOD_DEFLATED, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  // Extra field, comment, disk number, internal and external attributes stay zero.
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const record = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_SIZE);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  return record;
}

class Checksum extends Transform {
  crc = 0;
  bytes = 0;
  private readonly onBytes: (count: number) => void;

  constructor(onBytes: (count: number) => void) {
    super();
    this.onBytes = onBytes;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.crc = crc32(chunk, this.crc);
    this.bytes += chunk.length;
    this.onBytes(chunk.length);
    callback(null, chunk);
  }
}

async function writeEntry(
  handle: FileHandle,
  file: SourceFile,
  offset: number,
  onBytes: (count: number) => void,
  signal: AbortSignal | undefined,
): Promise<WrittenEntry> {
  const name = Buffer.from(file.name, 'utf8');
  const { time, date } = dosDateTime(file.modified);
  let position = offset + LOCAL_HEADER_SIZE + name.length;
  const checksum = new Checksum(onBytes);
  const deflate = createDeflateRaw();
  const feeding = pipeline(createReadStream(file.path, { signal }), checksum, deflate);
  // A read error also ends the iteration below with that error; the pipeline's own rejection must not go unhandled.
  feeding.catch(() => undefined);
  let compressedSize = 0;
  try {
    for await (const chunk of deflate as AsyncIterable<Buffer>) {
      await handle.write(chunk, 0, chunk.length, position);
      position += chunk.length;
      compressedSize += chunk.length;
    }
  } catch (error) {
    deflate.destroy();
    throw error;
  }
  await feeding;
  if (position > MAX_ZIP_SIZE) {
    throw new ZipError(t('main.zip.tooLarge'));
  }
  const entry: WrittenEntry = { name, crc: checksum.crc >>> 0, compressedSize, size: checksum.bytes, offset, time, date };
  const header = localHeader(entry);
  await handle.write(header, 0, header.length, offset);
  return entry;
}

/** Writes `folder` to a new zip at `target`, the folder's name as the root of every entry. */
export async function zipFolder(folder: string, target: string, options: ZipFolderOptions = {}): Promise<void> {
  const files = await listFolderFiles(folder);
  if (files.length === 0) {
    throw new ZipError(t('main.zip.emptyFolder'));
  }
  if (files.length > MAX_ENTRIES) {
    throw new ZipError(t('main.zip.tooLarge'));
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let done = 0;
  const onBytes = (count: number): void => {
    done += count;
    options.onProgress?.(total > 0 ? done / total : 1);
  };
  const handle = await open(target, 'w');
  try {
    const entries: WrittenEntry[] = [];
    let offset = 0;
    for (const file of files) {
      options.signal?.throwIfAborted();
      const entry = await writeEntry(handle, file, offset, onBytes, options.signal);
      entries.push(entry);
      offset = entry.offset + LOCAL_HEADER_SIZE + entry.name.length + entry.compressedSize;
    }
    const directory = Buffer.concat(entries.map(centralHeader));
    if (offset + directory.length + END_OF_CENTRAL_DIRECTORY_SIZE > MAX_ZIP_SIZE) {
      throw new ZipError(t('main.zip.tooLarge'));
    }
    await handle.write(directory, 0, directory.length, offset);
    const end = endOfCentralDirectory(entries.length, directory.length, offset);
    await handle.write(end, 0, end.length, offset + directory.length);
  } finally {
    await handle.close();
  }
}
