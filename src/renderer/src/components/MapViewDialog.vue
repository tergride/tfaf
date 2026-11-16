<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MapMarker, MapScene } from '../../../shared/contract.ts';
// The game's own markers: mass and hydrocarbon icons redrawn in high resolution after icon-mass_bmp and
// icon-energy_bmp.
import hydroIcon from '../assets/map-markers/hydro.png';
import massIcon from '../assets/map-markers/mass.png';
import { useMapDrawing } from '../composables/useMapDrawing.ts';
import { type MapViewRequest, useMapView } from '../composables/useMapView.ts';
import { usePanZoom } from '../composables/usePanZoom.ts';
import { t } from '../lib/i18n.ts';
import type { MapViewRect } from '../lib/mapView/mapRenderer.ts';
import AcuIcon from './AcuIcon.vue';
import FilterChip from './FilterChip.vue';
import ProgressLine from './ProgressLine.vue';

// At the deepest zoom a game unit (a twentieth of a kilometre on a 5 km map) is this many pixels wide.
const DEEPEST_PIXELS_PER_UNIT = 48;
const MIN_MAX_ZOOM = 8;

const { current, close } = useMapView();
// The map stays through the closing animation; the dialog is unmounted only once it is gone.
const shown = shallowRef<MapViewRequest | null>(current.value);
watch(current, (next) => {
  if (next) {
    shown.value = next;
  }
});

function onContentClosed(): void {
  if (!current.value) {
    shown.value = null;
  }
}

const layers = reactive({ mass: true, hydro: true, spawns: true, props: true, shadows: true });
const { scene, status, error, progress, canvas, canvasKey, frameSize, load, clear, onContextLost } = useMapDrawing(visibleRect, () => layers);

const maxZoom = computed(() => {
  const width = scene.value?.width ?? 0;
  return frameSize.value.width > 0 ? Math.max(MIN_MAX_ZOOM, (DEEPEST_PIXELS_PER_UNIT * width) / frameSize.value.width) : MIN_MAX_ZOOM;
});
const { zoom, pan, drag, reset, onWheel, onPointerDown, onPointerMove, onPointerUp } = usePanZoom(maxZoom);

/** The pan and zoom of the frame turned into the part of the map it shows. */
function visibleRect(map: MapScene): MapViewRect {
  return {
    left: map.width * (0.5 + (-0.5 - pan.value.x) / zoom.value),
    top: map.height * (0.5 + (-0.5 - pan.value.y) / zoom.value),
    width: map.width / zoom.value,
    height: map.height / zoom.value,
  };
}

const view = computed(() => (scene.value ? visibleRect(scene.value) : null));

const frame = computed(() => {
  const map = scene.value;
  const ratio = map ? map.width / map.height : 1;
  // The height leaves room for the title, the layer switches and the dialog's padding.
  return { width: `min(calc(100vw - 6rem), calc((100vh - 13rem) * ${ratio}))`, aspectRatio: map ? `${map.width} / ${map.height}` : '1' };
});

const counts = computed(() => {
  const markers = scene.value?.markers ?? [];
  return {
    mass: markers.filter((marker) => marker.kind === 'mass').length,
    hydro: markers.filter((marker) => marker.kind === 'hydro').length,
    spawns: markers.filter((marker) => marker.kind === 'spawn').length,
    props: scene.value?.props.length ?? 0,
  };
});

const LAYER_OF: Record<MapMarker['kind'], 'mass' | 'hydro' | 'spawns'> = { mass: 'mass', hydro: 'hydro', spawn: 'spawns' };

function inFrame(point: { left: number; top: number }): boolean {
  return point.left > -2 && point.left < 102 && point.top > -2 && point.top < 102;
}

/** Markers in the frame, placed in percent of its size. */
const markers = computed(() => {
  const current = view.value;
  if (!current) {
    return [];
  }
  return (scene.value?.markers ?? [])
    .filter((marker) => layers[LAYER_OF[marker.kind]] && !(marker.kind === 'spawn' && shown.value?.spawnLayer))
    .map((marker, index) => ({
      ...marker,
      key: index,
      left: ((marker.x - current.left) / current.width) * 100,
      top: ((marker.z - current.top) / current.height) * 100,
    }))
    .filter(inFrame)
    .sort((a, b) => Number(a.kind === 'spawn') - Number(b.kind === 'spawn'));
});

