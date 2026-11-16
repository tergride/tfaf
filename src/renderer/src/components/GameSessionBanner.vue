<script setup lang="ts">
import { CircleAlert, X } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { useCloseGame } from '../composables/useCloseGame.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { t } from '../lib/i18n.ts';

// `details`: offer the way to the current game tab, which lists the players and connections.
defineProps<{ details?: boolean }>();
defineEmits<{ details: [] }>();

const { state, clearError } = useGameSession();
const { close: kill, error: killError } = useCloseGame();

function withTitle(label: string): string {
  return state.value.title ? t('currentGame.banner.withTitle', { label, title: state.value.title }) : label;
}

const heading = computed(() =>
  withTitle(state.value.kind === 'replay' ? t('currentGame.banner.watching') : t('currentGame.banner.running')),
);
const failedHeading = computed(() =>
  withTitle(state.value.kind === 'replay' ? t('currentGame.banner.replayFailed') : t('currentGame.banner.gameFailed')),
);

/** `подключено 3 из 4 · файлы не как у хоста: Bob`: what needs attention, the rest is on the tab. */
const summary = computed(() => {
  const peers = state.value.peers;
  if (state.value.kind !== 'online' || peers.length === 0) {
    return null;
  }
  const connected = peers.filter((peer) => peer.state === 'connected').length;
  const differing = (state.value.files?.players ?? []).filter(
    (check) => check.gameFiles === 'different' || check.map === 'different' || check.mods === 'different',
  );
  return [
    t('currentGame.banner.connected', { connected, total: peers.length }),
    differing.length > 0
      ? t('currentGame.banner.filesDiffer', { players: differing.map((peer) => peer.login).join(', ') })
      : null,
    state.value.current?.desyncs ? t('currentGame.banner.hadDesync') : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
});

</script>

<template>
  <!-- A start in progress and a failed start are shown by the start window. -->
  <div
    v-if="state.phase === 'running'"
    class="plate flex items-center gap-3 bg-success/6 px-4 py-2.5 [--plate-border:color-mix(in_srgb,var(--color-success)_40%,transparent)]"
  >
    <span class="size-2.5 shrink-0 rounded-full bg-success shadow-[0_0_8px_var(--color-success)]" />
    <div class="min-w-0 flex-1">
      <div class="truncate font-semibold">{{ heading }}</div>
      <div v-if="summary" class="truncate text-sm text-muted-foreground">{{ summary }}</div>
      <div v-if="killError" class="text-sm text-destructive">{{ killError }}</div>
    </div>
    <Button v-if="details" variant="outline" size="sm" @click="$emit('details')">{{ t('currentGame.banner.details') }}</Button>
    <Button variant="destructive" size="sm" @click="kill">
      {{ state.kind === 'replay' ? t('currentGame.banner.closeReplay') : t('currentGame.banner.closeGame') }}
    </Button>
  </div>
  <div v-else-if="state.error && state.stages.length === 0" class="plate flex items-start gap-3 bg-destructive/8 px-4 py-3 [--plate-border:color-mix(in_srgb,var(--color-destructive)_40%,transparent)]">
    <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
    <div class="min-w-0 flex-1 selectable">
      <div class="font-semibold text-destructive">{{ failedHeading }}</div>
      <div class="text-sm">{{ state.error }}</div>
    </div>
    <Button variant="ghost" size="icon-xs" :aria-label="t('currentGame.banner.hide')" @click="clearError"><X /></Button>
  </div>
</template>
