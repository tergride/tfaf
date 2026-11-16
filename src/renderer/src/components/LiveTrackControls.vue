<script setup lang="ts">
import { Bell, Play, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { LiveGame, LiveReplayAction } from '../../../shared/contract.ts';
import { useLiveReplayTracking } from '../composables/useLiveReplayTracking.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';

// What to do with a running game the replay server does not give out yet: be told when it can be watched, or have
// it start then. `compact` fits a table cell, which must not select its row when a button is pressed.
const props = defineProps<{ game: LiveGame; watchableIn: number; compact?: boolean }>();

const { tracking, track, untrack } = useLiveReplayTracking();
const busy = ref(false);
const error = ref<string | null>(null);

const minutes = computed(() => Math.max(1, Math.ceil(props.watchableIn / 60)));
const tracked = computed(() => (tracking.value?.gameId === props.game.id ? tracking.value : null));
const trackedText = computed(() =>
  tracked.value
    ? t(tracked.value.action === 'notify' ? 'replays.live.trackingNotify' : 'replays.live.trackingWatch', { minutes: minutes.value })
    : null,
);

async function run(action: () => Promise<void>): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await action();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function start(action: LiveReplayAction): void {
  void run(() => track(props.game.id, action));
}
</script>

<template>
  <div v-if="compact" class="flex items-center gap-1" @click.stop @dblclick.stop @keydown.stop>
    <span
      v-if="error"
      class="min-w-0 flex-1 truncate text-xs text-destructive"
      :data-tooltip="error"
    >
      {{ error }}
    </span>
    <span v-else class="min-w-0 flex-1 truncate text-xs" :class="tracked ? 'text-info' : 'text-faint'">
      {{ trackedText ?? t('replays.live.watchableIn', { minutes }) }}
    </span>
    <Button
      v-if="tracked"
      variant="ghost"
      size="icon-xs"
      :data-tooltip="t('replays.live.cancelTracking')"
      :aria-label="t('replays.live.cancelTracking')"
      :disabled="busy"
      @click="run(untrack)"
    >
      <X />
    </Button>
    <template v-else>
      <Button
        variant="ghost"
        size="icon-xs"
        :data-tooltip="t('replays.live.notify')"
        :aria-label="t('replays.live.notify')"
        :disabled="busy"
        @click="start('notify')"
      >
        <Bell />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        :data-tooltip="t('replays.live.watchWhenReady')"
        :aria-label="t('replays.live.watchWhenReady')"
        :disabled="busy"
        @click="start('watch')"
      >
        <Play />
      </Button>
    </template>
  </div>

  <div v-else class="flex flex-col gap-2">
    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>
    <template v-if="tracked">
      <p class="text-[13px] text-info">{{ trackedText }}</p>
      <Button variant="outline" size="lg" :disabled="busy" @click="run(untrack)"><X />{{ t('replays.live.cancelTracking') }}</Button>
    </template>
    <template v-else>
      <p class="text-[13px] text-muted-foreground">{{ t('replays.panel.watchableIn', { minutes }) }}</p>
      <Button size="lg" :disabled="busy" @click="start('watch')"><Play />{{ t('replays.live.watchWhenReady') }}</Button>
      <Button variant="outline" :disabled="busy" @click="start('notify')"><Bell />{{ t('replays.live.notify') }}</Button>
      <p v-if="tracking" class="text-xs text-muted-foreground">{{ t('replays.live.trackingOther', { title: tracking.title }) }}</p>
    </template>
  </div>
</template>
