import { readonly, ref } from 'vue';
import type { PlayerAvatar } from '../../../shared/contract.ts';

const avatar = ref<PlayerAvatar | null>(null);
let initialized = false;

/** The avatar the signed-in player wears, as the lobby knows it. */
export function useCurrentAvatar() {
  if (!initialized) {
    initialized = true;
    let received = false;
    window.tfaf.avatars.onCurrentChanged((next) => {
      received = true;
      avatar.value = next;
    });
    void window.tfaf.avatars.getCurrent().then((initial) => {
      if (!received) {
        avatar.value = initial;
      }
    });
  }
  return readonly(avatar);
}
