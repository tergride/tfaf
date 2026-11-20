// A TFAF room carries the recipe of its StoneMap map, so players without the map make it; the recipe comes from the
// host and is checked like any input from another player.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRoom, type NewMember } from '../src/main/game/tfafLobby/lobbyRoom.ts';
import { parseLobbyMessage, serializeLobbyMessage } from '../src/main/game/tfafLobby/lobbyWire.ts';
import { parseStoneMapRecipe, readStoneMapRecipe } from '../src/main/stoneMap/stoneMapRecipe.ts';
import { isStoneMapFolder, type LobbyMap, type StoneMapRecipe } from '../src/shared/contract.ts';

const FOLDER = 'stonemap_512_0123456789abcdef';
const RECIPE: StoneMapRecipe = {
  build: '073cd39',
  mapName: 'stonemap_map_generator_snapshot_aaaaaaaaaaaac_ayeaeaadaeaaaqca_res4aqaaasaaaycqaaya',
  presentation: { name: 'Северные острова', description: null },
  adjustments: {
    version: 2,
    baseFingerprint: 'd7ad01f89c213963bda57aea83ed289860dac87ad758355955d6b843a20158c8',
    positions: [
      { id: 'spawn:0', x: 60.5, z: 70.5 },
      { id: 'mex:0', x: 68.5, z: 70.5 },
    ],
    deletedIds: ['mex:0'],
  },
};

function lobbyMap(folderName: string, recipe?: unknown): LobbyMap {
  return {
    folderName,
    name: 'Map',
    scenario: `/maps/${folderName}/${folderName}_scenario.lua`,
    spots: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ],
    adaptive: false,
    ...(recipe === undefined ? {} : { recipe: recipe as StoneMapRecipe }),
  };
}

function roundTrip(map: LobbyMap): LobbyMap | undefined {
  const host: NewMember = { id: 1, login: 'host', clan: null, country: null, rating: null };
  const room = createRoom({ host, title: 'Friday', featuredMod: 'faf', factions: ['uef', 'aeon', 'cybran', 'seraphim'], map, simMods: [] });
  const parsed = parseLobbyMessage(serializeLobbyMessage({ t: 'room', room }));
  return parsed?.t === 'room' ? parsed.room.map : undefined;
}

describe('StoneMap recipes in a TFAF room', () => {
  it('recognises StoneMap map folders', () => {
    assert.equal(isStoneMapFolder(FOLDER), true);
    assert.equal(isStoneMapFolder('stonemap_2048_ffffffffffffffff'), true);
    assert.equal(isStoneMapFolder('stonemap_512_xyz'), false);
    assert.equal(isStoneMapFolder('neroxis_map_generator_1.12.0_abc'), false);
  });

  it('takes a well-formed recipe as it is', () => {
    assert.deepEqual(parseStoneMapRecipe(RECIPE), RECIPE);
    assert.deepEqual(parseStoneMapRecipe({ ...RECIPE, presentation: undefined, adjustments: undefined }), { ...RECIPE, presentation: null, adjustments: null });
  });

  it('refuses a recipe that is not one', () => {
    const bad: unknown[] = [
      null,
      { ...RECIPE, build: '../x' },
      { ...RECIPE, mapName: 'neroxis_map_generator_1.12.0_abc' },
      { ...RECIPE, mapName: 'stonemap_map_generator_snapshot_A B' },
      { ...RECIPE, presentation: { name: 'x'.repeat(81) } },
      { ...RECIPE, adjustments: { ...RECIPE.adjustments, version: 3 } },
      { ...RECIPE, adjustments: { ...RECIPE.adjustments, positions: [{ id: '../etc', x: 1, z: 1 }] } },
      { ...RECIPE, adjustments: { ...RECIPE.adjustments, positions: [{ id: 'mex:0', x: Number.NaN, z: 1 }] } },
      { ...RECIPE, adjustments: { ...RECIPE.adjustments, deletedIds: ['mex:0', 7] } },
    ];
    for (const value of bad) {
      assert.equal(parseStoneMapRecipe(value), null, JSON.stringify(value));
    }
  });

  it('travels with the room map of a StoneMap folder only', () => {
    assert.deepEqual(roundTrip(lobbyMap(FOLDER, RECIPE))?.recipe, RECIPE);
    assert.equal(roundTrip(lobbyMap('theta_passage.v0004', RECIPE))?.recipe, undefined);
    // A broken recipe is dropped, not the room: the player then needs the map like any other.
    const broken = roundTrip(lobbyMap(FOLDER, { ...RECIPE, build: '' }));
    assert.equal(broken?.folderName, FOLDER);
    assert.equal(broken?.recipe, undefined);
  });

  describe('read from a saved map', () => {
    let folder = '';
    before(async () => {
      folder = await mkdtemp(path.join(tmpdir(), 'tfaf-stonemap-recipe-'));
    });
    after(() => rm(folder, { recursive: true, force: true }));

    it('names the host build and keeps the text and adjustments', async () => {
      await writeFile(
        path.join(folder, 'generation.json'),
        JSON.stringify({ formatVersion: 1, exportName: FOLDER, mapName: RECIPE.mapName, description: 'x', settings: {}, presentation: RECIPE.presentation, adjustments: RECIPE.adjustments }),
      );
      assert.deepEqual(await readStoneMapRecipe(folder, '073cd39'), RECIPE);
    });

    it('gives nothing for a folder without a readable recipe', async () => {
      await writeFile(path.join(folder, 'generation.json'), '{ broken');
      assert.equal(await readStoneMapRecipe(folder, '073cd39'), null);
      assert.equal(await readStoneMapRecipe(path.join(folder, 'missing'), '073cd39'), null);
    });
  });
});
