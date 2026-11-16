import { readonly, ref } from 'vue';
import type { WindowState } from '../../../shared/contract.ts';

const state = ref<WindowState>({ maximized: false, focused: true });
let initialized = false;

export function useAppWindow() {
  if (!initialized) {
    initialized = true;
    let receivedEvent = false;
    window.tfaf.appWindow.onStateChanged((next) => {
      receivedEvent = true;
      state.value = next;
    });
    void window.tfaf.appWindow.getState().then((initial) => {
      if (!receivedEvent) {
        state.value = initial;
      }
    });
  }
  return readonly(state);
}
