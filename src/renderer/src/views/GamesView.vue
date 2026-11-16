<script setup lang="ts">
import { Bot, Lock, Plus, Puzzle, RefreshCw, Sparkles, Swords, UserRound, Users } from '@lucide/vue';
import { computed, defineAsyncComponent, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { LobbyGame, SortOrder } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import ActiveFilters from '../components/ActiveFilters.vue';
import CountryFlag from '../components/CountryFlag.vue';
import DataTable from '../components/DataTable.vue';
import DetailPanel from '../components/DetailPanel.vue';
import DetailPreview from '../components/DetailPreview.vue';
import DetailStats from '../components/DetailStats.vue';
import FilterChip from '../components/FilterChip.vue';
import FilterChips from '../components/FilterChips.vue';
import GameCard from '../components/GameCard.vue';
import ListLayout from '../components/ListLayout.vue';
import ListToolbar from '../components/ListToolbar.vue';
import type { ActiveFilter, SortOption } from '../components/listKit.ts';
import PreviewImage from '../components/PreviewImage.vue';
import SearchInput from '../components/SearchInput.vue';
import SortControl from '../components/SortControl.vue';
import PlayerName from '../components/PlayerName.vue';
import TeamList from '../components/TeamList.vue';
import TfafBadge from '../components/TfafBadge.vue';
import ViewModeToggle from '../components/ViewModeToggle.vue';
import { useGameFocus } from '../composables/useGameFocus.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { useLobby } from '../composables/useLobby.ts';
import { useViewMode } from '../composables/useViewMode.ts';
import { errorMessage, formatDate, formatQuality, joinParts, mapDisplayName, ratingRangeLabel, timeAgo } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useListTable } from '../lib/listTable.ts';
import { friendsIn, friendsLabel } from '../lib/lobbyGames.ts';

const CreateGameDialog = defineAsyncComponent(() => import('../components/CreateGameDialog.vue'));
const JoinPasswordDialog = defineAsyncComponent(() => import('../components/JoinPasswordDialog.vue'));

type SortField = 'players' | 'rating' | 'hosted' | 'title';

interface StoredFilters {
  featuredMod: string;
  hidePrivate: boolean;
  hideModded: boolean;
  hideFull: boolean;
  withFriends: boolean;
  generatedOnly: boolean;
  sortField: SortField;
  sortOrder: SortOrder;
}

const SORT_OPTIONS: (Omit<SortOption<SortField>, 'label'> & { label: MessageKey })[] = [
  { value: 'players', label: 'games.sort.players', order: 'desc' },
  { value: 'rating', label: 'games.sort.rating', order: 'desc' },
  { value: 'hosted', label: 'games.sort.hosted', order: 'desc' },
  { value: 'title', label: 'games.sort.title', order: 'asc' },
];
const STORAGE_KEY = 'tfaf.customGames.filters';
const DEFAULTS: StoredFilters = {
  featuredMod: '',
  hidePrivate: false,
  hideModded: false,
  hideFull: false,
  withFriends: false,
  generatedOnly: false,
  sortField: 'players',
  sortOrder: 'desc',
};

// Filters are a per-user convenience; storage may be unavailable, so failures fall back to defaults.
function loadFilters(): StoredFilters {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof stored === 'object' && stored !== null) {
      const raw = stored as Partial<StoredFilters>;
      return {
        featuredMod: typeof raw.featuredMod === 'string' ? raw.featuredMod : '',
        hidePrivate: raw.hidePrivate === true,
        hideModded: raw.hideModded === true,
        hideFull: raw.hideFull === true,
        withFriends: raw.withFriends === true,
        generatedOnly: raw.generatedOnly === true,
        sortField: SORT_OPTIONS.some((option) => option.value === raw.sortField) ? (raw.sortField as SortField) : DEFAULTS.sortField,
        sortOrder: raw.sortOrder === 'asc' || raw.sortOrder === 'desc' ? raw.sortOrder : DEFAULTS.sortOrder,
      };
    }
  } catch {
    // Ignore unreadable storage.
  }
  return { ...DEFAULTS };
}

