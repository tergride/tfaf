import { computed, onScopeDispose, reactive, ref, toRaw, watch } from 'vue';
import { MAP_MAX_PLAYERS, MAP_SIZES_PX, type MapQuery, type MapSortField, type SortOrder } from '../../../shared/contract.ts';
import { type ActiveFilter, rangeLabel, type SortOption, type StepRange } from '../components/listKit.ts';
import { mapSizeKm } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useSettledText } from './useSettledText.ts';

const PAGE_SIZE = 30;

export const PLAYER_COUNTS = Array.from({ length: MAP_MAX_PLAYERS - 1 }, (_, index) => index + 2);
export const PLAYER_STEPS = PLAYER_COUNTS.map(String);
export const SIZE_STEPS = MAP_SIZES_PX.map((px) => String(mapSizeKm(px)));

export function wholeRange(steps: readonly unknown[]): StepRange {
  return [0, steps.length - 1];
}

/** The values a slider range keeps, or nothing when it spans every step and so filters nothing. */
export function pickSteps<T>(values: readonly T[], [low, high]: StepRange): T[] | undefined {
  return low === 0 && high === values.length - 1 ? undefined : values.slice(low, high + 1);
}

function initialFilters() {
  return {
    text: '',
    author: '',
    players: wholeRange(PLAYER_STEPS),
    sizes: wholeRange(SIZE_STEPS),
    ranked: false,
    recommended: false,
    own: false,
  };
}

type VaultFilters = ReturnType<typeof initialFilters>;
type VaultSort = { field: MapSortField; order: SortOrder };

const memory = new Map<string, { filters: VaultFilters; sort: VaultSort }>();

/**
 * The filters, sort and page of the map vault, the query they make and the filters to show as removable chips.
 * With `rememberAs` the next call with the same name continues from these filters and sort; the texts start empty.
 */
export function useMapVaultFilters(options: { rememberAs?: string } = {}) {
  const filters = reactive(initialFilters());
  const sort = reactive<VaultSort>({ field: 'gamesPlayed', order: 'desc' });
  const saved = options.rememberAs ? memory.get(options.rememberAs) : undefined;
  if (saved) {
    Object.assign(filters, saved.filters);
    Object.assign(sort, saved.sort);
  }
  const page = ref(1);
  const { settled: name, flush: flushName } = useSettledText(() => filters.text);
  const { settled: author, flush: flushAuthor } = useSettledText(() => filters.author);

  const players = computed(() => pickSteps(PLAYER_COUNTS, filters.players));
  const sizes = computed(() => pickSteps(MAP_SIZES_PX, filters.sizes));

  const sortOptions = computed<SortOption<MapSortField>[]>(() => [
    { value: 'gamesPlayed', label: t('maps.sort.popular'), order: 'desc' },
    { value: 'reviewsSummary.lowerBound', label: t('vault.sort.topRated'), order: 'desc' },
    { value: 'latestVersion.updateTime', label: t('vault.sort.recentlyUpdated'), order: 'desc' },
    { value: 'latestVersion.createTime', label: t('vault.sort.newest'), order: 'desc' },
    { value: 'displayName', label: t('vault.sort.byName'), order: 'asc' },
    { value: 'latestVersion.maxPlayers', label: t('maps.sort.byPlayers'), order: 'desc' },
    { value: 'latestVersion.width', label: t('maps.sort.bySize'), order: 'desc' },
  ]);

  const query = computed<MapQuery>(() => ({
    page: page.value,
    pageSize: PAGE_SIZE,
    name: name.value || undefined,
    author: author.value || undefined,
    players: players.value,
    sizes: sizes.value,
    onlyRanked: filters.ranked || undefined,
    onlyRecommended: filters.recommended || undefined,
    onlyOwn: filters.own || undefined,
    sortField: sort.field,
    sortOrder: sort.order,
  }));
  // Another filter or sort starts from the first page; synchronously, so the old page is never asked for with it.
  watch(
    () => [name.value, author.value, filters.players, filters.sizes, filters.ranked, filters.recommended, filters.own, sort.field, sort.order],
    () => {
      page.value = 1;
    },
    { flush: 'sync' },
  );

  if (options.rememberAs) {
    const key = options.rememberAs;
    onScopeDispose(() => {
      memory.set(key, { filters: { ...toRaw(filters), text: '', author: '' }, sort: { ...toRaw(sort) } });
    });
  }

  const activeFilters = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (filters.text.trim()) {
      list.push({ key: 'text', label: t('vault.filters.text', { text: filters.text.trim() }) });
    }
    if (filters.author.trim()) {
      list.push({ key: 'author', label: t('vault.filters.author', { author: filters.author.trim() }) });
    }
    if (players.value) {
      list.push({ key: 'players', label: t('maps.filters.players', { players: rangeLabel(PLAYER_STEPS, filters.players) }) });
    }
    if (sizes.value) {
      list.push({ key: 'sizes', label: t('maps.filters.sizes', { sizes: rangeLabel(SIZE_STEPS, filters.sizes) }) });
    }
    if (filters.ranked) {
      list.push({ key: 'ranked', label: t('vault.filters.ranked') });
    }
    if (filters.recommended) {
      list.push({ key: 'recommended', label: t('vault.filters.recommended') });
    }
    if (filters.own) {
      list.push({ key: 'own', label: t('maps.filters.own') });
    }
    return list;
  });

  function removeFilter(key: string): void {
    switch (key) {
      case 'text':
      case 'author':
        filters[key] = '';
        break;
      case 'players':
        filters.players = wholeRange(PLAYER_STEPS);
        break;
      case 'sizes':
        filters.sizes = wholeRange(SIZE_STEPS);
        break;
      case 'ranked':
      case 'recommended':
      case 'own':
        filters[key] = false;
        break;
    }
  }

  function clearFilters(): void {
    Object.assign(filters, initialFilters());
  }

  return { filters, sort, sortOptions, page, flushName, flushAuthor, query, activeFilters, removeFilter, clearFilters };
}
