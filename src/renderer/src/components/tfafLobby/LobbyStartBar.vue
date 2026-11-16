<script setup lang="ts">
import { Play } from '@lucide/vue';
import { computed, type DeepReadonly } from 'vue';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { type LobbyStartBlocker, NO_TEAM } from '../../../../shared/contract.ts';
import { useRoomFactions } from '../../composables/useRoomFactions.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { t } from '../../lib/i18n.ts';
import StatusLamp from '../StatusLamp.vue';

const { view, hosting, self, starting, act, run, error } = useTfafLobby();

const roomFactions = useRoomFactions();
const blockers = computed(() => view.value?.startBlockers ?? []);
/** Who plays what and where, as the host's launcher settled the start. */
const seats = computed(() =>
  (view.value?.launch?.armies ?? []).map((army) => ({
    key: `${army.spot}`,
    name: army.name,
    faction: roomFactions.faction(army.faction),
    place:
      army.team === NO_TEAM
        ? t('tfafLobby.start.starting.seat', { spot: army.spot })
        : t('tfafLobby.start.starting.seatTeam', { spot: army.spot, team: army.team - 1 }),
  })),
);
const ready = computed(() => self.value?.ready ?? false);

function blockerText(blocker: DeepReadonly<LobbyStartBlocker>): string {
  switch (blocker.kind) {
    case 'noPlayers':
      return t('tfafLobby.start.blockers.noPlayers');
    case 'unsupportedGame':
      return t('tfafLobby.start.blockers.unsupportedGame', { changes: blocker.changes.join(', ') });
    default:
      return t(`tfafLobby.start.blockers.${blocker.kind}`, { players: blocker.logins.join(', ') });
  }
}

const start = (): Promise<void> => run(() => window.tfaf.tfafLobby.start());
const cancel = (): Promise<void> => run(() => window.tfaf.tfafLobby.cancelStart());

const abortNote = computed(() => {
  const abort = view.value?.lastAbort;
  return abort ? t(`tfafLobby.start.aborted.${abort.reason}`, { player: abort.login ?? '' }) : null;
});
</script>

<template>
  <footer class="plate cut-lg flex min-h-16 items-center gap-4 bg-card px-5 py-3">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <p v-if="error" class="truncate text-sm text-destructive selectable">{{ error }}</p>
      <p v-else-if="abortNote && !starting" class="truncate text-sm text-warning">{{ abortNote }}</p>
      <template v-if="starting">
        <span class="flex items-center gap-2 font-display font-semibold"><Spinner class="text-primary" />{{ t('tfafLobby.start.starting.title') }}</span>
        <ul v-if="seats.length > 0" class="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
          <li v-for="seat in seats" :key="seat.key" class="flex items-center gap-1.5">
            <img v-if="seat.faction.icon" :src="seat.faction.icon" :alt="seat.faction.name" class="size-4" draggable="false" />
            <span class="selectable">{{ seat.name }}</span>
            <span class="text-faint">{{ seat.place }}</span>
          </li>
        </ul>
        <span v-else class="text-sm text-muted-foreground">{{ t('tfafLobby.start.starting.description') }}</span>
      </template>
      <ul v-else-if="blockers.length > 0" class="flex flex-col gap-0.5">
        <li v-for="blocker in blockers" :key="blocker.kind" class="truncate text-sm text-muted-foreground" :data-tooltip="blockerText(blocker)">{{ blockerText(blocker) }}</li>
      </ul>
      <StatusLamp v-else tone="success" large>{{ t('tfafLobby.start.allSet') }}</StatusLamp>
    </div>

    <template v-if="starting">
      <Button v-if="hosting" variant="outline" @click="cancel">{{ t('tfafLobby.start.cancel') }}</Button>
    </template>
    <Button v-else-if="hosting" size="lg" :disabled="blockers.length > 0" @click="start"><Play />{{ t('tfafLobby.start.start') }}</Button>
    <template v-else>
      <span v-if="ready" class="text-sm text-muted-foreground">{{ t('tfafLobby.start.waitingForHost') }}</span>
      <Button size="lg" :variant="ready ? 'outline' : 'default'" @click="act({ type: 'setReady', ready: !ready })">
        {{ ready ? t('tfafLobby.start.notReady') : t('tfafLobby.start.ready') }}
      </Button>
    </template>
  </footer>
</template>
