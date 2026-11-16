<script setup lang="ts">
import { ZoomIn } from '@lucide/vue';
import { ref, watch } from 'vue';
import { type ImagePreview, showImagePreview } from '../composables/useImagePreview.ts';
import { t } from '../lib/i18n.ts';

// The slot holds the picture. The button stays inert until one of the preview's pictures loads: a missing or broken
// picture would open an empty window. Focus is drawn inside the button: the plate it often is clips anything outside.
const props = defineProps<{ preview: ImagePreview }>();

const loadable = ref(false);

watch(
  () => [props.preview.src, props.preview.fallbackSrc] as const,
  (urls, _previous, onCleanup) => {
    loadable.value = false;
    let current = true;
    onCleanup(() => {
      current = false;
    });
    for (const url of urls) {
      if (url) {
        const image = new Image();
        image.onload = () => {
          if (current && image.naturalWidth > 0) {
            loadable.value = true;
          }
        };
        image.src = url;
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <button
    type="button"
    class="group relative block overflow-hidden outline-none enabled:cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
    :disabled="!loadable"
    :data-tooltip="loadable ? t('vault.imagePreview.open') : undefined" :aria-label="loadable ? t('vault.imagePreview.open') : undefined"
    @click="showImagePreview(props.preview)"
  >
    <slot />
    <span
      class="plate cut-xs pointer-events-none absolute right-1.5 bottom-1.5 bg-background/80 p-1 text-foreground [--plate-border:transparent] opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:hidden"
    >
      <ZoomIn class="size-4" />
    </span>
  </button>
</template>
