<script setup lang="ts">
import { Award, CircleArrowUp, Download, Expand, Map, RefreshCw, Star, Swords, Upload, UserRound, Users } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, defineAsyncComponent, onActivated, ref, useTemplateRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { VaultMap } from '../../../shared/contract.ts';
import ActiveFilters from '../components/ActiveFilters.vue';
import BulkBar from '../components/BulkBar.vue';
import DataTable from '../components/DataTable.vue';
import FilterChip from '../components/FilterChip.vue';
import ListLayout from '../components/ListLayout.vue';
import ListToolbar from '../components/ListToolbar.vue';
import MapDetailPanel, { type MapSelection, type MapVaultStatus } from '../components/MapDetailPanel.vue';
import PageNav from '../components/PageNav.vue';
import PreviewImage from '../components/PreviewImage.vue';
import RangeFilter from '../components/RangeFilter.vue';
import SearchInput from '../components/SearchInput.vue';
import SortControl from '../components/SortControl.vue';
import StatusLamp from '../components/StatusLamp.vue';
import VaultCard from '../components/VaultCard.vue';
import ViewModeToggle from '../components/ViewModeToggle.vue';
import { useBulkDelete } from '../composables/useBulkDelete.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { useInstalledMapFilters } from '../composables/useInstalledMapFilters.ts';
import { useLobby } from '../composables/useLobby.ts';
import { useMapVaultCheck } from '../composables/useMapVaultCheck.ts';
import { PLAYER_STEPS, SIZE_STEPS, useMapVaultFilters } from '../composables/useMapVaultFilters.ts';
import { useViewMode } from '../composables/useViewMode.ts';
import { errorMessage, formatDate, formatNumber, isCancelled, mapBaseName, mapSizeLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useListTable } from '../lib/listTable.ts';
import { queries, queryClient, queryState, refreshStale } from '../lib/queries.ts';

const CreateGameDialog = defineAsyncComponent(() => import('../components/CreateGameDialog.vue'));
const UploadDialog = defineAsyncComponent(() => import('../components/UploadDialog.vue'));

const { state: lobby } = useLobby();
const { state: session } = useGameSession();
const canStartGame = computed(() => lobby.value.status === 'connected' && session.value.phase === 'idle');

const tab = ref<'vault' | 'installed'>('vault');
const vaultView = useViewMode('maps.vault');
const installedView = useViewMode('maps.installed');
const layout = useTemplateRef<InstanceType<typeof ListLayout>>('layout');

const { filters, sort, sortOptions, page, flushName, flushAuthor, query, activeFilters, removeFilter, clearFilters } = useMapVaultFilters();
const { data: result, loading, error, reload } = queryState(useQuery(() => queries.vaultMaps(query.value)));

const {
  data: installedMaps,
  error: installedError,
  reload: refreshInstalled,
} = queryState(useQuery(queries.installedMaps()));
const installed = computed(() => installedMaps.value ?? []);
const {
  folders: vaultFolders,
  isLocal,
  error: vaultCheckError,
  reload: reloadVaultCheck,
} = useMapVaultCheck(() => installed.value, () => tab.value === 'installed');
const {
  filters: localFilters,
  sort: localSort,
  sortOptions: localSortOptions,
  filtered: filteredInstalled,
  waitingForVault,
  activeFilters: localActiveFilters,
  removeFilter: removeLocalFilter,
  clearFilters: clearLocalFilters,
} = useInstalledMapFilters(() => installed.value, { vaultFolders: () => vaultFolders.value });
const pending = ref(new Set<string>());

const selection = ref<MapSelection | null>(null);
// The panel belongs to the list it was opened from.
watch(tab, () => {
  selection.value = null;
});
const actionError = ref<string | null>(null);
const uploadOpen = ref(false);
const hostingMap = ref<string | null>(null);

