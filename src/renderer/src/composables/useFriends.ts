import { readonly, ref } from 'vue';
import type { FriendsState } from '../../../shared/contract.ts';

const state = ref<FriendsState>({ friends: [] });
let initialized = false;

export function useFriends() {
  if (!initialized) {
    initialized = true;
    let receivedState = false;
    window.tfaf.friends.onStateChanged((next) => {
      receivedState = true;
      state.value = next;
    });
    void window.tfaf.friends.getState().then((initial) => {
      if (!receivedState) {
        state.value = initial;
      }
    });
  }
  return { state: readonly(state) };
}
