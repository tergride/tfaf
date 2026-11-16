import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseGameReviews, parseVersionReviews, reviewDocument } from '../src/main/vault/reviews.ts';
import type { ScenarioInfo } from '../src/main/vault/scenarioReader.ts';
import { checkMapFolder, checkModInfo, readScmapPreview } from '../src/main/vault/uploads.ts';
import { extractZip, readZipEntries } from '../src/main/vault/zip.ts';
import { zipFolder } from '../src/main/vault/zipWriter.ts';

function scenario(overrides: Partial<ScenarioInfo> = {}): ScenarioInfo {
  return {
    name: 'Seton',
    description: '',
    type: 'skirmish',
    widthPx: 512,
    heightPx: 512,
    maxPlayers: 2,
    version: '3',
    files: {
      map: '/maps/seton.v0003/seton.scmap',
      save: '/maps/seton.v0003/seton_save.lua',
      script: '/maps/seton.v0003/seton_script.lua',
    },
    ...overrides,
  };
}

describe('zip writer', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'tfaf-zip-writer-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('zips a folder under its own name and reads back the same files', async () => {
    const folder = path.join(workDir, 'seton.v0003');
    await mkdir(path.join(folder, 'env', 'decals'), { recursive: true });
    const binary = randomBytes(200_000);
    await writeFile(path.join(folder, 'seton_scenario.lua'), 'ScenarioInfo = {}');
    await writeFile(path.join(folder, 'seton.scmap'), binary);
    await writeFile(path.join(folder, 'env', 'decals', 'ünïcode.dds'), 'decal');
    await writeFile(path.join(folder, 'empty.txt'), '');
    await writeFile(path.join(folder, 'Thumbs.db'), 'junk');
    await writeFile(path.join(folder, 'desktop.ini'), 'junk');
    const zip = path.join(workDir, 'out.zip');
    const progress: number[] = [];

    await zipFolder(folder, zip, { onProgress: (fraction) => progress.push(fraction) });

    const entries = await readZipEntries(zip);
    assert.deepEqual(entries.map((entry) => entry.name).sort(), [
      'seton.v0003/empty.txt',
      'seton.v0003/env/decals/ünïcode.dds',
      'seton.v0003/seton.scmap',
      'seton.v0003/seton_scenario.lua',
    ]);
    assert.equal(progress.at(-1), 1);
    const target = path.join(workDir, 'unpacked');
    await extractZip(zip, target);
    assert.deepEqual(await readFile(path.join(target, 'seton.v0003', 'seton.scmap')), binary);
    assert.equal(await readFile(path.join(target, 'seton.v0003', 'env', 'decals', 'ünïcode.dds'), 'utf8'), 'decal');
    assert.equal(await readFile(path.join(target, 'seton.v0003', 'empty.txt'), 'utf8'), '');
  });

  it('stops when cancelled', async () => {
    const folder = path.join(workDir, 'mod');
    await mkdir(folder);
    await writeFile(path.join(folder, 'mod_info.lua'), 'uid = "x"');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(zipFolder(folder, path.join(workDir, 'out.zip'), { signal: controller.signal }));
  });
});

