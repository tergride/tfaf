import { access, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function listDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function findChildCaseInsensitive(directory: string, name: string): Promise<string | null> {
  const wanted = name.toLowerCase();
  const match = (await listDirectories(directory)).find((candidate) => candidate.toLowerCase() === wanted);
  return match === undefined ? null : path.join(directory, match);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Vault Lua files are either UTF-8 or Windows-1252; latin1 is the closest lossless fallback for the latter. */
export async function readTextFile(file: string): Promise<string> {
  const buffer = await readFile(file);
  try {
    return utf8.decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

const RESERVED_CHARACTERS = /[<>:"/\\|?*\x00-\x1f]/;

/** A single path segment that is safe to join to a vault directory. */
export function isSafeFolderName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !RESERVED_CHARACTERS.test(name);
}

/** Windows may briefly lock freshly written files (indexer, antivirus), so directory moves are retried. */
export async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        throw error;
      }
      await delay(200 * attempt);
    }
  }
}
