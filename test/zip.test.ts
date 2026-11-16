import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { installArchive, removeInstallLeftovers } from '../src/main/vault/installer.ts';
import { extractZip, ZipError } from '../src/main/vault/zip.ts';
import { buildZip } from './helpers/zipBuilder.ts';

describe('zip extraction', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'tfaf-zip-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeZip(entries: Parameters<typeof buildZip>[0]): Promise<string> {
    const zipPath = path.join(workDir, 'archive.zip');
    await writeFile(zipPath, buildZip(entries));
    return zipPath;
  }

  it('extracts stored and deflated entries into nested folders', async () => {
    const zipPath = await writeZip([
      { name: 'my_map.v0001/' },
      { name: 'my_map.v0001/my_map_scenario.lua', content: 'ScenarioInfo = {}', method: 8 },
      { name: 'my_map.v0001/env/readme.txt', content: 'stored', method: 0 },
      { name: 'my_map.v0001/empty.txt', content: '' },
    ]);
    const target = path.join(workDir, 'out');

    await extractZip(zipPath, target);

    assert.equal(await readFile(path.join(target, 'my_map.v0001', 'my_map_scenario.lua'), 'utf8'), 'ScenarioInfo = {}');
    assert.equal(await readFile(path.join(target, 'my_map.v0001', 'env', 'readme.txt'), 'utf8'), 'stored');
    assert.equal(await readFile(path.join(target, 'my_map.v0001', 'empty.txt'), 'utf8'), '');
  });

  it('rejects entries that escape the target folder', async () => {
    const zipPath = await writeZip([{ name: '../evil.txt', content: 'x' }]);
    await assert.rejects(extractZip(zipPath, path.join(workDir, 'out')), ZipError);
  });

  it('rejects absolute entry paths', async () => {
    const zipPath = await writeZip([{ name: 'C:/Windows/evil.txt', content: 'x' }]);
    await assert.rejects(extractZip(zipPath, path.join(workDir, 'out')), ZipError);
  });

  it('detects corrupted content through the CRC', async () => {
    const zipPath = await writeZip([{ name: 'mod/file.lua', content: 'data', crcOverride: 1234 }]);
    await assert.rejects(extractZip(zipPath, path.join(workDir, 'out')), /Контрольная сумма/);
  });

  it('rejects files that are not zip archives', async () => {
    const zipPath = path.join(workDir, 'not-a-zip.zip');
    await writeFile(zipPath, 'definitely not a zip archive');
    await assert.rejects(extractZip(zipPath, path.join(workDir, 'out')), ZipError);
  });

  it('replaces an existing top-level folder on install and leaves no staging folder behind', async () => {
    const target = path.join(workDir, 'mods');
    await installArchive(await writeZip([{ name: 'tfaf-sim/mod_info.lua', content: 'uid = "v1"' }]), target);
    await installArchive(await writeZip([{ name: 'tfaf-sim/mod_info.lua', content: 'uid = "v2"' }]), target);

    assert.equal(await readFile(path.join(target, 'tfaf-sim', 'mod_info.lua'), 'utf8'), 'uid = "v2"');
    assert.deepEqual(await readdir(target), ['tfaf-sim']);
  });

  it('cleans up only what interrupted installs left behind', async () => {
    const target = path.join(workDir, 'leftovers');
    for (const name of ['.tfaf-staging-abc', '.tfaf-old-123', '.tfaf-download-xyz', 'my_map.v0001', '.git']) {
      await mkdir(path.join(target, name), { recursive: true });
    }
    await removeInstallLeftovers(target);
    assert.deepEqual((await readdir(target)).sort(), ['.git', 'my_map.v0001']);
  });
});
