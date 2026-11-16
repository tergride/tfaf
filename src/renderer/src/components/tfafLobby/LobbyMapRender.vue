<script setup lang="ts">
import { computed, watch } from 'vue';
import hydroIcon from '../../assets/map-markers/hydro.png';
import massIcon from '../../assets/map-markers/mass.png';
import { useMapDrawing } from '../../composables/useMapDrawing.ts';
import { t } from '../../lib/i18n.ts';
import ProgressLine from '../ProgressLine.vue';

// The board's map drawn from its files, over the preview until it is complete. It is centred in the square of the
// board, like a preview. Terrain shadows only darken a map this small, so they stay off.
const props = defineProps<{ folderName: string }>();

const { scene, status, error, progress, canvas, canvasKey, load, onContextLost } = useMapDrawing(
  (map) => ({ left: 0, top: 0, width: map.width, height: map.height }),
  () => ({ props: true, shadows: false }),
);

const fit = computed(() => {
  const map = scene.value;
  if (!map) {
    return undefined;
  }
  return { aspectRatio: `${map.width} / ${map.height}`, [map.width >= map.height ? 'width' : 'height']: '100%' };
});

const resources = computed(() => {
  const map = scene.value;
  return map
    ? map.markers
        .filter((marker) => marker.kind === 'mass' || marker.kind === 'hydro')
        .map((marker) => ({ kind: marker.kind, left: (marker.x / map.width) * 100, top: (marker.z / map.height) * 100 }))
    : [];
});

watch(() => props.folderName, load, { immediate: true });
</script>

<template>
  <div class="pointer-events-none absolute inset-0 grid place-items-center" :class="status === 'ready' && 'bg-hull'">
    <div class="relative" :class="status !== 'ready' && 'invisible'" :style="fit">
      <canvas :key="canvasKey" ref="canvas" class="absolute inset-0 size-full" @webglcontextlost="onContextLost" />
      <img
        v-for="(marker, index) in resources"
        :key="index"
        :src="marker.kind === 'mass' ? massIcon : hydroIcon"
        alt=""
        class="absolute -translate-1/2 drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]"
        :class="marker.kind === 'mass' ? 'size-3' : 'size-4'"
        :style="{ left: `${marker.left}%`, top: `${marker.top}%` }"
        draggable="false"
      />
    </div>
  </div>
  <p v-if="status === 'failed'" class="absolute inset-x-0 bottom-0 bg-background/85 px-3 py-1.5 text-xs text-destructive">{{ error }}</p>
  <div v-else-if="status === 'loading'" class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-background/80 px-3 py-1.5 backdrop-blur-sm">
    <span class="text-xs text-muted-foreground">
      {{ progress ? t('maps.mapView.loadingFiles', { done: progress.done, total: progress.total }) : t('maps.mapView.loadingScene') }}
    </span>
    <ProgressLine :value="progress && progress.total > 0 ? progress.done / progress.total : null" />
  </div>
</template>
