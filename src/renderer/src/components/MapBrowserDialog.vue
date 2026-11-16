<script setup lang="ts">
import { Award, Expand, Map, MousePointerClick, RefreshCw, Sparkles, Star, Swords, UserRound, Users } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useMediaQuery } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LocalMap, VaultMap } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { useInstalledMapFilters } from '../composables/useInstalledMapFilters.ts';
import { useMapVaultCheck } from '../composables/useMapVaultCheck.ts';
import { PLAYER_STEPS, SIZE_STEPS, useMapVaultFilters } from '../composables/useMapVaultFilters.ts';
import { useStoredMode, useViewMode } from '../composables/useViewMode.ts';
import { errorMessage, formatDate, formatNumber, mapBaseName, mapSizeLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useListTable } from '../lib/listTable.ts';
import { queries, queryState } from '../lib/queries.ts';
import ActiveFilters from './ActiveFilters.vue';
import DataTable from './DataTable.vue';
import FilterChip from './FilterChip.vue';
import GenerateMapDialog from './GenerateMapDialog.vue';
import ListLayout from './ListLayout.vue';
import ListToolbar from './ListToolbar.vue';
import MapDetailPanel, { type MapSelection, type MapVaultStatus } from './MapDetailPanel.vue';
import PageNav from './PageNav.vue';
import PreviewImage from './PreviewImage.vue';
import RangeFilter from './RangeFilter.vue';
import SearchInput from './SearchInput.vue';
import SortControl from './SortControl.vue';
import StatusLamp from './StatusLamp.vue';
import VaultCard from './VaultCard.vue';
import ViewModeToggle from './ViewModeToggle.vue';

export interface MapChoice {
  folderName: string;
  /** The vault version the map was picked from, or null for an installed map. */
  vaultMap: VaultMap | null;
}

const props = defineProps<{
  /** The map chosen now: the panel opens on it, and picking it again changes nothing. */
  current: string;
  title: string;
  description: string;
  pickLabel: string;
  /** Runs when a map is picked; the dialog closes once it is done and shows its error when it fails. */
  apply: (choice: MapChoice) => Promise<void> | void;
}>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const TABS = ['installed', 'vault'] as const;
const tab = useStoredMode('tfaf.mapBrowser.tab', TABS, 'installed');
const installedView = useViewMode('mapBrowser.installed');
const vaultView = useViewMode('mapBrowser.vault');
const layout = useTemplateRef<InstanceType<typeof ListLayout>>('layout');

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
} = useInstalledMapFilters(() => installed.value, { vaultFolders: () => vaultFolders.value, rememberAs: 'mapBrowser' });

const {
  filters: vaultFilters,
  sort: vaultSort,
  sortOptions: vaultSortOptions,
  page,
  flushName,
  flushAuthor,
  query,
  activeFilters: vaultActiveFilters,
  removeFilter: removeVaultFilter,
  clearFilters: clearVaultFilters,
} = useMapVaultFilters({ rememberAs: 'mapBrowser' });
const {
  data: vaultResult,
  loading: vaultLoading,
  error: vaultError,
  reload: reloadVault,
} = queryState(useQuery(() => ({ ...queries.vaultMaps(query.value), enabled: tab.value === 'vault' })));

