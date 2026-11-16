// Checks that a map or mod on disk holds exactly the files the FAF vault published. Vault versions never change, so
// the CRC32 and sizes in the central directory of the published archive describe the expected files once and for all.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import type { MessageKey } from '../../shared/i18n/index.ts';
import { mapLimited } from '../concurrency.ts';
import { t } from '../i18n.ts';
import { fetchWithTimeout, RETRYABLE_STATUSES, RetryableStatusError } from '../net/http.ts';
import { locateCentralDirectory, parseCentralDirectory, ZIP_TAIL_LENGTH, type ZipEntry } from './zip.ts';

export interface ManifestFile {
  /** Relative to the map or mod folder, lower case, with `/` separators. */
  path: string;
  size: number;
  crc32: number;
}

export interface Manifest {
  /** Name of the folder inside the archive that holds the files. */
  root: string;
  files: ManifestFile[];
}

export interface IntegrityProblem {
  path: string;
  kind: 'missing' | 'changed' | 'extra';
}

/** What the user should hear about a check: a repaired install, or content that could not be checked. */
export interface IntegrityNote {
  style: 'info' | 'warning';
  text: string;
}

const CHECK_CONCURRENCY = 4;
// Files Windows and macOS drop into folders on their own; the game never loads them.
const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);
const RANGE_TIMEOUT_MS = 20_000;
// A server that ignores ranges sends the whole archive; small ones are still usable, large ones are not worth it.
const MAX_FULL_BODY_BYTES = 1024 * 1024;

/**
 * The top-level folder of an archive that has `marker` directly inside it (the scenario of a map, mod_info.lua of a
 * mod); null when there is none.
 */
export function manifestFromEntries(entries: ZipEntry[], marker: (fileName: string) => boolean): Manifest | null {
  const groups = new Map<string, ZipEntry[]>();
  for (const entry of entries) {
    const slash = entry.name.indexOf('/');
    if (entry.isDirectory || slash <= 0) {
      continue;
    }
    const root = entry.name.slice(0, slash);
    const group = groups.get(root);
    if (group) {
      group.push(entry);
    } else {
      groups.set(root, [entry]);
    }
  }
  for (const [root, group] of groups) {
    const files = group.map((entry) => ({
      path: entry.name.slice(root.length + 1).toLowerCase(),
      size: entry.uncompressedSize,
      crc32: entry.crc32 >>> 0,
    }));
    if (files.some((file) => !file.path.includes('/') && marker(file.path))) {
      return { root, files };
    }
  }
  return null;
}

async function listFiles(directory: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const absolute = path.join(entry.parentPath, entry.name);
      files.set(path.relative(directory, absolute).split(path.sep).join('/').toLowerCase(), absolute);
    }
  }
  return files;
}

async function fileCrc32(file: string): Promise<number> {
  let value = 0;
  for await (const chunk of createReadStream(file)) {
    value = crc32(chunk as Buffer, value);
  }
  return value >>> 0;
}

/** The files of a folder as a manifest lists them, each read in full; for content the vault does not describe. */
export async function describeFolder(directory: string): Promise<ManifestFile[]> {
  const files = [...(await listFiles(directory))].filter(([file]) => !SYSTEM_FILES.has(file.slice(file.lastIndexOf('/') + 1)));
  return mapLimited(files, CHECK_CONCURRENCY, async ([file, absolute]) => ({
    path: file,
    size: (await stat(absolute)).size,
    crc32: await fileCrc32(absolute),
  }));
}

/**
 * Compares a folder with a manifest, reading every expected file in full. Extra files matter for mods, where any
 * Lua file in a hook folder is loaded, but not for maps, which only load the files their scenario names.
 */
export async function checkFolder(
  directory: string,
  manifest: Manifest,
  { allowExtra }: { allowExtra: boolean },
): Promise<IntegrityProblem[]> {
  const onDisk = await listFiles(directory);
  const problems: IntegrityProblem[] = [];
  await mapLimited(manifest.files, CHECK_CONCURRENCY, async (file) => {
    const absolute = onDisk.get(file.path);
    if (!absolute) {
      problems.push({ path: file.path, kind: 'missing' });
    } else if ((await stat(absolute)).size !== file.size || (await fileCrc32(absolute)) !== file.crc32) {
      problems.push({ path: file.path, kind: 'changed' });
    }
  });
  if (!allowExtra) {
    const expected = new Set(manifest.files.map((file) => file.path));
    for (const file of onDisk.keys()) {
      if (!expected.has(file) && !SYSTEM_FILES.has(file.slice(file.lastIndexOf('/') + 1))) {
        problems.push({ path: file, kind: 'extra' });
      }
    }
  }
  return problems.sort((a, b) => a.path.localeCompare(b.path));
}

