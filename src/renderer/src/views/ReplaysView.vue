<script setup lang="ts">
import { Eye, Film, FolderOpen, RefreshCw, Swords, UserRound } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, useTemplateRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LIVE_REPLAY_DELAY_SECONDS,
  type LocalReplay,
  type ReplayPeriod,
  type ReplaySort,
  type ReplayTeam,
} from '../../../shared/contract.ts';
import ActiveFilters from '../components/ActiveFilters.vue';
import BulkBar from '../components/BulkBar.vue';
import DataTable from '../components/DataTable.vue';
import FilterChip from '../components/FilterChip.vue';
import FilterChips from '../components/FilterChips.vue';
import ListLayout from '../components/ListLayout.vue';
import ListToolbar from '../components/ListToolbar.vue';
import type { ChipOption, SortOption } from '../components/listKit.ts';
import LiveReplayList from '../components/LiveReplayList.vue';
import PageNav from '../components/PageNav.vue';
import PreviewImage from '../components/PreviewImage.vue';
import ReplayDetailPanel from '../components/ReplayDetailPanel.vue';
import SearchInput from '../components/SearchInput.vue';
import SortControl from '../components/SortControl.vue';
import StatusLamp from '../components/StatusLamp.vue';
import VaultCard from '../components/VaultCard.vue';
import ViewModeToggle from '../components/ViewModeToggle.vue';
import { useBulkDelete } from '../composables/useBulkDelete.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { LIVE_TOGGLES, useLiveReplayFilters } from '../composables/useLiveReplayFilters.ts';
import { useLobby } from '../composables/useLobby.ts';
import { type ReplaySelection, useReplayDetails } from '../composables/useReplayDetails.ts';
import { useReplayFocus } from '../composables/useReplayFocus.ts';
import { ANY_MOD, useReplayVaultFilters } from '../composables/useReplayVaultFilters.ts';
import { useViewMode } from '../composables/useViewMode.ts';
import { useWatchedReplays } from '../composables/useWatchedReplays.ts';
import {
  durationBetween,
  errorMessage,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatQuality,
  isCancelled,
  joinParts,
  mapDisplayName,
  validityLabel,
} from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useListTable } from '../lib/listTable.ts';
import { matchesLiveFilters } from '../lib/liveReplayFilters.ts';
import { queries, queryState } from '../lib/queries.ts';
import { playersLine, watchableIn } from '../lib/replayLists.ts';

const LIVE_REFRESH_MS = 20_000;
// The countdown to a watchable game moves on between the reads of the list.
const CLOCK_TICK_MS = 15_000;
const SORTS: ReplaySort[] = ['newest', 'highestRated'];
const PERIODS: ReplayPeriod[] = ['day', 'week', 'month', 'year', 'all'];
const sortOptions = computed<SortOption<ReplaySort>[]>(() =>
  SORTS.map((value) => ({ value, label: t(`replays.sort.${value}`), order: 'desc' })),
);
const periodOptions = computed<ChipOption<ReplayPeriod>[]>(() =>
  PERIODS.map((value) => ({ value, label: t(`replays.period.${value}`) })),
);

const { state: lobby } = useLobby();
const { state: session } = useGameSession();
const replayFocus = useReplayFocus();

const tab = ref<'vault' | 'local' | 'live'>('vault');
const vaultView = useViewMode('replays.vault', 'table');
const localView = useViewMode('replays.local', 'table');
const liveView = useViewMode('replays.live', 'table');
const layout = useTemplateRef<InstanceType<typeof ListLayout>>('layout');
// The local and live lists are only read while the view is on screen.
const active = ref(false);
const now = ref(Date.now());

const {
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
} = useReplayVaultFilters();
const { data: result, loading, error, reload } = queryState(useQuery(() => queries.vaultReplays(query.value)));

const {
  data: local,
  loading: localLoading,
  error: localLoadError,
  reload: refreshLocal,
} = queryState(useQuery(() => ({ ...queries.localReplays(), enabled: active.value && tab.value === 'local' })));
const fileError = ref<string | null>(null);
const localError = computed(() => fileError.value ?? localLoadError.value);
const localFilter = ref('');

