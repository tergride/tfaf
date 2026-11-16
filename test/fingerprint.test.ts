import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  compareFingerprints,
  compareWithHost,
  differenceKeys,
  digestLines,
  filesDigest,
  folderDigest,
  type GameFingerprint,
  mapKey,
  type ModFingerprint,
  modKey,
  modsDigest,
} from '../src/main/game/fingerprint.ts';
import { manifestFromEntries } from '../src/main/vault/integrity.ts';
import { extractZip, readZipEntries } from '../src/main/vault/zip.ts';
import { buildZip } from './helpers/zipBuilder.ts';

describe('game file fingerprints', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-fingerprint-test-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('gives a map the same digest from the vault archive and from the folder on disk', async () => {
    const archive = path.join(directory, 'map.zip');
    await writeFile(
      archive,
      buildZip([
        { name: 'Setons.v0003/' },
        { name: 'Setons.v0003/Setons_scenario.lua', content: 'ScenarioInfo = {}', method: 8 },
        { name: 'Setons.v0003/Setons.scmap', content: 'height map' },
      ]),
    );
    const manifest = manifestFromEntries(await readZipEntries(archive), (file) => file.endsWith('_scenario.lua'));
    assert.ok(manifest);
    await extractZip(archive, directory);
    const folder = path.join(directory, 'Setons.v0003');
    // Windows and macOS drop these on their own; they must not count.
    await writeFile(path.join(folder, 'Thumbs.db'), 'thumbnails');

    assert.equal(await folderDigest(folder), filesDigest(manifest.files));
    await writeFile(path.join(folder, 'Setons.scmap'), 'edited height map');
    assert.notEqual(await folderDigest(folder), filesDigest(manifest.files));
    assert.equal(await folderDigest(path.join(directory, 'missing')), null);
  });

  it('combines sim mods regardless of order and compares each part', () => {
    assert.equal(
      modsDigest([
        { uid: 'a', digest: '01' },
        { uid: 'b', digest: '02' },
      ]),
      modsDigest([
        { uid: 'b', digest: '02' },
        { uid: 'a', digest: '01' },
      ]),
    );
    assert.equal(modsDigest([{ uid: 'a', digest: null }]), null);

    const local = { gameFiles: 'g1', map: 'm1', mapKey: null, mods: null, modFiles: null };
    assert.deepEqual(compareFingerprints(local, { gameFiles: 'g1', map: 'm2', mapKey: null, mods: 'x', modFiles: null }), {
      gameFiles: 'same',
      map: 'different',
      mods: 'unknown',
    });
    assert.deepEqual(compareFingerprints(null, { gameFiles: 'g1', map: null, mapKey: null, mods: null, modFiles: null }), {
      gameFiles: 'unknown',
      map: 'unknown',
      mods: 'unknown',
    });
  });
});

