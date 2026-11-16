import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { existingLocalPreviewUrl, localPreviewUrl, serveLocalPreview } from '../src/main/vault/mapPreviews.ts';

const MAP = 'neroxis_map_generator_1.12.0_abc d';

let maps = '';

async function open(url: string): Promise<{ status: number; body: string; type: string | null }> {
  const response = await serveLocalPreview(maps, new Request(url));
  return { status: response.status, body: await response.text(), type: response.headers.get('content-type') };
}

describe('local map previews', () => {
  beforeEach(async () => {
    maps = await mkdtemp(path.join(os.tmpdir(), 'tfaf-map-previews-'));
    await mkdir(path.join(maps, MAP));
    await writeFile(path.join(maps, MAP, `${MAP}_preview.png`), 'png');
  });
  afterEach(() => rm(maps, { recursive: true, force: true }));

  it('serves the picture the generator put into the map folder', async () => {
    assert.equal(existingLocalPreviewUrl(maps, MAP), localPreviewUrl(MAP));
    assert.deepEqual(await open(localPreviewUrl(MAP)), { status: 200, body: 'png', type: 'image/png' });
  });

  it('has nothing for a map without the picture', async () => {
    await mkdir(path.join(maps, 'seton'));
    assert.equal(existingLocalPreviewUrl(maps, 'seton'), null);
    assert.equal(existingLocalPreviewUrl(maps, 'missing'), null);
    assert.equal((await open(localPreviewUrl('seton'))).status, 404);
  });

  it('reads only map folders inside the maps folder', async () => {
    assert.equal(existingLocalPreviewUrl(maps, '..'), null);
    for (const url of [
      'tfaf-map-preview://maps/..%2Fsecret',
      'tfaf-map-preview://maps/%2E%2E',
      'tfaf-map-preview://other/secret',
      'tfaf-map-preview://maps/%E0%A4%A',
    ]) {
      assert.equal((await open(url)).status, 404, url);
    }
  });
});
