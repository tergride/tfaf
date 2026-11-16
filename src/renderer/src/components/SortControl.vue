<script setup lang="ts" generic="T extends string">
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SortOrder } from '../../../shared/contract.ts';
import { t } from '../lib/i18n.ts';
import type { SortOption } from './listKit.ts';

const props = defineProps<{ options: readonly SortOption<T>[] }>();
const field = defineModel<T>('field', { required: true });
// Lists sorted only one way leave the direction out.
const order = defineModel<SortOrder>('order');

function pick(value: unknown): void {
  const option = props.options.find((item) => item.value === value);
  if (option) {
    field.value = option.value;
    if (order.value !== undefined) {
      order.value = option.order;
    }
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1.5">
    <Select :model-value="field" @update:model-value="pick">
      <SelectTrigger class="plate-control min-w-44" :aria-label="t('vault.sortControl.label')">
        <span class="text-faint @max-[60rem]:hidden">{{ t('vault.sortControl.label') }}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
      </SelectContent>
    </Select>
    <Button
      v-if="order !== undefined"
      variant="outline"
      size="icon"
      :data-tooltip="order === 'desc' ? t('vault.sortControl.descending') : t('vault.sortControl.ascending')"
      :aria-label="order === 'desc' ? t('vault.sortControl.descending') : t('vault.sortControl.ascending')"
      @click="order = order === 'desc' ? 'asc' : 'desc'"
    >
      <ArrowDownWideNarrow v-if="order === 'desc'" />
      <ArrowUpNarrowWide v-else />
    </Button>
  </div>
</template>
