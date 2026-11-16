import { Puzzle, Sparkles, User, UserRound } from '@lucide/vue';
import { type Component, computed, reactive, ref, watch } from 'vue';
import type { LiveGame } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import type { ActiveFilter, ChipOption } from '../components/listKit.ts';
import { t } from '../lib/i18n.ts';
import { type LiveFilters, NO_LIVE_FILTERS, parseLiveFilters } from '../lib/liveReplayFilters.ts';

const STORAGE_KEY = 'tfaf.replays.liveFilters';

export const LIVE_TOGGLES: { key: Exclude<keyof LiveFilters, 'featuredMod'>; label: MessageKey; icon: Component }[] = [
  { key: 'withFriends', label: 'replays.filters.withFriends', icon: UserRound },
  { key: 'hideModded', label: 'replays.filters.hideModded', icon: Puzzle },
  { key: 'generatedOnly', label: 'replays.filters.generatedOnly', icon: Sparkles },
  { key: 'hideSingle', label: 'replays.filters.hideSingle', icon: User },
];

// The filters of running games are a per-user convenience; storage may be unavailable.
function loadFilters(): LiveFilters {
  try {
    return parseLiveFilters(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...NO_LIVE_FILTERS };
  }
}

/**
 * The filters of the running games: a search text, and the featured mod and toggles that are kept between launches.
 * `games` gives the listed games, whose featured mods the mod filter offers.
 */
export function useLiveReplayFilters(games: () => readonly LiveGame[] | null) {
  const text = ref('');
  const filters = reactive<LiveFilters>(loadFilters());
  watch(
    () => ({ ...filters }),
    (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // Ignore unavailable storage.
      }
    },
  );

  const modOptions = computed<ChipOption<string>[]>(() => {
    const names = new Map<string, string>();
    for (const game of games() ?? []) {
      names.set(game.featuredMod, game.featuredModName);
    }
    if (filters.featuredMod && !names.has(filters.featuredMod)) {
      names.set(filters.featuredMod, filters.featuredMod);
    }
    const mods = [...names.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
    return [{ value: '', label: t('replays.filters.allFeaturedMods') }, ...mods];
  });
  const modChoice = computed<string[]>({
    get: () => [filters.featuredMod],
    set: ([value]) => {
      filters.featuredMod = value ?? '';
    },
  });

  const activeFilters = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (text.value.trim()) {
      list.push({ key: 'text', label: t('replays.filters.text', { text: text.value.trim() }) });
    }
    if (filters.featuredMod) {
      const option = modOptions.value.find((item) => item.value === filters.featuredMod);
      list.push({ key: 'featuredMod', label: t('replays.filters.activeMod', { mod: option?.label ?? filters.featuredMod }) });
    }
    for (const toggle of LIVE_TOGGLES) {
      if (filters[toggle.key]) {
        list.push({ key: toggle.key, label: t(toggle.label) });
      }
    }
    return list;
  });

  function removeFilter(key: string): void {
    if (key === 'text') {
      text.value = '';
    } else if (key === 'featuredMod') {
      filters.featuredMod = '';
    } else {
      const toggle = LIVE_TOGGLES.find((item) => item.key === key);
      if (toggle) {
        filters[toggle.key] = false;
      }
    }
  }

  function clearFilters(): void {
    text.value = '';
    Object.assign(filters, NO_LIVE_FILTERS);
  }

  return { text, filters, modOptions, modChoice, activeFilters, removeFilter, clearFilters };
}
