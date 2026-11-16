<script setup lang="ts">
import { CircleAlert, Info, TriangleAlert, X } from '@lucide/vue';
import { onBeforeUnmount, watch } from 'vue';
import { Button } from '@/components/ui/button';
import type { AppNotification } from '../../../shared/contract.ts';
import { useNotifications } from '../composables/useNotifications.ts';
import { t } from '../lib/i18n.ts';

const { toasts, prefs, hideToast, act } = useNotifications();

const ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert } as const;
const ICON_TONES = { info: 'text-info', warning: 'text-warning', error: 'text-destructive' } as const;
const BORDERS = {
  info: '[--plate-border:var(--color-input)]',
  warning: '[--plate-border:color-mix(in_srgb,var(--color-warning)_50%,transparent)]',
  error: '[--plate-border:var(--color-destructive)]',
} as const;

// Errors stay until closed; the others leave after the time of the settings.
const timers = new Map<string, number>();
watch(
  toasts,
  (current) => {
    for (const toast of current) {
      if (!timers.has(toast.id) && toast.severity !== 'error') {
        timers.set(
          toast.id,
          window.setTimeout(() => {
            timers.delete(toast.id);
            hideToast(toast.id);
          }, prefs.toastSeconds * 1000),
        );
      }
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => timers.forEach((timer) => window.clearTimeout(timer)));

function close(toast: AppNotification): void {
  window.clearTimeout(timers.get(toast.id));
  timers.delete(toast.id);
  hideToast(toast.id);
}
</script>

<template>
  <TransitionGroup
    enter-active-class="animate-in fade-in-0 slide-in-from-bottom-2"
    leave-active-class="animate-out fade-out-0 slide-out-to-right-8"
  >
    <div v-for="toast in toasts" :key="toast.id" class="plate bg-popover px-3 py-2.5" :class="BORDERS[toast.severity]" role="status">
      <div class="flex items-start gap-2">
        <component :is="ICONS[toast.severity]" class="mt-0.5 size-4 shrink-0" :class="ICON_TONES[toast.severity]" />
        <component
          :is="toast.clickable ? 'button' : 'div'"
          :type="toast.clickable ? 'button' : undefined"
          class="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
          :class="{ 'cursor-pointer hover:[&>span:first-child]:underline': toast.clickable }"
          @click="toast.clickable && act(toast, null)"
        >
          <span class="font-medium wrap-anywhere">{{ toast.title }}</span>
          <span v-if="toast.body" class="line-clamp-4 text-xs whitespace-pre-line text-muted-foreground wrap-anywhere">
            {{ toast.body }}
          </span>
        </component>
        <Button variant="ghost" size="icon-xs" class="-my-0.5" :aria-label="t('notifications.close')" @click="close(toast)">
          <X />
        </Button>
      </div>
      <div v-if="toast.actions.length" class="mt-2 flex flex-wrap gap-1.5 pl-6">
        <Button v-for="action in toast.actions" :key="action.id" variant="outline" size="xs" @click="act(toast, action.id)">
          {{ action.label }}
        </Button>
      </div>
    </div>
  </TransitionGroup>
</template>
