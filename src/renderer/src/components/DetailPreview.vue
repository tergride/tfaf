<script setup lang="ts">
import type { ImagePreview } from '../composables/useImagePreview.ts';
import ImagePreviewButton from './ImagePreviewButton.vue';
import MapViewButton from './MapViewButton.vue';
import PreviewImage from './PreviewImage.vue';

// The picture of the item in a detail panel, marked with the selection brackets and shaped to match them; it opens the
// large preview. The picture of a map on disk also gets a button under it that draws the map from its own files.
defineProps<{ preview: ImagePreview; fallback?: string; wide?: boolean; mapFolder?: string | null }>();
</script>

<template>
  <div>
    <div class="brackets m-1.5">
      <ImagePreviewButton class="plate cut-picture w-full bg-background" :class="wide ? 'aspect-16/10' : 'aspect-square'" :preview="preview">
        <PreviewImage :src="preview.src ?? preview.fallbackSrc" :fallback="fallback" />
      </ImagePreviewButton>
    </div>
    <MapViewButton
      v-if="mapFolder"
      class="mx-1.5 mt-1 w-[calc(100%-0.75rem)]"
      :folder-name="mapFolder"
      :title="preview.title"
      :details="preview.details"
    />
  </div>
</template>
