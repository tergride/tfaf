<script setup lang="ts">
import { Ban, CircleAlert, CircleCheck, X } from '@lucide/vue';
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTasks } from '../composables/useTasks.ts';
import { t } from '../lib/i18n.ts';
import ProgressLine from './ProgressLine.vue';

const { tasks, dismiss } = useTasks();
// Between the click and the task's final state the button stays disabled.
const cancelling = ref(new Set<string>());

async function cancel(id: string): Promise<void> {
  cancelling.value = new Set(cancelling.value).add(id);
  try {
    await window.tfaf.tasks.cancel(id);
  } catch (error) {
    console.warn('Task could not be cancelled', error);
    const next = new Set(cancelling.value);
    next.delete(id);
    cancelling.value = next;
  }
}
</script>

<template>
  <TransitionGroup
    enter-active-class="animate-in fade-in-0 slide-in-from-bottom-2"
    leave-active-class="animate-out fade-out-0 slide-out-to-right-8"
  >
    <div
      v-for="task in tasks"
      :key="task.id"
      class="plate bg-popover px-3 py-2.5"
      :class="task.state === 'failed' ? '[--plate-border:var(--color-destructive)]' : '[--plate-border:var(--color-input)]'"
    >
      <div class="flex items-center gap-2">
        <Spinner v-if="task.state === 'running'" class="text-primary" />
        <CircleCheck v-else-if="task.state === 'done'" class="size-4 text-success" />
        <Ban v-else-if="task.state === 'cancelled'" class="size-4 text-muted-foreground" />
        <CircleAlert v-else class="size-4 text-destructive" />
        <span class="flex-1 truncate" :class="{ 'text-muted-foreground': task.state === 'cancelled' }">{{ task.title }}</span>
        <span v-if="task.state === 'cancelled'" class="text-xs text-muted-foreground">{{ t('app.tasks.cancelled') }}</span>
        <Button
          v-else-if="task.state === 'running' && task.cancellable"
          variant="ghost"
          size="xs"
          class="-my-1 text-muted-foreground"
          :disabled="cancelling.has(task.id)"
          @click="cancel(task.id)"
        >
          {{ cancelling.has(task.id) ? t('app.tasks.cancelling') : t('app.tasks.cancel') }}
        </Button>
        <Button v-if="task.state === 'failed'" variant="ghost" size="icon-xs" :aria-label="t('app.tasks.hide')" @click="dismiss(task.id)">
          <X />
        </Button>
      </div>
      <div v-if="task.state === 'failed'" class="mt-1.5 text-xs text-muted-foreground selectable">{{ task.error }}</div>
      <template v-else-if="task.state !== 'cancelled'">
        <div
          v-if="task.state === 'running' && task.detail"
          class="mt-1 truncate text-xs text-muted-foreground tabular-nums"
          :data-tooltip="task.detail"
        >
          {{ task.detail }}
        </div>
        <ProgressLine :value="task.progress" :done="task.state === 'done'" class="mt-2" />
      </template>
    </div>
  </TransitionGroup>
</template>
