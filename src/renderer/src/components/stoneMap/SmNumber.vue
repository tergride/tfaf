<script setup lang="ts">
import { computed } from 'vue';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import RandomToggle from './RandomToggle.vue';
import { useRandomChoice } from './randomChoice.ts';

const props = defineProps<{
  id: string;
  label: string;
  modelValue: number | null;
  min?: number;
  max?: number;
  step?: number | 'any';
  /** An empty field stands for no value (null) instead of keeping the old one. */
  nullable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  randomPath?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();
const { isRandom } = useRandomChoice();
const random = computed(() => isRandom(props.randomPath));

function set(text: string | number): void {
  const raw = String(text).trim();
  if (raw === '') {
    if (props.nullable) {
      emit('update:modelValue', null);
    }
    return;
  }
  const value = Number(raw.replace(',', '.'));
  if (Number.isFinite(value)) {
    emit('update:modelValue', value);
  }
}
</script>

<template>
  <Field class="gap-1.5">
    <FieldLabel :for="id">{{ label }}</FieldLabel>
    <div class="flex items-center gap-2">
      <Input
        :id="id"
        type="number"
        class="tabular-nums"
        :model-value="modelValue ?? ''"
        :min="min"
        :max="max"
        :step="step ?? 1"
        :placeholder="placeholder"
        :disabled="disabled || random"
        @update:model-value="set"
      />
      <RandomToggle v-if="randomPath" :path="randomPath" :label="label" />
    </div>
  </Field>
</template>
