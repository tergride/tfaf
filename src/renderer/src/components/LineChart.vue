<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { computed, ref, useTemplateRef, watch } from 'vue';
import { formatMonthYear, formatNumber, formatShortDate } from '../format.ts';
import { nearestIndex, niceTicks, timeTicks } from '../lib/chartScale.ts';

// A line over time drawn in SVG, sized to its container: the rating history of a profile.
const props = defineProps<{
  /** Ascending by `x`, a time in milliseconds. */
  points: { x: number; y: number }[];
  label: string;
}>();
defineSlots<{ tooltip(props: { index: number }): unknown }>();

const HEIGHT = 260;
const PADDING = { top: 12, right: 14, bottom: 26, left: 48 };
const DAY_MS = 24 * 60 * 60 * 1000;

const container = useTemplateRef<HTMLElement>('container');
const { width } = useElementSize(container);
const active = ref<number | null>(null);

watch(
  () => props.points,
  () => {
    active.value = null;
  },
);

const plot = computed(() => {
  const points = props.points;
  const xs = points.map((point) => point.x);
  const first = xs[0] ?? Date.now();
  const last = xs[xs.length - 1] ?? first;
  // A single game still gets a day on each side.
  const [start, end] = first === last ? [first - DAY_MS, last + DAY_MS] : [first, last];
  const y = niceTicks(Math.min(...points.map((point) => point.y)), Math.max(...points.map((point) => point.y)), 5);
  const time = timeTicks(start, end, Math.max(2, Math.floor(width.value / 110)));
  const innerWidth = Math.max(1, width.value - PADDING.left - PADDING.right);
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const toX = (x: number): number => PADDING.left + ((x - start) / (end - start)) * innerWidth;
  const toY = (value: number): number => PADDING.top + (1 - (value - y.min) / (y.max - y.min || 1)) * innerHeight;
  const coordinates = points.map((point) => ({ x: toX(point.x), y: toY(point.y) }));
  const line = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('');
  const bottom = PADDING.top + innerHeight;
  const area =
    coordinates.length > 1 ? `${line}L${coordinates.at(-1)!.x.toFixed(1)} ${bottom}L${coordinates[0]!.x.toFixed(1)} ${bottom}Z` : '';
  const timeLabel = (tick: number): string =>
    time.unit === 'day' ? formatShortDate(tick) : time.unit === 'month' ? formatMonthYear(tick) : String(new Date(tick).getFullYear());
  return {
    coordinates,
    line,
    area,
    bottom,
    yTicks: y.ticks.map((tick) => ({ value: formatNumber(tick), y: toY(tick) })),
    xTicks: time.ticks.map((tick) => ({ label: timeLabel(tick), x: toX(tick) })),
  };
});

const activePoint = computed(() => (active.value === null ? null : (plot.value.coordinates[active.value] ?? null)));
// The tooltip keeps to the side of the point with more room.
const tooltipOnLeft = computed(() => (activePoint.value?.x ?? 0) > width.value / 2);

function onPointerMove(event: PointerEvent): void {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect();
  const x = event.clientX - box.left;
  const index = nearestIndex(
    plot.value.coordinates.map((point) => point.x),
    x,
  );
  active.value = index < 0 ? null : index;
}

function onKeydown(event: KeyboardEvent): void {
  const count = props.points.length;
  if (count === 0 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End')) {
    return;
  }
  event.preventDefault();
  const current = active.value ?? (event.key === 'ArrowLeft' ? count : -1);
  active.value =
    event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : Math.min(count - 1, Math.max(0, current + (event.key === 'ArrowLeft' ? -1 : 1)));
}
</script>

<template>
  <div ref="container" class="relative w-full select-none">
    <svg
      v-if="width > 0"
      :width="width"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      role="img"
      :aria-label="label"
      tabindex="0"
      class="block outline-none focus-visible:outline-2 focus-visible:outline-ring"
      @pointermove="onPointerMove"
      @pointerleave="active = null"
      @keydown="onKeydown"
      @blur="active = null"
    >
      <defs>
        <linearGradient id="line-chart-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--color-primary)" stop-opacity="0.22" />
          <stop offset="1" stop-color="var(--color-primary)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g class="text-[11px]" fill="var(--color-muted-foreground)">
        <template v-for="tick in plot.yTicks" :key="tick.y">
          <line :x1="PADDING.left" :x2="width - PADDING.right" :y1="tick.y" :y2="tick.y" stroke="var(--color-border)" />
          <text :x="PADDING.left - 8" :y="tick.y" text-anchor="end" dominant-baseline="middle" class="tabular-nums">{{ tick.value }}</text>
        </template>
        <text v-for="tick in plot.xTicks" :key="tick.x" :x="tick.x" :y="plot.bottom + 17" text-anchor="middle">{{ tick.label }}</text>
      </g>
      <path v-if="plot.area" :d="plot.area" fill="url(#line-chart-fill)" />
      <path :d="plot.line" fill="none" stroke="var(--color-primary)" stroke-width="1.75" stroke-linejoin="round" />
      <circle v-if="plot.coordinates.length === 1" :cx="plot.coordinates[0]!.x" :cy="plot.coordinates[0]!.y" r="3.5" fill="var(--color-primary)" />
      <template v-if="activePoint">
        <line :x1="activePoint.x" :x2="activePoint.x" :y1="PADDING.top" :y2="plot.bottom" stroke="var(--color-input)" stroke-dasharray="3 3" />
        <circle :cx="activePoint.x" :cy="activePoint.y" r="4.5" fill="var(--color-background)" stroke="var(--color-primary)" stroke-width="2" />
      </template>
    </svg>
    <div
      v-if="activePoint && active !== null"
      class="plate cut-xs pointer-events-none absolute z-10 flex flex-col gap-0.5 bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md [--plate-border:var(--color-input)]"
      :style="{
        top: `${Math.max(0, activePoint.y - 48)}px`,
        left: tooltipOnLeft ? undefined : `${activePoint.x + 12}px`,
        right: tooltipOnLeft ? `${width - activePoint.x + 12}px` : undefined,
      }"
      aria-live="polite"
    >
      <slot name="tooltip" :index="active" />
    </div>
  </div>
</template>