/** Where a point of the square the map is centred in lands in the frame, for a `spawnLayer`. */
function place(point: { x: number; y: number }): { left: number; top: number } | null {
  const map = scene.value;
  const current = view.value;
  if (!map || !current) {
    return null;
  }
  const side = Math.max(map.width, map.height);
  const placed = {
    left: ((point.x * side - (side - map.width) / 2 - current.left) / current.width) * 100,
    top: ((point.y * side - (side - map.height) / 2 - current.top) / current.height) * 100,
  };
  return inFrame(placed) ? placed : null;
}

watch(shown, (request) => {
  if (request) {
    reset();
    void load(request.folderName);
  } else {
    clear();
  }
}, { immediate: true });
</script>

<template>
  <!-- Mounted on demand, like the image preview: the portal then lands above an open side panel or dialog. -->
  <Dialog v-if="shown" :open="current !== null" @update:open="(open) => !open && close()">
    <DialogContent class="w-auto max-w-[calc(100vw-4rem)] gap-3 p-4 sm:max-w-[calc(100vw-4rem)]" @close-auto-focus="onContentClosed">
      <DialogHeader class="pr-8">
        <DialogTitle class="truncate font-display text-lg">{{ shown.title }}</DialogTitle>
        <DialogDescription class="truncate" :class="{ 'sr-only': !shown.details }">
          {{ shown.details ?? shown.title }}
        </DialogDescription>
      </DialogHeader>
      <div v-if="scene" class="flex flex-wrap gap-0.75" role="group" :aria-label="t('maps.mapView.layers')">
        <FilterChip v-if="counts.mass > 0" :pressed="layers.mass" @toggle="layers.mass = !layers.mass">
          <img :src="massIcon" alt="" class="size-4" draggable="false" />{{ t('maps.mapView.mass') }}
        </FilterChip>
        <FilterChip v-if="counts.hydro > 0" :pressed="layers.hydro" @toggle="layers.hydro = !layers.hydro">
          <img :src="hydroIcon" alt="" class="size-4" draggable="false" />{{ t('maps.mapView.hydro') }}
        </FilterChip>
        <FilterChip v-if="counts.spawns > 0" :pressed="layers.spawns" @toggle="layers.spawns = !layers.spawns">
          <AcuIcon class="h-4 w-[0.833rem]" color="#9a9a9a" />{{ t('maps.mapView.spawns') }}
        </FilterChip>
        <FilterChip v-if="counts.props > 0" :pressed="layers.props" @toggle="layers.props = !layers.props">
          {{ t('maps.mapView.props') }}
        </FilterChip>
        <FilterChip :pressed="layers.shadows" @toggle="layers.shadows = !layers.shadows">
          {{ t('maps.mapView.shadows') }}
        </FilterChip>
      </div>
      <div class="relative overflow-hidden border bg-background" :style="frame">
        <div
          class="size-full touch-none select-none"
          :class="{ 'cursor-grab': zoom > 1 && !drag, 'cursor-grabbing': drag }"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <canvas :key="canvasKey" ref="canvas" class="block size-full" @webglcontextlost="onContextLost" />
          <div class="pointer-events-none absolute inset-0">
            <template v-for="marker in markers" :key="marker.key">
              <span v-if="marker.kind === 'spawn'" class="absolute -translate-1/2" :style="{ left: `${marker.left}%`, top: `${marker.top}%` }">
                <AcuIcon class="h-6 w-5" />
                <span
                  class="absolute -top-2 left-full -ml-1 text-sm leading-none font-bold text-white [text-shadow:0_0_2px_#000,0_0_2px_#000,0_1px_3px_#000]"
                >
                  {{ marker.army }}
                </span>
              </span>
              <img
                v-else
                :src="marker.kind === 'mass' ? massIcon : hydroIcon"
                alt=""
                class="absolute -translate-1/2 drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]"
                :class="marker.kind === 'mass' ? 'size-4' : 'size-5'"
                :style="{ left: `${marker.left}%`, top: `${marker.top}%` }"
                draggable="false"
              />
            </template>
            <component :is="shown.spawnLayer" v-if="shown.spawnLayer && layers.spawns" :place="place" />
          </div>
        </div>
        <div v-if="status === 'failed'" class="absolute inset-0 flex items-center justify-center bg-background/85 p-6 text-center text-sm text-destructive">
          {{ error }}
        </div>
        <div v-else-if="status === 'loading'" class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-background/80 px-3 py-2 backdrop-blur-sm">
          <span class="text-xs text-muted-foreground">
            {{ progress ? t('maps.mapView.loadingFiles', { done: progress.done, total: progress.total }) : t('maps.mapView.loadingScene') }}
          </span>
          <ProgressLine :value="progress && progress.total > 0 ? progress.done / progress.total : null" />
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
