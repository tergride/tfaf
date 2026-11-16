<script setup lang="ts">
import { Badge } from '@/components/ui/badge';
import BulkCheckbox from './BulkCheckbox.vue';
import type { CardBadge } from './cardBadge.ts';
import PreviewImage from './PreviewImage.vue';

// Slots: `status` over the bottom of the picture, `quick` for one action over its top corner (shown on hover and
// when selected), `title-icon` after the title, `meta` in place of the meta lines. A `checkable` card has a
// checkbox of the list's bulk selection in its top left corner, shown on hover, when ticked and while any card is ticked.
defineProps<{
  title: string;
  image: string | null;
  subtitle?: string | null;
  meta?: (string | null)[];
  badges?: CardBadge[];
  square?: boolean;
  selected?: boolean;
  checkable?: boolean;
  checked?: boolean;
  checkLabel?: string;
  checkDisabled?: boolean;
  /** Some card of the list is ticked, so every checkbox shows. */
  selecting?: boolean;
}>();

defineEmits<{ open: []; check: [checked: boolean] }>();
</script>

<template>
  <div class="group/card relative min-w-0" :class="{ brackets: selected }">
    <button
      type="button"
      class="plate plate-focus cut-lg flex h-full w-full min-w-0 flex-col overflow-hidden bg-card text-left transition-colors"
      :class="selected ? '[--plate-border:var(--color-primary)]' : 'hover:[--plate-border:var(--color-input)]'"
      :aria-pressed="selected"
      @click="$emit('open')"
    >
      <div class="relative w-full overflow-hidden bg-background" :class="square ? 'aspect-square' : 'aspect-16/10'">
        <PreviewImage :src="image" :fallback="title.slice(0, 1).toUpperCase()" lazy />
        <div v-if="badges?.length" class="absolute top-2 right-2 flex flex-wrap gap-1" :class="checkable ? 'left-9' : 'left-2'">
          <Badge
            v-for="badge in badges"
            :key="badge.text"
            :variant="badge.tone ?? 'muted'"
            class="bg-background/80 backdrop-blur-sm"
          >
            {{ badge.text }}
          </Badge>
        </div>
        <div v-if="$slots.status" class="absolute bottom-2 left-2 flex gap-1">
          <slot name="status" />
        </div>
      </div>
      <div class="flex w-full min-w-0 flex-col gap-0.5 px-3 pt-2.5 pb-3">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate font-display text-[15px] leading-tight font-semibold" :data-tooltip="title">{{ title }}</span>
          <slot name="title-icon" />
        </div>
        <!-- A null subtitle keeps its empty line, so the cards of one list line up. -->
        <div v-if="subtitle !== undefined" class="truncate text-xs text-muted-foreground">{{ subtitle || '\u00a0' }}</div>
        <slot name="meta">
          <div
            v-for="(line, index) in (meta ?? []).filter(Boolean)"
            :key="index"
            class="truncate text-xs text-muted-foreground/80"
          >
            {{ line }}
          </div>
        </slot>
      </div>
    </button>
    <div
      v-if="checkable && !checkDisabled"
      class="absolute top-2 left-2 grid size-6 place-items-center bg-hull/80 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100"
      :class="checked || selecting ? 'opacity-100' : 'opacity-0'"
    >
      <BulkCheckbox :checked="checked" :label="checkLabel ?? title" @change="(value) => $emit('check', value)" />
    </div>
    <div
      v-if="$slots.quick"
      class="absolute top-2 right-2 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100"
      :class="{ 'opacity-100': selected }"
    >
      <slot name="quick" />
    </div>
  </div>
</template>
