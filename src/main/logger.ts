import { createWriteStream, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LEVELS = ['log', 'info', 'warn', 'error'] as const;

/**
 * Copies everything the main process writes to the console into `launcher.log`, because an installed app has no
 * console. A log that grew too big is kept once as `launcher.old.log`.
 */
export function startFileLog(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'launcher.log');
  try {
    if (statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, path.join(directory, 'launcher.old.log'));
    }
  } catch {
    // No log yet.
  }
  const stream = createWriteStream(file, { flags: 'a' });
  stream.on('error', () => undefined);
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      stream.write(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${format(...args)}\n`);
    };
  }
  return file;
}
