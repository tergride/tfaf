import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { mapLimited } from '../src/main/concurrency.ts';
import { FeaturedModCatalog } from '../src/main/game/featuredMods.ts';
import { FileHashCache } from '../src/main/game/fileHashCache.ts';
import { ParsedFileCache } from '../src/main/vault/parsedFileCache.ts';

describe('mapLimited', () => {
  it('keeps the order of results and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimited([5, 1, 4, 2, 3], 2, async (value) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, value * 2));
      running--;
      return value * 10;
    });
    assert.deepEqual(results, [50, 10, 40, 20, 30]);
    assert.equal(peak, 2);
  });
});

describe('parsed file cache', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tfaf-cache-'));
  after(() => rm(directory, { recursive: true, force: true }));

  it('parses a file again only after it changed and forgets files that are gone', async () => {
    const file = path.join(directory, 'mod_info.lua');
    await writeFile(file, 'uid = "v1"');
    const cache = new ParsedFileCache<number>();
    let parses = 0;
    const parse = async (): Promise<number> => ++parses;

    assert.equal(await cache.get(file, parse), 1);
    assert.equal(await cache.get(file, parse), 1);

    await writeFile(file, 'uid = "v2-longer"');
    assert.equal(await cache.get(file, parse), 2);

    // Same size, newer time: an edited uid of the same length must still be noticed.
    await writeFile(file, 'uid = "v3-longer"');
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    assert.equal(await cache.get(file, parse), 3);

    cache.retain(new Set());
    assert.equal(await cache.get(file, parse), 4);
    assert.equal(await cache.get(file, parse, true), 5);
  });

  it('hashes game files again when asked to verify, even if size and time look unchanged', async () => {
    const file = path.join(directory, 'units.nx2');
    await writeFile(file, 'damaged');
    const hashes = await FileHashCache.load(path.join(directory, 'hashes.json'));
    // A cache entry that matches size and time but not the content: what a damaged sector would leave behind.
    await hashes.remember(file, 'md5-of-the-good-file');

    assert.equal(await hashes.md5(file), 'md5-of-the-good-file');
    assert.equal(await hashes.md5(file, true), createHash('md5').update('damaged').digest('hex'));
  });
});

describe('featured mod catalog', () => {
  it('loads the list once for every consumer until it expires', async () => {
    let requests = 0;
    let now = 0;
    const api = {
      get: async () => {
        requests++;
        return {
          data: [
            { type: 'featuredMod', id: '0', attributes: { technicalName: 'faf', displayName: 'FAF', visible: true } },
            { type: 'featuredMod', id: '27', attributes: { technicalName: 'ladder1v1', displayName: 'Ladder', visible: false } },
          ],
        };
      },
    };
    const catalog = new FeaturedModCatalog(api, () => now);

    const [hostable, names, id] = await Promise.all([catalog.hostable(), catalog.displayNames(), catalog.idOf('ladder1v1')]);
    assert.deepEqual(hostable, [{ technicalName: 'faf', displayName: 'FAF', description: '' }]);
    assert.equal(names.get('ladder1v1'), 'Ladder');
    assert.equal(id, '27');
    assert.equal(requests, 1);

    await assert.rejects(catalog.idOf('unknown'), /Неизвестный мод игры/);
    assert.equal(requests, 1);

    now += 31 * 60 * 1000;
    await catalog.hostable();
    assert.equal(requests, 2);
  });
});
