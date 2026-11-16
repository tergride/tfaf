import type { Dirent } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { LOG_CLEANUP_LIMITS, type LogCleanupPrefs, type LogsCleanup, type LogsUsage } from '../shared/contract.ts';
import { describeError } from './errors.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const MEGABYTE = 1024 * 1024;
// The logs of a game that just ended are what a desync or a crash is looked into with, and a running game still
// writes its own, so no rule removes logs of the last day.
const KEEP_RECENT_MS = DAY_MS;

export interface LogFile {
  path: string;
  bytes: number;
  modifiedMs: number;
}

export function defaultLogCleanupPrefs(): LogCleanupPrefs {
  return { enabled: true, byAge: true, maxAgeDays: 30, bySize: true, maxSizeMb: 500 };
}

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max;
}

/** A damaged stored value falls back to its default; the other values stay. */
export function mergeLogCleanupPrefs(stored: unknown, defaults: LogCleanupPrefs): LogCleanupPrefs {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const flag = (name: 'enabled' | 'byAge' | 'bySize'): boolean => (typeof raw[name] === 'boolean' ? raw[name] : defaults[name]);
  return {
    enabled: flag('enabled'),
    byAge: flag('byAge'),
    maxAgeDays: inRange(raw.maxAgeDays, LOG_CLEANUP_LIMITS.maxAgeDays) ? raw.maxAgeDays : defaults.maxAgeDays,
    bySize: flag('bySize'),
    maxSizeMb: inRange(raw.maxSizeMb, LOG_CLEANUP_LIMITS.maxSizeMb) ? raw.maxSizeMb : defaults.maxSizeMb,
  };
}

/** The `.log` files of the folder and its subfolders, e.g. the Java adapter's `iceAdapterLogs`. */
export async function listLogs(directory: string): Promise<LogFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true, recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.log$/i.test(entry.name))
      .map(async (entry): Promise<LogFile | null> => {
        const file = path.join(entry.parentPath, entry.name);
        try {
          const info = await stat(file);
          return { path: file, bytes: info.size, modifiedMs: info.mtimeMs };
        } catch {
          // Gone meanwhile, e.g. rolled over by the Java adapter.
          return null;
        }
      }),
  );
  return files.filter((file) => file !== null);
}

export function logsUsage(files: readonly LogFile[]): LogsUsage {
  return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

/** What the rules remove, oldest first: logs older than the age, then the oldest ones until the rest fits the size. */
export function expiredLogs(files: readonly LogFile[], prefs: LogCleanupPrefs, now: number): LogFile[] {
  const oldestFirst = [...files].sort((a, b) => a.modifiedMs - b.modifiedMs);
  const removable = oldestFirst.filter((file) => now - file.modifiedMs >= KEEP_RECENT_MS);
  const expired = new Set(prefs.byAge ? removable.filter((file) => now - file.modifiedMs > prefs.maxAgeDays * DAY_MS) : []);
  if (prefs.bySize) {
    let total = oldestFirst.reduce((sum, file) => (expired.has(file) ? sum : sum + file.bytes), 0);
    for (const file of removable) {
      if (total <= prefs.maxSizeMb * MEGABYTE) {
        break;
      }
      if (!expired.has(file)) {
        expired.add(file);
        total -= file.bytes;
      }
    }
  }
  return removable.filter((file) => expired.has(file));
}

export interface LogCleanerSource {
  /** Asked on every run, since the data folder can be changed in the settings. */
  directory(): string;
  prefs(): LogCleanupPrefs;
}

export class LogCleaner {
  private readonly source: LogCleanerSource;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(source: LogCleanerSource, now: () => number = Date.now) {
    this.source = source;
    this.now = now;
  }

  async usage(): Promise<LogsUsage> {
    return logsUsage(await listLogs(this.source.directory()));
  }

  /** Runs one cleanup at a time, each with the rules saved when it starts. */
  clean(): Promise<LogsCleanup> {
    const run = this.queue.then(() => this.run());
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** At start and after every game, unless the automatic cleanup is off. Problems only go to the launcher log. */
  cleanAutomatically(): void {
    if (!this.source.prefs().enabled) {
      return;
    }
    this.clean()
      .then(({ removedFiles, freedBytes, busyFiles }) => {
        if (removedFiles > 0 || busyFiles > 0) {
          console.info(`Log cleanup removed ${removedFiles} files (${freedBytes} bytes), ${busyFiles} in use`);
        }
      })
      .catch((error: unknown) => console.warn('Log cleanup failed', describeError(error)));
  }

  private async run(): Promise<LogsCleanup> {
    const files = await listLogs(this.source.directory());
    const before = logsUsage(files);
    let removedFiles = 0;
    let freedBytes = 0;
    let busyFiles = 0;
    for (const file of expiredLogs(files, this.source.prefs(), this.now())) {
      try {
        await unlink(file.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(`Log ${file.path} could not be removed: ${describeError(error)}`);
          busyFiles += 1;
          continue;
        }
      }
      removedFiles += 1;
      freedBytes += file.bytes;
    }
    return { removedFiles, freedBytes, busyFiles, usage: { files: before.files - removedFiles, bytes: before.bytes - freedBytes } };
  }
}
