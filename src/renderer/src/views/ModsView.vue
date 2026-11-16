<script setup lang="ts">
import { Award, Download, Puzzle, RefreshCw, Star, Swords, Upload } from '@lucide/vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, defineAsyncComponent, onActivated, reactive, ref, useTemplateRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ModQuery, ModSortField, ModType, SortOrder, VaultMod } from '../../../shared/contract.ts';
import ActiveFilters from '../components/ActiveFilters.vue';
import BulkBar from '../components/BulkBar.vue';
import DataTable from '../components/DataTable.vue';
import FilterChip from '../components/FilterChip.vue';
import FilterChips from '../components/FilterChips.vue';
import ListLayout from '../components/ListLayout.vue';
import ListToolbar from '../components/ListToolbar.vue';
import type { ActiveFilter, ChipOption, SortOption } from '../components/listKit.ts';
import ModDetailPanel, { type ModSelection } from '../components/ModDetailPanel.vue';
import PageNav from '../components/PageNav.vue';
import PreviewImage from '../components/PreviewImage.vue';
import SearchInput from '../components/SearchInput.vue';
import SortControl from '../components/SortControl.vue';
import StatusLamp from '../components/StatusLamp.vue';
import VaultCard from '../components/VaultCard.vue';
import ViewModeToggle from '../components/ViewModeToggle.vue';
import { useBulkDelete } from '../composables/useBulkDelete.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { useSettledText } from '../composables/useSettledText.ts';
import { useViewMode } from '../composables/useViewMode.ts';
import { errorMessage, formatDate, formatNumber, isCancelled } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useListTable } from '../lib/listTable.ts';
import { queries, queryState, refreshStale } from '../lib/queries.ts';

const UploadDialog = defineAsyncComponent(() => import('../components/UploadDialog.vue'));

type TypeFilter = 'any' | ModType;
type LocalSort = 'name' | 'author';

const PAGE_SIZE = 30;
const sortOptions = computed<SortOption<ModSortField>[]>(() => [
  { value: 'latestVersion.createTime', label: t('vault.sort.newest'), order: 'desc' },
  { value: 'latestVersion.updateTime', label: t('vault.sort.recentlyUpdated'), order: 'desc' },
  { value: 'reviewsSummary.lowerBound', label: t('vault.sort.topRated'), order: 'desc' },
  { value: 'displayName', label: t('vault.sort.byName'), order: 'asc' },
]);
const localSortOptions = computed<SortOption<LocalSort>[]>(() => [
  { value: 'name', label: t('vault.sort.byName'), order: 'asc' },
  { value: 'author', label: t('mods.sort.byAuthor'), order: 'asc' },
]);
const typeOptions = computed<ChipOption<TypeFilter>[]>(() => [
  { value: 'any', label: t('mods.types.any') },
  { value: 'SIM', label: t('mods.types.sim') },
  { value: 'UI', label: 'UI' },
]);

const tab = ref<'vault' | 'installed'>('vault');
const vaultView = useViewMode('mods.vault');
const installedView = useViewMode('mods.installed', 'table');
const layout = useTemplateRef<InstanceType<typeof ListLayout>>('layout');

const filters = reactive({
  text: '',
  author: '',
  type: ['any'] as TypeFilter[],
  ranked: false,
  recommended: false,
});
const sort = reactive<{ field: ModSortField; order: SortOrder }>({ field: 'latestVersion.createTime', order: 'desc' });
const page = ref(1);
const { settled: name, flush: flushName } = useSettledText(() => filters.text);
const { settled: author, flush: flushAuthor } = useSettledText(() => filters.author);
const type = computed(() => (filters.type[0] === 'any' ? undefined : filters.type[0]));

