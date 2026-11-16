// Voice-overs and videos of coop missions come as archives among the featured mod files. init_coop.lua mounts them
// from the movies and sounds folders next to bin, so they are unpacked there, as UpdaterUtil.extractMoviesAndSoundsIfPresent
// of the official client does.

import { link, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractZip, readZipEntries, resolveEntryPath, type ZipEntry } from '../vault/zip.ts';

const MEDIA_FOLDERS = ['movies/', 'sounds/'];

/** Files of an archive that belong in movies/ or sounds/; none when the file is not a zip archive. */
export async function readMediaEntries(archive: string): Promise<ZipEntry[]> {
  let entries: ZipEntry[];
  try {
    entries = await readZipEntries(archive);
  } catch {
    return [];
  }
  return entries.filter(
    (entry) => !entry.isDirectory && MEDIA_FOLDERS.some((folder) => entry.name.toLowerCase().startsWith(folder)),
  );
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

/** Entries whose unpacked copy under `root` is missing or has another size; all of them when the archive changed. */
export async function staleMediaEntries(entries: ZipEntry[], root: string, archiveChanged: boolean): Promise<ZipEntry[]> {
  if (archiveChanged) {
    return entries;
  }
  const stale: ZipEntry[] = [];
  for (const entry of entries) {
    if ((await sizeOf(resolveEntryPath(root, entry.name))) !== entry.uncompressedSize) {
      stale.push(entry);
    }
  }
  return stale;
}

export interface UnpackMediaOptions {
  /** A folder where the same archive is already unpacked; its copies are shared with hard links instead. */
  linkFrom?: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/**
 * Unpacks entries of an archive under `root`. An old copy is deleted rather than overwritten: it may be a hard link
 * that another folder shares.
 */
export async function unpackMedia(
  archive: string,
  root: string,
  entries: ZipEntry[],
  { linkFrom = null, signal, onProgress }: UnpackMediaOptions = {},
): Promise<void> {
  const toExtract = new Set<string>();
  for (const entry of entries) {
    const target = resolveEntryPath(root, entry.name);
    await rm(target, { force: true });
    if (linkFrom) {
      const source = resolveEntryPath(linkFrom, entry.name);
      if ((await sizeOf(source)) === entry.uncompressedSize) {
        try {
          await mkdir(path.dirname(target), { recursive: true });
          await link(source, target);
          continue;
        } catch {
          // Without hard links, e.g. on FAT32, the file is unpacked.
        }
      }
    }
    toExtract.add(entry.name);
  }
  if (toExtract.size === 0) {
    return;
  }
  try {
    await extractZip(archive, root, { filter: (entry) => toExtract.has(entry.name), signal, onProgress });
  } catch (error) {
    // A partly written file could have the right size by chance; without it the next update unpacks it again.
    await Promise.all([...toExtract].map((name) => rm(resolveEntryPath(root, name), { force: true })));
    throw error;
  }
}
