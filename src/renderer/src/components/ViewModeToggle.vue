<script setup lang="ts">
import { LayoutGrid, Rows3 } from '@lucide/vue';
import { t } from '../lib/i18n.ts';
import type { ViewMode } from './listKit.ts';

const model = defineModel<ViewMode>({ required: true });

const OPTIONS = [
  { value: 'cards', labelKey: 'vault.viewMode.cards', icon: LayoutGrid },
  { value: 'table', labelKey: 'vault.viewMode.table', icon: Rows3 },
] as const;
</script>

<template>
  <div class="plate cut-sm flex shrink-0 gap-0.5 bg-secondary p-0.75" role="group" :aria-label="t('vault.viewMode.label')">
    <button
      v-for="option in OPTIONS"
      :key="option.value"
      type="button"
      class="plate plate-control plate-focus cut-xs grid h-7.5 w-8 place-items-center transition-colors [--plate-border:transparent]"
      :class="model === option.value ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
      :aria-pressed="model === option.value"
      :aria-label="t(option.labelKey)"
      :data-tooltip="t(option.labelKey)"
      @click="model = option.value"
    >
      <component :is="option.icon" class="size-4" />
    </button>
  </div>
</template>
