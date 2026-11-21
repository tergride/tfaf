<script setup lang="ts">
import { ImageOff, Map as MapIcon, Minus, Plus } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MapResult, StoneMapJob, StoneMapTextureAssets, StoneMapTextureLayer } from '../../../../shared/contract.ts';
import type { PreviewKind, PreviewQuality } from '../../../../shared/stoneMap/contracts.ts';
import { usePanZoom } from '../../composables/usePanZoom.ts';
import { errorMessage } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import { mapSizeLabel, previewKindLabel } from '../../lib/stoneMapLabels.ts';
import StoneMapAdjustments from './StoneMapAdjustments.vue';

const props = defineProps<{ job: StoneMapJob | null; result: MapResult | null; busy: boolean }>();
const emit = defineEmits<{ select: [jobId: string] }>();

const KINDS: PreviewKind[] = ['map', 'textures', 'terrain', 'resources', 'heightmap'];
const QUALITIES: { value: PreviewQuality; pixels: number }[] = [
  { value: 'low', pixels: 256 },
  { value: 'medium', pixels: 512 },
  { value: 'high', pixels: 1024 },
  { value: 'ultra', pixels: 2048 },
];

type Tab = PreviewKind | 'adjust';
const tab = ref<Tab>('resources');
const quality = ref<PreviewQuality>('medium');
const markers = ref(true);
const contours = ref(false);
const waterContours = ref(true);
const reclaim = ref(false);
const waterSurface = ref(false);
const textures = ref<StoneMapTextureAssets | null>(null);
const layers = ref<StoneMapTextureLayer[]>([]);
const texturesError = ref<string | null>(null);

const url = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const { zoom, transform, reset, onWheel, onPointerDown, onPointerMove, onPointerUp, drag } = usePanZoom(8);
let request = 0;

const completed = computed(() => (props.job?.status === 'completed' ? props.job : null));
const kind = computed<PreviewKind>(() => (tab.value === 'adjust' ? 'resources' : tab.value));
const running = computed(() => !!props.job && !props.job.terminal);
const settlements = computed(() => props.result?.settlements ?? null);
const options = computed(() => ({
  kind: kind.value,
  quality: quality.value,
  markers: markers.value,
  contours: contours.value,
  waterContours: waterContours.value,
  reclaim: kind.value === 'resources' && reclaim.value,
  ...(kind.value === 'textures' ? { waterSurface: waterSurface.value } : {}),
}));

function show(next: string | null): void {
  if (url.value) {
    URL.revokeObjectURL(url.value);
  }
  url.value = next;
}

async function load(): Promise<void> {
  const job = completed.value;
  const current = ++request;
  error.value = null;
  if (!job || tab.value === 'adjust') {
    show(null);
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const png = await window.tfaf.stoneMap.preview(job.id, options.value);
    if (current === request) {
      show(URL.createObjectURL(new Blob([png], { type: 'image/png' })));
    }
  } catch (cause) {
    if (current === request) {
      show(null);
      error.value = errorMessage(cause);
    }
  } finally {
    if (current === request) {
      loading.value = false;
    }
  }
}

async function loadTextures(): Promise<void> {
  texturesError.value = null;
  try {
    textures.value = await window.tfaf.stoneMap.textureAssets();
    layers.value = completed.value && !textures.value.directory ? await window.tfaf.stoneMap.textureLayers(completed.value.id) : [];
  } catch (cause) {
    texturesError.value = errorMessage(cause);
  }
}

async function setGameTextures(enabled: boolean): Promise<void> {
  texturesError.value = null;
  try {
    textures.value = await window.tfaf.stoneMap.useGameTextures(enabled);
    await loadTextures();
    await load();
  } catch (cause) {
    texturesError.value = errorMessage(cause);
  }
}

watch([() => completed.value?.id, options, () => textures.value?.revision], () => void load(), { immediate: true });
watch(
  [() => completed.value?.id, () => tab.value === 'textures'],
  ([, onTextures]) => {
    if (onTextures) {
      void loadTextures();
    }
  },
  { immediate: true },
);
watch(() => props.job?.id, reset);
onBeforeUnmount(() => show(null));

