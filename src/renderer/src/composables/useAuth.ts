import { readonly, ref } from 'vue';
import type { AuthState } from '../../../shared/contract.ts';

const state = ref<AuthState | null>(null);
let initialized = false;

export function useAuth() {
  if (!initialized) {
    initialized = true;
    let receivedEvent = false;
    window.tfaf.auth.onStateChanged((next) => {
      receivedEvent = true;
      state.value = next;
    });
    void window.tfaf.auth.getState().then((initial) => {
      if (!receivedEvent) {
        state.value = initial;
      }
    });
  }
  return readonly(state);
}
