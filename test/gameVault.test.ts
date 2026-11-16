import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GameVault, type InstalledModFolder, removeGameVault, selectGameMods } from '../src/main/game/gameVault.ts';
import { pathExists } from '../src/main/vault/fsUtil.ts';

const RESOURCE_RICH = '74A9EAB2-E851-11DB-A1F1-F2C755D89593';

const INSTALLED: InstalledModFolder[] = [
  { uid: 'game-sim', type: 'SIM', active: false, path: 'mods/GameSim' },
  { uid: 'other-sim', type: 'SIM', active: true, path: 'mods/shields' },
  { uid: 'active-ui', type: 'UI', active: true, path: 'mods/ActiveUi' },
  { uid: 'inactive-ui', type: 'UI', active: false, path: 'mods/InactiveUi' },
  { uid: RESOURCE_RICH, type: 'SIM', active: true, path: 'mods/Resource Rich' },
];

describe('selectGameMods', () => {
  it('takes the sim mods of a lobby game and the active UI mods, never a built-in mod', () => {
    assert.deepEqual(selectGameMods(INSTALLED, ['game-sim', RESOURCE_RICH]), ['mods/GameSim', 'mods/ActiveUi']);
  });
});

describe('GameVault', () => {
  let workDir = '';
  let session = '';
  let maps = '';
  let modA = '';
  let modB = '';

  before(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'tfaf-game-vault-'));
    session = path.join(workDir, 'data', 'game-session');
    maps = path.join(workDir, 'vault', 'maps');
    modA = path.join(workDir, 'vault', 'mods', 'TM28AI');
    modB = path.join(workDir, 'vault', 'mods', 'Ultra Shields');
    for (const [folder, file] of [
      [path.join(maps, 'theta'), 'theta_scenario.lua'],
      [modA, 'mod_info.lua'],
      [modB, 'mod_info.lua'],
    ] as const) {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, file), 'content');
    }
  });
  after(() => rm(workDir, { recursive: true, force: true }));

  const layout = (modFolders: string[]) => ({
    directory: session,
    binDirectory: 'C:\\ProgramData\\TFAF\\bin',
    mapsDirectory: maps,
    modFolders,
  });

  it('links the maps folder and the given mods and writes an init file that mounts them', async () => {
    const vault = new GameVault();
    const initFile = await vault.prepare(layout([modA, modB]));

    assert.equal(initFile, path.join(session, 'init.lua'));
    const init = await readFile(initFile, 'utf8');
    assert.match(init, /^InitFileDir = "C:\/ProgramData\/TFAF\/bin"$/m);
    assert.ok(init.includes(`custom_vault_path = "${path.join(session, 'vault').replace(/\\/g, '/')}"`));
    assert.match(init, /^TfafDofile\(InitFileDir \.\. "\/init\.lua"\)$/m);
    assert.deepEqual((await readdir(path.join(session, 'vault', 'mods'))).sort(), ['TM28AI', 'Ultra Shields']);
    assert.equal(await readFile(path.join(session, 'vault', 'mods', 'TM28AI', 'mod_info.lua'), 'utf8'), 'content');
    assert.equal(await readFile(path.join(session, 'vault', 'maps', 'theta', 'theta_scenario.lua'), 'utf8'), 'content');

    await vault.release();
    assert.equal(await pathExists(session), false);
    assert.equal(await readFile(path.join(modA, 'mod_info.lua'), 'utf8'), 'content');
    assert.equal(await readFile(path.join(maps, 'theta', 'theta_scenario.lua'), 'utf8'), 'content');
  });

  it('replaces what an earlier game left behind and links one folder per name', async () => {
    await new GameVault().prepare(layout([modA, modB]));
    const duplicate = path.join(workDir, 'pack', 'tm28ai');
    await mkdir(duplicate, { recursive: true });

    await new GameVault().prepare(layout([modB, duplicate, modA]));

    assert.deepEqual((await readdir(path.join(session, 'vault', 'mods'))).sort(), ['Ultra Shields', 'tm28ai']);
    await removeGameVault(session);
    assert.equal(await pathExists(modA), true);
  });

  it('refuses to empty a real folder where a link is expected', async () => {
    const copy = path.join(session, 'vault', 'mods', 'Copied');
    await mkdir(copy, { recursive: true });
    await writeFile(path.join(copy, 'mod_info.lua'), 'kept');

    await assert.rejects(removeGameVault(session));
    assert.equal(await readFile(path.join(copy, 'mod_info.lua'), 'utf8'), 'kept');
  });
});
