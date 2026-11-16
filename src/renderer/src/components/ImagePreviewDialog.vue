<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type ImagePreview, useImagePreview } from '../composables/useImagePreview.ts';
import { usePanZoom } from '../composables/usePanZoom.ts';
import { t } from '../lib/i18n.ts';

// Map previews fill the window; small pictures such as mod icons grow at most this much, beyond it they only blur.
const MAX_UPSCALE = 2;
const MIN_SIDE_PX = 320;
const MAX_ZOOM = 8;

const { current, close } = useImagePreview();
const { zoom, drag, transform, reset: resetZoom, onWheel, onPointerDown, onPointerMove, onPointerUp } = usePanZoom(MAX_ZOOM);
// The picture stays through the closing animation; the dialog is unmounted only once it is gone.
const shown = shallowRef<ImagePreview | null>(current.value);
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

// Index into the sources: the main picture first, then the fallback once it fails.
const attempt = ref(0);
const natural = ref<{ width: number; height: number } | null>(null);
watch(shown, () => {
  attempt.value = 0;
  natural.value = null;
  resetZoom();
});

const source = computed(() => {
  const sources = [shown.value?.src, shown.value?.fallbackSrc].filter((src) => typeof src === 'string' && src);
  return sources[attempt.value] ?? null;
});

/** Square and as large as the window allows until the picture is loaded, then fitted to its own proportions. */
const frame = computed(() => {
  const size = natural.value;
  if (!size || size.width === 0 || size.height === 0) {
    return { width: 'min(80vh, calc(100vw - 6rem))', aspectRatio: '1' };
  }
  const ratio = size.width / size.height;
  const largest = Math.max(size.width * MAX_UPSCALE, MIN_SIDE_PX * Math.max(ratio, 1));
  return { width: `min(${largest}px, calc(100vw - 6rem), calc(80vh * ${ratio}))`, aspectRatio: `${size.width} / ${size.height}` };
});

function onLoad(event: Event): void {
  const image = event.target as HTMLImageElement;
  natural.value = { width: image.naturalWidth, height: image.naturalHeight };
}

function onError(): void {
  attempt.value++;
  natural.value = null;
  resetZoom();
}
</script>

<template>
  <!-- Mounted on demand: the portal then lands after an open side panel or dialog and stays above it. -->
  <Dialog v-if="shown" :open="current !== null" @update:open="(open) => !open && close()">
    <DialogContent class="w-auto max-w-[calc(100vw-4rem)] gap-3 p-4 sm:max-w-[calc(100vw-4rem)]" @close-auto-focus="onContentClosed">
      <DialogHeader class="pr-8">
        <DialogTitle class="truncate font-display text-lg">{{ shown.title }}</DialogTitle>
        <DialogDescription class="truncate" :class="{ 'sr-only': !shown.details }">
          {{ shown.details ?? shown.title }}
        </DialogDescription>
      </DialogHeader>
      <div class="overflow-hidden border bg-background" :style="frame">
        <div
          v-if="source"
          class="size-full touch-none select-none"
          :class="{ 'cursor-grab': zoom > 1 && !drag, 'cursor-grabbing': drag }"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <img
            :key="source"
            :src="source"
            alt=""
            draggable="false"
            class="size-full object-contain"
            :class="{ 'transition-transform duration-100 ease-out': !drag }"
            :style="{ transform }"
            @load="onLoad"
            @error="onError"
          />
        </div>
        <div v-else class="flex size-full items-center justify-center text-muted-foreground">{{ t('vault.imagePreview.none') }}</div>
      </div>
    </DialogContent>
  </Dialog>
</template>
