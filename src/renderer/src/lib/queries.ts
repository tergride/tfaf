import { keepPreviousData, QueryClient, queryOptions, type QueryKey, type UseQueryReturnType } from '@tanstack/vue-query';
import { computed, type Ref, toRaw } from 'vue';
import type { MapQuery, ModQuery, ReplayQuery, ReviewTarget } from '../../../shared/contract.ts';
import { errorMessage } from '../format.ts';

const LONG_LIVED_MS = 30 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The main process caches network answers already; here a list stays fresh for a minute, so going back to a
      // view or a page shows it at once instead of loading it again.
      staleTime: 60_000,
      // Views show errors with a retry button; repeating a failed request on its own would only delay the message.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/** Everything the renderer reads from the main process. The keys also name what to refresh after a change. */
export const queries = {
  installedMaps: () => queryOptions({ queryKey: ['maps', 'installed'], queryFn: () => window.tfaf.maps.installed() }),
  // Folder names are case-insensitive, like the game's; all of them refresh together with `mapsOnDisk`.
  mapOnDisk: (folderName: string) =>
    queryOptions({
      queryKey: ['maps', 'onDisk', folderName.toLowerCase()],
      queryFn: () => window.tfaf.mapView.available(folderName),
      // A look at one folder: cheap enough to repeat whenever a preview shows, so a deleted map loses its button.
      staleTime: 0,
    }),
  mapsOnDisk: () => ({ queryKey: ['maps', 'onDisk'] }),
  mapVaultCheck: (folderNames: readonly string[]) =>
    queryOptions({
      queryKey: ['maps', 'vaultCheck', folderNames],
      queryFn: () => window.tfaf.maps.vaultCheck([...folderNames]),
      placeholderData: keepPreviousData,
    }),
  // Queries often come from a view's reactive state; Vue proxies cannot be cloned over IPC, so the plain object goes.
  vaultMaps: (query: MapQuery) =>
    queryOptions({
      queryKey: ['maps', 'vault', query],
      queryFn: () => window.tfaf.maps.query(toRaw(query)),
      placeholderData: keepPreviousData,
    }),
  installedMods: () => queryOptions({ queryKey: ['mods', 'installed'], queryFn: () => window.tfaf.mods.installed() }),
  modsNotInVault: (uids: readonly string[]) =>
    queryOptions({
      queryKey: ['mods', 'notInVault', uids],
      queryFn: () => window.tfaf.mods.notInVault([...uids]),
      placeholderData: keepPreviousData,
    }),
  vaultMods: (query: ModQuery) =>
    queryOptions({
      queryKey: ['mods', 'vault', query],
      queryFn: () => window.tfaf.mods.query(toRaw(query)),
      placeholderData: keepPreviousData,
    }),
  vaultReplays: (query: ReplayQuery) =>
    queryOptions({
      queryKey: ['replays', 'vault', query],
      queryFn: () => window.tfaf.replays.query(toRaw(query)),
      placeholderData: keepPreviousData,
    }),
  // The reviews of all versions of a map or mod: the key leaves the shown version out.
  reviews: (target: ReviewTarget) =>
    queryOptions({ queryKey: ['reviews', target.kind, target.id], queryFn: () => window.tfaf.reviews.list(toRaw(target)) }),
  localReplays: () => queryOptions({ queryKey: ['replays', 'local'], queryFn: () => window.tfaf.replays.local() }),
  liveReplays: () => queryOptions({ queryKey: ['replays', 'live'], queryFn: () => window.tfaf.replays.live(), staleTime: 0 }),
  featuredMods: () =>
    queryOptions({ queryKey: ['featuredMods'], queryFn: () => window.tfaf.game.featuredMods(), staleTime: LONG_LIVED_MS }),
  news: () => queryOptions({ queryKey: ['news'], queryFn: () => window.tfaf.news.list() }),
  tournaments: () => queryOptions({ queryKey: ['tournaments'], queryFn: () => window.tfaf.tournaments.list() }),
  tutorials: () => queryOptions({ queryKey: ['tutorials'], queryFn: () => window.tfaf.tutorials.list(), staleTime: LONG_LIVED_MS }),
  leagues: () => queryOptions({ queryKey: ['leagues'], queryFn: () => window.tfaf.leagues.list(), staleTime: LONG_LIVED_MS }),
  leagueSeasons: (leagueId: string) =>
    queryOptions({ queryKey: ['leagues', 'seasons', leagueId], queryFn: () => window.tfaf.leagues.seasons(leagueId) }),
  leagueStanding: (seasonId: string) =>
    queryOptions({ queryKey: ['leagues', 'standing', seasonId], queryFn: () => window.tfaf.leagues.standing(seasonId) }),
  leagueEntries: (seasonId: string, subdivisionId: string, page: number) =>
    queryOptions({
      queryKey: ['leagues', 'entries', seasonId, subdivisionId, page],
      queryFn: () => window.tfaf.leagues.entries(seasonId, subdivisionId, page),
      // Another page or subdivision keeps the table on screen while it loads; another season must not show this one's.
      placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === seasonId ? previous : undefined),
    }),
  coopScenarios: () =>
    queryOptions({ queryKey: ['coop', 'scenarios'], queryFn: () => window.tfaf.coop.scenarios(), staleTime: LONG_LIVED_MS }),
  coopLeaderboard: (missionId: string, playerCount: number) =>
    queryOptions({
      queryKey: ['coop', 'leaderboard', missionId, playerCount],
      queryFn: () => window.tfaf.coop.leaderboard(missionId, playerCount),
      // Another team size keeps the table on screen while it loads; another mission must not show this one's results.
      placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === missionId ? previous : undefined),
    }),
};

