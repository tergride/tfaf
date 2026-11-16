<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Slider } from '@/components/ui/slider';
import { rangeLabel, type StepRange } from './listKit.ts';

// The model holds positions in `steps`; the whole range means the filter is off.
const props = defineProps<{ label: string; steps: readonly string[]; format?: (range: string) => string }>();
const model = defineModel<StepRange>({ required: true });

// While a thumb is dragged only the slider and its label move; the model, and with it the query, changes when it is let go.
const draft = ref<StepRange | null>(null);
watch(model, () => {
  draft.value = null;
});
const shown = computed(() => draft.value ?? model.value);
const last = computed(() => props.steps.length - 1);
const active = computed(() => shown.value[0] > 0 || shown.value[1] < last.value);
const text = computed(() => {
  const range = rangeLabel(props.steps, shown.value);
  return props.format ? props.format(range) : range;
});

function toRange(value: number[] | undefined): StepRange | null {
  const [low, high] = value ?? [];
  return low === undefined || high === undefined ? null : [low, high];
}

function commit(value: number[]): void {
  const range = toRange(value);
  if (range) {
    model.value = range;
  }
  draft.value = null;
}
</script>

<template>
  <div class="flex w-36 flex-col gap-1" role="group" :aria-label="label">
    <div class="flex items-baseline justify-between gap-2 text-[13px]">
      <span class="text-muted-foreground">{{ label }}</span>
      <span class="font-medium tabular-nums" :class="active ? 'text-primary' : 'text-muted-foreground'">{{ text }}</span>
    </div>
    <Slider
      :model-value="shown"
      :min="0"
      :max="last"
      :step="1"
      :aria-label="label"
      class="h-4 cursor-pointer"
      :class="{ '[&_[data-slot=slider-range]]:bg-faint/45 [&_[data-slot=slider-thumb]]:bg-faint': !active }"
      @update:model-value="(value) => (draft = toRange(value))"
      @value-commit="commit"
    />
  </div>
</template>