const installedNames = computed(() => new Set(installed.value.map((map) => map.folderName.toLowerCase())));
const installedBaseNames = computed(
  () => new Set(installed.value.filter((map) => !map.official).map((map) => mapBaseName(map.folderName))),
);
const customInstalledCount = computed(() => installed.value.filter((map) => !map.official).length);

function vaultStatus(map: VaultMap): MapVaultStatus {
  if (installedNames.value.has(map.folderName.toLowerCase())) {
    return 'installed';
  }
  return installedBaseNames.value.has(mapBaseName(map.folderName)) ? 'outdated' : null;
}

const vaultTable = useListTable({
  data: () => result.value?.items ?? [],
  columns: [
    { id: 'name', header: () => t('maps.columns.map'), meta: { class: 'w-full max-w-0' } },
    { id: 'players', header: () => t('maps.columns.players'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'size', header: () => t('maps.columns.size'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'rating', header: () => t('vault.columns.rating'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'plays', header: () => t('maps.columns.plays'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'updated', header: () => t('maps.columns.updated'), sortDescFirst: true, meta: { class: '@max-[56rem]:hidden' } },
    { id: 'status', header: () => t('vault.columns.status'), meta: { class: '@max-[44rem]:hidden' } },
    { id: 'actions', header: '', meta: { class: 'w-13 text-right' } },
  ],
  rowId: (map) => String(map.mapId),
  sort,
  sortFields: {
    name: 'displayName',
    players: 'latestVersion.maxPlayers',
    size: 'latestVersion.width',
    rating: 'reviewsSummary.lowerBound',
    plays: 'gamesPlayed',
    updated: 'latestVersion.updateTime',
  },
});

const localTable = useListTable({
  data: () => filteredInstalled.value,
  columns: [
    { id: 'name', header: () => t('maps.columns.map'), meta: { class: 'w-full max-w-0' } },
    { id: 'players', header: () => t('maps.columns.players'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'size', header: () => t('maps.columns.size'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'added', header: () => t('maps.columns.added'), sortDescFirst: true, meta: { class: '@max-[48rem]:hidden' } },
    { id: 'kind', header: () => t('maps.columns.source'), meta: { class: '@max-[40rem]:hidden' } },
    { id: 'actions', header: '', meta: { class: 'w-13 text-right' } },
  ],
  rowId: (map) => map.folderName,
  sort: localSort,
  sortFields: { name: 'name', added: 'added', players: 'players', size: 'size' },
});

const selectedId = computed(() => {
  const current = selection.value;
  return current?.source === 'vault' ? String(current.map.mapId) : (current?.map.folderName ?? null);
});
const selectedVaultStatus = computed(() => (selection.value?.source === 'vault' ? vaultStatus(selection.value.map) : null));
const resultCount = computed(() => {
  const total = result.value?.totalItems;
  return total === null || total === undefined ? null : t('maps.count', { count: total });
});

function setPending(folderName: string, active: boolean): void {
  const next = new Set(pending.value);
  if (active) {
    next.add(folderName);
  } else {
    next.delete(folderName);
  }
  pending.value = next;
}

function changePage(next: number): void {
  page.value = next;
  layout.value?.scrollToTop();
}

function open(next: MapSelection): void {
  selection.value = next;
  actionError.value = null;
}

async function install(map: VaultMap): Promise<void> {
  actionError.value = null;
  setPending(map.folderName, true);
  try {
    await window.tfaf.maps.install(map.versionId);
    await refreshInstalled();
  } catch (cause) {
    const message = isCancelled(cause) ? null : errorMessage(cause);
    if (message) {
      open({ source: 'vault', map });
      actionError.value = message;
    }
  } finally {
    setPending(map.folderName, false);
  }
}

async function uninstall(folderName: string, displayName: string): Promise<void> {
  const confirmed = await confirmAction({
    title: t('maps.uninstallConfirm.title', { name: displayName }),
    description: t('maps.uninstallConfirm.description'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  actionError.value = null;
  setPending(folderName, true);
  try {
    await window.tfaf.maps.uninstall(folderName);
    await refreshInstalled();
    if (selection.value?.source === 'local') {
      selection.value = null;
    }
  } catch (cause) {
    actionError.value = errorMessage(cause);
  } finally {
    setPending(folderName, false);
  }
}

async function hideVersion(map: VaultMap): Promise<void> {
  const confirmed = await confirmAction({
    title: t('vault.hideVersion.title', { name: map.displayName }),
    description: t('vault.hideVersion.description'),
    confirmText: t('vault.hideVersion.confirm'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  actionError.value = null;
  try {
    await window.tfaf.uploads.hideVersion('map', map.versionId);
    selection.value = null;
    await queryClient.invalidateQueries({ queryKey: ['maps', 'vault'] });
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

// Maps of the game installation cannot be deleted, so they cannot be ticked either.
const bulk = useBulkDelete({
  items: () => filteredInstalled.value,
  key: (map) => map.folderName,
  selectable: (map) => !map.official,
  name: (map) => map.displayName,
  confirmTitle: (count) => t('vault.bulk.deleteMaps', { count }),
  remove: async (map) => {
    setPending(map.folderName, true);
    try {
      await window.tfaf.maps.uninstall(map.folderName);
    } finally {
      setPending(map.folderName, false);
    }
  },
  done: async () => {
    await refreshInstalled();
    const open = selection.value;
    if (open?.source === 'local' && !installed.value.some((map) => map.folderName === open.map.folderName)) {
      selection.value = null;
    }
  },
});
const { selection: ticked } = bulk;

async function reveal(folderName: string): Promise<void> {
  actionError.value = null;
  try {
    await window.tfaf.maps.reveal(folderName);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

// A map that is not installed yet is downloaded when the game is created.
function hostOn(folderName: string): void {
  if (canStartGame.value) {
    hostingMap.value = folderName;
  }
}

onActivated(() => refreshStale(queries.installedMaps()));
</script>

<template>
  <ListLayout ref="layout" :panel-open="selection !== null" :placeholder="t('vault.detailPanel.placeholder.maps')" @close-panel="selection = null">
    <template #header>
      <div class="mb-3.5 flex items-center gap-5">
        <h1 class="text-2xl">{{ t('maps.title') }}</h1>
        <Tabs v-model="tab">
          <TabsList>
            <TabsTrigger value="vault" class="px-4">{{ t('vault.tabs.vault') }}</TabsTrigger>
            <TabsTrigger value="installed" class="px-4">
              {{ t('vault.tabs.installed') }} <span class="text-muted-foreground tabular-nums">{{ customInstalledCount }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" class="ml-auto" @click="uploadOpen = true"><Upload />{{ t('vault.upload.mapButton') }}</Button>
      </div>

      <template v-if="tab === 'vault'">
        <ListToolbar>
          <SearchInput
            v-model="filters.text"
            class="max-w-105 flex-[1_1_15rem]"
            :placeholder="t('maps.searchPlaceholder')"
            @keydown.enter="flushName"
          />
          <Input
            v-model="filters.author"
            class="w-36"
            maxlength="100"
            :placeholder="t('vault.author')"
            :aria-label="t('vault.author')"
            @keydown.enter="flushAuthor"
          />
          <template #end>
            <SortControl v-model:field="sort.field" v-model:order="sort.order" :options="sortOptions" />
            <ViewModeToggle v-model="vaultView" />
          </template>
          <template #filters>
            <div class="flex items-center gap-7">
              <RangeFilter v-model="filters.players" :label="t('maps.ranges.players')" :steps="PLAYER_STEPS" />
              <RangeFilter
                v-model="filters.sizes"
                :label="t('maps.ranges.size')"
                :steps="SIZE_STEPS"
                :format="(range) => t('format.mapSize', { size: range })"
              />
            </div>
            <div class="flex items-center gap-0.75">
              <FilterChip :pressed="filters.ranked" @toggle="filters.ranked = !filters.ranked">
                <Swords />
                {{ t('vault.filters.ranked') }}
              </FilterChip>
              <FilterChip :pressed="filters.recommended" @toggle="filters.recommended = !filters.recommended">
                <Award />
                {{ t('vault.filters.recommended') }}
              </FilterChip>
              <FilterChip :pressed="filters.own" @toggle="filters.own = !filters.own">
                <UserRound />
                {{ t('maps.filters.own') }}
              </FilterChip>
            </div>
          </template>
        </ListToolbar>
        <ActiveFilters
          :filters="activeFilters"
          :hint="t('maps.noFiltersHint')"
          @remove="removeFilter"
          @clear="clearFilters"
        >
          {{ resultCount }}
        </ActiveFilters>
      </template>

      <template v-else>
        <ListToolbar>
          <SearchInput v-model="localFilters.text" class="max-w-105 flex-[1_1_15rem]" :placeholder="t('maps.installed.searchPlaceholder')" />
          <template #end>
            <SortControl v-model:field="localSort.field" v-model:order="localSort.order" :options="localSortOptions" />
            <ViewModeToggle v-model="installedView" />
            <Button
              variant="ghost"
              size="icon"
              :data-tooltip="t('maps.installed.rescan')"
              :aria-label="t('maps.installed.rescan')"
              @click="refreshInstalled"
            >
              <RefreshCw />
            </Button>
          </template>
          <template #filters>
            <div class="flex items-center gap-7">
              <RangeFilter v-model="localFilters.players" :label="t('maps.ranges.players')" :steps="PLAYER_STEPS" />
              <RangeFilter
                v-model="localFilters.sizes"
                :label="t('maps.ranges.size')"
                :steps="SIZE_STEPS"
                :format="(range) => t('format.mapSize', { size: range })"
              />
            </div>
            <div class="flex items-center gap-0.75">
              <FilterChip :pressed="localFilters.official" @toggle="localFilters.official = !localFilters.official">
                {{ t('maps.installed.officialFilter') }}
              </FilterChip>
              <FilterChip :pressed="localFilters.vault" @toggle="localFilters.vault = !localFilters.vault">
                {{ t('maps.installed.vaultFilter') }}
              </FilterChip>
              <FilterChip :pressed="localFilters.local" @toggle="localFilters.local = !localFilters.local">
                {{ t('maps.installed.localFilter') }}
              </FilterChip>
            </div>
          </template>
        </ListToolbar>
        <ActiveFilters :filters="localActiveFilters" @remove="removeLocalFilter" @clear="clearLocalFilters">
          {{ t('maps.count', { count: filteredInstalled.length }) }}
        </ActiveFilters>
      </template>
    </template>

    <template v-if="tab === 'vault'">
      <Alert v-if="error" variant="destructive" class="mb-4 flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
        <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
      </Alert>

      <template v-if="!result && loading">
        <div v-if="vaultView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-4.5 pt-1.5">
          <Skeleton v-for="index in 12" :key="index" class="aspect-[3/4]" />
        </div>
        <div v-else class="flex flex-col gap-1 pt-10">
          <Skeleton v-for="index in 10" :key="index" class="h-12" />
        </div>
      </template>
      <Empty v-else-if="result && result.items.length === 0 && !loading">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Map /></EmptyMedia>
          <EmptyTitle>{{ t('maps.empty.title') }}</EmptyTitle>
          <EmptyDescription>{{ t('vault.emptyHint') }}</EmptyDescription>
        </EmptyHeader>
        <Button v-if="activeFilters.length" variant="outline" @click="clearFilters">{{ t('vault.resetFilters') }}</Button>
      </Empty>
      <template v-else-if="result">
        <div
          v-if="vaultView === 'cards'"
          class="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-4.5 pt-1.5 transition-opacity"
          :class="{ 'pointer-events-none opacity-50': loading }"
        >
          <VaultCard
            v-for="map in result.items"
            :key="map.mapId"
            :title="map.displayName"
            :image="map.thumbnailUrlSmall"
            :subtitle="map.author"
            :selected="selectedId === String(map.mapId)"
            square
            @open="open({ source: 'vault', map })"
          >
            <template #title-icon>
              <Award v-if="map.recommended" class="size-3.5 shrink-0 text-primary" :aria-label="t('maps.recommended')" />
            </template>
            <template #status>
              <StatusLamp v-if="vaultStatus(map) === 'installed'" tone="success" overlay>{{ t('maps.status.installed') }}</StatusLamp>
              <StatusLamp v-else-if="vaultStatus(map) === 'outdated'" tone="warning" overlay>{{ t('maps.status.outdated') }}</StatusLamp>
            </template>
            <template #meta>
              <div class="mt-1 flex gap-3 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5 [&_svg]:text-faint">
                <span class="flex items-center gap-1" :data-tooltip="t('maps.players')"><Users />{{ map.maxPlayers }}</span>
                <span v-if="map.widthPx" class="flex items-center gap-1" :data-tooltip="t('maps.size')">
                  <Expand />{{ mapSizeLabel(map.widthPx, map.heightPx) }}
                </span>
                <span v-if="map.reviews?.numReviews" class="flex items-center gap-1" :data-tooltip="t('vault.rating')">
                  <Star />{{ map.reviews.averageScore.toFixed(1) }}
                </span>
              </div>
            </template>
            <template #quick>
              <Button v-if="pending.has(map.folderName)" size="xs" disabled><Spinner />{{ t('maps.downloading') }}</Button>
              <Button
                v-else-if="vaultStatus(map) === 'installed'"
                size="xs"
                variant="secondary"
                class="bg-hull/85"
                :disabled="!canStartGame"
                @click="hostOn(map.folderName)"
              >
                <Swords />
                {{ t('maps.host') }}
              </Button>
              <Button v-else size="xs" @click="install(map)">
                <CircleArrowUp v-if="vaultStatus(map) === 'outdated'" />
                <Download v-else />
                {{ vaultStatus(map) === 'outdated' ? t('maps.update') : t('common.install') }}
              </Button>
            </template>
          </VaultCard>
        </div>
        <DataTable
          v-else
          :table="vaultTable"
          :label="t('maps.vaultTable')"
          :selected-id="selectedId"
          :loading="loading"
          @select="(map) => open({ source: 'vault', map })"
        >
          <template #cell-name="{ row: map }">
            <div class="flex min-w-0 items-center gap-3">
              <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
                <PreviewImage small :src="map.thumbnailUrlSmall" lazy />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
                  <span class="truncate">{{ map.displayName }}</span>
                  <Award v-if="map.recommended" class="size-3.5 shrink-0 text-primary" :aria-label="t('maps.recommended')" />
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {{ [map.author, map.version ? t('vault.version', { version: map.version }) : null].filter(Boolean).join(', ') }}
                </span>
              </span>
            </div>
          </template>
          <template #cell-players="{ row: map }">{{ map.maxPlayers }}</template>
          <template #cell-size="{ row: map }">{{ mapSizeLabel(map.widthPx, map.heightPx) ?? '—' }}</template>
          <template #cell-rating="{ row: map }">
            <template v-if="map.reviews?.numReviews">
              {{ map.reviews.averageScore.toFixed(1) }}
              <span class="text-faint">({{ formatNumber(map.reviews.numReviews) }})</span>
            </template>
            <span v-else class="text-faint">—</span>
          </template>
          <template #cell-plays="{ row: map }">{{ formatNumber(map.gamesPlayed) }}</template>
          <template #cell-updated="{ row: map }">{{ formatDate(map.updateTime ?? map.createTime) ?? '—' }}</template>
          <template #cell-status="{ row: map }">
            <StatusLamp v-if="pending.has(map.folderName)" tone="warning">{{ t('vault.downloading') }}</StatusLamp>
            <StatusLamp v-else-if="vaultStatus(map) === 'installed'" tone="success">{{ t('maps.status.installed') }}</StatusLamp>
            <StatusLamp v-else-if="vaultStatus(map) === 'outdated'" tone="warning">{{ t('maps.status.outdated') }}</StatusLamp>
            <StatusLamp v-else tone="muted">{{ t('maps.status.notInstalled') }}</StatusLamp>
          </template>
          <template #cell-actions="{ row: map }">
            <Button
              v-if="vaultStatus(map) === 'installed'"
              variant="ghost"
              size="icon-sm"
              :data-tooltip="t('maps.hostOnMap')"
              :aria-label="t('maps.hostOnMap')"
              :disabled="!canStartGame"
              @click.stop="hostOn(map.folderName)"
            >
              <Swords />
            </Button>
            <Button
              v-else
              variant="ghost"
              size="icon-sm"
              :data-tooltip="vaultStatus(map) === 'outdated' ? t('maps.installNewVersion') : t('common.install')"
              :aria-label="vaultStatus(map) === 'outdated' ? t('maps.installNewVersion') : t('common.install')"
              :disabled="pending.has(map.folderName)"
              @click.stop="install(map)"
            >
              <Spinner v-if="pending.has(map.folderName)" />
              <CircleArrowUp v-else-if="vaultStatus(map) === 'outdated'" />
              <Download v-else />
            </Button>
          </template>
        </DataTable>
        <div class="flex items-center justify-between gap-4 pt-4">
          <span class="text-[13px] text-muted-foreground tabular-nums">
            {{ t('vault.pageOf', { page: result.page, total: result.totalPages }) }}
          </span>
          <PageNav :page="result.page" :total-pages="result.totalPages" :disabled="loading" @change="changePage" />
        </div>
      </template>
    </template>

    <template v-else>
      <Alert v-if="installedError" variant="destructive" class="mb-4">
        <AlertDescription class="selectable">{{ installedError }}</AlertDescription>
      </Alert>
      <template v-if="waitingForVault">
        <Alert v-if="vaultCheckError" variant="destructive" class="mb-4 flex items-center gap-3">
          <AlertDescription class="flex-1 selectable">{{ t('maps.installed.vaultCheckFailed', { error: vaultCheckError }) }}</AlertDescription>
          <Button variant="outline" size="sm" @click="reloadVaultCheck"><RefreshCw />{{ t('common.retry') }}</Button>
        </Alert>
        <div v-else class="flex justify-center py-12"><Spinner class="size-6 text-primary" /></div>
      </template>
      <Empty v-else-if="filteredInstalled.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Map /></EmptyMedia>
          <EmptyTitle>{{ installed.length === 0 ? t('maps.installed.noMaps') : t('vault.nothingFound') }}</EmptyTitle>
          <EmptyDescription>
            {{ installed.length === 0 ? t('maps.installed.noMapsHint') : t('maps.installed.nothingFoundHint') }}
          </EmptyDescription>
        </EmptyHeader>
        <div class="flex gap-2">
          <Button v-if="localActiveFilters.length" variant="outline" @click="clearLocalFilters">{{ t('vault.resetFilters') }}</Button>
          <Button variant="outline" @click="tab = 'vault'">{{ t('vault.openVault') }}</Button>
        </div>
      </Empty>
      <div v-else-if="installedView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-4.5 pt-1.5">
        <VaultCard
          v-for="map in filteredInstalled"
          :key="map.folderName"
          :title="map.displayName"
          :image="map.previewUrl"
          :subtitle="map.folderName"
          :selected="selectedId === map.folderName"
          checkable
          :checked="ticked.isSelected(map)"
          :check-label="t('vault.bulk.select', { name: map.displayName })"
          :check-disabled="map.official"
          :selecting="ticked.count.value > 0"
          square
          @open="open({ source: 'local', map })"
          @check="(value) => ticked.toggle(map, value)"
        >
          <template #status>
            <StatusLamp v-if="map.official" tone="info" overlay>{{ t('maps.official') }}</StatusLamp>
            <StatusLamp v-else-if="isLocal(map)" tone="warning" overlay :data-tooltip="t('maps.localHint')">{{ t('maps.local') }}</StatusLamp>
          </template>
          <template #meta>
            <div class="mt-1 flex gap-3 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5 [&_svg]:text-faint">
              <span class="flex items-center gap-1" :data-tooltip="t('maps.players')"><Users />{{ map.maxPlayers }}</span>
              <span v-if="map.widthPx" class="flex items-center gap-1" :data-tooltip="t('maps.size')">
                <Expand />{{ mapSizeLabel(map.widthPx, map.heightPx) }}
              </span>
            </div>
          </template>
          <template #quick>
            <Button size="xs" variant="secondary" class="bg-hull/85" :disabled="!canStartGame" @click="hostOn(map.folderName)">
              <Swords />
              {{ t('maps.host') }}
            </Button>
          </template>
        </VaultCard>
      </div>
      <DataTable
        v-else
        :table="localTable"
        :label="t('maps.installedTable')"
        :selected-id="selectedId"
        :selection="ticked"
        :row-label="(map) => map.displayName"
        @select="(map) => open({ source: 'local', map })"
      >
        <template #cell-name="{ row: map }">
          <div class="flex min-w-0 items-center gap-3">
            <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
              <PreviewImage small :src="map.previewUrl" lazy />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-display text-sm font-semibold">{{ map.displayName }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ map.folderName }}</span>
            </span>
          </div>
        </template>
        <template #cell-players="{ row: map }">{{ map.maxPlayers }}</template>
        <template #cell-size="{ row: map }">{{ mapSizeLabel(map.widthPx, map.heightPx) ?? '—' }}</template>
        <template #cell-added="{ row: map }">{{ formatDate(map.addedAt) ?? '—' }}</template>
        <template #cell-kind="{ row: map }">
          <StatusLamp v-if="map.official" tone="info">{{ t('maps.official') }}</StatusLamp>
          <StatusLamp v-else-if="isLocal(map)" tone="warning" :data-tooltip="t('maps.localHint')">{{ t('maps.local') }}</StatusLamp>
          <span v-else class="text-muted-foreground">{{ t('maps.mapsFolder') }}</span>
        </template>
        <template #cell-actions="{ row: map }">
          <Button
            variant="ghost"
            size="icon-sm"
            :data-tooltip="t('maps.hostOnMap')"
            :aria-label="t('maps.hostOnMap')"
            :disabled="!canStartGame"
            @click.stop="hostOn(map.folderName)"
          >
            <Swords />
          </Button>
        </template>
      </DataTable>
      <BulkBar
        :count="ticked.count.value"
        :total="ticked.selectableCount.value"
        :label="t('vault.bulk.maps', { count: ticked.count.value })"
        :busy="bulk.busy.value"
        :error="bulk.error.value"
        @delete="bulk.deleteSelected"
        @select-all="ticked.setAll(true)"
        @clear="ticked.clear"
        @dismiss-error="bulk.error.value = null"
      />
    </template>

    <template #panel>
      <MapDetailPanel
        v-if="selection"
        :selection="selection"
        :vault-status="selectedVaultStatus"
        :pending="pending.has(selection.map.folderName)"
        :can-start-game="canStartGame"
        :error="actionError"
        @close="selection = null"
        @install="install"
        @uninstall="uninstall"
        @reveal="reveal"
        @host="hostOn"
        @hide-version="hideVersion"
      />
    </template>

    <CreateGameDialog v-if="hostingMap" :map="hostingMap" @close="hostingMap = null" />
    <UploadDialog v-if="uploadOpen" kind="map" @close="uploadOpen = false" />
  </ListLayout>
</template>