const liveQuery = useQuery(() => ({
  ...queries.liveReplays(),
  enabled: active.value && tab.value === 'live',
  refetchInterval: LIVE_REFRESH_MS,
}));
const { data: live, error: liveError, reload: refreshLive } = queryState(liveQuery);
watch(liveQuery.dataUpdatedAt, () => {
  now.value = Date.now();
});
const ticker = setInterval(() => {
  if (active.value && tab.value === 'live') {
    now.value = Date.now();
  }
}, CLOCK_TICK_MS);
onBeforeUnmount(() => clearInterval(ticker));

const {
  text: liveFilter,
  filters: liveFilters,
  modOptions: liveModOptions,
  modChoice: liveModChoice,
  activeFilters: liveActiveFilters,
  removeFilter: removeLiveFilter,
  clearFilters: clearLiveFilters,
} = useLiveReplayFilters(() => live.value);

const { isWatched, refresh: refreshWatched } = useWatchedReplays();
// A replay counts as watched once it starts, which the main process records while the start goes on.
watch(
  () => session.value.phase,
  () => void refreshWatched(),
);

const selection = ref<ReplaySelection | null>(null);
// The panel belongs to the list it was opened from.
watch(tab, () => {
  selection.value = null;
});
const { selected: selectedDetails, load: loadDetails, show: showDetails } = useReplayDetails(selection);
const actionError = ref<string | null>(null);
const starting = ref(false);

const gameBusy = computed(() => session.value.phase !== 'idle');

function vaultTeams(teams: ReplayTeam[]): { team: number; players: string[] }[] {
  return teams.map((team) => ({ team: team.team, players: team.players.map((one) => one.login) }));
}

function matches(filter: string, ...texts: (string | null | undefined)[]): boolean {
  const needle = filter.trim().toLowerCase();
  return !needle || texts.some((text) => text?.toLowerCase().includes(needle));
}

const filteredLocal = computed(() =>
  (local.value ?? []).filter((replay) =>
    matches(localFilter.value, replay.title, replay.mapFolderName, ...replay.teams.flatMap((team) => team.players)),
  ),
);
const filteredLive = computed(() =>
  (live.value ?? []).filter(
    (game) =>
      matchesLiveFilters(game, liveFilters) &&
      matches(liveFilter.value, game.title, game.mapFolderName, ...game.teams.flatMap((team) => team.players.map((one) => one.login))),
  ),
);

// Replays asked for elsewhere replace the vault filters: a player's a year back, as far as the official client looks,
// or one game, which opens once the vault has it.
const gameToOpen = ref<number | null>(null);
watch(
  replayFocus.request,
  (request) => {
    if (!request) {
      return;
    }
    tab.value = 'vault';
    clearFilters();
    if ('player' in request) {
      filters.player = request.player;
      filters.period = ['year'];
      gameToOpen.value = null;
    } else {
      gameIdText.value = String(request.gameId);
      gameToOpen.value = request.gameId;
    }
    flushPlayer();
    flushGameId();
    replayFocus.done();
  },
  { immediate: true },
);
watch(
  () => result.value?.items,
  (items) => {
    const replay = gameToOpen.value === null ? undefined : items?.find((item) => item.id === gameToOpen.value);
    if (replay) {
      gameToOpen.value = null;
      open({ source: 'vault', replay });
    }
  },
);

const resultCount = computed(() => {
  if (gameId.value !== undefined) {
    return t('replays.filters.byGameId');
  }
  const total = result.value?.totalItems;
  return total === null || total === undefined ? null : t('replays.games', { count: total });
});