const stored = loadFilters();
const filters = reactive({
  text: '',
  featuredMod: stored.featuredMod,
  hidePrivate: stored.hidePrivate,
  hideModded: stored.hideModded,
  hideFull: stored.hideFull,
  withFriends: stored.withFriends,
  generatedOnly: stored.generatedOnly,
});
const sort = reactive({ field: stored.sortField, order: stored.sortOrder });

watch(
  () =>
    ({
      featuredMod: filters.featuredMod,
      hidePrivate: filters.hidePrivate,
      hideModded: filters.hideModded,
      hideFull: filters.hideFull,
      withFriends: filters.withFriends,
      generatedOnly: filters.generatedOnly,
      sortField: sort.field,
      sortOrder: sort.order,
    }) satisfies StoredFilters,
  (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Ignore unavailable storage.
    }
  },
);

const { state, games: lobbyGames, reconnect } = useLobby();
const games = computed(() => lobbyGames.value.filter((game) => game.gameType === 'custom'));
const { state: session } = useGameSession();
const gameFocus = useGameFocus();
const viewMode = useViewMode('games');
const creating = ref(false);
const joining = ref(false);
const joinError = ref<string | null>(null);
/** The game whose password the dialog asks for. */
const passwordGame = ref<LobbyGame | null>(null);
const canStartGame = computed(() => state.value.status === 'connected' && session.value.phase === 'idle');
const selectedId = ref<number | null>(null);
const lastSelected = ref<LobbyGame | null>(null);
const actionError = ref<string | null>(null);
const reconnecting = ref(false);
const now = ref(Date.now());
const sortOptions = computed<SortOption<SortField>[]>(() =>
  SORT_OPTIONS.map((option) => ({ ...option, label: t(option.label) })),
);

const ticker = setInterval(() => {
  now.value = Date.now();
}, 30_000);
onBeforeUnmount(() => clearInterval(ticker));

