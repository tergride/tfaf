import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { asNumber, asObject, asString } from '../api/jsonApi.ts';

interface Entry {
  size: number;
  mtimeMs: number;
  md5: string;
}

/**
 * MD5 of game files remembered by size and modification time. The game files weigh ~700 MB, so hashing all of them on
 * every update would cost seconds; unchanged files are answered from the cache.
 */
export class FileHashCache {
  private readonly file: string;
  private readonly entries = new Map<string, Entry>();
  private dirty = false;

  private constructor(file: string) {
    this.file = file;
  }

  static async load(file: string): Promise<FileHashCache> {
    const cache = new FileHashCache(file);
    try {
      const stored = asObject(JSON.parse(await readFile(file, 'utf8')));
      for (const [key, value] of Object.entries(stored ?? {})) {
        const entry = asObject(value);
        const size = asNumber(entry?.size);
        const mtimeMs = asNumber(entry?.mtimeMs);
        const md5 = asString(entry?.md5);
        if (size !== null && mtimeMs !== null && md5) {
          cache.entries.set(key, { size, mtimeMs, md5 });
        }
      }
    } catch {
      // Missing or unreadable cache: every file is simply hashed again.
    }
    return cache;
  }

  /**
   * MD5 of the file, or null when it does not exist. `fresh` hashes the content even when size and time match, which
   * also catches a file damaged on disk.
   */
  async md5(file: string, fresh = false): Promise<string | null> {
    let info;
    try {
      info = await stat(file);
    } catch {
      return null;
    }
    const key = file.toLowerCase();
    const cached = this.entries.get(key);
    if (!fresh && cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      return cached.md5;
    }
    const hash = createHash('md5');
    await pipeline(createReadStream(file), hash);
    const md5 = hash.digest('hex');
    this.entries.set(key, { size: info.size, mtimeMs: info.mtimeMs, md5 });
    this.dirty = true;
    return md5;
  }

  /** Records the MD5 of a file that was just written and verified. */
  async remember(file: string, md5: string): Promise<void> {
    const info = await stat(file);
    this.entries.set(file.toLowerCase(), { size: info.size, mtimeMs: info.mtimeMs, md5 });
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(Object.fromEntries(this.entries)), 'utf8');
    await rename(temp, this.file);
    this.dirty = false;
  }
}