describe('upload checks', () => {
  const files = ['seton_scenario.lua', 'seton.scmap', 'seton_save.lua', 'seton_script.lua'];

  it('accepts a complete map folder', () => {
    assert.deepEqual(checkMapFolder('seton.v0003', files, scenario()), { problems: [], warnings: [] });
  });

  it('finds missing files and a missing version', () => {
    const checks = checkMapFolder('seton.v0003', ['seton_scenario.lua', 'seton.scmap'], scenario({ version: null }));
    assert.equal(checks.problems.length, 3);
  });

  it('warns about a folder name that does not match the version or the scenario paths', () => {
    // The paths in the scenario point to seton.v0003 as well.
    assert.equal(checkMapFolder('seton.v0002', files, scenario()).warnings.length, 2);
    assert.equal(checkMapFolder('seton', files, scenario()).warnings.length, 2);
    assert.deepEqual(checkMapFolder('seton.v0002', files, scenario()).problems, []);
  });

  it('wants a whole number as the mod version', () => {
    const mod = { uid: 'x', name: 'Mod', version: '2', author: '', description: '', uiOnly: false, icon: null };
    assert.deepEqual(checkModInfo(mod).problems, []);
    assert.equal(checkModInfo({ ...mod, version: '1.5' }).problems.length, 1);
    assert.equal(checkModInfo({ ...mod, version: null }).problems.length, 1);
  });

  it('reads the uncompressed preview of a .scmap file', () => {
    const width = 2;
    const height = 2;
    const dds = Buffer.alloc(128 + width * height * 4);
    dds.writeUInt32LE(0x20534444, 0);
    dds.writeUInt32LE(124, 4);
    dds.writeUInt32LE(height, 12);
    dds.writeUInt32LE(width, 16);
    dds.writeUInt32LE(32, 76);
    dds.writeUInt32LE(32, 88);
    dds.writeUInt32LE(0x00ff0000, 92);
    dds.writeUInt32LE(0x0000ff00, 96);
    dds.writeUInt32LE(0x000000ff, 100);
    dds.writeUInt32LE(0, 104);
    dds.fill(0x40, 128);
    const header = Buffer.alloc(34);
    header.writeUInt32LE(0x1a70614d, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(dds.length, 30);

    const preview = readScmapPreview(Buffer.concat([header, dds, Buffer.from([1, 2, 3])]));

    assert.equal(preview?.width, 2);
    assert.equal(preview?.height, 2);
    // Without an alpha mask the pixels are made opaque.
    assert.deepEqual([...preview.bgra.subarray(0, 4)], [0x40, 0x40, 0x40, 0xff]);
    assert.equal(readScmapPreview(Buffer.from('not a map at all, really not a map file')), null);
  });
});

describe('reviews', () => {
  it('reads map reviews over all versions, own first', () => {
    const reviews = parseVersionReviews(
      {
        data: [
          { type: 'mapVersion', id: '10', attributes: { version: '1' }, relationships: { reviews: { data: [{ type: 'mapVersionReview', id: 'r1' }] } } },
          { type: 'mapVersion', id: '11', attributes: { version: '2' }, relationships: { reviews: { data: [{ type: 'mapVersionReview', id: 'r2' }] } } },
        ],
        included: [
          { type: 'mapVersionReview', id: 'r1', attributes: { text: 'Old', score: 3, updateTime: '2026-01-01T00:00:00Z' }, relationships: { player: { data: { type: 'player', id: '7' } } } },
          { type: 'mapVersionReview', id: 'r2', attributes: { text: 'New', score: 5, updateTime: '2026-02-01T00:00:00Z' }, relationships: { player: { data: { type: 'player', id: '8' } } } },
          { type: 'player', id: '7', attributes: { login: 'Me' } },
          { type: 'player', id: '8', attributes: { login: 'Other' } },
        ],
      },
      7,
    );
    assert.deepEqual(
      reviews.map(({ id, author, own, versionId, version, score }) => ({ id, author, own, versionId, version, score })),
      [
        { id: 'r1', author: 'Me', own: true, versionId: 10, version: '1', score: 3 },
        { id: 'r2', author: 'Other', own: false, versionId: 11, version: '2', score: 5 },
      ],
    );
  });

  it('reads game reviews', () => {
    const reviews = parseGameReviews(
      {
        data: [{ type: 'gameReview', id: 'g1', attributes: { text: 'GG', score: 4 }, relationships: { player: { data: { type: 'player', id: '8' } } } }],
        included: [{ type: 'player', id: '8', attributes: { login: 'Other' } }],
      },
      null,
    );
    assert.deepEqual(reviews[0], { id: 'g1', text: 'GG', score: 4, author: 'Other', own: false, versionId: null, version: null, updatedAt: null });
  });

  it('serializes new and changed reviews', () => {
    assert.deepEqual(reviewDocument('map', { text: 'Nice', score: 5 }, 7, null), {
      data: { type: 'mapVersionReview', attributes: { text: 'Nice', score: 5 }, relationships: { player: { data: { type: 'player', id: '7' } } } },
    });
    assert.deepEqual(reviewDocument('game', { text: '', score: 2 }, 7, '99'), {
      data: { type: 'gameReview', id: '99', attributes: { text: '', score: 2 } },
    });
  });
});