const featuredModOptions = computed(() => {
  const names = new Map<string, string>();
  for (const game of games.value) {
    names.set(game.featuredMod, game.featuredModName);
  }
  if (filters.featuredMod && !names.has(filters.featuredMod)) {
    names.set(filters.featuredMod, filters.featuredMod);
  }
  const mods = [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
    .map(([value, label]) => ({ value, label }));
  return [{ value: '', label: t('games.filters.allFeaturedMods') }, ...mods];
});
const featuredModChoice = computed<string[]>({
  get: () => [filters.featuredMod],
  set: ([value]) => {
    filters.featuredMod = value ?? '';
  },
});

function compare(a: LobbyGame, b: LobbyGame): number {
  switch (sort.field) {
    case 'players':
      return a.numPlayers - b.numPlayers;
    case 'rating':
      return (a.averageRating ?? -Infinity) - (b.averageRating ?? -Infinity);
    case 'hosted':
      return (a.hostedAt ?? '').localeCompare(b.hostedAt ?? '');
    case 'title':
      return a.title.localeCompare(b.title, 'ru');
  }
}

function isFull(game: LobbyGame): boolean {
  return game.maxPlayers > 0 && game.numPlayers >= game.maxPlayers;
}

const visibleGames = computed(() => {
  const text = filters.text.trim().toLowerCase();
  const direction = sort.order === 'asc' ? 1 : -1;
  return games.value
    .filter((game) => !filters.hidePrivate || !game.passwordProtected)
    .filter((game) => !filters.hideModded || game.simMods.length === 0)
    .filter((game) => !filters.hideFull || !isFull(game))
    .filter((game) => !filters.withFriends || friendsIn(game).length > 0)
    .filter((game) => !filters.generatedOnly || game.generatedMap)
    .filter((game) => !filters.featuredMod || game.featuredMod === filters.featuredMod)
    .filter(
      (game) =>
        !text ||
        game.title.toLowerCase().includes(text) ||
        game.host.toLowerCase().includes(text) ||
        game.mapFolderName.toLowerCase().includes(text),
    )
    .sort((a, b) => direction * compare(a, b) || a.id - b.id);
});

const activeFilters = computed<ActiveFilter[]>(() => {
  const list: ActiveFilter[] = [];
  if (filters.text.trim()) {
    list.push({ key: 'text', label: t('games.filters.textActive', { text: filters.text.trim() }) });
  }
  if (filters.featuredMod) {
    const option = featuredModOptions.value.find((item) => item.value === filters.featuredMod);
    list.push({ key: 'featuredMod', label: t('games.filters.featuredModActive', { name: option?.label ?? filters.featuredMod }) });
  }
  if (filters.withFriends) {
    list.push({ key: 'withFriends', label: t('games.filters.withFriends') });
  }
  if (filters.hideFull) {
    list.push({ key: 'hideFull', label: t('games.filters.hideFull') });
  }
  if (filters.hidePrivate) {
    list.push({ key: 'hidePrivate', label: t('games.filters.hidePrivate') });
  }
  if (filters.hideModded) {
    list.push({ key: 'hideModded', label: t('games.filters.hideModded') });
  }
  if (filters.generatedOnly) {
    list.push({ key: 'generatedOnly', label: t('games.filters.generatedOnly') });
  }
  return list;
});

function removeFilter(key: string): void {
  switch (key) {
    case 'text':
    case 'featuredMod':
      filters[key] = '';
      break;
    case 'withFriends':
    case 'hideFull':
    case 'hidePrivate':
    case 'hideModded':
    case 'generatedOnly':
      filters[key] = false;
      break;
  }
}

function resetFilters(): void {
  Object.assign(filters, {
    text: '',
    featuredMod: '',
    hidePrivate: false,
    hideModded: false,
    hideFull: false,
    withFriends: false,
    generatedOnly: false,
  });
}

const table = useListTable({
  data: () => visibleGames.value,
  columns: [
    { id: 'game', header: () => t('games.columns.game'), meta: { class: 'w-[40%] max-w-0' } },
    { id: 'host', header: () => t('games.columns.host'), meta: { class: 'max-w-40 @max-[48rem]:hidden' } },
    { id: 'players', header: () => t('games.columns.players'), sortDescFirst: true, meta: { class: 'w-32' } },
    { id: 'rating', header: () => t('games.columns.rating'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'limit', header: () => t('games.columns.limit'), meta: { class: '@max-[56rem]:hidden' } },
    { id: 'hosted', header: () => t('games.columns.hosted'), sortDescFirst: true, meta: { class: '@max-[40rem]:hidden' } },
  ],
  rowId: (game) => String(game.id),
  sort,
  sortFields: { game: 'title', players: 'players', rating: 'rating', hosted: 'hosted' },
});

const liveSelected = computed(() => games.value.find((game) => game.id === selectedId.value) ?? null);
const selected = computed(() => liveSelected.value ?? lastSelected.value);

watch(liveSelected, (game) => {
  if (game) {
    lastSelected.value = game;
  }
});

// A game shown from the chat opens here once the app has switched to this list.
watch(
  () => gameFocus.request.value,
  (request) => {
    const game = request ? games.value.find((item) => item.id === request.gameId) : null;
    if (game) {
      open(game);
      gameFocus.done();
    }
  },
  { immediate: true },
);

function open(game: LobbyGame): void {
  if (selectedId.value !== game.id) {
    joinError.value = null;
  }
  selectedId.value = game.id;
  lastSelected.value = game;
}

// The launcher tells whether the game needs a password: for a TFAF lobby only the host's launcher knows it.
async function join(game: LobbyGame): Promise<void> {
  joinError.value = null;
  joining.value = true;
  try {
    if ((await window.tfaf.game.join(game.id, null)) === 'passwordRequired') {
      passwordGame.value = game;
    } else {
      close();
    }
  } catch (cause) {
    open(game);
    joinError.value = errorMessage(cause);
  } finally {
    joining.value = false;
  }
}

/** A double click joins right away; a game with a password asks for it in a dialog. */
function quickJoin(game: LobbyGame): void {
  if (!canStartGame.value || joining.value) {
    open(game);
  } else {
    void join(game);
  }
}

function submitJoin(): void {
  if (liveSelected.value && canJoin.value) {
    void join(liveSelected.value);
  }
}

const canJoin = computed(() => liveSelected.value !== null && canStartGame.value && !joining.value);

function close(): void {
  selectedId.value = null;
  lastSelected.value = null;
}

const startingSkirmish = ref(false);

async function skirmish(): Promise<void> {
  actionError.value = null;
  startingSkirmish.value = true;
  try {
    await window.tfaf.game.skirmish(true);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  } finally {
    startingSkirmish.value = false;
  }
}

async function connect(): Promise<void> {
  actionError.value = null;
  reconnecting.value = true;
  try {
    await reconnect();
  } catch (cause) {
    actionError.value = errorMessage(cause);
  } finally {
    reconnecting.value = false;
  }
}
</script>

<template>
  <ListLayout :panel-open="selected !== null" :placeholder="t('vault.detailPanel.placeholder.games')" @close-panel="close">
    <template #header>
      <div class="mb-3.5 flex items-center gap-5">
        <h1 class="text-2xl">{{ t('games.title') }}</h1>
        <div class="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            :disabled="session.phase !== 'idle' || startingSkirmish"
            :data-tooltip="t('games.skirmishHint')"
            @click="skirmish"
          >
            <Bot />
            {{ t('games.skirmish') }}
          </Button>
          <Button size="lg" :disabled="!canStartGame" @click="creating = true">
            <Plus />
            {{ t('games.create') }}
          </Button>
        </div>
      </div>

      <Alert v-if="state.status !== 'connected'" :variant="state.error ? 'destructive' : 'default'" class="mb-3.5 flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">
          <template v-if="state.status === 'connecting'">{{ t('games.connecting') }}</template>
          <template v-else>
            {{ state.error ? t('games.disconnectedWithError', { error: state.error }) : t('games.disconnected') }}
          </template>
        </AlertDescription>
        <Spinner v-if="state.status === 'connecting'" class="text-warning" />
        <Button v-else variant="outline" size="sm" :disabled="reconnecting" @click="connect">
          <RefreshCw :class="{ 'animate-spin': reconnecting }" />
          {{ t('games.connect') }}
        </Button>
      </Alert>
      <Alert v-if="actionError" variant="destructive" class="mb-3.5">
        <AlertDescription class="selectable">{{ actionError }}</AlertDescription>
      </Alert>

      <ListToolbar>
        <SearchInput v-model="filters.text" class="max-w-105 flex-[1_1_15rem]" :placeholder="t('games.searchPlaceholder')" />
        <template #end>
          <SortControl v-model:field="sort.field" v-model:order="sort.order" :options="sortOptions" />
          <ViewModeToggle v-model="viewMode" />
        </template>
        <template #filters>
          <FilterChips v-model="featuredModChoice" :label="t('games.filters.featuredMod')" :options="featuredModOptions" required />
          <div class="flex items-center gap-0.75">
            <FilterChip :pressed="filters.withFriends" @toggle="filters.withFriends = !filters.withFriends">
              <UserRound />
              {{ t('games.filters.withFriends') }}
            </FilterChip>
            <FilterChip :pressed="filters.hideFull" @toggle="filters.hideFull = !filters.hideFull">
              <Users />
              {{ t('games.filters.hideFull') }}
            </FilterChip>
            <FilterChip :pressed="filters.hidePrivate" @toggle="filters.hidePrivate = !filters.hidePrivate">
              <Lock />
              {{ t('games.filters.hidePrivate') }}
            </FilterChip>
            <FilterChip :pressed="filters.hideModded" @toggle="filters.hideModded = !filters.hideModded">
              <Puzzle />
              {{ t('games.filters.hideModded') }}
            </FilterChip>
            <FilterChip :pressed="filters.generatedOnly" @toggle="filters.generatedOnly = !filters.generatedOnly">
              <Sparkles />
              {{ t('games.filters.generatedOnly') }}
            </FilterChip>
          </div>
        </template>
      </ListToolbar>
      <ActiveFilters
        :filters="activeFilters"
        :hint="t('games.filters.hint')"
        @remove="removeFilter"
        @clear="resetFilters"
      >
        <template v-if="activeFilters.length">
          {{ t('games.shownOfTotal', { shown: visibleGames.length, total: games.length }) }}
        </template>
        <template v-else>{{ t('games.total', { count: games.length }) }}</template>
      </ActiveFilters>
    </template>

    <Empty v-if="visibleGames.length === 0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Swords /></EmptyMedia>
        <EmptyTitle>
          {{
            games.length > 0
              ? t('games.empty.filtered')
              : state.status === 'connected'
                ? t('games.empty.none')
                : t('games.empty.offline')
          }}
        </EmptyTitle>
        <EmptyDescription v-if="games.length === 0 && state.status === 'connected'">
          {{ t('games.empty.hint') }}
        </EmptyDescription>
      </EmptyHeader>
      <Button v-if="games.length > 0" variant="outline" @click="resetFilters">{{ t('games.filters.reset') }}</Button>
    </Empty>
    <div v-else-if="viewMode === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
      <GameCard
        v-for="game in visibleGames"
        :key="game.id"
        :game="game"
        :selected="game.id === selectedId"
        @open="open(game)"
        @quick-join="quickJoin(game)"
      />
    </div>
    <DataTable
      v-else
      :table="table"
      :label="t('games.tableLabel')"
      :selected-id="selectedId === null ? null : String(selectedId)"
      :highlighted="(game) => friendsIn(game).length > 0"
      @select="open"
      @activate="quickJoin"
    >
      <template #cell-game="{ row: game }">
        <div class="flex min-w-0 items-center gap-3" :data-tooltip="t('games.quickJoinHint')">
          <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
            <PreviewImage small :src="game.mapPreviewUrl" :fallback="game.mapPreviewUrl ? '?' : 'GEN'" lazy />
          </span>
          <span class="flex min-w-0 flex-col">
            <span class="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
              <span class="truncate">{{ game.title || t('games.untitled') }}</span>
              <Badge v-if="game.tfafLobby" variant="accent" class="shrink-0">TFAF</Badge>
              <Lock v-else-if="game.passwordProtected" class="size-3.5 shrink-0 text-warning" :aria-label="t('games.withPassword')" />
            </span>
            <span v-if="friendsLabel(game)" class="flex min-w-0 items-center gap-1 text-xs font-medium text-info">
              <UserRound class="size-3 shrink-0" />
              <span class="truncate">{{ friendsLabel(game) }}</span>
            </span>
            <span class="truncate text-xs text-muted-foreground">
              {{
                joinParts(
                  mapDisplayName(game.mapFolderName),
                  game.featuredMod !== 'faf' ? game.featuredModName : null,
                  game.simMods.length ? t('games.modCount', { count: game.simMods.length }) : null,
                )
              }}
            </span>
          </span>
        </div>
      </template>
      <template #cell-host="{ row: game }">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="truncate selectable">{{ game.host }}</span>
          <TfafBadge :login="game.host" />
        </span>
      </template>
      <template #cell-players="{ row: game }">
        <div class="flex items-center gap-2">
          <div class="h-1 w-14 overflow-hidden bg-background">
            <div
              class="h-full"
              :class="isFull(game) ? 'bg-warning' : 'bg-success'"
              :style="{ width: `${game.maxPlayers > 0 ? Math.min(game.numPlayers / game.maxPlayers, 1) * 100 : 0}%` }"
            />
          </div>
          <span class="tabular-nums">{{ game.numPlayers }}/{{ game.maxPlayers }}</span>
        </div>
      </template>
      <template #cell-rating="{ row: game }">{{ game.averageRating ?? '—' }}</template>
      <template #cell-limit="{ row: game }">
        <span :class="game.enforceRatingRange ? 'text-warning' : 'text-muted-foreground'">
          {{ ratingRangeLabel(game.ratingMin, game.ratingMax) ?? '—' }}
        </span>
      </template>
      <template #cell-hosted="{ row: game }">
        <span class="text-muted-foreground">{{ timeAgo(game.hostedAt, now) ?? '—' }}</span>
      </template>
    </DataTable>

    <template #panel>
      <DetailPanel
        v-if="selected"
        :title="selected.title || t('games.untitled')"
        :kind="t('games.detail.kind')"
        :item-key="selected.id"
        @close="close"
      >
        <template #media>
          <DetailPreview
            :preview="{
              title: mapDisplayName(selected.mapFolderName),
              details: selected.mapFolderName,
              src: selected.mapPreviewLargeUrl,
              fallbackSrc: selected.mapPreviewUrl,
            }"
            :fallback="selected.mapPreviewUrl ? '?' : 'GEN'"
            :map-folder="selected.mapFolderName"
          />
        </template>
        <Alert v-if="!liveSelected" variant="warning">
          <AlertDescription>{{ t('games.detail.gone') }}</AlertDescription>
        </Alert>
        <div class="flex flex-wrap gap-1.5">
          <Badge :variant="selected.featuredMod === 'faf' ? 'muted' : 'accent'">{{ selected.featuredModName }}</Badge>
          <Badge v-if="selected.tfafLobby" variant="accent">{{ t('games.detail.tfafLobby') }}</Badge>
          <Badge v-if="selected.tfafLobby" variant="warning" :data-tooltip="t('tfafLobby.badges.experimentalHint')">{{ t('tfafLobby.badges.experimental') }}</Badge>
          <Badge v-else-if="selected.passwordProtected" variant="warning"><Lock />{{ t('games.detail.password') }}</Badge>
          <Badge v-if="selected.friendsOnly" variant="info">{{ t('games.detail.friendsOnly') }}</Badge>
        </div>
        <p v-if="selected.tfafLobby" class="text-sm text-muted-foreground">{{ t('games.detail.tfafLobbyHint') }}</p>
        <DetailStats
          :items="[
            { label: t('games.detail.map'), value: mapDisplayName(selected.mapFolderName) },
            { label: t('games.detail.host'), value: selected.host },
            {
              label: t('games.detail.players'),
              value: t('games.detail.playersOfMax', { players: selected.numPlayers, max: selected.maxPlayers }),
            },
            { label: t('games.detail.averageRating'), value: selected.averageRating },
            { label: t('games.detail.quality'), value: formatQuality(selected.quality) },
            {
              label: t('games.detail.ratingLimit'),
              value: ratingRangeLabel(selected.ratingMin, selected.ratingMax) ?? t('games.detail.noRatingLimit'),
              note:
                selected.enforceRatingRange && (selected.ratingMin !== null || selected.ratingMax !== null)
                  ? t('games.detail.strictRatingLimit')
                  : null,
            },
            { label: t('games.detail.hosted'), value: timeAgo(selected.hostedAt, now) ?? formatDate(selected.hostedAt) },
          ]"
        />
        <TeamList :teams="selected.teams" :player-key="(one) => String(one.id ?? one.login)">
          <template #default="{ player: one }">
            <CountryFlag v-if="one.country" :country="one.country" />
            <PlayerName :login="one.login" :id="one.id" :clan="one.clan" :avatar="one.avatar" />
            <span v-if="one.friend" class="text-xs text-info">{{ t('games.detail.friend') }}</span>
            <span class="text-muted-foreground tabular-nums">{{ one.rating ?? '—' }}</span>
          </template>
        </TeamList>
        <div v-if="selected.simMods.length" class="flex flex-col gap-1">
          <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('games.detail.mods') }}</h3>
          <ul class="flex flex-col gap-px border bg-border">
            <li v-for="mod in selected.simMods" :key="mod.uid" class="bg-background px-2.5 py-1.5 text-[13px] selectable">
              {{ mod.name }}
            </li>
          </ul>
        </div>

        <Alert v-if="joinError" variant="destructive">
          <AlertDescription class="selectable">{{ joinError }}</AlertDescription>
        </Alert>

        <template #actions>
          <Button size="lg" :disabled="!canJoin" @click="submitJoin">
            <Spinner v-if="joining" />
            <Swords v-else />
            {{ t('games.detail.join') }}
          </Button>
          <p v-if="session.phase !== 'idle'" class="text-xs text-muted-foreground">{{ t('games.joinState.otherGameRunning') }}</p>
          <p v-else-if="state.status !== 'connected'" class="text-xs text-muted-foreground">{{ t('games.joinState.noLobby') }}</p>
        </template>
      </DetailPanel>
    </template>

    <CreateGameDialog v-if="creating" @close="creating = false" />
    <JoinPasswordDialog v-if="passwordGame" :game="passwordGame" @joined="close" @close="passwordGame = null" />
  </ListLayout>
</template>
