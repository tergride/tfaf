import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/contract.ts';

export const PORTABLE_MARKER = 'portable.flag';

export interface PortableStorage {
  root: string;
  profileDirectory: string;
  sessionDirectory: string;
  logsDirectory: string;
  tempDirectory: string;
  crashDirectory: string;
  dataDirectory: string;
  vaultDirectory: string;
  prefsFile: string;
}

/** Only the flag next to the packaged executable enables portable storage. */
export function findPortableStorage(executable: string, packaged: boolean): PortableStorage | null {
  if (!packaged) {
    return null;
  }
  const root = path.dirname(executable);
  try {
    if (!lstatSync(path.join(root, PORTABLE_MARKER)).isFile()) {
      throw new Error('portable.flag must be a regular file');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const data = path.join(root, 'portable-data');
  return {
    root,
    profileDirectory: path.join(data, 'profile'),
    sessionDirectory: path.join(data, 'chromium'),
    logsDirectory: path.join(data, 'logs'),
    tempDirectory: path.join(data, 'temp'),
    crashDirectory: path.join(data, 'crashes'),
    dataDirectory: path.join(data, 'game'),
    vaultDirectory: path.join(data, 'vault'),
    prefsFile: path.join(data, 'prefs', 'TFAF.prefs'),
  };
}

/** A write probe catches read-only media and access denied before Electron opens any profile. */
export function preparePortableStorage(storage: PortableStorage): void {
  const directories = [
    storage.profileDirectory,
    storage.sessionDirectory,
    storage.logsDirectory,
    storage.tempDirectory,
    storage.crashDirectory,
    storage.dataDirectory,
    storage.vaultDirectory,
    path.dirname(storage.prefsFile),
  ];
  for (const directory of directories) {
    assertWritableDirectory(directory);
  }
}

function assertWritableDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.tfaf-write-${randomUUID()}`);
  const descriptor = openSync(probe, 'wx');
  try {
    closeSync(descriptor);
  } finally {
    unlinkSync(probe);
  }
}

/** New ordinary profiles may use a personal folder when another account owns the shared default. */
export function defaultDataDirectory(sharedDirectory: string, personalDirectory: string): string {
  try {
    assertWritableDirectory(sharedDirectory);
    return sharedDirectory;
  } catch (error) {
    if (!['EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error;
    }
  }
  assertWritableDirectory(personalDirectory);
  return personalDirectory;
}

const PATH_FIELDS = ['gamePath', 'vaultPath', 'gamePrefsPath', 'dataPath'] as const;

function relativeWithin(root: string, target: string): string | null {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? null : relative;
}

/** The on-disk portable profile moves with its executable; consumers still receive absolute paths. */
export function encodePortablePaths(settings: Settings, root: string): Settings {
  const stored = { ...settings };
  for (const field of PATH_FIELDS) {
    const value = settings[field];
    if (value !== null && path.isAbsolute(value)) {
      const relative = relativeWithin(root, value);
      if (relative !== null) {
        stored[field] = relative.length === 0 ? '.' : relative.split(path.sep).join('/');
      }
    }
  }
  return stored;
}

export function decodePortablePaths(stored: unknown, root: string): unknown {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return stored;
  }
  const resolved = { ...stored } as Record<string, unknown>;
  for (const field of PATH_FIELDS) {
    const value = resolved[field];
    if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
      continue;
    }
    // Drive-relative paths (C:folder) are neither portable nor fully qualified.
    const absolute = path.resolve(root, value);
    resolved[field] = path.parse(value).root !== '' || relativeWithin(root, absolute) === null ? null : absolute;
  }
  return resolved;
}