const vaultTable = useListTable({
  data: () => result.value?.items ?? [],
  columns: [
    { id: 'game', header: () => t('replays.columns.game'), meta: { class: 'w-[38%] max-w-0' } },
    { id: 'players', header: () => t('replays.columns.players'), meta: { class: 'w-[30%] max-w-0 @max-[34rem]:hidden' } },
    { id: 'ended', header: () => t('replays.columns.ended'), meta: { class: '@max-[44rem]:hidden' } },
    { id: 'duration', header: () => t('replays.columns.duration'), meta: { numeric: true, class: '@max-[56rem]:hidden' } },
    { id: 'rating', header: () => t('replays.columns.rating'), meta: { numeric: true } },
    { id: 'quality', header: () => t('replays.columns.quality'), meta: { numeric: true, class: '@max-[70rem]:hidden' } },
    { id: 'reviews', header: () => t('replays.columns.reviews'), meta: { numeric: true, class: '@max-[62rem]:hidden' } },
  ],
  rowId: (replay) => String(replay.id),
});
const localTable = useListTable({
  data: () => filteredLocal.value,
  columns: [
    { id: 'game', header: () => t('replays.columns.game'), meta: { class: 'w-[38%] max-w-0' } },
    { id: 'players', header: () => t('replays.columns.players'), meta: { class: 'w-[30%] max-w-0 @max-[34rem]:hidden' } },
    { id: 'started', header: () => t('replays.columns.started'), meta: { class: '@max-[44rem]:hidden' } },
    { id: 'duration', header: () => t('replays.columns.duration'), meta: { numeric: true, class: '@max-[56rem]:hidden' } },
    { id: 'source', header: () => t('replays.columns.source'), meta: { class: '@max-[62rem]:hidden' } },
  ],
  rowId: (replay) => replay.file,
});

const selectedId = computed(() => {
  const current = selection.value;
  if (!current) {
    return null;
  }
  return current.source === 'vault' ? String(current.replay.id) : current.source === 'local' ? current.replay.file : String(current.game.id);
});

function changePage(next: number): void {
  page.value = next;
  layout.value?.scrollToTop();
}

function open(next: ReplaySelection): void {
  selection.value = next;
  actionError.value = null;
  showDetails(next);
}

function startWatching(current: ReplaySelection): Promise<void> {
  switch (current.source) {
    case 'vault':
      return window.tfaf.replays.watch(current.replay.id);
    case 'local':
      return window.tfaf.replays.watchFile(current.replay.file);
    case 'live':
      return window.tfaf.replays.watchLive(current.game.id);
  }
}

// The game banner shows the rest, so the panel closes once the launcher has accepted the replay.
async function watchSelected(): Promise<void> {
  const current = selection.value;
  if (!current) {
    return;
  }
  actionError.value = null;
  starting.value = true;
  try {
    await startWatching(current);
    selection.value = null;
  } catch (cause) {
    actionError.value = isCancelled(cause) ? null : errorMessage(cause);
  } finally {
    starting.value = false;
  }
}

async function openFile(): Promise<void> {
  fileError.value = null;
  try {
    await window.tfaf.replays.openFile();
  } catch (cause) {
    fileError.value = errorMessage(cause);
  }
}

