<script setup lang="ts" generic="Id extends string">
import type { Component } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../lib/i18n.ts';

export interface NavGroup<Id extends string> {
  title: string | null;
  items: { id: Id; label: string; icon: Component }[];
}

// The sections of the launcher; `compact` keeps only the icons, with the labels in tooltips. The last group stays at the
// bottom. `attention` is a count that needs the user, `counts` a quiet number, `busy` a running process.
defineProps<{
  groups: NavGroup<Id>[];
  current: Id;
  compact: boolean;
  attention: Partial<Record<Id, { count: number; title: string }>>;
  counts: Partial<Record<Id, number>>;
  busy: Partial<Record<Id, boolean>>;
}>();
defineEmits<{ navigate: [id: Id] }>();
</script>

<template>
  <nav class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" :aria-label="t('app.sections')">
    <div
      v-for="(group, index) in groups"
      :key="index"
      class="flex flex-col gap-0.5"
      :class="{ 'mt-auto pt-3': index === groups.length - 1 }"
    >
      <span v-if="group.title && !compact" class="px-3 pt-4 pb-1 text-xs text-faint">{{ group.title }}</span>
      <span v-else-if="group.title" class="mx-auto my-2 h-px w-6 bg-border" />
      <Tooltip v-for="item in group.items" :key="item.id" :disabled="!compact">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="plate plate-focus cut-sm relative flex h-9 shrink-0 items-center gap-3 font-display text-[14px] font-medium transition-colors [--plate-border:transparent]"
            :class="[
              compact ? 'w-10 justify-center' : 'px-3 text-left',
              current === item.id
                ? 'bg-accent text-foreground before:absolute before:inset-y-2.5 before:left-0 before:w-0.75 before:bg-primary [&>svg]:text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            ]"
            :aria-current="current === item.id ? 'page' : undefined"
            :aria-label="compact ? item.label : undefined"
            @click="$emit('navigate', item.id)"
          >
            <component :is="item.icon" class="size-4.5" />
            <template v-if="!compact">
              {{ item.label }}
              <Badge v-if="attention[item.id]" class="ml-auto tabular-nums" :data-tooltip="attention[item.id]!.title">
                {{ attention[item.id]!.count }}
              </Badge>
              <Spinner v-else-if="busy[item.id]" class="ml-auto size-3.5 text-primary" />
              <span v-else-if="counts[item.id]" class="ml-auto font-sans text-xs text-faint tabular-nums">
                {{ counts[item.id] }}
              </span>
            </template>
            <span v-else-if="attention[item.id] || busy[item.id]" class="absolute top-1.5 right-1.5 size-2 bg-primary" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{{ item.label }}</TooltipContent>
      </Tooltip>
    </div>
  </nav>
</template>
