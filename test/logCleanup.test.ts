import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { LogCleanupPrefs } from '../src/shared/contract.ts';
import { defaultLogCleanupPrefs, expiredLogs, LogCleaner, type LogFile, mergeLogCleanupPrefs } from '../src/main/logCleanup.ts';

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
const NOW = Date.UTC(2026, 10, 7, 12);

function log(name: string, ageDays: number, megabytes = 1): LogFile {
  return { path: name, bytes: megabytes * MB, modifiedMs: NOW - ageDays * DAY };
}

function prefs(change: Partial<LogCleanupPrefs>): LogCleanupPrefs {
  return { ...defaultLogCleanupPrefs(), ...change };
}

function names(files: LogFile[]): string[] {
  return files.map((file) => file.path);
}

describe('log cleanup rules', () => {
  it('removes logs older than the age, oldest first', () => {
    const files = [log('new', 2), log('oldest', 40), log('old', 31), log('kept', 29)];
    assert.deepEqual(names(expiredLogs(files, prefs({ bySize: false, maxAgeDays: 30 }), NOW)), ['oldest', 'old']);
  });

  it('removes the oldest logs until the rest fits the size', () => {
    const files = [log('a', 5, 300), log('b', 4, 200), log('c', 3, 100), log('d', 2, 50)];
    assert.deepEqual(names(expiredLogs(files, prefs({ byAge: false, maxSizeMb: 300 }), NOW)), ['a', 'b']);
  });

  it('does not count the logs the age removes against the size', () => {
    const files = [log('expired', 40, 400), log('fits', 3, 300), log('recent', 2, 100)];
    assert.deepEqual(names(expiredLogs(files, prefs({ maxAgeDays: 30, maxSizeMb: 400 }), NOW)), ['expired']);
  });

  it('keeps the logs of the last day even above the size', () => {
    const files = [log('older', 2, 100), log('today', 0.5, 900)];
    assert.deepEqual(names(expiredLogs(files, prefs({ byAge: false, maxSizeMb: 50 }), NOW)), ['older']);
    assert.deepEqual(names(expiredLogs([log('today', 0.9)], prefs({ maxAgeDays: 1 }), NOW)), []);
  });

  it('removes nothing with both rules off', () => {
    assert.deepEqual(expiredLogs([log('ancient', 300, 5000)], prefs({ byAge: false, bySize: false }), NOW), []);
  });
});

describe('stored log cleanup settings', () => {
  it('fall back field by field to the defaults', () => {
    const defaults = defaultLogCleanupPrefs();
    assert.deepEqual(mergeLogCleanupPrefs(undefined, defaults), defaults);
    assert.deepEqual(
      mergeLogCleanupPrefs({ enabled: false, byAge: 'yes', maxAgeDays: 0, bySize: false, maxSizeMb: 1234 }, defaults),
      { ...defaults, enabled: false, bySize: false, maxSizeMb: 1234 },
    );
    assert.equal(mergeLogCleanupPrefs({ maxAgeDays: 7.5 }, defaults).maxAgeDays, defaults.maxAgeDays);
    assert.equal(mergeLogCleanupPrefs({ maxSizeMb: 20_000 }, defaults).maxSizeMb, defaults.maxSizeMb);
  });
});

describe('log cleaner', () => {
  let root: string;
  let logs: string;

  async function writeLog(relative: string, ageDays: number, bytes: number): Promise<void> {
    const file = path.join(logs, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.alloc(bytes));
    const modified = new Date(NOW - ageDays * DAY);
    await utimes(file, modified, modified);
  }

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tfaf-log-cleanup-'));
    logs = path.join(root, 'logs');
    await writeLog('game_1.log', 45, 300);
    await writeLog('tfaf-ice-adapter-1.log', 45, 20);
    await writeLog(path.join('iceAdapterLogs', 'ice-adapter.2026-09-01.log'), 60, 50);
    await writeLog('game_2.log', 3, 100);
    await writeLog('game_3.log', 0, 80);
    await writeLog('notes.txt', 90, 10);
  });

  after(() => rm(root, { recursive: true, force: true }));

  it('reports nothing for a data folder without logs', async () => {
    const cleaner = new LogCleaner({ directory: () => path.join(root, 'missing'), prefs: defaultLogCleanupPrefs }, () => NOW);
    assert.deepEqual(await cleaner.usage(), { files: 0, bytes: 0 });
  });

  it('removes the expired .log files of the folder and its subfolders', async () => {
    const cleaner = new LogCleaner({ directory: () => logs, prefs: () => prefs({ maxAgeDays: 30 }) }, () => NOW);
    assert.deepEqual(await cleaner.usage(), { files: 5, bytes: 550 });
    const result = await cleaner.clean();
    assert.deepEqual(result, { removedFiles: 3, freedBytes: 370, busyFiles: 0, usage: { files: 2, bytes: 180 } });
    assert.deepEqual((await readdir(logs, { recursive: true })).sort(), ['game_2.log', 'game_3.log', 'iceAdapterLogs', 'notes.txt']);
  });
});