async function reveal(file: string): Promise<void> {
  actionError.value = null;
  try {
    await window.tfaf.replays.reveal(file);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

async function remove(replay: LocalReplay): Promise<void> {
  const confirmed = await confirmAction({
    title: t('replays.confirmDelete.title', { title: replay.title }),
    description: t('replays.confirmDelete.description'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  actionError.value = null;
  try {
    await window.tfaf.replays.delete(replay.file);
    selection.value = null;
    await refreshLocal();
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

// Replays of the official client's folder cannot be deleted from here, so they cannot be ticked either.
const bulk = useBulkDelete({
  items: () => filteredLocal.value,
  key: (replay) => replay.file,
  selectable: (replay) => !replay.official,
  name: (replay) => replay.title,
  confirmTitle: (count) => t('vault.bulk.deleteReplays', { count }),
  remove: (replay) => window.tfaf.replays.delete(replay.file),
  done: async () => {
    await refreshLocal();
    const open = selection.value;
    if (open?.source === 'local' && !(local.value ?? []).some((replay) => replay.file === open.replay.file)) {
      selection.value = null;
    }
  },
});
const { selection: ticked } = bulk;

onActivated(() => {
  active.value = true;
  now.value = Date.now();
  void refreshWatched();
});
onDeactivated(() => {
  active.value = false;
});
</script>

<template>
  <ListLayout ref="layout" :panel-open="selection !== null" :placeholder="t('vault.detailPanel.placeholder.replays')" @close-panel="selection = null">
    <template #header>
      <div class="mb-3.5 flex items-center gap-5">
        <h1 class="text-2xl">{{ t('replays.title') }}</h1>
        <Tabs v-model="tab">
          <TabsList>
            <TabsTrigger value="vault" class="px-4">{{ t('replays.tabs.vault') }}</TabsTrigger>
            <TabsTrigger value="local" class="px-4">
              {{ t('replays.tabs.local') }} <span v-if="local" class="text-muted-foreground tabular-nums">{{ local.length }}</span>
            </TabsTrigger>
            <TabsTrigger value="live" class="px-4">
              {{ t('replays.tabs.live') }} <span v-if="live" class="text-muted-foreground tabular-nums">{{ live.length }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <template v-if="tab === 'vault'">
        <ListToolbar>
          <SearchInput
            v-model="filters.map"
            class="max-w-105 flex-[1_1_15rem]"
            :placeholder="t('replays.filters.map')"
            @keydown.enter="flushMap"
          />
          <Input
            v-model="filters.player"
            class="w-44"
            maxlength="100"
            :placeholder="t('replays.filters.playerPlaceholder')"
            :aria-label="t('replays.filters.player')"
            @keydown.enter="flushPlayer"
          />
          <Input
            v-model="gameIdText"
            class="w-28"
            maxlength="11"
            inputmode="numeric"
            :placeholder="t('replays.filters.gameIdPlaceholder')"
            :aria-label="t('replays.filters.gameId')"
            :aria-invalid="gameIdInvalid || undefined"
            @keydown.enter="flushGameId"
          />
          <template #end>
            <SortControl v-model:field="sort" :options="sortOptions" />
            <ViewModeToggle v-model="vaultView" />
          </template>
          <template #filters>
            <FilterChips v-model="filters.period" :label="t('replays.period.label')" :options="periodOptions" required />
            <Select v-model="filters.featuredMod">
              <SelectTrigger size="sm" class="plate-control w-40" :aria-label="t('replays.filters.featuredMod')"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem :value="ANY_MOD">{{ t('replays.filters.anyMod') }}</SelectItem>
                <SelectItem v-for="mod in featuredMods" :key="mod.technicalName" :value="mod.technicalName">
                  {{ mod.displayName }}
                </SelectItem>
              </SelectContent>
            </Select>
            <div class="flex items-center gap-0.75">
              <FilterChip :pressed="filters.ranked" @toggle="filters.ranked = !filters.ranked">
                <Swords />
                {{ t('replays.filters.ranked') }}
              </FilterChip>
              <FilterChip :pressed="filters.own" @toggle="filters.own = !filters.own">
                <UserRound />
                {{ t('replays.filters.own') }}
              </FilterChip>
            </div>
          </template>
        </ListToolbar>
        <ActiveFilters
          :filters="activeFilters"
          :hint="t(`replays.periodHints.${period}`)"
          @remove="removeFilter"
          @clear="clearFilters"
        >
          {{ resultCount }}
        </ActiveFilters>
      </template>

      <template v-else-if="tab === 'local'">
        <ListToolbar>
          <SearchInput v-model="localFilter" class="max-w-105 flex-[1_1_15rem]" :placeholder="t('replays.filters.search')" />
          <template #end>
            <Button variant="outline" :disabled="gameBusy" @click="openFile"><FolderOpen />{{ t('replays.local.openFile') }}</Button>
            <ViewModeToggle v-model="localView" />
            <Button
              variant="ghost"
              size="icon"
              :data-tooltip="t('replays.local.rescan')"
              :aria-label="t('replays.local.rescan')"
              :disabled="localLoading"
              @click="refreshLocal"
            >
              <RefreshCw />
            </Button>
          </template>
        </ListToolbar>
        <ActiveFilters
          :filters="localFilter.trim() ? [{ key: 'text', label: t('replays.filters.text', { text: localFilter.trim() }) }] : []"
          :hint="t('replays.local.hint')"
          @remove="localFilter = ''"
          @clear="localFilter = ''"
        >
          <template v-if="local">
            {{ t('replays.replays', { count: filteredLocal.length }) }}
          </template>
        </ActiveFilters>
      </template>

      <template v-else>
        <ListToolbar>
          <SearchInput v-model="liveFilter" class="max-w-105 flex-[1_1_15rem]" :placeholder="t('replays.filters.search')" />
          <template #end>
            <ViewModeToggle v-model="liveView" />
            <Button
              variant="ghost"
              size="icon"
              :data-tooltip="t('replays.live.refresh')"
              :aria-label="t('replays.live.refresh')"
              @click="refreshLive"
            >
              <RefreshCw />
            </Button>
          </template>
          <template #filters>
            <FilterChips v-model="liveModChoice" :label="t('replays.filters.featuredMod')" :options="liveModOptions" required />
            <div class="flex items-center gap-0.75">
              <FilterChip
                v-for="toggle in LIVE_TOGGLES"
                :key="toggle.key"
                :pressed="liveFilters[toggle.key]"
                @toggle="liveFilters[toggle.key] = !liveFilters[toggle.key]"
              >
                <component :is="toggle.icon" />
                {{ t(toggle.label) }}
              </FilterChip>
            </div>
          </template>
        </ListToolbar>
        <ActiveFilters
          :filters="liveActiveFilters"
          :hint="t('replays.live.hint', { minutes: LIVE_REPLAY_DELAY_SECONDS / 60 })"
          @remove="removeLiveFilter"
          @clear="clearLiveFilters"
        >
          <template v-if="live">
            {{ t('replays.games', { count: filteredLive.length }) }}
          </template>
        </ActiveFilters>
      </template>
    </template>

    <template v-if="tab === 'vault'">
      <Alert v-if="error" variant="destructive" class="mb-4 flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
        <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
      </Alert>

      <template v-if="!result && loading">
        <div v-if="vaultView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
          <Skeleton v-for="index in 12" :key="index" class="aspect-[3/4]" />
        </div>
        <div v-else class="flex flex-col gap-1 pt-10">
          <Skeleton v-for="index in 10" :key="index" class="h-12" />
        </div>
      </template>
      <Empty v-else-if="result && result.items.length === 0 && !loading">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Film /></EmptyMedia>
          <EmptyTitle>{{ t('replays.vault.emptyTitle') }}</EmptyTitle>
          <EmptyDescription>{{ t('replays.vault.emptyDescription') }}</EmptyDescription>
        </EmptyHeader>
        <Button v-if="activeFilters.length" variant="outline" @click="clearFilters">{{ t('replays.filters.reset') }}</Button>
      </Empty>
      <template v-else-if="result">
        <div
          v-if="vaultView === 'cards'"
          class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5 transition-opacity"
          :class="{ 'pointer-events-none opacity-50': loading }"
        >
          <VaultCard
            v-for="replay in result.items"
            :key="replay.id"
            :title="replay.title"
            :image="replay.mapPreviewUrl"
            :subtitle="replay.mapName"
            :meta="[
              playersLine(vaultTeams(replay.teams)),
              joinParts(formatDateTime(replay.endedAt ?? replay.startedAt), formatDuration(replay.durationSeconds)),
            ]"
            :selected="selectedId === String(replay.id)"
            square
            @open="open({ source: 'vault', replay })"
          >
            <template v-if="isWatched(replay.id)" #title-icon>
              <span class="flex shrink-0" role="img" :data-tooltip="t('replays.watched')" :aria-label="t('replays.watched')">
                <Eye class="size-3.5 text-faint" />
              </span>
            </template>
            <template #status>
              <StatusLamp v-if="replay.validity === 'VALID'" tone="success" overlay>{{ t('replays.vault.ranked') }}</StatusLamp>
            </template>
          </VaultCard>
        </div>
        <DataTable
          v-else
          :table="vaultTable"
          :label="t('replays.vault.table')"
          :selected-id="selectedId"
          :loading="loading"
          @select="(replay) => open({ source: 'vault', replay })"
          @activate="(replay) => open({ source: 'vault', replay })"
        >
          <template #cell-game="{ row: replay }">
            <div class="flex min-w-0 items-center gap-3">
              <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
                <PreviewImage small :src="replay.mapPreviewUrl" :fallback="replay.mapPreviewUrl ? '?' : 'GEN'" lazy />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
                  <span class="truncate" :data-tooltip="replay.title">{{ replay.title }}</span>
                  <span
                    v-if="isWatched(replay.id)"
                    class="flex shrink-0"
                    role="img"
                    :data-tooltip="t('replays.watched')"
                    :aria-label="t('replays.watched')"
                  >
                    <Eye class="size-3.5 text-faint" />
                  </span>
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {{ joinParts(replay.mapName, replay.featuredModName) }}
                </span>
              </span>
            </div>
          </template>
          <template #cell-players="{ row: replay }">
            <span class="block truncate text-muted-foreground" :data-tooltip="playersLine(vaultTeams(replay.teams)) ?? undefined">
              {{ playersLine(vaultTeams(replay.teams)) ?? '—' }}
            </span>
          </template>
          <template #cell-ended="{ row: replay }">{{ formatDateTime(replay.endedAt ?? replay.startedAt) ?? '—' }}</template>
          <template #cell-duration="{ row: replay }">{{ formatDuration(replay.durationSeconds) ?? '—' }}</template>
          <template #cell-rating="{ row: replay }">
            <span :class="{ 'text-success': replay.validity === 'VALID' }" :data-tooltip="validityLabel(replay.validity) ?? undefined">
              {{ replay.averageRating ?? '—' }}
            </span>
          </template>
          <template #cell-quality="{ row: replay }">{{ formatQuality(replay.quality) ?? '—' }}</template>
          <template #cell-reviews="{ row: replay }">
            <template v-if="replay.reviews?.numReviews">
              {{ replay.reviews.averageScore.toFixed(1) }}
              <span class="text-faint">({{ formatNumber(replay.reviews.numReviews) }})</span>
            </template>
            <span v-else class="text-faint">—</span>
          </template>
        </DataTable>
        <div class="flex items-center justify-between gap-4 pt-4">
          <span class="text-[13px] text-muted-foreground tabular-nums">
            {{ t('replays.vault.page', { page: result.page, total: result.totalPages }) }}
          </span>
          <PageNav :page="result.page" :total-pages="result.totalPages" :disabled="loading" @change="changePage" />
        </div>
      </template>
    </template>

    <template v-else-if="tab === 'local'">
      <Alert v-if="localError" variant="destructive" class="mb-4">
        <AlertDescription class="selectable">{{ localError }}</AlertDescription>
      </Alert>
      <div v-if="!local && localLoading" class="flex flex-col gap-1 pt-10">
        <Skeleton v-for="index in 8" :key="index" class="h-12" />
      </div>
      <Empty v-else-if="local && filteredLocal.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Film /></EmptyMedia>
          <EmptyTitle>{{ local.length ? t('replays.local.notFound') : t('replays.local.empty') }}</EmptyTitle>
          <EmptyDescription>{{ t('replays.local.emptyDescription') }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <div v-else-if="localView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
        <VaultCard
          v-for="replay in filteredLocal"
          :key="replay.file"
          :title="replay.title"
          :image="replay.mapPreviewUrl"
          :subtitle="replay.mapFolderName ? mapDisplayName(replay.mapFolderName) : null"
          :meta="[
            playersLine(replay.teams),
            joinParts(formatDateTime(replay.startedAt), formatDuration(durationBetween(replay.startedAt, replay.endedAt))),
          ]"
          :selected="selectedId === replay.file"
          checkable
          :checked="ticked.isSelected(replay)"
          :check-label="t('vault.bulk.select', { name: replay.title })"
          :check-disabled="replay.official"
          :selecting="ticked.count.value > 0"
          square
          @open="open({ source: 'local', replay })"
          @check="(value) => ticked.toggle(replay, value)"
        >
          <template v-if="isWatched(replay.id)" #title-icon>
            <span class="flex shrink-0" role="img" :data-tooltip="t('replays.watched')" :aria-label="t('replays.watched')">
              <Eye class="size-3.5 text-faint" />
            </span>
          </template>
          <template #status>
            <StatusLamp v-if="replay.official" tone="info" overlay>{{ t('replays.local.officialClient') }}</StatusLamp>
          </template>
        </VaultCard>
      </div>
      <DataTable
        v-else
        :table="localTable"
        :label="t('replays.local.table')"
        :selected-id="selectedId"
        :selection="ticked"
        :row-label="(replay) => replay.title"
        @select="(replay) => open({ source: 'local', replay })"
      >
        <template #cell-game="{ row: replay }">
          <div class="flex min-w-0 items-center gap-3">
            <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
              <PreviewImage small :src="replay.mapPreviewUrl" :fallback="replay.mapPreviewUrl ? '?' : 'GEN'" lazy />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
                <span class="truncate" :data-tooltip="replay.title">{{ replay.title }}</span>
                <span
                  v-if="isWatched(replay.id)"
                  class="flex shrink-0"
                  role="img"
                  :data-tooltip="t('replays.watched')"
                  :aria-label="t('replays.watched')"
                >
                  <Eye class="size-3.5 text-faint" />
                </span>
              </span>
              <span class="truncate text-xs text-muted-foreground">
                {{ joinParts(replay.mapFolderName ? mapDisplayName(replay.mapFolderName) : null, replay.featuredModName) }}
              </span>
            </span>
          </div>
        </template>
        <template #cell-players="{ row: replay }">
          <span class="block truncate text-muted-foreground" :data-tooltip="playersLine(replay.teams) ?? undefined">
            {{ playersLine(replay.teams) ?? '—' }}
          </span>
        </template>
        <template #cell-started="{ row: replay }">{{ formatDateTime(replay.startedAt) ?? '—' }}</template>
        <template #cell-duration="{ row: replay }">
          {{ formatDuration(durationBetween(replay.startedAt, replay.endedAt)) ?? '—' }}
        </template>
        <template #cell-source="{ row: replay }">
          <StatusLamp v-if="replay.official" tone="info">{{ t('replays.local.officialClient') }}</StatusLamp>
          <span v-else class="text-muted-foreground">TFAF</span>
        </template>
      </DataTable>
      <BulkBar
        :count="ticked.count.value"
        :total="ticked.selectableCount.value"
        :label="t('vault.bulk.replays', { count: ticked.count.value })"
        :busy="bulk.busy.value"
        :error="bulk.error.value"
        @delete="bulk.deleteSelected"
        @select-all="ticked.setAll(true)"
        @clear="ticked.clear"
        @dismiss-error="bulk.error.value = null"
      />
    </template>

    <template v-else>
      <Alert v-if="liveError" variant="destructive" class="mb-4">
        <AlertDescription class="selectable">{{ liveError }}</AlertDescription>
      </Alert>
      <Alert v-else-if="lobby.status !== 'connected'" class="mb-4">
        <AlertDescription>{{ t('replays.live.noLobby') }}</AlertDescription>
      </Alert>
      <Empty v-if="live && filteredLive.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Film /></EmptyMedia>
          <EmptyTitle>{{ live.length ? t('replays.live.notFound') : t('replays.live.empty') }}</EmptyTitle>
        </EmptyHeader>
      </Empty>
      <LiveReplayList
        v-else
        :games="filteredLive"
        :view="liveView"
        :selected-id="selectedId"
        :now="now"
        @open="(game) => open({ source: 'live', game })"
      />
    </template>

    <template #panel>
      <ReplayDetailPanel
        v-if="selection"
        :selection="selection"
        :item-key="selectedId ?? ''"
        :details="selectedDetails"
        :error="actionError"
        :starting="starting"
        :now="now"
        :watchable-in="selection.source === 'live' ? watchableIn(selection.game, now) : 0"
        @close="selection = null"
        @watch="watchSelected"
        @load-details="selection && loadDetails(selection)"
        @reveal="reveal"
        @remove="remove"
        @error="(message) => (actionError = message)"
      />
    </template>
  </ListLayout>
</template>
