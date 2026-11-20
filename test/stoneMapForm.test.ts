// The StoneMap form must build the requests StoneMap's own editor builds: the same choices make the same map recipe.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFormState,
  formToRequest,
  mountainHollowsRequest,
  RANDOM_FREE_ISLANDS,
  selectExplicitResources,
  selectPattern,
  selectSpawnIslandMode,
  selectTopology,
  spawnIslandModeAllowed,
  type StoneMapForm,
} from '../src/shared/stoneMap/form.ts';
import type { ResolvedParameters } from '../src/shared/stoneMap/contracts.ts';

const initial = createFormState().form;

function settingsOf(form: StoneMapForm, random: string[] = []) {
  const settings = formToRequest({ form, random }).settings;
  assert.ok(settings?.features && settings.topology);
  return { ...settings, features: settings.features, topology: settings.topology };
}

describe('StoneMap form', () => {
  it('starts from the editor preset and writes it in the API units', () => {
    const state = createFormState();
    assert.deepEqual(state.random, ['topology.maxPlayersPerIsland']);
    const request = formToRequest(state);
    const settings = settingsOf(state.form, state.random);
    assert.equal(settings.topology.kind, 'MIXED');
    assert.equal(settings.topology.mode, 'REALISM');
    assert.equal(settings.navigationProfile, 'LARGE');
    assert.equal(settings.topology.waterRatio, 0.55);
    assert.equal(settings.features.teamSpawnSeparation, 0.55);
    assert.equal(settings.features.navigationUnitsPerRow, 2);
    assert.equal(settings.resourcePlacement, undefined);
    assert.deepEqual(settings.randomize, ['topology.maxPlayersPerIsland']);
    assert.deepEqual(request.preview, { kinds: [], quality: 'medium' });
  });

  it('leaves the shore settings out on dry land and keeps them with rivers', () => {
    const form: StoneMapForm = { ...initial, kind: 'LAND', rivers: false, navalNavigation: true, coastalDetails: true };
    const dry = settingsOf(form);
    assert.equal(dry.topology.waterRatio, 0);
    assert.equal(dry.topology.shorelineStyle, 'DEFAULT');
    assert.equal(dry.features.navalNavigation, false);
    assert.equal(dry.features.coastalCliffMaterials, false);
    const river = settingsOf({ ...form, rivers: true });
    assert.equal(river.topology.shorelineStyle, 'MIXED');
    assert.equal(river.features.navalNavigation, true);
    assert.equal(river.features.coastalCliffMaterials, true);
    assert.equal(settingsOf({ ...form, rivers: true }, ['features.coastalDetails']).features.coastalCliffMaterials, undefined);
  });

  it('keeps allied distances only when a team has two players', () => {
    const form: StoneMapForm = { ...initial, minimumTeamSpawnDistance: 80.5, maximumTeamSpawnDistance: 180.25 };
    assert.equal(settingsOf(form).features.minimumTeamSpawnDistance, 80.5);
    for (const numTeams of [0, form.spawnCount]) {
      assert.equal(settingsOf({ ...form, numTeams }).features.maximumTeamSpawnDistance, null);
    }
  });

  it('applies the island rules to bridges and free islands', () => {
    const form: StoneMapForm = {
      ...initial,
      kind: 'ISLAND',
      spawnIslandMode: 'TEAM_GROUPS',
      bridges: true,
      enemyIslandConnections: 2,
      freeIslands: RANDOM_FREE_ISLANDS,
    };
    const team = settingsOf(form);
    assert.equal(team.topology.landBridges, true);
    assert.equal(team.topology.enemyIslandConnections, 2);
    assert.equal(team.topology.spawnFreeIslands, 0);
    assert.equal(team.topology.randomSpawnFreeIslands, true);
    const player = settingsOf({ ...form, spawnIslandMode: 'PER_SPAWN', numTeams: 0 });
    assert.equal(player.topology.landBridges, false);
    assert.equal(player.topology.enemyIslandConnections, 1);
    assert.equal(player.features.teamSpawnSeparation, null);
  });

  it('trims the name, description and seed, and drops the seed left to chance', () => {
    const form: StoneMapForm = { ...initial, displayName: '  Карта  ', mapDescription: '  Описание\nкарты  ', seed: '  -9223372036854775808  ' };
    const request = formToRequest({ form, random: [] });
    assert.deepEqual(request.presentation, { name: 'Карта', description: 'Описание\nкарты' });
    assert.equal(request.settings?.seed, '-9223372036854775808');
    const random = formToRequest({ form, random: ['seed', 'topology.mode'] });
    assert.equal(random.settings?.seed, undefined);
    assert.deepEqual(random.settings?.randomize, ['topology.mode']);
    assert.equal(formToRequest({ form: { ...initial, displayName: ' ', mapDescription: '\n' }, random: [] }).presentation, undefined);
  });

  it('rounds the players for symmetry patterns and keeps the form it started from', () => {
    const form: StoneMapForm = { ...initial, spawnCount: 5, numTeams: 4, terrainMode: 'STANDARD' };
    const curve = selectPattern(form, 'S_CURVE');
    assert.deepEqual([curve.spawnCount, curve.numTeams, curve.symmetry], [6, 2, 'POINT2']);
    const quadrants = selectPattern(form, 'QUADRANTS');
    assert.deepEqual([quadrants.spawnCount, quadrants.numTeams, quadrants.symmetry], [8, 4, 'POINT4']);
    assert.equal(selectPattern(form, 'LAYERED').terrainMode, 'REALISM');
    assert.equal(selectPattern(form, 'ASYMMETRIC').symmetry, 'NONE');
    assert.equal(form.spawnCount, 5);
  });

  it('moves split islands to a shared one on land and lakes, within the lake water limit', () => {
    const island: StoneMapForm = { ...initial, spawnIslandMode: 'TEAM_GROUPS', water: 80 };
    assert.equal(selectTopology(island, 'LAND').spawnIslandMode, 'SHARED');
    const lake = selectTopology(island, 'LAKE');
    assert.deepEqual([lake.spawnIslandMode, lake.water], ['SHARED', 30]);
    assert.equal(selectTopology({ ...lake, water: 80 }, 'CALDERA').water, 65);
    assert.equal(selectTopology(island, 'ARCHIPELAGO').water, 80);
    assert.equal(spawnIslandModeAllowed({ ...initial, kind: 'LAND' }, 'PER_SPAWN'), false);
    assert.equal(spawnIslandModeAllowed({ ...initial, numTeams: 0 }, 'PER_TEAM'), false);
    assert.equal(selectSpawnIslandMode({ ...initial, kind: 'MIXED', bridges: true }, 'PER_SPAWN').bridges, false);
  });

  it('writes standard relief and explicit resources the way the editor does', () => {
    const form: StoneMapForm = {
      ...selectExplicitResources({ ...initial, terrainMode: 'STANDARD', mountainStructure: 'ALL', erosion: 100, baseMex: 1, outsideMex: 10 }, true),
      decoration: true,
      decorationTransition: 20,
    };
    assert.equal(form.outsideMex, form.spawnCount * form.nearbyMex + 8);
    const settings = settingsOf(form);
    assert.equal(settings.features.mountainStructure, 'CLASSIC');
    assert.equal(settings.features.erosionStrength, 0);
    assert.equal(settings.topology.mountainRatio, undefined);
    assert.equal(settings.resourcePlacement?.minimumMexesPerSpawn, 4);
    assert.equal(settings.features.decoration?.transitionWidth, 0.2);
    assert.equal(settings.features.decoration?.thirdBiome, null);
  });

  it('makes the same map with filled mountain hollows from its parameters', () => {
    const parameters = {
      seed: '42',
      mapSize: 512,
      spawnCount: 4,
      numTeams: 2,
      terrainSymmetry: 'POINT2',
      navigationProfile: 'OFF',
      heightScale: 1,
      heightOffset: 0,
      style: null,
      customStyle: null,
      topology: null,
      resourcePlacement: null,
      spawnBuildArea: null,
      features: { reefs: true, fillMountainHollows: false },
      presentation: { name: 'A', description: null },
    } as unknown as ResolvedParameters;
    const request = mountainHollowsRequest(parameters);
    assert.equal(request.settings?.seed, '42');
    assert.deepEqual(request.settings?.features, { reefs: true, fillMountainHollows: true });
    assert.deepEqual(request.presentation, { name: 'A', description: null });
  });
});
