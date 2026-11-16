import { computed, ref } from 'vue';
import type { GamePhase, GameSessionKind } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useGameSession } from './useGameSession.ts';

const ACTIVE_PHASES: readonly GamePhase[] = ['preparing', 'waitingForServer', 'launching'];

export const LAUNCH_TITLES: Record<GameSessionKind, MessageKey> = {
  online: 'currentGame.launch.titles.online',
  offline: 'currentGame.launch.titles.offline',
  replay: 'currentGame.launch.titles.replay',
};

// Shared by the start window and its minimized card.
const minimized = ref(false);

/** The steps of a game start while it runs, and after a failed start until the user dismisses it. */
export function useLaunch() {
  const { state, clearError } = useGameSession();
  const active = computed(() => ACTIVE_PHASES.includes(state.value.phase));
  const failed = computed(() => state.value.phase === 'idle' && state.value.error !== null && state.value.stages.length > 0);
  const stages = computed(() => state.value.stages);
  const done = computed(() => stages.value.filter((stage) => stage.state === 'done').length);
  const running = computed(() => stages.value.filter((stage) => stage.state === 'running'));
  const current = computed(
    () => running.value[0] ?? stages.value.find((stage) => stage.state === 'failed' || stage.state === 'pending') ?? null,
  );

  return {
    state,
    active,
    failed,
    visible: computed(() => active.value || failed.value),
    minimized,
    done,
    running,
    current,
    cancel: () => window.tfaf.game.cancelLaunch(),
    dismiss: clearError,
  };
}
