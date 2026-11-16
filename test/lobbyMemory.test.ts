import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LobbyMemory, parseLobbyMemory, validOptions } from '../src/main/game/tfafLobby/lobbyMemory.ts';
import { createRoom, presetOf } from '../src/main/game/tfafLobby/lobbyRoom.ts';
import { roomQuality } from '../src/shared/tfafLobby.ts';
import type { LobbyOptionGroup, LobbyRoom } from '../src/shared/contract.ts';

function room(): LobbyRoom {
  return createRoom({
    host: { id: 1, login: 'alpha', clan: null, country: null, rating: 1000, mean: 1200, deviation: 60 },
    title: 'Friday',
    featuredMod: 'faf',
    factions: ['uef', 'aeon', 'cybran', 'seraphim'],
    map: { folderName: 'theta.v0001', name: 'Theta', scenario: '/maps/theta.v0001/theta_scenario.lua', spots: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], adaptive: false },
    simMods: [],
  });
}

describe('lobby memory', () => {
  let folder = '';

  before(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'tfaf-lobby-memory-'));
  });
  after(() => rm(folder, { recursive: true, force: true }));

  it('comes back after a restart', async () => {
    const file = path.join(folder, 'first.json');
    const memory = await LobbyMemory.load(file);
    memory.update({ options: { Share: 'FullShare' }, autoTeams: 'tvsb', faction: 'aeon' });
    await memory.savePreset((id) => presetOf(room(), id, 'Friday'), 'Friday');
    const loaded = await LobbyMemory.load(file);
    assert.equal(loaded.current.options.Share, 'FullShare');
    assert.equal(loaded.current.autoTeams, 'tvsb');
    assert.equal(loaded.current.faction, 'aeon');
    assert.equal(loaded.presets().presets[0]?.name, 'Friday');
  });

  it('overwrites a preset of the same name and deletes one', async () => {
    const memory = await LobbyMemory.load(path.join(folder, 'second.json'));
    await memory.savePreset((id) => presetOf(room(), id, 'Friday'), 'Friday');
    const again = await memory.savePreset((id) => ({ ...presetOf(room(), id, 'friday'), restrictions: ['T4'] }), 'friday');
    assert.equal(again.presets.length, 1);
    assert.deepEqual(again.presets[0]?.restrictions, ['T4']);
    assert.deepEqual((await memory.deletePreset(again.presets[0].id)).presets, []);
  });

  it('finds the last game under its own id', async () => {
    const memory = await LobbyMemory.load(path.join(folder, 'third.json'));
    memory.update({ lastGame: presetOf(room(), 'lastGame', 'lastGame') });
    assert.equal(memory.preset('lastGame')?.name, 'lastGame');
    assert.equal(memory.preset('other'), null);
  });

  it('survives a damaged file and keeps it aside', async () => {
    const file = path.join(folder, 'broken.json');
    await writeFile(file, 'not json');
    const memory = await LobbyMemory.load(file);
    assert.deepEqual(memory.presets(), { lastGame: null, presets: [] });
    assert.equal(await readFile(`${file}.corrupt`, 'utf8'), 'not json');
  });

  it('takes the faction an older version kept by its number as the faction of FAF', () => {
    assert.equal(parseLobbyMemory({ faction: 2 }).faction, 'aeon');
    assert.equal(parseLobbyMemory({ faction: 5 }).faction, 'random');
    assert.equal(parseLobbyMemory({ faction: 9 }).faction, null);
    assert.equal(parseLobbyMemory({ faction: 'nomads' }).faction, 'nomads');
  });

  it('drops one damaged preset and keeps the others', () => {
    const good = presetOf(room(), 'a', 'Good');
    const memory = parseLobbyMemory({ presets: [good, { id: 'b', name: 'Bad', folderName: '../outside' }], faction: '../x', autoTeams: 'sideways' });
    assert.deepEqual(memory.presets.map((preset) => preset.id), ['a']);
    assert.equal(memory.faction, null);
    assert.equal(memory.autoTeams, 'none');
  });

  it('keeps only the options the game still offers with those values', () => {
    const groups: LobbyOptionGroup[] = [
      {
        id: 'game',
        options: [
          { key: 'Share', label: '', help: '', defaultValue: 'FullShare', choices: [{ value: 'FullShare', label: '', help: '' }, { value: 'ShareUntilDeath', label: '', help: '' }] },
          { key: 'UnitCap', label: '', help: '', defaultValue: '1000', choices: [{ value: '1000', label: '', help: '' }] },
        ],
      },
    ];
    assert.deepEqual(validOptions(groups, { Share: 'ShareUntilDeath', UnitCap: '9999', Gone: 'x' }), { Share: 'ShareUntilDeath' });
    assert.deepEqual(validOptions(groups, { Share: 'FullShare' }), {});
  });
});

describe('room quality', () => {
  it('needs two sides of rated players on fixed positions', () => {
    const alone = room();
    assert.equal(roomQuality(alone), null);
    const member = { id: 2, login: 'beta', clan: null, country: null, rating: 1000, games: 10, mean: 1200, deviation: 60, ready: false, files: 'ready' as const, connected: [] };
    const seated: LobbyRoom = {
      ...alone,
      members: [...alone.members, member],
      slots: [alone.slots[0]!, { ...alone.slots[1]!, occupant: { kind: 'player', playerId: 2 } }],
    };
    const quality = roomQuality(seated);
    assert.ok(quality !== null && quality > 0.8 && quality <= 1);
    assert.equal(roomQuality({ ...seated, options: { ...seated.options, TeamSpawn: 'random' } }), null);
    assert.equal(roomQuality({ ...seated, slots: [seated.slots[0]!, { ...seated.slots[1]!, occupant: { kind: 'ai', personality: 'easy', name: 'AI' } }] }), null);
  });
});
