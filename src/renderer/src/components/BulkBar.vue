<script setup lang="ts">
import { Trash2, X } from '@lucide/vue';
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { t } from '../lib/i18n.ts';

// The bar of a list's bulk selection, floating over the bottom of the list while items are ticked: how many, delete
// them, tick all, or untick (also Esc). Placed last in the list's scrolling area.
const props = defineProps<{
  count: number;
  /** How many items can be ticked at all. */
  total: number;
  /** The count with its noun, such as "3 maps". */
  label: string;
  busy: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ delete: []; selectAll: []; clear: []; dismissError: [] }>();

// Esc unticks before it closes the item's panel; a dialog on top keeps its own Esc.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || props.count === 0 || props.busy || document.querySelector('[role="dialog"], [role="alertdialog"]')) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  emit('clear');
}

// The views stay alive while hidden, so the key is only listened for while the list is on screen.
let listening = false;
function listen(on: boolean): void {
  if (on !== listening) {
    listening = on;
    if (on) {
      window.addEventListener('keydown', onKeydown, true);
    } else {
      window.removeEventListener('keydown', onKeydown, true);
    }
  }
}
onMounted(() => listen(true));
onActivated(() => listen(true));
onDeactivated(() => listen(false));
onBeforeUnmount(() => listen(false));
</script>

<template>
  <div class="pointer-events-none sticky bottom-4 z-20 mt-4 flex flex-col items-center gap-2">
    <Alert v-if="error" variant="destructive" class="pointer-events-auto flex max-w-2xl items-start gap-2 shadow-lg">
      <AlertDescription class="flex-1 selectable">{{ error }}</AlertDescription>
      <Button variant="ghost" size="icon-xs" :data-tooltip="t('common.close')" :aria-label="t('common.close')" @click="emit('dismissError')">
        <X />
      </Button>
    </Alert>
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="count > 0"
        role="toolbar"
        :aria-label="t('vault.bulk.toolbar')"
        class="plate cut-sm pointer-events-auto flex items-center gap-1.5 bg-popover py-1.5 pr-1.5 pl-4 shadow-[0_12px_32px_rgb(0_0_0/0.55)] [--plate-border:var(--color-input)]"
      >
        <span class="mr-2 text-sm font-semibold whitespace-nowrap tabular-nums" aria-live="polite">{{ label }}</span>
        <Button v-if="count < total" variant="ghost" size="sm" :disabled="busy" @click="emit('selectAll')">
          {{ t('vault.bulk.selectAll') }}
          <span class="text-muted-foreground tabular-nums">{{ total }}</span>
        </Button>
        <Button variant="destructive" size="sm" :disabled="busy" @click="emit('delete')">
          <Spinner v-if="busy" />
          <Trash2 v-else />
          {{ t('common.delete') }}
        </Button>
        <Button variant="ghost" size="sm" :disabled="busy" @click="emit('clear')">
          {{ t('vault.bulk.clear') }}
          <kbd class="plate cut-xs bg-secondary px-1 font-sans text-[11px] text-muted-foreground [--plate-border:transparent]">Esc</kbd>
        </Button>
      </div>
    </Transition>
  </div>
</template>
