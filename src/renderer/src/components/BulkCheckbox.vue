<script setup lang="ts">
import { Check, Minus } from '@lucide/vue';
import { Checkbox } from '@/components/ui/checkbox';

// A checkbox of a list's bulk selection: one item, or all of them, which shows a dash while only some are ticked. A click
// on it ticks and nothing else, so it does not also open the row or card it sits on.
defineProps<{ checked: boolean | 'indeterminate'; label: string; disabled?: boolean }>();
const emit = defineEmits<{ change: [checked: boolean] }>();
</script>

<template>
  <Checkbox
    :model-value="checked"
    :disabled="disabled"
    :aria-label="label"
    :data-tooltip="label"
    @update:model-value="(value) => emit('change', value === true)"
    @click.stop
    @dblclick.stop
    @keydown.stop
  >
    <template #default="{ state }">
      <Minus v-if="state === 'indeterminate'" class="size-3.5" />
      <Check v-else class="size-3.5" />
    </template>
  </Checkbox>
</template>
