<script setup lang="ts">
import { X } from '@lucide/vue';
import { useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { t } from '../lib/i18n.ts';

// `kind` names what the panel shows; a new `itemKey` (another item) scrolls the panel back to the top.
const props = defineProps<{ title: string; kind: string; itemKey: string | number }>();
defineEmits<{ close: [] }>();

const scroller = useTemplateRef<HTMLElement>('scroller');
watch(
  () => props.itemKey,
  () => scroller.value?.scrollTo({ top: 0 }),
);
</script>

<template>
  <aside class="flex h-full w-90 shrink-0 flex-col border-l bg-card" :aria-label="kind">
    <div class="flex h-11 shrink-0 items-center justify-between gap-2 border-b pr-2 pl-5">
      <span class="truncate text-[13px] text-faint">{{ kind }}</span>
      <Button variant="ghost" size="icon-sm" :aria-label="t('vault.detailPanel.close')" :data-tooltip="t('vault.detailPanel.closeHint')" @click="$emit('close')">
        <X />
      </Button>
    </div>
    <div ref="scroller" class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4 pb-5 *:shrink-0">
      <slot name="media" />
      <h2 class="font-display text-[22px] leading-tight font-semibold wrap-anywhere selectable">{{ title }}</h2>
      <slot />
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-col gap-2 border-t px-5 pt-3.5 pb-4">
      <slot name="actions" />
    </div>
  </aside>
</template>
