import { readonly, ref } from 'vue';
import type { WindowCloseAnswer } from '../../../shared/contract.ts';

// The first close of the window asks what closing should do; the main process applies the answer and saves it in the
// settings (closeToTray).
const open = ref(false);
// Grows with every applied answer, so a page that shows the settings reads them again.
const answered = ref(0);
let subscribed = false;

export function useCloseQuestion() {
  if (!subscribed) {
    subscribed = true;
    window.tfaf.appWindow.onCloseQuestion(() => {
      open.value = true;
    });
  }
  return {
    open: readonly(open),
    answered: readonly(answered),
    async answer(choice: WindowCloseAnswer): Promise<void> {
      if (!open.value) {
        return;
      }
      open.value = false;
      try {
        await window.tfaf.appWindow.answerClose(choice);
        answered.value++;
      } catch (error) {
        console.warn('Close answer could not be sent', error);
      }
    },
  };
}
