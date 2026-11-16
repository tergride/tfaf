<script setup lang="ts">
import { Bell, CircleAlert, Info, Trash2, TriangleAlert, X } from '@lucide/vue';
import { useNow } from '@vueuse/core';
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotifications } from '../composables/useNotifications.ts';
import { timeAgo } from '../format.ts';
import { t } from '../lib/i18n.ts';

const { items, unread, act, markAllRead, dismiss, clear } = useNotifications();
const now = useNow({ interval: 30_000 });

const ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert } as const;
const ICON_TONES = { info: 'text-info', warning: 'text-warning', error: 'text-destructive' } as const;

// Opening the list reads everything; what was new keeps its mark until the list closes.
const fresh = ref(new Set<string>());

function onOpenChange(open: boolean): void {
  if (open) {
    fresh.value = new Set(items.value.filter((item) => !item.read).map((item) => item.id));
    if (fresh.value.size > 0) {
      void markAllRead();
    }
  } else {
    fresh.value = new Set();
  }
}
</script>

<template>
  <Popover @update:open="onOpenChange">
    <!-- The count sits beside the button, not in it: the button's cut corners would clip it. -->
    <span class="no-drag relative flex">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="icon-sm" :aria-label="t('notifications.title')">
          <Bell />
        </Button>
      </PopoverTrigger>
      <span
        v-if="unread"
        class="pointer-events-none absolute top-0 right-0 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
      >
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </span>
    <PopoverContent align="end" class="flex w-96 flex-col gap-0 p-0">
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <span class="flex-1 font-display font-semibold">{{ t('notifications.title') }}</span>
        <Button variant="ghost" size="icon-xs" :disabled="!items.length" :data-tooltip="t('notifications.clear')" :aria-label="t('notifications.clear')" @click="clear()">
          <Trash2 />
        </Button>
      </div>
      <p v-if="!items.length" class="px-3 py-6 text-center text-sm text-muted-foreground">{{ t('notifications.empty') }}</p>
      <ul v-else class="flex max-h-[min(28rem,70vh)] flex-col overflow-y-auto">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex gap-2 border-b px-3 py-2.5 last:border-b-0"
          :class="{ 'bg-primary/5': fresh.has(item.id) }"
        >
          <component :is="ICONS[item.severity]" class="mt-0.5 size-4 shrink-0" :class="ICON_TONES[item.severity]" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <component
              :is="item.clickable ? 'button' : 'div'"
              :type="item.clickable ? 'button' : undefined"
              class="flex flex-col gap-0.5 text-left"
              :class="{ 'cursor-pointer hover:[&>span:first-child]:underline': item.clickable }"
              @click="item.clickable && act(item, null)"
            >
              <span class="text-sm font-medium wrap-anywhere">{{ item.title }}</span>
              <span v-if="item.body" class="text-xs whitespace-pre-line text-muted-foreground wrap-anywhere selectable">
                {{ item.body }}
              </span>
            </component>
            <div v-if="item.actions.length" class="flex flex-wrap gap-1.5">
              <Button v-for="action in item.actions" :key="action.id" variant="outline" size="xs" @click="act(item, action.id)">
                {{ action.label }}
              </Button>
            </div>
            <span class="text-[11px] text-faint">{{ timeAgo(item.createdAt, now.getTime()) }}</span>
          </div>
          <Button variant="ghost" size="icon-xs" :aria-label="t('notifications.dismiss')" @click="dismiss(item.id)">
            <X />
          </Button>
        </li>
      </ul>
    </PopoverContent>
  </Popover>
</template>