const query = computed<ModQuery>(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  name: name.value || undefined,
  author: author.value || undefined,
  type: type.value,
  onlyRanked: filters.ranked || undefined,
  onlyRecommended: filters.recommended || undefined,
  sortField: sort.field,
  sortOrder: sort.order,
}));
// Another filter or sort starts from the first page; synchronously, so the old page is never asked for with it.
watch(
  () => [name.value, author.value, type.value, filters.ranked, filters.recommended, sort.field, sort.order],
  () => {
    page.value = 1;
  },
  { flush: 'sync' },
);
const { data: result, loading, error, reload } = queryState(useQuery(() => queries.vaultMods(query.value)));

const queryClient = useQueryClient();
const {
  data: installedMods,
  error: installedLoadError,
  reload: refreshInstalled,
} = queryState(useQuery(queries.installedMods()));
const installed = computed(() => installedMods.value ?? []);
const saveError = ref<string | null>(null);
const installedError = computed(() => saveError.value ?? installedLoadError.value);
const localFilters = reactive({ text: '', type: ['any'] as TypeFilter[], active: false });
const localSort = reactive<{ field: LocalSort; order: SortOrder }>({ field: 'name', order: 'asc' });
const pending = ref(new Set<string>());
const pendingSaves = ref(0);

const selection = ref<ModSelection | null>(null);
// The panel belongs to the list it was opened from.
watch(tab, () => {
  selection.value = null;
});
const actionError = ref<string | null>(null);
const uploadOpen = ref(false);

const installedByUid = computed(() => new Map(installed.value.map((mod) => [mod.uid, mod])));
const activeCount = computed(() => installed.value.filter((mod) => mod.active).length);
const selectedInstalled = computed(() => (selection.value ? (installedByUid.value.get(selection.value.mod.uid) ?? null) : null));
const selectedId = computed(() => {
  const current = selection.value;
  return current?.source === 'vault' ? String(current.mod.modId) : (current?.mod.uid ?? null);
});
const resultCount = computed(() => {
  const total = result.value?.totalItems;
  return total === null || total === undefined ? null : t('mods.count', { count: total });
});

const activeFilters = computed<ActiveFilter[]>(() => {
  const list: ActiveFilter[] = [];
  if (filters.text.trim()) {
    list.push({ key: 'text', label: t('vault.filters.text', { text: filters.text.trim() }) });
  }
  if (filters.author.trim()) {
    list.push({ key: 'author', label: t('vault.filters.author', { author: filters.author.trim() }) });
  }
  if (type.value) {
    list.push({ key: 'type', label: type.value === 'UI' ? t('mods.types.uiMods') : t('mods.types.simMods') });
  }
  if (filters.ranked) {
    list.push({ key: 'ranked', label: t('vault.filters.ranked') });
  }
  if (filters.recommended) {
    list.push({ key: 'recommended', label: t('vault.filters.recommended') });
  }
  return list;
});

function removeFilter(key: string): void {
  switch (key) {
    case 'text':
    case 'author':
      filters[key] = '';
      break;
    case 'type':
      filters.type = ['any'];
      break;
    case 'ranked':
    case 'recommended':
      filters[key] = false;
      break;
  }
}

function clearFilters(): void {
  Object.assign(filters, { text: '', author: '', type: ['any'], ranked: false, recommended: false });
}

const localActiveFilters = computed<ActiveFilter[]>(() => {
  const list: ActiveFilter[] = [];
  if (localFilters.text.trim()) {
    list.push({ key: 'text', label: t('vault.filters.text', { text: localFilters.text.trim() }) });
  }
  if (localFilters.type[0] !== 'any') {
    list.push({ key: 'type', label: localFilters.type[0] === 'UI' ? t('mods.types.uiMods') : t('mods.types.simMods') });
  }
  if (localFilters.active) {
    list.push({ key: 'active', label: t('mods.filters.active') });
  }
  return list;
});

function removeLocalFilter(key: string): void {
  if (key === 'text') {
    localFilters.text = '';
  } else if (key === 'type') {
    localFilters.type = ['any'];
  } else if (key === 'active') {
    localFilters.active = false;
  }
}

