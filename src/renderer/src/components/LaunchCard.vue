<script setup lang="ts">
import { CircleAlert, Maximize2, X } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LAUNCH_TITLES, useLaunch } from '../composables/useLaunch.ts';
import { t } from '../lib/i18n.ts';
import ProgressLine from './ProgressLine.vue';

const { state, active, failed, visible, minimized, done, running, current, cancel, dismiss } = useLaunch();
const cancelling = ref(false);

watch(active, (now) => {
  if (now) {
    cancelling.value = false;
  }
});

const heading = computed(() => {
  const label = failed.value ? t('currentGame.launch.failed') : t(LAUNCH_TITLES[state.value.kind]);
  return state.value.title ? t('currentGame.launch.withTitle', { label, title: state.value.title }) : label;
});

/** `Файлы игры · 45%`, with the number of other steps running side by side. */
const currentLabel = computed(() => {
  const stage = current.value;
  if (!stage) {
    return null;
  }
  const others = stage.state === 'running' ? running.value.length - 1 : 0;
  return [
    others > 0 ? t('currentGame.launch.stageAndMore', { stage: stage.title, count: others }) : stage.title,
    stage.state === 'running' && stage.progress !== null ? `${Math.floor(stage.progress * 100)}%` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
});

async function cancelStart(): Promise<void> {
  cancelling.value = true;
  try {
    await cancel();
  } catch {
    // Too late: the server is creating the game, which the window says.
    cancelling.value = false;
    minimized.value = false;
  }
}
</script>

<template>
  <Transition
    enter-active-class="animate-in fade-in-0 slide-in-from-bottom-2"
    leave-active-class="animate-out fade-out-0 slide-out-to-right-8"
  >
    <div
      v-if="visible && minimized"
      role="button"
      tabindex="0"
      class="plate plate-focus cursor-pointer bg-popover px-3 py-2.5 hover:bg-accent"
      :class="failed ? '[--plate-border:var(--color-destructive)]' : '[--plate-border:var(--color-primary)]'"
      :data-tooltip="t('currentGame.launch.expand')"
      @click="minimized = false"
      @keydown.enter.self="minimized = false"
    >
      <div class="flex items-center gap-2">
        <CircleAlert v-if="failed" class="size-4 shrink-0 text-destructive" />
        <Spinner v-else class="text-primary" />
        <span class="flex-1 truncate font-medium">{{ heading }}</span>
        <Button
          v-if="failed"
          variant="ghost"
          size="icon-xs"
          :aria-label="t('currentGame.launch.hide')"
          @click.stop="dismiss"
        >
          <X />
        </Button>
        <template v-else>
          <Button
            v-if="state.cancellable"
            variant="destructive"
            size="xs"
            class="-my-1"
            :disabled="cancelling"
            @click.stop="cancelStart"
          >
            {{ cancelling ? t('currentGame.launch.cancelling') : t('currentGame.launch.cancel') }}
          </Button>
          <Maximize2 class="size-3.5 shrink-0 text-muted-foreground" />
        </template>
      </div>
      <div class="mt-1 truncate text-xs text-muted-foreground tabular-nums">
        <template v-if="failed">{{ state.error }}</template>
        <template v-else>{{ t('currentGame.launch.doneOfTotal', { done, total: state.stages.length }) }}<template v-if="currentLabel"> · {{ currentLabel }}</template></template>
      </div>
      <ProgressLine
        v-if="!failed && current?.state === 'running' && current.progress !== null"
        :value="current.progress"
        class="mt-2"
      />
    </div>
  </Transition>
</template>
