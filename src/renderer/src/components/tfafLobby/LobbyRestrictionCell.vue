<script setup lang="ts">
import { X } from '@lucide/vue';
import { onMounted, useTemplateRef, watch } from 'vue';
import type { DeepReadonly } from 'vue';
import type { MapTexture } from '../../../../shared/contract.ts';
import { decodeDxt } from '../../lib/mapView/dxt.ts';

const props = defineProps<{
  texture: DeepReadonly<MapTexture> | null;
  label: string;
  hint: string;
  forbidden: boolean;
  readonly: boolean;
  tech?: string | null;
  modded?: boolean;
  /** Behind the icon, which is transparent around the unit. */
  color?: string | null;
  /** The preset under the pointer forbids it. */
  highlighted?: boolean;
  /** The preset under the pointer leaves it out. */
  dimmed?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();

const canvas = useTemplateRef<HTMLCanvasElement>('canvas');

function draw(): void {
  const context = canvas.value?.getContext('2d');
  const level = props.texture?.levels[0];
  if (!props.texture || !context || !level) {
    return;
  }
  const { format, width, height } = props.texture;
  const rgba = format === 'rgba8' ? level : decodeDxt(format, width, height, level);
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
}

onMounted(draw);
watch(() => props.texture, draw, { flush: 'post' });

function toggle(): void {
  if (!props.readonly) {
    emit('toggle');
  }
}
</script>

<template>
  <button
    type="button"
    class="relative size-11 overflow-hidden rounded-xs bg-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring"
    :class="[readonly ? 'cursor-default' : 'hover:brightness-125', highlighted ? 'ring-2 ring-primary' : forbidden && 'ring-1 ring-destructive', dimmed && 'opacity-30']"
    :style="color ? { backgroundColor: color } : undefined"
    :aria-pressed="forbidden"
    :aria-disabled="readonly"
    :aria-label="label"
    :data-tooltip="hint"
    @click="toggle"
  >
    <canvas v-if="texture" ref="canvas" class="block size-full" :width="texture.width" :height="texture.height" />
    <span v-if="tech" class="absolute top-0 left-0 bg-black/65 px-0.5 text-[0.6875rem] leading-tight font-bold text-white">{{ tech }}</span>
    <span v-if="modded" class="absolute right-0 bottom-0 bg-[#aa00ff] px-0.5 text-[0.6875rem] leading-tight font-bold text-white">M</span>
    <span v-if="forbidden" class="absolute inset-0 grid place-items-center bg-black/65"><X class="size-7 text-destructive" /></span>
  </button>
</template>
