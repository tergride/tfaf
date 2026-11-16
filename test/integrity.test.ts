import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { installArchive } from '../src/main/vault/installer.ts';
import {
  checkFolder,
  describeProblems,
  fetchRemoteEntries,
  ManifestStore,
  manifestFromEntries,
} from '../src/main/vault/integrity.ts';
import { readZipEntries } from '../src/main/vault/zip.ts';
import { buildZip } from './helpers/zipBuilder.ts';

const isModInfo = (name: string): boolean => name === 'mod_info.lua';

const MOD_FILES = [
  { name: 'Readme.txt', content: 'outside of the mod folder' },
  { name: 'Other/notes.txt', content: 'a folder without mod_info.lua' },
  { name: 'MyMod/', content: '' },
  { name: 'MyMod/mod_info.lua', content: 'uid = "my-mod-1"' },
  { name: 'MyMod/hook/lua/sim/Unit.lua', content: 'local x = 1' },
];

let workDir = '';

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'tfaf-integrity-'));
});
after(() => rm(workDir, { recursive: true, force: true }));

async function writeZip(name: string, entries: { name: string; content: string }[]): Promise<string> {
  const file = path.join(workDir, name);
  await writeFile(file, buildZip(entries));
  return file;
}

describe('vault manifests', () => {
  it('takes the folder that holds the marker file, with paths relative to it', async () => {
    const manifest = manifestFromEntries(await readZipEntries(await writeZip('mod.zip', MOD_FILES)), isModInfo);
    assert.equal(manifest?.root, 'MyMod');
    assert.deepEqual(
      manifest?.files.map((file) => file.path),
      ['mod_info.lua', 'hook/lua/sim/unit.lua'],
    );
    assert.equal(manifestFromEntries(await readZipEntries(await writeZip('loose.zip', [MOD_FILES[0]!])), isModInfo), null);
  });

  it('finds changed, missing and, for mods, extra files', async () => {
    const zip = await writeZip('install.zip', MOD_FILES);
    const target = path.join(workDir, 'mods');
    await installArchive(zip, target);
    const folder = path.join(target, 'MyMod');
    const manifest = manifestFromEntries(await readZipEntries(zip), isModInfo);
    assert.ok(manifest);

    assert.deepEqual(await checkFolder(folder, manifest, { allowExtra: false }), []);

    // Same size, different content: only the checksum can tell.
    await writeFile(path.join(folder, 'hook', 'lua', 'sim', 'Unit.lua'), 'local y = 2');
    await writeFile(path.join(folder, 'hook', 'lua', 'extra.lua'), 'print("loaded too")');
    await writeFile(path.join(folder, 'Thumbs.db'), 'windows thumbnails');
    await unlink(path.join(folder, 'mod_info.lua'));

    const problems = await checkFolder(folder, manifest, { allowExtra: false });
    assert.deepEqual(problems, [
      { path: 'hook/lua/extra.lua', kind: 'extra' },
      { path: 'hook/lua/sim/unit.lua', kind: 'changed' },
      { path: 'mod_info.lua', kind: 'missing' },
    ]);
    assert.equal((await checkFolder(folder, manifest, { allowExtra: true })).length, 2);
    assert.match(describeProblems(problems), /hook\/lua\/extra\.lua \(лишний файл\)/);
  });

  it('keeps manifests on disk and ignores damaged ones', async () => {
    const store = new ManifestStore(path.join(workDir, 'store'));
    const manifest = { root: 'MyMod', files: [{ path: 'mod_info.lua', size: 16, crc32: 1234 }] };
    await store.put('mod', 'My-Mod-1', manifest);
    assert.deepEqual(await store.get('mod', 'my-mod-1'), manifest);
    assert.equal(await store.get('map', 'my-mod-1'), null);

    const mapStore = new ManifestStore(path.join(workDir, 'broken'));
    await mapStore.put('map', 'seton', manifest);
    const [file] = await readdir(path.join(workDir, 'broken', 'maps'));
    await writeFile(path.join(workDir, 'broken', 'maps', file ?? ''), '{"root": 1}');
    assert.equal(await mapStore.get('map', 'seton'), null);
  });
});

