<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '../../lib/i18n.ts';
import { RANDOM_VALUE, useRandomChoice } from './randomChoice.ts';

export interface SmOption<V> {
  value: V;
  label: string;
  disabled?: boolean;
}

const props = defineProps<{
  id: string;
  label: string;
  modelValue: T;
  options: SmOption<T>[];
  disabled?: boolean;
  /** The catalog path when the setting may be left to the seed. */
  randomPath?: string;
  hint?: string | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T] }>();
const { isRandom, randomTopology, toggle } = useRandomChoice();

const random = computed(() => isRandom(props.randomPath));
const locked = computed(() => props.disabled && !random.value && !(props.randomPath && randomTopology()));

function choose(value: unknown): void {
  if (value === RANDOM_VALUE) {
    if (props.randomPath) {
      toggle(props.randomPath, true);
    }
    return;
  }
  if (props.randomPath) {
    toggle(props.randomPath, false);
  }
  const option = props.options.find((candidate) => candidate.value === value);
  if (option) {
    emit('update:modelValue', option.value);
  }
}
</script>

<template>
  <Field class="gap-1.5">
    <FieldLabel :for="id">{{ label }}</FieldLabel>
    <Select :model-value="random ? RANDOM_VALUE : modelValue" :disabled="locked" @update:model-value="choose">
      <SelectTrigger :id="id" class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem v-if="randomPath" :value="RANDOM_VALUE">{{ t('stoneMap.settings.random') }}</SelectItem>
        <SelectItem v-for="option in options" :key="String(option.value)" :value="option.value" :disabled="option.disabled">
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>
    <FieldDescription v-if="hint">{{ hint }}</FieldDescription>
  </Field>
</template>