function clearLocalFilters(): void {
  Object.assign(localFilters, { text: '', type: ['any'], active: false });
}

const filteredInstalled = computed(() => {
  const text = localFilters.text.trim().toLowerCase();
  const localType = localFilters.type[0];
  const direction = localSort.order === 'asc' ? 1 : -1;
  return installed.value
    .filter((mod) => !localFilters.active || mod.active)
    .filter((mod) => localType === 'any' || mod.type === localType)
    .filter((mod) => !text || mod.name.toLowerCase().includes(text) || mod.author.toLowerCase().includes(text))
    .sort(
      (a, b) =>
        direction * (localSort.field === 'author' ? a.author.localeCompare(b.author, 'ru') : 0) ||
        direction * a.name.localeCompare(b.name, 'ru'),
    );
});

const vaultTable = useListTable({
  data: () => result.value?.items ?? [],
  columns: [
    { id: 'name', header: () => t('mods.columns.mod'), meta: { class: 'w-full max-w-0' } },
    { id: 'type', header: () => t('mods.columns.type'), meta: { class: '@max-[40rem]:hidden' } },
    { id: 'rating', header: () => t('vault.columns.rating'), sortDescFirst: true, meta: { numeric: true } },
    { id: 'updated', header: () => t('mods.columns.updated'), sortDescFirst: true, meta: { class: '@max-[52rem]:hidden' } },
    { id: 'created', header: () => t('mods.columns.uploaded'), sortDescFirst: true, meta: { class: '@max-[60rem]:hidden' } },
    { id: 'status', header: () => t('vault.columns.status'), meta: { class: '@max-[46rem]:hidden' } },
    { id: 'actions', header: '', meta: { class: 'w-13 text-right' } },
  ],
  rowId: (mod) => String(mod.modId),
  sort,
  sortFields: {
    name: 'displayName',
    rating: 'reviewsSummary.lowerBound',
    updated: 'latestVersion.updateTime',
    created: 'latestVersion.createTime',
  },
});

const localTable = useListTable({
  data: () => filteredInstalled.value,
  columns: [
    { id: 'name', header: () => t('mods.columns.mod'), meta: { class: 'w-full max-w-0' } },
    { id: 'author', header: () => t('mods.columns.author'), meta: { class: '@max-[44rem]:hidden' } },
    { id: 'type', header: () => t('mods.columns.type'), meta: { class: '@max-[36rem]:hidden' } },
    { id: 'active', header: () => t('mods.columns.active'), meta: { class: 'w-24' } },
  ],
  rowId: (mod) => mod.uid,
  sort: localSort,
  sortFields: { name: 'name', author: 'author' },
});

function setPending(uid: string, active: boolean): void {
  const next = new Set(pending.value);
  if (active) {
    next.add(uid);
  } else {
    next.delete(uid);
  }
  pending.value = next;
}

function changePage(next: number): void {
  page.value = next;
  layout.value?.scrollToTop();
}

function open(next: ModSelection): void {
  selection.value = next;
  actionError.value = null;
}

async function install(mod: VaultMod): Promise<void> {
  actionError.value = null;
  setPending(mod.uid, true);
  try {
    await window.tfaf.mods.install(mod.versionId);
    await refreshInstalled();
  } catch (cause) {
    const message = isCancelled(cause) ? null : errorMessage(cause);
    if (message) {
      open({ source: 'vault', mod });
      actionError.value = message;
    }
  } finally {
    setPending(mod.uid, false);
  }
}

