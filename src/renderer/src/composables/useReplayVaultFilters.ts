import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import type { ReplayPeriod, ReplayQuery, ReplaySort } from '../../../shared/contract.ts';
import type { ActiveFilter } from '../components/listKit.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';
import { useSettledText } from './useSettledText.ts';

const PAGE_SIZE = 20;
const MAX_GAME_ID = 2 ** 31 - 1;
// Select items cannot have an empty value, so "any mod" has its own key.
export const ANY_MOD = '*';

/** `25000001` or `#25000001`; undefined for anything else. */
function parseGameId(text: string): number | undefined {
  const id = Number(/^#?(\d{1,10})$/.exec(text.trim())?.[1]);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_GAME_ID ? id : undefined;
}

/** The filters, sort and page of the replay vault, the query they make and the filters to show as removable chips. */
export function useReplayVaultFilters() {
  const filters = reactive({
    map: '',
    player: '',
    featuredMod: ANY_MOD,
    period: ['day'] as ReplayPeriod[],
    ranked: false,
    own: false,
  });
  const sort = ref<ReplaySort>('newest');
  const page = ref(1);
  const gameIdText = ref('');
  const { settled: mapName, flush: flushMap } = useSettledText(() => filters.map);
  const { settled: player, flush: flushPlayer } = useSettledText(() => filters.player);
  const { settled: settledGameId, flush: flushGameId } = useSettledText(() => gameIdText.value);
  const period = computed(() => filters.period[0] ?? 'day');
  const featuredModsQuery = useQuery(queries.featuredMods());
  const featuredMods = computed(() => featuredModsQuery.data.value ?? []);

  // One game by its number: the other filters stay as they are but do not apply.
  const gameId = computed(() => parseGameId(settledGameId.value));
  const gameIdInvalid = computed(() => gameIdText.value.trim() !== '' && parseGameId(gameIdText.value) === undefined);

  const query = computed<ReplayQuery>(() => ({
    page: page.value,
    pageSize: PAGE_SIZE,
    gameId: gameId.value,
    player: player.value || undefined,
    map: mapName.value || undefined,
    featuredMod: filters.featuredMod === ANY_MOD ? undefined : filters.featuredMod,
    onlyRanked: filters.ranked || undefined,
    onlyOwn: filters.own || undefined,
    period: period.value,
    sort: sort.value,
  }));
  // Another filter or sort starts from the first page; synchronously, so the old page is never asked for with it.
  watch(
    () => [gameId.value, mapName.value, player.value, filters.featuredMod, period.value, filters.ranked, filters.own, sort.value],
    () => {
      page.value = 1;
    },
    { flush: 'sync' },
  );
  // Games rated within a day are few, so the best rated ones are looked for over all time unless asked otherwise.
  watch(sort, (value) => {
    if (value === 'highestRated' && period.value === 'day') {
      filters.period = ['all'];
    }
  });

  const activeFilters = computed<ActiveFilter[]>(() => {
    if (gameId.value !== undefined) {
      return [{ key: 'gameId', label: t('replays.filters.activeGameId', { id: gameId.value }) }];
    }
    const list: ActiveFilter[] = [];
    if (filters.map.trim()) {
      list.push({ key: 'map', label: t('replays.filters.activeMap', { map: filters.map.trim() }) });
    }
    if (filters.player.trim()) {
      list.push({ key: 'player', label: t('replays.filters.activePlayer', { player: filters.player.trim() }) });
    }
    if (filters.featuredMod !== ANY_MOD) {
      const mod = featuredMods.value.find((item) => item.technicalName === filters.featuredMod);
      list.push({ key: 'featuredMod', label: t('replays.filters.activeMod', { mod: mod?.displayName ?? filters.featuredMod }) });
    }
    if (filters.ranked) {
      list.push({ key: 'ranked', label: t('replays.filters.ranked') });
    }
    if (filters.own) {
      list.push({ key: 'own', label: t('replays.filters.own') });
    }
    return list;
  });

  function removeFilter(key: string): void {
    switch (key) {
      case 'gameId':
        gameIdText.value = '';
        break;
      case 'map':
      case 'player':
        filters[key] = '';
        break;
      case 'featuredMod':
        filters.featuredMod = ANY_MOD;
        break;
      case 'ranked':
      case 'own':
        filters[key] = false;
        break;
    }
  }

  function clearFilters(): void {
    gameIdText.value = '';
    Object.assign(filters, { map: '', player: '', featuredMod: ANY_MOD, ranked: false, own: false });
  }

  return {
    filters,
    sort,
    page,
    gameIdText,
    flushMap,
    flushPlayer,
    flushGameId,
    period,
    featuredMods,
    gameId,
    gameIdInvalid,
    query,
    activeFilters,
    removeFilter,
    clearFilters,
  };
}
