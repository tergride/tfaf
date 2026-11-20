<script setup lang="ts">
import { computed } from 'vue';
import { FieldDescription, FieldLabel } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import RandomToggle from './RandomToggle.vue';
import { useRandomChoice } from './randomChoice.ts';

const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    /** What the slider shows beside the label; the value itself by default. */
    valueLabel?: string;
    disabled?: boolean;
    randomPath?: string;
    hint?: string | null;
  }>(),
  { min: 0, max: 100, step: 1, valueLabel: undefined, disabled: false, randomPath: undefined, hint: null },
);
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const { isRandom } = useRandomChoice();
const random = computed(() => isRandom(props.randomPath));

function set(value: number[] | undefined): void {
  const [next] = value ?? [];
  if (next !== undefined) {
    emit('update:modelValue', next);
  }
}
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="{ 'opacity-60': disabled && !random }">
    <div class="flex items-center justify-between gap-2">
      <FieldLabel :for="id">{{ label }}</FieldLabel>
      <span class="text-sm text-muted-foreground tabular-nums">{{ valueLabel ?? modelValue }}</span>
    </div>
    <div class="flex items-center gap-2">
      <Slider
        :id="id"
        class="h-5 flex-1"
        :model-value="[modelValue]"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled || random"
        :aria-label="label"
        @update:model-value="set"
      />
      <RandomToggle v-if="randomPath" :path="randomPath" :label="label" />
    </div>
    <FieldDescription v-if="hint" class="text-xs">{{ hint }}</FieldDescription>
  </div>
</template>
