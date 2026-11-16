import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  decodePortablePaths,
  encodePortablePaths,
  findPortableStorage,
  PORTABLE_MARKER,
  preparePortableStorage,
} from '../src/main/storagePaths.ts';
import type { Settings } from '../src/shared/contract.ts';

describe('portable storage', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-portable-storage-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('requires the marker next to a packaged executable', async () => {
    const executable = path.join(directory, 'TFAF.exe');
    assert.equal(findPortableStorage(executable, true), null);
    await writeFile(path.join(directory, PORTABLE_MARKER), '');
    assert.equal(findPortableStorage(executable, false), null);
    const storage = findPortableStorage(executable, true);
    assert.ok(storage);
    assert.equal(storage.prefsFile, path.join(directory, 'portable-data', 'prefs', 'TFAF.prefs'));
    assert.equal(storage.profileDirectory, path.join(directory, 'portable-data', 'profile'));
    assert.equal(existsSync(storage.profileDirectory), false);
  });

  it('does not fall back to an ordinary profile for a malformed marker', async () => {
    await mkdir(path.join(directory, PORTABLE_MARKER));
    assert.throws(() => findPortableStorage(path.join(directory, 'TFAF.exe'), true), /regular file/);
  });

  it('prepares separate writable folders without retaining probe files', async () => {
    await writeFile(path.join(directory, PORTABLE_MARKER), '');
    const storage = findPortableStorage(path.join(directory, 'TFAF.exe'), true)!;
    preparePortableStorage(storage);
    for (const folder of [storage.profileDirectory, storage.sessionDirectory, storage.tempDirectory, storage.dataDirectory]) {
      assert.deepEqual(await readdir(folder), []);
    }
    await writeFile(path.join(storage.profileDirectory, 'settings.json'), '{"theme":"aeon"}');
    preparePortableStorage(storage);
    assert.deepEqual(await readdir(storage.profileDirectory), ['settings.json']);
  });

  it('fails before profile initialization when portable-data cannot be a writable folder', async () => {
    await writeFile(path.join(directory, PORTABLE_MARKER), '');
    await writeFile(path.join(directory, 'portable-data'), 'existing user file');
    const storage = findPortableStorage(path.join(directory, 'TFAF.exe'), true)!;
    assert.throws(() => preparePortableStorage(storage));
    assert.equal(existsSync(storage.profileDirectory), false);
  });

  it('moves internal paths to a new root while keeping explicitly external paths', () => {
    const root = path.join(directory, 'original');
    const moved = path.join(directory, 'moved copy');
    const settings = {
      gamePath: path.join(root, 'Forged Alliance'),
      vaultPath: path.join(root, 'portable-data', 'vault'),
      dataPath: path.join(directory, 'external-game-data'),
      gamePrefsPath: path.join(root, 'portable-data', 'prefs', 'TFAF.prefs'),
      theme: 'aeon',
    } as Settings;
    const stored = encodePortablePaths(settings, root);
    assert.equal(stored.vaultPath, 'portable-data/vault');
    assert.equal(stored.dataPath, settings.dataPath);
    assert.equal(settings.vaultPath, path.join(root, 'portable-data', 'vault'));
    assert.deepEqual(decodePortablePaths(JSON.parse(JSON.stringify(stored)), moved), {
      ...settings,
      gamePath: path.join(moved, 'Forged Alliance'),
      vaultPath: path.join(moved, 'portable-data', 'vault'),
      gamePrefsPath: path.join(moved, 'portable-data', 'prefs', 'TFAF.prefs'),
    });
  });

  it('handles the root itself and avoids confusing sibling folders with child paths', () => {
    const root = path.join(directory, 'TFAF');
    const settings = {
      gamePath: null,
      dataPath: root,
      vaultPath: path.join(directory, 'TFAF-external', 'vault'),
      gamePrefsPath: path.join(root, 'portable-data', 'prefs', 'TFAF.prefs'),
    } as Settings;
    const stored = encodePortablePaths(settings, root);
    assert.equal(stored.dataPath, '.');
    assert.equal(stored.gamePath, null);
    assert.equal(stored.vaultPath, settings.vaultPath);
    assert.deepEqual(decodePortablePaths(stored, root), settings);
  });

  it('rejects relative paths escaping the portable root, preserving explicit absolute paths', () => {
    const external = path.join(directory, 'external');
    assert.deepEqual(decodePortablePaths({ dataPath: '../other', vaultPath: external, gamePath: null }, directory), {
      dataPath: null,
      vaultPath: external,
      gamePath: null,
    });
    assert.equal(decodePortablePaths(null, directory), null);
    if (process.platform === 'win32') {
      assert.deepEqual(decodePortablePaths({ gamePath: 'C:Games' }, directory), { gamePath: null });
    }
  });
});