function sameFolder(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

const selection = ref<MapSelection | null>(null);
const selectedFolder = computed(() => selection.value?.map.folderName.toLowerCase() ?? null);
const unchanged = computed(() => !selection.value || sameFolder(selection.value.map.folderName, props.current));

// The panel opens on the current map only where it stands beside the list; in a narrower window it would cover it.
const docked = useMediaQuery('(width >= 72rem)');
let openedOnCurrent = false;
watch(
  [installed, docked],
  () => {
    const map = installed.value.find((item) => sameFolder(item.folderName, props.current));
    if (!openedOnCurrent && docked.value && map) {
      openedOnCurrent = true;
      selection.value = { source: 'local', map };
    }
  },
  { immediate: true },
);

const installedNames = computed(() => new Set(installed.value.map((map) => map.folderName.toLowerCase())));
const installedBaseNames = computed(
  () => new Set(installed.value.filter((map) => !map.official).map((map) => mapBaseName(map.folderName))),
);

function vaultStatus(map: VaultMap): MapVaultStatus {
  if (installedNames.value.has(map.folderName.toLowerCase())) {
    return 'installed';
  }
  return installedBaseNames.value.has(mapBaseName(map.folderName)) ? 'outdated' : null;
}

const selectedVaultStatus = computed(() => (selection.value?.source === 'vault' ? vaultStatus(selection.value.map) : null));

const vaultTable = useListTable({
  data: () => vaultResult.value?.items ?? [],
  columns: [
    { id: 'name', header: () => t('maps.columns.map'), meta: { class: 'w-full max-w-0' } },
    { id: 'players', header: () => t('maps.columns.players'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'size', header: () => t('maps.columns.size'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'rating', header: () => t('vault.columns.rating'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'plays', header: () => t('maps.columns.plays'), sortDescFirst: true, meta: { numeric: true, class: '@max-[44rem]:hidden' } },
    { id: 'status', header: () => t('vault.columns.status'), meta: { class: '@max-[36rem]:hidden' } },
  ],
  rowId: (map) => map.folderName.toLowerCase(),
  sort: vaultSort,
  sortFields: {
    name: 'displayName',
    players: 'latestVersion.maxPlayers',
    size: 'latestVersion.width',
    rating: 'reviewsSummary.lowerBound',
    plays: 'gamesPlayed',
  },
});

const localTable = useListTable({
  data: () => filteredInstalled.value,
  columns: [
    { id: 'name', header: () => t('maps.columns.map'), meta: { class: 'w-full max-w-0' } },
    { id: 'players', header: () => t('maps.columns.players'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'size', header: () => t('maps.columns.size'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'added', header: () => t('maps.columns.added'), sortDescFirst: true, meta: { class: '@max-[44rem]:hidden' } },
    { id: 'kind', header: () => t('maps.columns.source'), meta: { class: '@max-[36rem]:hidden' } },
  ],
  rowId: (map) => map.folderName.toLowerCase(),
  sort: localSort,
  sortFields: { name: 'name', added: 'added', players: 'players', size: 'size' },
});

const vaultCount = computed(() => {
  const total = vaultResult.value?.totalItems;
  return total === null || total === undefined ? null : t('maps.count', { count: total });
});

function changePage(next: number): void {
  page.value = next;
  layout.value?.scrollToTop();
}

const applying = ref(false);
const error = ref<string | null>(null);

async function pick(next: MapSelection | null): Promise<void> {
  if (!next || applying.value) {
    return;
  }
  selection.value = next;
  if (sameFolder(next.map.folderName, props.current)) {
    return;
  }
  error.value = null;
  applying.value = true;
  try {
    await props.apply({ folderName: next.map.folderName, vaultMap: next.source === 'vault' ? next.map : null });
    close();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    applying.value = false;
  }
}

function openLocal(map: LocalMap): void {
  selection.value = { source: 'local', map };
}

function openVault(map: VaultMap): void {
  selection.value = { source: 'vault', map };
}

const generatorOpen = ref(false);

// The generator refreshes the installed maps before it reports the new one, so the list already holds it.
async function showGenerated(folderName: string): Promise<void> {
  tab.value = 'installed';
  clearLocalFilters();
  const map = installed.value.find((item) => sameFolder(item.folderName, folderName));
  if (map) {
    selection.value = { source: 'local', map };
  }
  await nextTick();
  layout.value?.scrollToTop();
}

function onOpenChange(value: boolean): void {
  if (!value && !applying.value) {
    close();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      class="flex h-[min(800px,calc(100vh-var(--titlebar-height)-3rem))] max-w-[1216px] flex-col gap-0 bg-background p-0 sm:max-w-[1216px]"
      :show-close-button="false"
      @close-auto-focus="onContentClosed"
    >
      <DialogHeader class="flex-row flex-wrap items-center gap-x-6 gap-y-3 border-b px-6 py-4">
        <div class="flex flex-col gap-0.5">
          <DialogTitle class="font-display text-xl">{{ title }}</DialogTitle>
          <DialogDescription>{{ description }}</DialogDescription>
        </div>
        <Tabs v-model="tab">
          <TabsList>
            <TabsTrigger value="installed" class="px-4">
              {{ t('vault.tabs.installed') }} <span class="text-muted-foreground tabular-nums">{{ installed.length }}</span>
            </TabsTrigger>
            <TabsTrigger value="vault" class="px-4">{{ t('vault.tabs.vault') }}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" class="ml-auto" :data-tooltip="t('hostGame.generator.openHint')" @click="generatorOpen = true">
          <Sparkles />{{ t('hostGame.generator.open') }}
        </Button>
      </DialogHeader>

      <ListLayout ref="layout" :panel-open="selection !== null" :placeholder="t('vault.detailPanel.placeholder.maps')" @close-panel="selection = null">
        <template #header>
          <template v-if="tab === 'vault'">
            <ListToolbar>
              <SearchInput
                v-model="vaultFilters.text"
                class="max-w-90 flex-[1_1_13rem]"
                :placeholder="t('maps.searchPlaceholder')"
                @keydown.enter="flushName"
              />
              <Input
                v-model="vaultFilters.author"
                class="w-36"
                maxlength="100"
                :placeholder="t('vault.author')"
                :aria-label="t('vault.author')"
                @keydown.enter="flushAuthor"
              />
              <template #end>
                <SortControl v-model:field="vaultSort.field" v-model:order="vaultSort.order" :options="vaultSortOptions" />
                <ViewModeToggle v-model="vaultView" />
              </template>
              <template #filters>
                <div class="flex items-center gap-7">
                  <RangeFilter v-model="vaultFilters.players" :label="t('maps.ranges.players')" :steps="PLAYER_STEPS" />
                  <RangeFilter
                    v-model="vaultFilters.sizes"
                    :label="t('maps.ranges.size')"
                    :steps="SIZE_STEPS"
                    :format="(range) => t('format.mapSize', { size: range })"
                  />
                </div>
                <div class="flex items-center gap-0.75">
                  <FilterChip :pressed="vaultFilters.ranked" @toggle="vaultFilters.ranked = !vaultFilters.ranked">
                    <Swords />
                    {{ t('vault.filters.ranked') }}
                  </FilterChip>
                  <FilterChip :pressed="vaultFilters.recommended" @toggle="vaultFilters.recommended = !vaultFilters.recommended">
                    <Award />
                    {{ t('vault.filters.recommended') }}
                  </FilterChip>
                  <FilterChip :pressed="vaultFilters.own" @toggle="vaultFilters.own = !vaultFilters.own">
                    <UserRound />
                    {{ t('maps.filters.own') }}
                  </FilterChip>
                </div>
              </template>
            </ListToolbar>
            <ActiveFilters
              :filters="vaultActiveFilters"
              :hint="t('maps.noFiltersHint')"
              @remove="removeVaultFilter"
              @clear="clearVaultFilters"
            >
              {{ vaultCount }}
            </ActiveFilters>
          </template>

          <template v-else>
            <ListToolbar>
              <SearchInput v-model="localFilters.text" class="max-w-90 flex-[1_1_13rem]" :placeholder="t('maps.installed.searchPlaceholder')" />
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
          <Alert v-if="vaultError" variant="destructive" class="mb-4 flex items-center gap-3">
            <AlertDescription class="flex-1 selectable">{{ vaultError }}</AlertDescription>
            <Button variant="outline" size="sm" @click="reloadVault"><RefreshCw />{{ t('common.retry') }}</Button>
          </Alert>
          <div v-if="!vaultResult && vaultLoading" class="flex justify-center py-12"><Spinner class="size-6 text-primary" /></div>
          <Empty v-else-if="vaultResult && vaultResult.items.length === 0 && !vaultLoading">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Map /></EmptyMedia>
              <EmptyTitle>{{ t('maps.empty.title') }}</EmptyTitle>
              <EmptyDescription>{{ t('vault.emptyHint') }}</EmptyDescription>
            </EmptyHeader>
            <Button v-if="vaultActiveFilters.length" variant="outline" @click="clearVaultFilters">{{ t('vault.resetFilters') }}</Button>
          </Empty>
          <template v-else-if="vaultResult">
            <div
              v-if="vaultView === 'cards'"
              class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3.5 pt-1.5 transition-opacity"
              :class="{ 'pointer-events-none opacity-50': vaultLoading }"
            >
              <VaultCard
                v-for="map in vaultResult.items"
                :key="map.mapId"
                :title="map.displayName"
                :image="map.thumbnailUrlLarge ?? map.thumbnailUrlSmall"
                :subtitle="map.author"
                :selected="selectedFolder === map.folderName.toLowerCase()"
                square
                @open="openVault(map)"
                @dblclick="pick({ source: 'vault', map })"
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
              </VaultCard>
            </div>
            <DataTable
              v-else
              :table="vaultTable"
              :label="t('maps.vaultTable')"
              :selected-id="selectedFolder"
              :loading="vaultLoading"
              @select="openVault"
              @activate="(map) => pick({ source: 'vault', map })"
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
              <template #cell-status="{ row: map }">
                <StatusLamp v-if="vaultStatus(map) === 'installed'" tone="success">{{ t('maps.status.installed') }}</StatusLamp>
                <StatusLamp v-else-if="vaultStatus(map) === 'outdated'" tone="warning">{{ t('maps.status.outdated') }}</StatusLamp>
                <StatusLamp v-else tone="muted">{{ t('maps.status.notInstalled') }}</StatusLamp>
              </template>
            </DataTable>
            <div class="flex items-center justify-between gap-4 pt-4">
              <span class="text-[13px] text-muted-foreground tabular-nums">
                {{ t('vault.pageOf', { page: vaultResult.page, total: vaultResult.totalPages }) }}
              </span>
              <PageNav :page="vaultResult.page" :total-pages="vaultResult.totalPages" :disabled="vaultLoading" @change="changePage" />
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
          <div v-else-if="installedView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3.5 pt-1.5">
            <VaultCard
              v-for="map in filteredInstalled"
              :key="map.folderName"
              :title="map.displayName"
              :image="map.previewLargeUrl"
              :subtitle="map.folderName"
              :selected="selectedFolder === map.folderName.toLowerCase()"
              square
              @open="openLocal(map)"
              @dblclick="pick({ source: 'local', map })"
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
            </VaultCard>
          </div>
          <DataTable
            v-else
            :table="localTable"
            :label="t('maps.installedTable')"
            :selected-id="selectedFolder"
            @select="openLocal"
            @activate="(map) => pick({ source: 'local', map })"
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
          </DataTable>
        </template>

        <template #panel>
          <MapDetailPanel
            v-if="selection"
            :selection="selection"
            :vault-status="selectedVaultStatus"
            :pending="false"
            :can-start-game="false"
            :error="null"
            picker
            @close="selection = null"
          />
        </template>
      </ListLayout>

      <DialogFooter class="items-center border-t px-6 py-4">
        <p v-if="error" class="mr-auto text-sm text-destructive selectable">{{ error }}</p>
        <p v-else class="mr-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <MousePointerClick class="size-4 text-faint" />{{ t('maps.browser.doubleClickHint') }}
        </p>
        <Button variant="ghost" :disabled="applying" @click="close">{{ t('common.cancel') }}</Button>
        <Button size="lg" :disabled="applying || unchanged" @click="pick(selection)">
          <Spinner v-if="applying" />{{ pickLabel }}
        </Button>
      </DialogFooter>

      <GenerateMapDialog v-if="generatorOpen" @close="generatorOpen = false" @generated="showGenerated" />
    </DialogContent>
  </Dialog>
</template>
