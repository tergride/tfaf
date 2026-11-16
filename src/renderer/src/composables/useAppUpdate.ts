import { readonly, ref } from 'vue';
import type { AppUpdateState } from '../../../shared/contract.ts';

const state = ref<AppUpdateState | null>(null);
let initialized = false;

export function useAppUpdate() {
  if (!initialized) {
    initialized = true;
    let receivedEvent = false;
    window.tfaf.appUpdate.onStateChanged((next) => {
      receivedEvent = true;
      state.value = next;
    });
    void window.tfaf.appUpdate.getState().then((initial) => {
      if (!receivedEvent) {
        state.value = initial;
      }
    });
  }
  return readonly(state);
}
