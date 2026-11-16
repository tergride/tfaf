import { readonly, ref } from 'vue';
import type { GameSessionState } from '../../../shared/contract.ts';

const state = ref<GameSessionState>({
  phase: 'idle',
  kind: 'online',
  gameId: null,
  title: null,
  message: null,
  error: null,
  peers: [],
  files: null,
  featureIssues: [],
  stages: [],
  cancellable: false,
  current: null,
  tfafLobby: null,
});
let initialized = false;

export function useGameSession() {
  if (!initialized) {
    initialized = true;
    let receivedEvent = false;
    window.tfaf.game.onStateChanged((next) => {
      receivedEvent = true;
      state.value = next;
    });
    void window.tfaf.game.getState().then((initial) => {
      if (!receivedEvent) {
        state.value = initial;
      }
    });
  }
  return {
    state: readonly(state),
    clearError: () => {
      state.value = { ...state.value, error: null, stages: [] };
    },
  };
}