async function uninstall(uid: string, name: string): Promise<void> {
  const confirmed = await confirmAction({
    title: t('mods.uninstallConfirm.title', { name }),
    description: t('mods.uninstallConfirm.description'),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  actionError.value = null;
  setPending(uid, true);
  try {
    await window.tfaf.mods.uninstall(uid);
    await refreshInstalled();
    if (selection.value?.source === 'local') {
      selection.value = null;
    }
  } catch (cause) {
    actionError.value = errorMessage(cause);
  } finally {
    setPending(uid, false);
  }
}

const bulk = useBulkDelete({
  items: () => filteredInstalled.value,
  key: (mod) => mod.uid,
  name: (mod) => mod.name,
  confirmTitle: (count) => t('vault.bulk.deleteMods', { count }),
  remove: async (mod) => {
    setPending(mod.uid, true);
    try {
      await window.tfaf.mods.uninstall(mod.uid);
    } finally {
      setPending(mod.uid, false);
    }
  },
  done: async () => {
    await refreshInstalled();
    const open = selection.value;
    if (open?.source === 'local' && !installed.value.some((mod) => mod.uid === open.mod.uid)) {
      selection.value = null;
    }
  },
});
const { selection: ticked } = bulk;

async function hideVersion(mod: VaultMod): Promise<void> {
  const confirmed = await confirmAction({
    title: t('vault.hideVersion.title', { name: mod.displayName }),
    description: t('vault.hideVersion.description'),
    confirmText: t('vault.hideVersion.confirm'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  actionError.value = null;
  try {
    await window.tfaf.uploads.hideVersion('mod', mod.versionId);
    selection.value = null;
    await queryClient.invalidateQueries({ queryKey: ['mods', 'vault'] });
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

async function reveal(uid: string): Promise<void> {
  actionError.value = null;
  try {
    await window.tfaf.mods.reveal(uid);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

let activeSaves: Promise<void> = Promise.resolve();

/**
 * The switch flips at once; writes to Game.prefs run one after another and each sends the state at that moment, so
 * quick toggles of several mods all end up saved.
 */
async function setActive(uid: string, active: boolean): Promise<void> {
  saveError.value = null;
  actionError.value = null;
  // A reading of the list that is under way would bring the old state back over the switched one.
  const { queryKey } = queries.installedMods();
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (mods) => mods?.map((mod) => (mod.uid === uid ? { ...mod, active } : mod)));
  pendingSaves.value++;
  const save = activeSaves.then(() =>
    window.tfaf.mods.setActive(installed.value.filter((mod) => mod.active).map((mod) => mod.uid)),
  );
  activeSaves = save.catch(() => undefined);
  try {
    await save;
  } catch (cause) {
    saveError.value = errorMessage(cause);
    actionError.value = saveError.value;
    await refreshInstalled();
  } finally {
    pendingSaves.value--;
  }
}

onActivated(() => refreshStale(queries.installedMods()));
</script>

<template>
  <ListLayout ref="layout" :panel-open="selection !== null" :placeholder="t('vault.detailPanel.placeholder.mods')" @close-panel="selection = null">
    <template #header>
      <div class="mb-3.5 flex items-center gap-5">
        <h1 class="text-2xl">{{ t('mods.title') }}</h1>
        <Tabs v-model="tab">
          <TabsList>
            <TabsTrigger value="vault" class="px-4">{{ t('vault.tabs.vault') }}</TabsTrigger>
            <TabsTrigger value="installed" class="px-4">
              {{ t('vault.tabs.installed') }} <span class="text-muted-foreground tabular-nums">{{ installed.length }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" class="ml-auto" @click="uploadOpen = true"><Upload />{{ t('vault.upload.modButton') }}</Button>
      </div>

      <template v-if="tab === 'vault'">
        <ListToolbar>
          <SearchInput
            v-model="filters.text"
            class="max-w-105 flex-[1_1_15rem]"
            :placeholder="t('mods.searchPlaceholder')"
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
            <FilterChips v-model="filters.type" :label="t('mods.typeFilter')" :options="typeOptions" required />
            <div class="flex items-center gap-0.75">
              <FilterChip :pressed="filters.ranked" @toggle="filters.ranked = !filters.ranked">
                <Swords />
                {{ t('vault.filters.ranked') }}
              </FilterChip>
              <FilterChip :pressed="filters.recommended" @toggle="filters.recommended = !filters.recommended">
                <Award />
                {{ t('vault.filters.recommended') }}
              </FilterChip>
            </div>
          </template>
        </ListToolbar>
        <ActiveFilters
          :filters="activeFilters"
          :hint="t('mods.noFiltersHint')"
          @remove="removeFilter"
          @clear="clearFilters"
        >
          {{ resultCount }}
        </ActiveFilters>
      </template>

      <template v-else>
        <ListToolbar>
          <SearchInput v-model="localFilters.text" class="max-w-105 flex-[1_1_15rem]" :placeholder="t('mods.installed.searchPlaceholder')" />
          <template #end>
            <SortControl v-model:field="localSort.field" v-model:order="localSort.order" :options="localSortOptions" />
            <ViewModeToggle v-model="installedView" />
            <Button
              variant="ghost"
              size="icon"
              :data-tooltip="t('mods.installed.rescan')"
              :aria-label="t('mods.installed.rescan')"
              @click="refreshInstalled"
            >
              <RefreshCw />
            </Button>
          </template>
          <template #filters>
            <FilterChips v-model="localFilters.type" :label="t('mods.typeFilter')" :options="typeOptions" required />
            <FilterChip :pressed="localFilters.active" @toggle="localFilters.active = !localFilters.active">
              {{ t('mods.installed.onlyActive') }}
            </FilterChip>
            <span class="ml-auto flex items-center gap-2 text-[13px] text-muted-foreground">
              <Spinner v-if="pendingSaves > 0" class="text-primary" />
              {{ t('mods.installed.activeOf', { active: activeCount, total: installed.length }) }}
            </span>
          </template>
        </ListToolbar>
        <ActiveFilters
          :filters="localActiveFilters"
          :hint="t('mods.installed.hint')"
          @remove="removeLocalFilter"
          @clear="clearLocalFilters"
        >
          {{ t('mods.count', { count: filteredInstalled.length }) }}
        </ActiveFilters>
      </template>
    </template>

    <template v-if="tab === 'vault'">
      <Alert v-if="error" variant="destructive" class="mb-4 flex items-center gap-3">
        <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
        <Button variant="outline" size="sm" @click="reload"><RefreshCw />{{ t('common.retry') }}</Button>
      </Alert>

      <template v-if="!result && loading">
        <div v-if="vaultView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5 pt-1.5">
          <Skeleton v-for="index in 12" :key="index" class="aspect-[4/5]" />
        </div>
        <div v-else class="flex flex-col gap-1 pt-10">
          <Skeleton v-for="index in 10" :key="index" class="h-12" />
        </div>
      </template>
      <Empty v-else-if="result && result.items.length === 0 && !loading">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Puzzle /></EmptyMedia>
          <EmptyTitle>{{ t('mods.empty.title') }}</EmptyTitle>
          <EmptyDescription>{{ t('vault.emptyHint') }}</EmptyDescription>
        </EmptyHeader>
        <Button v-if="activeFilters.length" variant="outline" @click="clearFilters">{{ t('vault.resetFilters') }}</Button>
      </Empty>
      <template v-else-if="result">
        <div
          v-if="vaultView === 'cards'"
          class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5 pt-1.5 transition-opacity"
          :class="{ 'pointer-events-none opacity-50': loading }"
        >
          <VaultCard
            v-for="mod in result.items"
            :key="mod.modId"
            :title="mod.displayName"
            :image="mod.thumbnailUrl"
            :subtitle="mod.author"
            :selected="selectedId === String(mod.modId)"
            @open="open({ source: 'vault', mod })"
          >
            <template #title-icon>
              <Award v-if="mod.recommended" class="size-3.5 shrink-0 text-primary" :aria-label="t('mods.recommended')" />
            </template>
            <template #status>
              <StatusLamp v-if="installedByUid.get(mod.uid)?.active" tone="success" overlay>{{ t('mods.status.active') }}</StatusLamp>
              <StatusLamp v-else-if="installedByUid.has(mod.uid)" tone="info" overlay>{{ t('mods.status.installed') }}</StatusLamp>
            </template>
            <template #meta>
              <div class="mt-1 flex gap-3 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5 [&_svg]:text-faint">
                <span>{{ mod.type === 'UI' ? 'UI' : t('mods.types.simShort') }}</span>
                <span v-if="mod.version">{{ t('vault.version', { version: mod.version }) }}</span>
                <span v-if="mod.reviews?.numReviews" class="flex items-center gap-1" :data-tooltip="t('vault.rating')">
                  <Star />{{ mod.reviews.averageScore.toFixed(1) }}
                </span>
              </div>
            </template>
            <template v-if="!installedByUid.has(mod.uid)" #quick>
              <Button size="xs" :disabled="pending.has(mod.uid)" @click="install(mod)">
                <Spinner v-if="pending.has(mod.uid)" />
                <Download v-else />
                {{ t('common.install') }}
              </Button>
            </template>
          </VaultCard>
        </div>
        <DataTable
          v-else
          :table="vaultTable"
          :label="t('mods.vaultTable')"
          :selected-id="selectedId"
          :loading="loading"
          @select="(mod) => open({ source: 'vault', mod })"
        >
          <template #cell-name="{ row: mod }">
            <div class="flex min-w-0 items-center gap-3">
              <span class="plate cut-xs h-9.5 w-15 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
                <PreviewImage small :src="mod.thumbnailUrl" :fallback="mod.displayName.slice(0, 1).toUpperCase()" lazy />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
                  <span class="truncate">{{ mod.displayName }}</span>
                  <Award v-if="mod.recommended" class="size-3.5 shrink-0 text-primary" :aria-label="t('mods.recommended')" />
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {{ [mod.author, mod.version ? t('vault.version', { version: mod.version }) : null].filter(Boolean).join(', ') }}
                </span>
              </span>
            </div>
          </template>
          <template #cell-type="{ row: mod }">{{ mod.type === 'UI' ? 'UI' : t('mods.types.simShort') }}</template>
          <template #cell-rating="{ row: mod }">
            <template v-if="mod.reviews?.numReviews">
              {{ mod.reviews.averageScore.toFixed(1) }}
              <span class="text-faint">({{ formatNumber(mod.reviews.numReviews) }})</span>
            </template>
            <span v-else class="text-faint">—</span>
          </template>
          <template #cell-updated="{ row: mod }">{{ formatDate(mod.updateTime ?? mod.createTime) ?? '—' }}</template>
          <template #cell-created="{ row: mod }">{{ formatDate(mod.createTime) ?? '—' }}</template>
          <template #cell-status="{ row: mod }">
            <StatusLamp v-if="pending.has(mod.uid)" tone="warning">{{ t('vault.downloading') }}</StatusLamp>
            <StatusLamp v-else-if="installedByUid.get(mod.uid)?.active" tone="success">{{ t('mods.status.active') }}</StatusLamp>
            <StatusLamp v-else-if="installedByUid.has(mod.uid)" tone="info">{{ t('mods.status.installed') }}</StatusLamp>
            <StatusLamp v-else tone="muted">{{ t('mods.status.notInstalled') }}</StatusLamp>
          </template>
          <template #cell-actions="{ row: mod }">
            <Button
              v-if="!installedByUid.has(mod.uid)"
              variant="ghost"
              size="icon-sm"
              :data-tooltip="t('common.install')"
              :aria-label="t('common.install')"
              :disabled="pending.has(mod.uid)"
              @click.stop="install(mod)"
            >
              <Spinner v-if="pending.has(mod.uid)" />
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
      <Empty v-if="filteredInstalled.length === 0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Puzzle /></EmptyMedia>
          <EmptyTitle>{{ installed.length ? t('vault.nothingFound') : t('mods.installed.noMods') }}</EmptyTitle>
          <EmptyDescription>{{ t('mods.installed.noModsHint') }}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" @click="tab = 'vault'">{{ t('vault.openVault') }}</Button>
      </Empty>
      <div v-else-if="installedView === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4.5 pt-1.5">
        <VaultCard
          v-for="mod in filteredInstalled"
          :key="mod.uid"
          :title="mod.name"
          :image="mod.iconDataUrl"
          :subtitle="mod.author || null"
          :selected="selectedId === mod.uid"
          checkable
          :checked="ticked.isSelected(mod)"
          :check-label="t('vault.bulk.select', { name: mod.name })"
          :selecting="ticked.count.value > 0"
          @open="open({ source: 'local', mod })"
          @check="(value) => ticked.toggle(mod, value)"
        >
          <template #status>
            <StatusLamp v-if="mod.active" tone="success" overlay>{{ t('mods.status.active') }}</StatusLamp>
          </template>
          <template #meta>
            <div class="mt-1 flex gap-3 text-xs text-muted-foreground">
              <span>{{ mod.type === 'UI' ? 'UI' : t('mods.types.simShort') }}</span>
              <span v-if="mod.version">{{ t('vault.version', { version: mod.version }) }}</span>
            </div>
          </template>
          <template #quick>
            <Button size="xs" :variant="mod.active ? 'secondary' : 'default'" :class="{ 'bg-hull/85': mod.active }" @click="setActive(mod.uid, !mod.active)">
              {{ mod.active ? t('mods.disable') : t('mods.enable') }}
            </Button>
          </template>
        </VaultCard>
      </div>
      <DataTable
        v-else
        :table="localTable"
        :label="t('mods.installedTable')"
        :selected-id="selectedId"
        :selection="ticked"
        :row-label="(mod) => mod.name"
        @select="(mod) => open({ source: 'local', mod })"
      >
        <template #cell-name="{ row: mod }">
          <div class="flex min-w-0 items-center gap-3">
            <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
              <PreviewImage small :src="mod.iconDataUrl" :fallback="mod.name.slice(0, 1).toUpperCase()" />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-display text-sm font-semibold">{{ mod.name }}</span>
              <span class="truncate text-xs text-muted-foreground">
                {{ [mod.version ? t('vault.version', { version: mod.version }) : null, mod.folderName].filter(Boolean).join(', ') }}
              </span>
            </span>
          </div>
        </template>
        <template #cell-author="{ row: mod }">{{ mod.author || '—' }}</template>
        <template #cell-type="{ row: mod }">{{ mod.type === 'UI' ? 'UI' : t('mods.types.simShort') }}</template>
        <template #cell-active="{ row: mod }">
          <Switch
            :model-value="mod.active"
            :aria-label="t('mods.activeSwitch', { name: mod.name })"
            @click.stop
            @keydown.stop
            @update:model-value="(active) => setActive(mod.uid, active)"
          />
        </template>
      </DataTable>
      <BulkBar
        :count="ticked.count.value"
        :total="ticked.selectableCount.value"
        :label="t('vault.bulk.mods', { count: ticked.count.value })"
        :busy="bulk.busy.value"
        :error="bulk.error.value"
        @delete="bulk.deleteSelected"
        @select-all="ticked.setAll(true)"
        @clear="ticked.clear"
        @dismiss-error="bulk.error.value = null"
      />
    </template>

    <template #panel>
      <ModDetailPanel
        v-if="selection"
        :selection="selection"
        :installed="selectedInstalled"
        :pending="pending.has(selection.mod.uid)"
        :error="actionError"
        @close="selection = null"
        @install="install"
        @uninstall="uninstall"
        @set-active="setActive"
        @reveal="reveal"
        @hide-version="hideVersion"
      />
    </template>
    <UploadDialog v-if="uploadOpen" kind="mod" @close="uploadOpen = false" />
  </ListLayout>
</template>
