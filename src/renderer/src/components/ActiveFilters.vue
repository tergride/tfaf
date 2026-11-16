<script setup lang="ts">
import { X } from '@lucide/vue';
import { t } from '../lib/i18n.ts';
import type { ActiveFilter } from './listKit.ts';

defineProps<{ filters: ActiveFilter[]; hint?: string }>();
defineEmits<{ remove: [key: string]; clear: [] }>();
</script>

<template>
  <div class="flex min-h-11 flex-wrap items-center gap-2 py-2">
    <template v-if="filters.length">
      <span
        v-for="filter in filters"
        :key="filter.key"
        class="plate plate-control cut-xs inline-flex h-6.5 items-center gap-1 bg-secondary pr-1 pl-2.5 text-[13px] [--plate-border:transparent]"
      >
        {{ filter.label }}
        <button
          type="button"
          class="grid size-5 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
          :aria-label="t('vault.activeFilters.remove', { label: filter.label })"
          @click="$emit('remove', filter.key)"
        >
          <X class="size-3.5" />
        </button>
      </span>
      <button
        type="button"
        class="px-1.5 py-1 text-[13px] text-info outline-none hover:underline focus-visible:underline"
        @click="$emit('clear')"
      >
        {{ t('vault.activeFilters.clearAll') }}
      </button>
    </template>
    <span v-else-if="hint" class="text-[13px] text-faint">{{ hint }}</span>
    <span class="ml-auto text-[13px] text-muted-foreground tabular-nums"><slot /></span>
  </div>
</template>
