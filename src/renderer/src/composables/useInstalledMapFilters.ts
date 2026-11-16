import { computed, onScopeDispose, reactive, toRaw } from 'vue';
import { type LocalMap, MAP_SIZES_PX, type SortOrder } from '../../../shared/contract.ts';
import { type ActiveFilter, rangeLabel, type SortOption } from '../components/listKit.ts';
import { t } from '../lib/i18n.ts';
import { PLAYER_COUNTS, PLAYER_STEPS, pickSteps, SIZE_STEPS, wholeRange } from './useMapVaultFilters.ts';

export type InstalledMapSort = 'name' | 'added' | 'players' | 'size';

/** Lower-case folder names of the maps folder: those the FAF vault has and those it does not. */
export interface MapVaultFolders {
  inVault: ReadonlySet<string>;
  notInVault: ReadonlySet<string>;
}

function initialFilters() {
  return {
    text: '',
    players: wholeRange(PLAYER_STEPS),
    sizes: wholeRange(SIZE_STEPS),
    official: false,
    vault: false,
    local: false,
  };
}

type InstalledFilters = ReturnType<typeof initialFilters>;
type InstalledSort = { field: InstalledMapSort; order: SortOrder };

const memory = new Map<string, { filters: InstalledFilters; sort: InstalledSort }>();

function addedMs(map: LocalMap): number {
  return map.addedAt ? Date.parse(map.addedAt) || 0 : 0;
}

/**
 * The filters and sort of the installed maps, applied here rather than by a server, and the filters to show as
 * removable chips. The source filters keep the maps of any source chosen: `official` the maps of the game
 * installation, `vault` and `local` the maps of the maps folder that `vaultFolders` puts in the vault or not. Until the
 * vault answers those two keep nothing, and generated maps, which are in neither, show only without source filters.
 * `rememberAs` works as in useMapVaultFilters.
 */
export function useInstalledMapFilters(
  maps: () => readonly LocalMap[],
  options: { vaultFolders?: () => MapVaultFolders | null; rememberAs?: string } = {},
) {
  const filters = reactive(initialFilters());
  const sort = reactive<InstalledSort>({ field: 'name', order: 'asc' });
  const saved = options.rememberAs ? memory.get(options.rememberAs) : undefined;
  if (saved) {
    Object.assign(filters, saved.filters);
    Object.assign(sort, saved.sort);
  }

  const players = computed(() => pickSteps(PLAYER_COUNTS, filters.players));
  const sizes = computed(() => pickSteps(MAP_SIZES_PX, filters.sizes));

  const sortOptions = computed<SortOption<InstalledMapSort>[]>(() => [
    { value: 'name', label: t('vault.sort.byName'), order: 'asc' },
    { value: 'added', label: t('vault.sort.newest'), order: 'desc' },
    { value: 'players', label: t('maps.sort.byPlayers'), order: 'desc' },
    { value: 'size', label: t('maps.sort.bySize'), order: 'desc' },
  ]);

  const filtered = computed(() => {
    const text = filters.text.trim().toLowerCase();
    const direction = sort.order === 'asc' ? 1 : -1;
    const anySource = filters.official || filters.vault || filters.local;
    const folders = options.vaultFolders?.() ?? null;
    const ofChosenSource = (map: LocalMap): boolean => {
      const name = map.folderName.toLowerCase();
      return (
        (filters.official && map.official) ||
        (filters.vault && (folders?.inVault.has(name) ?? false)) ||
        (filters.local && (folders?.notInVault.has(name) ?? false))
      );
    };
    const byName = (a: LocalMap, b: LocalMap): number => a.displayName.localeCompare(b.displayName, 'ru');
    return (
      maps()
        .filter((map) => !anySource || ofChosenSource(map))
        .filter((map) => !text || map.displayName.toLowerCase().includes(text) || map.folderName.toLowerCase().includes(text))
        .filter((map) => !players.value || players.value.includes(map.maxPlayers))
        // As in the vault, a map matches when either of its sides has one of the sizes.
        .filter((map) => !sizes.value || sizes.value.some((px) => px === map.widthPx || px === map.heightPx))
        // eslint-disable-next-line array-callback-return -- the switch covers every sort field
        .sort((a, b) => {
          switch (sort.field) {
            case 'name':
              return direction * byName(a, b);
            case 'added':
              return direction * (addedMs(a) - addedMs(b)) || byName(a, b);
            case 'players':
              return direction * (a.maxPlayers - b.maxPlayers) || byName(a, b);
            case 'size':
              return direction * ((a.widthPx ?? 0) - (b.widthPx ?? 0)) || byName(a, b);
          }
        })
    );
  });

  // The list cannot show maps from the vault or local ones before the vault answers.
  const waitingForVault = computed(() => (filters.vault || filters.local) && !options.vaultFolders?.());

  if (options.rememberAs) {
    const key = options.rememberAs;
    onScopeDispose(() => {
      memory.set(key, { filters: { ...toRaw(filters), text: '' }, sort: { ...toRaw(sort) } });
    });
  }

  const activeFilters = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (filters.text.trim()) {
      list.push({ key: 'text', label: t('vault.filters.text', { text: filters.text.trim() }) });
    }
    if (players.value) {
      list.push({ key: 'players', label: t('maps.filters.players', { players: rangeLabel(PLAYER_STEPS, filters.players) }) });
    }
    if (sizes.value) {
      list.push({ key: 'sizes', label: t('maps.filters.sizes', { sizes: rangeLabel(SIZE_STEPS, filters.sizes) }) });
    }
    if (filters.official) {
      list.push({ key: 'official', label: t('maps.installed.officialFilter') });
    }
    if (filters.vault) {
      list.push({ key: 'vault', label: t('maps.installed.vaultFilter') });
    }
    if (filters.local) {
      list.push({ key: 'local', label: t('maps.installed.localFilter') });
    }
    return list;
  });

  function removeFilter(key: string): void {
    switch (key) {
      case 'text':
        filters.text = '';
        break;
      case 'players':
        filters.players = wholeRange(PLAYER_STEPS);
        break;
      case 'sizes':
        filters.sizes = wholeRange(SIZE_STEPS);
        break;
      case 'official':
      case 'vault':
      case 'local':
        filters[key] = false;
        break;
    }
  }

  function clearFilters(): void {
    Object.assign(filters, initialFilters());
  }

  return { filters, sort, sortOptions, filtered, waitingForVault, activeFilters, removeFilter, clearFilters };
}
