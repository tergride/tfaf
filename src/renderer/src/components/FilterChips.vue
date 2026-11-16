<script setup lang="ts" generic="T extends string | number">
import FilterChip from './FilterChip.vue';
import type { ChipOption } from './listKit.ts';

// Without `required` the chips pick any number of values; with it exactly one, kept in a one-item list.
const props = defineProps<{ label: string; options: readonly ChipOption<T>[]; required?: boolean }>();
const model = defineModel<T[]>({ required: true });

function toggle(value: T): void {
  if (props.required) {
    model.value = [value];
  } else if (model.value.includes(value)) {
    model.value = model.value.filter((item) => item !== value);
  } else {
    model.value = [...model.value, value];
  }
}
</script>

<template>
  <div class="flex items-center gap-0.75" role="group" :aria-label="label">
    <span class="mr-1.5 text-[13px] text-muted-foreground">{{ label }}</span>
    <FilterChip
      v-for="option in options"
      :key="option.value"
      :pressed="model.includes(option.value)"
      @toggle="toggle(option.value)"
    >
      {{ option.label }}
    </FilterChip>
  </div>
</template>
