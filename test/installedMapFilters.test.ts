import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectScope, shallowRef } from 'vue';
import { type MapVaultFolders, useInstalledMapFilters } from '../src/renderer/src/composables/useInstalledMapFilters.ts';
import type { LocalMap } from '../src/shared/contract.ts';

function map(
  displayName: string,
  maxPlayers: number,
  widthPx: number,
  heightPx: number,
  official = false,
  addedAt: string | null = null,
): LocalMap {
  return {
    folderName: displayName.toLowerCase(),
    displayName,
    description: '',
    version: null,
    maxPlayers,
    widthPx,
    heightPx,
    official,
    addedAt,
    previewUrl: '',
    previewLargeUrl: '',
  };
}

const MAPS = [
  map('Alpha', 8, 1024, 1024, false, '2026-03-01T10:00:00.000Z'),
  map('Beta', 6, 512, 1024, false, '2026-11-05T18:30:00.000Z'),
  map('Gamma', 4, 1024, 1024, true, '2025-01-10T09:00:00.000Z'),
  map('Delta', 8, 2048, 2048),
];

// Slider positions: players go 2, 3, …, 16 and sizes 5, 10, 20, 40, 81 km.
const SIX_TO_EIGHT: [number, number] = [4, 6];
const TWENTY_KM: [number, number] = [2, 2];

describe('installed map filters', () => {
  it('list every map at first and narrow them by players and by either side of the size', () => {
    const { filters, sort, filtered, activeFilters, clearFilters } = useInstalledMapFilters(() => MAPS);
    const names = (): string[] => filtered.value.map((item) => item.displayName);

    assert.deepEqual(names(), ['Alpha', 'Beta', 'Delta', 'Gamma']);
    filters.players = SIX_TO_EIGHT;
    filters.sizes = TWENTY_KM;
    assert.deepEqual(names(), ['Alpha', 'Beta']);
    assert.deepEqual(
      activeFilters.value.map((filter) => filter.key),
      ['players', 'sizes'],
    );

    clearFilters();
    sort.field = 'players';
    sort.order = 'desc';
    assert.deepEqual(names(), ['Alpha', 'Delta', 'Beta', 'Gamma']);
  });

  it('leave only the maps of the game with the official filter', () => {
    const { filters, filtered, activeFilters, removeFilter } = useInstalledMapFilters(() => MAPS);
    const names = (): string[] => filtered.value.map((item) => item.displayName);

    filters.official = true;
    assert.deepEqual(names(), ['Gamma']);
    assert.deepEqual(
      activeFilters.value.map((filter) => filter.key),
      ['official'],
    );

    removeFilter('official');
    assert.deepEqual(names(), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  it('put the maps added last first, with maps of unknown date at the end', () => {
    const { sort, filtered } = useInstalledMapFilters(() => MAPS);
    sort.field = 'added';
    sort.order = 'desc';
    assert.deepEqual(
      filtered.value.map((item) => item.displayName),
      ['Beta', 'Alpha', 'Gamma', 'Delta'],
    );
  });

  it('tell the maps of the folder from the vault and the local ones once the vault answers', () => {
    const vaultFolders = shallowRef<MapVaultFolders | null>(null);
    const { filters, filtered, waitingForVault, activeFilters, removeFilter } = useInstalledMapFilters(() => MAPS, {
      vaultFolders: () => vaultFolders.value,
    });
    const names = (): string[] => filtered.value.map((item) => item.displayName);

    assert.equal(waitingForVault.value, false);
    filters.vault = true;
    // Until the vault answers no map of the folder is known to be in it or not.
    assert.equal(waitingForVault.value, true);
    assert.deepEqual(names(), []);
    vaultFolders.value = { inVault: new Set(['alpha']), notInVault: new Set(['beta', 'delta']) };
    assert.equal(waitingForVault.value, false);
    assert.deepEqual(names(), ['Alpha']);

    removeFilter('vault');
    filters.local = true;
    assert.deepEqual(names(), ['Beta', 'Delta']);
    assert.deepEqual(
      activeFilters.value.map((filter) => filter.key),
      ['local'],
    );

    removeFilter('local');
    assert.deepEqual(names(), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  it('list the maps of every source chosen; generated maps are of none', () => {
    const maps = [...MAPS, map('Neroxis_Map_Generator_1.12.0_abc', 8, 512, 512)];
    const { filters, filtered, activeFilters } = useInstalledMapFilters(() => maps, {
      vaultFolders: () => ({ inVault: new Set(['alpha']), notInVault: new Set(['beta', 'delta']) }),
    });
    const names = (): string[] => filtered.value.map((item) => item.displayName);

    filters.official = true;
    filters.local = true;
    assert.deepEqual(names(), ['Beta', 'Delta', 'Gamma']);
    assert.deepEqual(
      activeFilters.value.map((filter) => filter.key),
      ['official', 'local'],
    );

    filters.vault = true;
    assert.deepEqual(names(), ['Alpha', 'Beta', 'Delta', 'Gamma']);

    filters.official = false;
    filters.vault = false;
    filters.local = false;
    assert.equal(names().length, 5);
  });

  it('continue from the last filters and sort under the same name, with the search text cleared', () => {
    const first = effectScope();
    first.run(() => {
      const { filters, sort } = useInstalledMapFilters(() => MAPS, { rememberAs: 'test' });
      filters.text = 'al';
      filters.players = SIX_TO_EIGHT;
      filters.official = true;
      sort.field = 'size';
    });
    first.stop();

    const second = effectScope();
    second.run(() => {
      const { filters, sort } = useInstalledMapFilters(() => MAPS, { rememberAs: 'test' });
      assert.equal(filters.text, '');
      assert.deepEqual(filters.players, SIX_TO_EIGHT);
      assert.equal(filters.official, true);
      assert.equal(sort.field, 'size');
    });
    second.stop();
  });
});
