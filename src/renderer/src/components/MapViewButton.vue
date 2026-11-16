<script setup lang="ts">
import { Mountain } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { type Component, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { showMapView } from '../composables/useMapView.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';

// Opens the map drawn from its own files. Shown only for maps on disk: the others have nothing to draw from.
// `block` is a full-width button under a preview; `overlay` an icon over a thumbnail that appears on hover of the
// element marked `group/map`.
const props = defineProps<{
  folderName: string | null | undefined;
  title: string;
  details?: string | null;
  variant?: 'block' | 'overlay';
  spawnLayer?: Component;
}>();

const query = useQuery(() => ({ ...queries.mapOnDisk(props.folderName ?? ''), enabled: Boolean(props.folderName) }));
const available = computed(() => Boolean(props.folderName) && query.data.value === true);

function open(): void {
  if (props.folderName) {
    showMapView({ folderName: props.folderName, title: props.title, details: props.details ?? null, spawnLayer: props.spawnLayer });
  }
}
</script>

<template>
  <button
    v-if="available && variant === 'overlay'"
    type="button"
    class="plate cut-xs absolute bottom-1.5 left-1.5 bg-background/80 p-1 text-foreground [--plate-border:transparent] opacity-0 backdrop-blur-sm transition-opacity outline-none group-hover/map:opacity-100 hover:text-primary focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50"
    :data-tooltip="t('maps.mapView.openHint')"
    :aria-label="t('maps.mapView.openHint')"
    @click.stop="open"
  >
    <Mountain class="size-4" />
  </button>
  <Button v-else-if="available" variant="outline" size="sm" :data-tooltip="t('maps.mapView.openHint')" @click="open">
    <Mountain />{{ t('maps.mapView.open') }}
  </Button>
</template>
