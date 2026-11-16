import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { OldVersion, OldVersionsCleanup } from '../shared/contract.ts';
import { describeError } from './errors.ts';
import { pathExists } from './vault/fsUtil.ts';

/** An old version on disk: a file or a whole folder. */
export interface OldVersionFile extends OldVersion {
  path: string;
}

/** Bytes taken by a file, or by a folder with everything inside it. */
export async function diskUsage(target: string): Promise<number> {
  const info = await lstat(target);
  if (!info.isDirectory()) {
    return info.size;
  }
  let total = 0;
  for (const entry of await readdir(target, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      total += (await lstat(path.join(entry.parentPath, entry.name))).size;
    }
  }
  return total;
}

export async function oldVersionFile(title: string, target: string): Promise<OldVersionFile> {
  return { title, path: target, bytes: await diskUsage(target) };
}

export async function removeOldVersions(files: readonly OldVersionFile[]): Promise<OldVersionsCleanup> {
  let freedBytes = 0;
  const remaining: OldVersion[] = [];
  for (const file of files) {
    try {
      await rm(file.path, { recursive: true, force: true, maxRetries: 2 });
      freedBytes += file.bytes;
    } catch (error) {
      console.warn(`Old version ${file.path} could not be removed: ${describeError(error)}`);
      if (!(await pathExists(file.path))) {
        freedBytes += file.bytes;
        continue;
      }
      // A folder may be removed only in part.
      const left = await diskUsage(file.path).catch(() => file.bytes);
      freedBytes += Math.max(0, file.bytes - left);
      remaining.push({ title: file.title, bytes: left });
    }
  }
  return { freedBytes, remaining };
}