function zoomBy(factor: number): void {
  zoom.value = Math.min(8, Math.max(1, zoom.value * factor));
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex flex-wrap items-center gap-3 border-b px-4 py-2">
      <!-- In a narrow column the tabs wrap instead of pushing the column wider than the window. -->
      <Tabs v-model="tab" class="max-w-full min-w-0">
        <TabsList class="h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger v-for="value in KINDS" :key="value" :value="value" class="h-[30px] flex-none px-3">{{ previewKindLabel(value) }}</TabsTrigger>
          <TabsTrigger value="adjust" class="h-[30px] flex-none px-3" :disabled="!completed || !result">{{ t('stoneMap.preview.adjust') }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-sm text-muted-foreground">{{ t('stoneMap.preview.quality') }}</span>
        <Select v-model="quality">
          <SelectTrigger size="sm" class="w-28" :aria-label="t('stoneMap.preview.quality')"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in QUALITIES" :key="option.value" :value="option.value">{{ option.pixels }} px</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div v-if="tab !== 'adjust'" class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2 text-sm">
      <Label class="cursor-pointer gap-2 font-normal" :class="{ 'opacity-50': kind === 'heightmap' || kind === 'textures' }">
        <Switch v-model="markers" :disabled="kind === 'heightmap' || kind === 'textures'" />{{ t('stoneMap.preview.markers') }}
      </Label>
      <Label class="cursor-pointer gap-2 font-normal" :class="{ 'opacity-50': kind !== 'terrain' && kind !== 'resources' }">
        <Switch v-model="contours" :disabled="kind !== 'terrain' && kind !== 'resources'" />{{ t('stoneMap.preview.contours') }}
      </Label>
      <Label
        class="cursor-pointer gap-2 font-normal"
        :class="{ 'opacity-50': kind === 'heightmap' || kind === 'textures' }"
        :data-tooltip="t('stoneMap.preview.waterContoursHint')"
      >
        <Switch v-model="waterContours" :disabled="kind === 'heightmap' || kind === 'textures'" />{{ t('stoneMap.preview.waterContours') }}
      </Label>
      <Label v-if="kind === 'resources'" class="cursor-pointer gap-2 font-normal">
        <Switch v-model="reclaim" />{{ t('stoneMap.preview.reclaim') }}
      </Label>
      <template v-if="kind === 'textures'">
        <Label class="cursor-pointer gap-2 font-normal">
          <Switch :model-value="!!textures?.directory" @update:model-value="setGameTextures" />{{ t('stoneMap.preview.gameTextures') }}
        </Label>
        <Label class="cursor-pointer gap-2 font-normal">
          <Switch v-model="waterSurface" />{{ t('stoneMap.preview.waterSurface') }}
        </Label>
      </template>
      <div class="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" :aria-label="t('stoneMap.preview.zoomOut')" :disabled="zoom <= 1" @click="zoomBy(1 / 1.25)">
          <Minus />
        </Button>
        <Button variant="ghost" size="sm" class="w-16 tabular-nums" :data-tooltip="t('stoneMap.preview.fit')" @click="reset">
          {{ Math.round(zoom * 100) }}%
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-label="t('stoneMap.preview.zoomIn')" :disabled="zoom >= 8" @click="zoomBy(1.25)">
          <Plus />
        </Button>
      </div>
    </div>

    <div v-if="tab === 'textures' && (texturesError || layers.length > 0 || textures)" class="flex flex-wrap gap-x-4 gap-y-1 border-b px-4 py-2 text-xs">
      <span v-if="texturesError" class="text-destructive selectable">{{ texturesError }}</span>
      <span v-else-if="textures?.directory" class="text-muted-foreground selectable">
        {{ t('stoneMap.preview.texturesFrom', { directory: textures.directory, count: textures.textures }) }}
      </span>
      <span v-for="layer in layers" :key="layer.layer" class="flex items-center gap-1.5 text-muted-foreground">
        <span class="inline-block size-3 rounded-sm border" :style="{ backgroundColor: layer.color }" />{{ layer.path }}
      </span>
    </div>

    <div v-if="settlements?.count && tab !== 'adjust'" class="border-b px-4 py-1.5 text-xs text-muted-foreground">
      {{ t('stoneMap.preview.settlements', { count: settlements.count, factions: [...new Set(settlements.sites.map((site) => site.faction))].join(', ') }) }}
    </div>

    <StoneMapAdjustments
      v-if="tab === 'adjust' && completed && result"
      :key="completed.id"
      :job-id="completed.id"
      :quality="quality"
      :busy="busy"
      @select="(id) => emit('select', id)"
    />
    <div
      v-else
      class="relative min-h-0 flex-1 overflow-hidden bg-muted/30"
      :class="{ 'cursor-grab': zoom > 1 && !drag, 'cursor-grabbing': drag }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img
        v-if="url"
        :src="url"
        :alt="t('stoneMap.preview.alt', { kind: previewKindLabel(kind) })"
        draggable="false"
        class="absolute inset-4 size-[calc(100%-2rem)] object-contain"
        :style="{ transform }"
      />
      <div v-else class="absolute inset-0 grid place-items-center p-6 text-center">
        <div class="flex max-w-sm flex-col items-center gap-2 text-muted-foreground">
          <Spinner v-if="loading || running" class="size-6 text-primary" />
          <ImageOff v-else-if="error" class="size-8" />
          <MapIcon v-else class="size-8" />
          <p class="font-display text-lg text-foreground">
            {{ error ? t('stoneMap.preview.failed') : running ? t('stoneMap.preview.generating') : loading ? t('stoneMap.preview.loading') : t('stoneMap.preview.empty') }}
          </p>
          <p class="text-sm selectable">{{ error ?? (running ? t('stoneMap.preview.generatingHint') : loading ? '' : t('stoneMap.preview.emptyHint')) }}</p>
        </div>
      </div>
      <Spinner v-if="url && loading" class="absolute top-3 right-3 size-5 text-primary" />
      <span v-if="job" class="absolute bottom-2 left-3 rounded bg-background/70 px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
        {{ mapSizeLabel(job.parameters.mapSize) }} · {{ t('stoneMap.preview.seed', { seed: job.parameters.seed }) }}
      </span>
    </div>
  </div>
</template>