describe('manifests from the content server', () => {
  let server: http.Server;
  let baseUrl = '';
  const archives = new Map<string, Buffer>();
  const requests: string[] = [];
  let honourRanges = true;

  before(async () => {
    server = http.createServer((request, response) => {
      const archive = archives.get(request.url ?? '');
      requests.push(request.headers.range ?? 'full');
      if (!archive) {
        response.writeHead(404).end();
        return;
      }
      const suffix = /^bytes=-(\d+)$/.exec(request.headers.range ?? '');
      const span = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      if (!honourRanges || (!suffix && !span)) {
        response.writeHead(200, { 'Content-Length': archive.length }).end(archive);
        return;
      }
      const start = suffix ? Math.max(0, archive.length - Number(suffix[1])) : Number(span?.[1]);
      const end = suffix ? archive.length - 1 : Math.min(archive.length - 1, Number(span?.[2]));
      response
        .writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${archive.length}`, 'Content-Length': end - start + 1 })
        .end(archive.subarray(start, end + 1));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reads the entries from the end of the archive alone', async () => {
    const archive = buildZip(MOD_FILES);
    archives.set('/small.zip', archive);
    requests.length = 0;
    const local = path.join(workDir, 'small.zip');
    await writeFile(local, archive);
    assert.deepEqual(await fetchRemoteEntries(`${baseUrl}/small.zip`, 'test'), await readZipEntries(local));
    assert.equal(requests.length, 1);
  });

  it('asks for the central directory separately when it does not fit into the tail', async () => {
    const many = Array.from({ length: 1500 }, (_, index) => ({
      name: `BigMap/textures/a-rather-long-texture-file-name-${index}.dds`,
      content: '',
    }));
    archives.set('/big.zip', buildZip([{ name: 'BigMap/bigmap_scenario.lua', content: 'x' }, ...many]));
    requests.length = 0;
    const entries = await fetchRemoteEntries(`${baseUrl}/big.zip`, 'test');
    assert.equal(entries?.length, 1501);
    assert.equal(requests.length, 2);
    assert.match(requests[1] ?? '', /^bytes=\d+-\d+$/);
  });

  it('returns null for archives the server does not have and copes with servers that ignore ranges', async () => {
    assert.equal(await fetchRemoteEntries(`${baseUrl}/missing.zip`, 'test'), null);
    honourRanges = false;
    try {
      assert.equal((await fetchRemoteEntries(`${baseUrl}/small.zip`, 'test'))?.length, MOD_FILES.length);
    } finally {
      honourRanges = true;
    }
  });
});

describe('installed folders', () => {
  it('reads a damaged folder against the manifest of a fresh install', async () => {
    const zip = await writeZip('map.zip', [
      { name: 'seton.v0001/seton_scenario.lua', content: 'ScenarioInfo = {}' },
      { name: 'seton.v0001/seton.scmap', content: 'terrain' },
    ]);
    const maps = path.join(workDir, 'maps');
    await mkdir(maps, { recursive: true });
    await installArchive(zip, maps);
    const manifest = manifestFromEntries(await readZipEntries(zip), (name) => name.endsWith('_scenario.lua'));
    assert.ok(manifest);
    await writeFile(path.join(maps, 'seton.v0001', 'seton.scmap'), 'terrAin');
    assert.deepEqual(await checkFolder(path.join(maps, 'seton.v0001'), manifest, { allowExtra: true }), [
      { path: 'seton.scmap', kind: 'changed' },
    ]);
    assert.equal(await readFile(path.join(maps, 'seton.v0001', 'seton_scenario.lua'), 'utf8'), 'ScenarioInfo = {}');
  });
});
