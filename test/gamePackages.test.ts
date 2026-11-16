import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadPackageStrings } from '../src/main/gameOptions/gameFiles.ts';
import { gamePackages } from '../src/main/gameOptions/gamePackages.ts';
import { readBannedMods } from '../src/main/gameOptions/lobbyCatalog.ts';
import { GameFileSystem } from '../src/main/mapView/gameFileSystem.ts';
import type { Settings } from '../src/shared/contract.ts';
import { buildZip } from './helpers/zipBuilder.ts';

describe('game packages', () => {
  const data = path.join('C:', 'data');
  const game = path.join('C:', 'game');
  const names = (featuredMod: string): string[] => gamePackages(featuredMod, data, game).archives.map((file) => path.relative(data, file).replace(/\\/g, '/'));

  it('lay FAF and its test builds out by the extension of their packages, before the packages of the game', () => {
    for (const [featuredMod, extension] of [['faf', 'nx2'], ['fafbeta', 'nx4'], ['fafdevelop', 'nx5']] as const) {
      const archives = names(featuredMod);
      assert.equal(archives[0], `gamedata/effects.${extension}`);
      assert.ok(archives.includes(`gamedata/lua.${extension}`));
      assert.ok(archives.indexOf(`gamedata/units.${extension}`) < archives.findIndex((file) => file.endsWith('units.scd')));
      assert.deepEqual(gamePackages(featuredMod, data, game).hooks, []);
    }
    assert.ok(!names('faf').some((file) => /lua\.scd|schook/.test(file)));
  });

  it('put Nomads over everything FAF mounts and add its hook folder', () => {
    const archives = names('nomads');
    assert.equal(archives[0], 'gamedata/units.nmd');
    assert.ok(archives.indexOf('gamedata/lua.nmd') < archives.indexOf('gamedata/lua.nx2'));
    assert.deepEqual(gamePackages('nomads', data, game).hooks, ['/nomadhook']);
  });

  it('leave the game packages out without the game', () => {
    assert.ok(!gamePackages('faf', data, null).archives.some((file) => file.endsWith('.scd')));
  });
});

describe('packages of a featured mod', () => {
  let workDir = '';

  before(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'tfaf-game-packages-'));
    const gamedata = path.join(workDir, 'gamedata');
    await mkdir(gamedata);
    await writeFile(
      path.join(gamedata, 'lua.nx2'),
      buildZip([
        { name: 'lua/ui/lobby/aiNames.lua', content: 'ainames = { uef = { "Ann" } }' },
        { name: 'lua/factions.lua', content: 'Factions = "faf"' },
      ]),
    );
    await writeFile(path.join(gamedata, 'loc.nx2'), buildZip([{ name: 'loc/US/strings_db.lua', content: 'a_1 = "Spawn"\n' }]));
    await writeFile(path.join(gamedata, 'etc.nx2'), buildZip([{ name: 'etc/faf/blacklist.lua', content: `Blacklist = {\n    ['AB-CD'] = "bad",\n}\n` }]));
    await writeFile(path.join(gamedata, 'lua.nmd'), buildZip([{ name: 'lua/factions.lua', content: 'Factions = "nomads"' }]));
    await writeFile(
      path.join(gamedata, 'nomadhook.nmd'),
      buildZip([
        { name: 'nomadhook/lua/ui/lobby/aiNames.lua', content: 'ainames.nomads = { "Bob" }' },
        { name: 'nomadhook/etc/faf/blacklist.lua', content: `local Nomads = "old"\nBlacklist['EF-GH'] = Nomads` },
      ]),
    );
  });
  after(() => rm(workDir, { recursive: true, force: true }));

  const files = (featuredMod: string): GameFileSystem =>
    new GameFileSystem({ get: () => ({ dataPath: workDir, gamePath: null }) as Settings, mapsDirectory: workDir }, ({ dataPath, gamePath }) =>
      gamePackages(featuredMod, dataPath, gamePath),
    );

  it('read a script from the first package that has it', async () => {
    assert.equal(await files('faf').script('/lua/factions.lua'), 'Factions = "faf"');
    assert.equal(await files('nomads').script('lua/factions.lua'), 'Factions = "nomads"');
    assert.equal(await files('faf').script('/lua/missing.lua'), null);
  });

  it('append the hooks of the featured mod to a script, as the game does', async () => {
    assert.equal(await files('faf').script('/lua/ui/lobby/aiNames.lua'), 'ainames = { uef = { "Ann" } }');
    assert.equal(await files('nomads').script('/lua/ui/lobby/aiNames.lua'), 'ainames = { uef = { "Ann" } }\nainames.nomads = { "Bob" }');
    assert.deepEqual(await readBannedMods(files('faf')), ['ab-cd']);
    assert.deepEqual(await readBannedMods(files('nomads')), ['ab-cd', 'ef-gh']);
  });

  it('take the strings from the packages beneath when the featured mod brings none', async () => {
    const strings = await loadPackageStrings(files('nomads'));
    assert.equal(strings.get('US')?.get('a_1'), 'Spawn');
  });

  it('find nothing of a featured mod whose packages are not there', async () => {
    assert.equal(await files('fafdevelop').script('/lua/factions.lua'), null);
    assert.deepEqual(await readBannedMods(files('fafdevelop')), []);
  });
});
