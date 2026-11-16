<script setup lang="ts">
import { CircleAlert, CircleCheck, Minimize2 } from '@lucide/vue';
import { computed, ref, shallowRef, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { LAUNCH_TITLES, useLaunch } from '../composables/useLaunch.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import ProgressLine from './ProgressLine.vue';

const { state, active, failed, visible, minimized, done, cancel, dismiss } = useLaunch();
const cancelling = ref(false);
const cancelError = ref<string | null>(null);

const open = computed(() => visible.value && !minimized.value);

// A finished start clears its steps at once; the window keeps its last open state through the closing animation.
const live = computed(() => ({ state: state.value, failed: failed.value, done: done.value }));
const shown = shallowRef(live.value);
watch([live, open], ([next, isOpen]) => {
  if (isOpen) {
    shown.value = next;
  }
});

// Every start opens the window, even when the previous one was minimized.
watch(active, (now, before) => {
  if (now && !before) {
    minimized.value = false;
    cancelling.value = false;
    cancelError.value = null;
  }
});

// Escape and a click outside minimize the window; a running start only stops through the cancel button.
function onOpenChange(next: boolean): void {
  if (next) {
    return;
  }
  if (failed.value) {
    dismiss();
  } else {
    minimized.value = true;
  }
}

async function cancelStart(): Promise<void> {
  cancelling.value = true;
  cancelError.value = null;
  try {
    await cancel();
  } catch (cause) {
    cancelError.value = errorMessage(cause);
    cancelling.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="gap-5 sm:max-w-xl" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">
          {{ shown.failed ? t('currentGame.launch.failed') : t(LAUNCH_TITLES[shown.state.kind]) }}
        </DialogTitle>
        <DialogDescription class="truncate">
          <template v-if="shown.state.title">{{ t('currentGame.quoted', { title: shown.state.title }) }} · </template
          >{{ t('currentGame.launch.progress', { done: shown.done, total: shown.state.stages.length }) }}
        </DialogDescription>
      </DialogHeader>

      <ol class="flex flex-col gap-px border bg-border">
        <li
          v-for="stage in shown.state.stages"
          :key="stage.id"
          class="flex items-start gap-3 bg-card px-3 py-2.5"
          :class="{
            'bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-card))] shadow-[inset_3px_0_0_var(--color-primary)]':
              stage.state === 'running',
            'bg-[color-mix(in_srgb,var(--color-destructive)_8%,var(--color-card))] shadow-[inset_3px_0_0_var(--color-destructive)]':
              stage.state === 'failed',
          }"
        >
          <Spinner v-if="stage.state === 'running'" class="mt-0.5 text-primary" />
          <CircleCheck v-else-if="stage.state === 'done'" class="mt-0.5 size-4 shrink-0 text-success" />
          <CircleAlert v-else-if="stage.state === 'failed'" class="mt-0.5 size-4 shrink-0 text-destructive" />
          <span v-else class="mt-0.5 grid size-4 shrink-0 place-items-center">
            <span class="size-1.5 bg-faint" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex items-center gap-2">
              <span :class="{ 'text-muted-foreground': stage.state === 'pending', 'text-destructive': stage.state === 'failed' }">
                {{ stage.title }}
              </span>
              <span v-if="stage.state === 'running' && stage.progress !== null" class="ml-auto text-xs text-muted-foreground tabular-nums">
                {{ Math.floor(stage.progress * 100) }}%
              </span>
            </div>
            <div v-if="stage.detail" class="truncate text-xs text-muted-foreground tabular-nums" :data-tooltip="stage.detail">
              {{ stage.detail }}
            </div>
            <!-- Without a known share the spinner alone tells that the step runs. -->
            <ProgressLine v-if="stage.state === 'running' && stage.progress !== null" :value="stage.progress" class="mt-1" />
          </div>
        </li>
      </ol>

      <Alert v-if="shown.failed" variant="destructive">
        <AlertDescription class="selectable">{{ shown.state.error }}</AlertDescription>
      </Alert>
      <Alert v-else-if="cancelError" variant="destructive">
        <AlertDescription class="selectable">{{ cancelError }}</AlertDescription>
      </Alert>

      <DialogFooter class="items-center">
        <Button v-if="shown.failed" @click="dismiss">{{ t('common.close') }}</Button>
        <template v-else>
          <p v-if="!shown.state.cancellable" class="mr-auto text-xs text-muted-foreground">
            {{ t('currentGame.launch.cannotCancel') }}
          </p>
          <Button variant="outline" @click="minimized = true"><Minimize2 />{{ t('currentGame.launch.minimize') }}</Button>
          <Button variant="destructive" :disabled="!shown.state.cancellable || cancelling" @click="cancelStart">
            <Spinner v-if="cancelling" />
            {{ t('currentGame.launch.cancelLaunch') }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