const PROBLEM_LABELS: Record<IntegrityProblem['kind'], MessageKey> = {
  missing: 'main.integrity.missing',
  changed: 'main.integrity.changed',
  extra: 'main.integrity.extra',
};

/** A short list for logs and notices: the first few problems and how many more there are. */
export function describeProblems(problems: IntegrityProblem[]): string {
  const shown = problems.slice(0, 3).map((problem) => `${problem.path} (${t(PROBLEM_LABELS[problem.kind])})`);
  return problems.length > shown.length
    ? t('main.integrity.andMore', { list: shown.join(', '), more: problems.length - shown.length })
    : shown.join(', ');
}

async function fetchRange(url: string, range: string, userAgent: string): Promise<{ body: Buffer; total: number } | null> {
  const response = await fetchWithTimeout(url, { headers: { Range: range, 'User-Agent': userAgent } }, RANGE_TIMEOUT_MS);
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status === 200 && Number(response.headers.get('content-length')) <= MAX_FULL_BODY_BYTES) {
    const body = Buffer.from(await response.arrayBuffer());
    return { body, total: body.length };
  }
  if (response.status !== 206) {
    await response.body?.cancel();
    const message = t('main.integrity.rangeStatus', { status: response.status });
    if (RETRYABLE_STATUSES.has(response.status)) {
      throw new RetryableStatusError(message, response.status, response.headers.get('retry-after'));
    }
    throw new Error(message);
  }
  const total = Number(response.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1]);
  if (!Number.isFinite(total) || total <= 0) {
    await response.body?.cancel();
    throw new Error(t('main.integrity.noArchiveSize'));
  }
  return { body: Buffer.from(await response.arrayBuffer()), total };
}

/**
 * The entries of an archive on the content server without downloading it: the end of the file and, for archives with
 * many files, the central directory itself. Null when the server does not have the archive.
 */
export async function fetchRemoteEntries(url: string, userAgent: string): Promise<ZipEntry[] | null> {
  const tail = await fetchRange(url, `bytes=-${ZIP_TAIL_LENGTH}`, userAgent);
  if (!tail) {
    return null;
  }
  const location = locateCentralDirectory(tail.body, tail.total);
  const tailStart = tail.total - tail.body.length;
  if (location.offset >= tailStart) {
    const start = location.offset - tailStart;
    return parseCentralDirectory(tail.body.subarray(start, start + location.size), location.entryCount);
  }
  const directory = await fetchRange(url, `bytes=${location.offset}-${location.offset + location.size - 1}`, userAgent);
  if (!directory || directory.body.length !== location.size) {
    throw new Error(t('main.integrity.incompleteDirectory'));
  }
  return parseCentralDirectory(directory.body, location.entryCount);
}

function parseManifest(value: unknown): Manifest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.root !== 'string' || !Array.isArray(raw.files)) {
    return null;
  }
  const files: ManifestFile[] = [];
  for (const entry of raw.files) {
    const file = entry as Record<string, unknown> | null;
    if (
      typeof file?.path !== 'string' ||
      !Number.isInteger(file.size) ||
      !Number.isInteger(file.crc32) ||
      (file.size as number) < 0
    ) {
      return null;
    }
    files.push({ path: file.path, size: file.size as number, crc32: file.crc32 as number });
  }
  return { root: raw.root, files };
}

/**
 * Manifests of installed vault versions, kept next to the launcher settings rather than in the game folders. They are
 * stored for good: a vault version is never changed after upload.
 */
export class ManifestStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async get(kind: 'map' | 'mod', key: string): Promise<Manifest | null> {
    try {
      return parseManifest(JSON.parse(await readFile(this.fileFor(kind, key), 'utf8')));
    } catch {
      return null;
    }
  }

  async put(kind: 'map' | 'mod', key: string, manifest: Manifest): Promise<void> {
    const file = this.fileFor(kind, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify({ key, ...manifest }), 'utf8');
    await rename(`${file}.tmp`, file);
  }

  private fileFor(kind: 'map' | 'mod', key: string): string {
    const name = createHash('sha256').update(key.toLowerCase()).digest('hex').slice(0, 40);
    return path.join(this.directory, `${kind}s`, `${name}.json`);
  }
}