describe('files compared with the host', () => {
  const shields = modKey('E08710C8-B785-11E4-9CA4-35FF1C5D46B0');
  const resources = modKey('resource-rich');
  const names = new Map([
    [shields, 'Exp Shields'],
    [resources, 'Resource Rich'],
  ]);
  const files = (map: string, shieldsDigest: string | null, extra: ModFingerprint[] = []): GameFingerprint => {
    const modFiles = [{ key: shields, digest: shieldsDigest }, { key: resources, digest: 'r1' }, ...extra];
    const known = modFiles.every((mod) => mod.digest !== null);
    return { gameFiles: 'g1', map, mapKey: null, mods: known ? digestLines(modFiles.map((mod) => `${mod.key}:${mod.digest ?? ''}`)) : null, modFiles };
  };

  it('names what differs from the host for every other player', () => {
    const report = compareWithHost(
      'Host',
      [
        { playerId: 1, login: 'host', fingerprint: files('m1', 's1') },
        { playerId: 2, login: 'Same', fingerprint: files('m1', 's1') },
        { playerId: 3, login: 'Different', fingerprint: files('m2', 's2', [{ key: modKey('stray'), digest: 'x' }]) },
        { playerId: 4, login: 'Official', fingerprint: null },
        { playerId: 5, login: 'Unreadable', fingerprint: files('m1', null) },
      ],
      names,
    );
    assert.deepEqual(report.host, { playerId: 1, login: 'host', known: true });
    assert.deepEqual(
      report.players.map(({ login, gameFiles, map, mods, differentMods }) => ({ login, gameFiles, map, mods, differentMods })),
      [
        { login: 'Same', gameFiles: 'same', map: 'same', mods: 'same', differentMods: [] },
        // A mod the host does not have counts, but cannot be named.
        { login: 'Different', gameFiles: 'same', map: 'different', mods: 'different', differentMods: ['Exp Shields', null] },
        { login: 'Official', gameFiles: 'unknown', map: 'unknown', mods: 'unknown', differentMods: [] },
        // A mod the player could not read is not known to differ.
        { login: 'Unreadable', gameFiles: 'same', map: 'same', mods: 'unknown', differentMods: [] },
      ],
    );
    assert.deepEqual([...differenceKeys(report)].sort(), ['3:map', '3:mod:?', '3:mod:Exp Shields', '3:mods']);
  });

  it('compares only the mods ticked in the lobby, so unticking one needs no restart', () => {
    const tm28 = modKey('tm28');
    const RESOURCE_RICH = '74A9EAB2-E851-11DB-A1F1-F2C755D89593';
    // The host started with TM28 and Exp Shields and unticked Exp Shields; a later player only has TM28.
    const host = { gameFiles: 'g1', map: 'm1', mapKey: null, mods: 'all-host', modFiles: [{ key: tm28, digest: 't1' }, { key: shields, digest: 's1' }] };
    const late = { gameFiles: 'g1', map: 'm1', mapKey: null, mods: 'all-late', modFiles: [{ key: tm28, digest: 't1' }] };
    const changed = { ...late, modFiles: [{ key: tm28, digest: 't2' }] };
    const report = compareWithHost(
      'host',
      [
        { playerId: 1, login: 'host', fingerprint: host },
        { playerId: 2, login: 'late', fingerprint: late },
        { playerId: 3, login: 'changed', fingerprint: changed },
      ],
      new Map(),
      [
        { uid: 'tm28', name: 'TM28AI' },
        { uid: RESOURCE_RICH, name: 'Resource Rich' },
      ],
    );
    assert.deepEqual(
      report.players.map(({ login, mods, differentMods }) => ({ login, mods, differentMods })),
      [
        { login: 'late', mods: 'same', differentMods: [] },
        // Named after the lobby's list, which also names mods we do not have.
        { login: 'changed', mods: 'different', differentMods: ['TM28AI'] },
      ],
    );
    // Ticked again, Exp Shields counts once more; the player has not checked it yet, so it is not known to differ.
    const lobby = [
      { uid: 'tm28', name: 'TM28AI' },
      { uid: 'E08710C8-B785-11E4-9CA4-35FF1C5D46B0', name: 'Exp Shields' },
    ];
    const ticked = compareWithHost('host', [{ playerId: 1, login: 'host', fingerprint: host }, { playerId: 2, login: 'late', fingerprint: late }], names, lobby);
    assert.deepEqual(ticked.players.map(({ mods, differentMods }) => ({ mods, differentMods })), [{ mods: 'unknown', differentMods: [] }]);
    // Once its launcher checked the mod in the lobby, it compares like any other.
    const checked = { ...late, modFiles: [...late.modFiles, { key: shields, digest: 's2' }] };
    const after = compareWithHost('host', [{ playerId: 1, login: 'host', fingerprint: host }, { playerId: 2, login: 'late', fingerprint: checked }], names, lobby);
    assert.deepEqual(after.players.map(({ mods, differentMods }) => ({ mods, differentMods })), [{ mods: 'different', differentMods: ['Exp Shields'] }]);
  });

  it('does not hold a map against a player who has not caught up with the lobby yet', () => {
    const report = (playerFiles: GameFingerprint) =>
      compareWithHost(
        'host',
        [
          { playerId: 1, login: 'host', fingerprint: { ...files('digest-b', 's1'), mapKey: mapKey('Map-B') } },
          { playerId: 2, login: 'guest', fingerprint: playerFiles },
        ],
        names,
      );

    const downloading = report({ ...files('digest-a', 's1'), mapKey: mapKey('map-a') });
    assert.equal(downloading.players[0]?.map, 'unknown');
    assert.equal(differenceKeys(downloading).size, 0);

    assert.equal(report({ ...files('digest-b', 's1'), mapKey: mapKey('map-b') }).players[0]?.map, 'same');

    const stillDifferent = report({ ...files('digest-other', 's1'), mapKey: mapKey('map-b') });
    assert.equal(stillDifferent.players[0]?.map, 'different');
    assert.deepEqual([...differenceKeys(stillDifferent)], ['2:map']);

    // An older TFAF does not say which map it means, so its digest decides.
    assert.equal(report(files('digest-a', 's1')).players[0]?.map, 'different');
  });

  it('compares nothing without the host files', () => {
    const players = [
      { playerId: 1, login: 'host', fingerprint: null },
      { playerId: 2, login: 'guest', fingerprint: files('m1', 's1') },
    ];
    const report = compareWithHost('host', players, names);
    assert.deepEqual(report.host, { playerId: 1, login: 'host', known: false });
    assert.equal(report.players[0]?.map, 'unknown');
    assert.equal(differenceKeys(report).size, 0);
    assert.deepEqual(compareWithHost(null, players, names).host, null);
  });
});
