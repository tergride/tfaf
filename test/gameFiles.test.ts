import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { FileHashCache } from '../src/main/game/fileHashCache.ts';
import { officialFileCandidates } from '../src/main/game/officialClient.ts';

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

describe('FileHashCache', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-hash-test-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('hashes files, answers unchanged files from the cache and survives a reload', async () => {
    const file = path.join(directory, 'lua.nx2');
    const cacheFile = path.join(directory, 'hashes.json');
    // Whole seconds, so that restoring the timestamp below reproduces it exactly.
    const mtime = new Date('2026-01-01T00:00:00Z');
    await writeFile(file, 'first');
    await utimes(file, mtime, mtime);
    const cache = await FileHashCache.load(cacheFile);
    assert.equal(await cache.md5(file), md5('first'));

    // Same size and modification time: the cached value is trusted without reading the file.
    await writeFile(file, 'other');
    await utimes(file, mtime, mtime);
    assert.equal(await cache.md5(file), md5('first'));

    await cache.save();
    const reloaded = await FileHashCache.load(cacheFile);
    assert.equal(await reloaded.md5(file), md5('first'));

    // A new modification time invalidates the entry.
    const later = new Date(mtime.getTime() + 5000);
    await utimes(file, later, later);
    assert.equal(await reloaded.md5(file), md5('other'));
  });

  it('returns null for missing files', async () => {
    const cache = await FileHashCache.load(path.join(directory, 'hashes.json'));
    assert.equal(await cache.md5(path.join(directory, 'missing.nx2')), null);
  });
});

describe('officialFileCandidates', () => {
  it('looks in the game folders and in the featured mod cache by MD5', () => {
    const candidates = officialFileCandidates(
      { baseDirectory: 'C:\\ProgramData\\FAForever', featuredModCacheDirectory: 'C:\\ProgramData\\FAForever\\cache\\featured_mod' },
      'gamedata',
      'env.nx2',
      'abc123',
    );
    assert.deepEqual(candidates, [
      path.join('C:\\ProgramData\\FAForever', 'gamedata', 'env.nx2'),
      path.join('C:\\ProgramData\\FAForever\\cache\\featured_mod', 'gamedata', 'abc123'),
    ]);
  });
});
