import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { LocalMap } from '../../../shared/contract.ts';
import { queries, queryState } from '../lib/queries.ts';
import type { MapVaultFolders } from './useInstalledMapFilters.ts';

/**
 * Which maps of the maps folder the FAF vault has, or null until it answers; generated maps are in neither set. The
 * vault is asked only while `enabled` holds, that is while the list is on screen.
 */
export function useMapVaultCheck(maps: () => readonly LocalMap[], enabled: () => boolean) {
  const folderNames = computed(() =>
    maps()
      .filter((map) => !map.official)
      .map((map) => map.folderName),
  );
  const { data, error, reload } = queryState(
    useQuery(() => ({ ...queries.mapVaultCheck(folderNames.value), enabled: enabled() && folderNames.value.length > 0 })),
  );
  const folders = computed<MapVaultFolders | null>(() => {
    // With nothing to ask the vault is never asked, and the answer is known already.
    if (folderNames.value.length === 0) {
      return { inVault: new Set(), notInVault: new Set() };
    }
    const lower = (names: string[]): Set<string> => new Set(names.map((name) => name.toLowerCase()));
    return data.value ? { inVault: lower(data.value.inVault), notInVault: lower(data.value.notInVault) } : null;
  });

  function isLocal(map: LocalMap): boolean {
    return folders.value?.notInVault.has(map.folderName.toLowerCase()) ?? false;
  }

  return { folders, isLocal, error, reload };
}