/** Reads lists again after the user changed something; resolves once they show the change. */
export async function refreshLists(...lists: { queryKey: QueryKey }[]): Promise<void> {
  await Promise.all(lists.map(({ queryKey }) => queryClient.invalidateQueries({ queryKey })));
}

/**
 * A view that comes back on screen reads its lists again once they are older than the fresh period: files may have
 * changed outside the launcher meanwhile, e.g. through the official client.
 */
export function refreshStale(...lists: { queryKey: QueryKey }[]): void {
  for (const { queryKey } of lists) {
    void queryClient.refetchQueries({ queryKey, stale: true }, { cancelRefetch: false });
  }
}

/** The lists read from disk; they change with downloads, deletions and folders changed in the settings. */
export function localContent(): { queryKey: QueryKey }[] {
  return [queries.installedMaps(), queries.mapsOnDisk(), queries.installedMods(), queries.localReplays()];
}

/** Work in the background changes what is on disk: a finished download may bring a map or a mod, a game a replay. */
export function watchLocalContent(): void {
  // A list that is loading already is not asked for again.
  const refreshInBackground = (...lists: { queryKey: QueryKey }[]): void => {
    for (const { queryKey } of lists) {
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  };
  window.tfaf.tasks.onProgress((task) => {
    if (task.state === 'done') {
      refreshInBackground(queries.installedMaps(), queries.mapsOnDisk(), queries.installedMods());
    }
  });
  window.tfaf.game.onStateChanged((state) => {
    if (state.phase === 'idle') {
      refreshInBackground(queries.localReplays());
    }
  });
}

export interface QueryState<T> {
  data: Readonly<Ref<T | null>>;
  loading: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  reload(): Promise<void>;
}

/** A query the way the views show it: the data or null, whether it is loading, the error as text, and a retry. */
export function queryState<T>(query: UseQueryReturnType<T, Error>): QueryState<T> {
  return {
    data: computed(() => query.data.value ?? null),
    loading: computed(() => query.isFetching.value),
    error: computed(() => (query.error.value ? errorMessage(query.error.value) : null)),
    reload: async () => {
      await query.refetch();
    },
  };
}
