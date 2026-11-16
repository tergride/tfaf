import { readonly, ref } from 'vue';
import { MATCHMAKER_FACTIONS, type MatchmakerState } from '../../../shared/contract.ts';

const state = ref<MatchmakerState>({
  connected: false,
  queues: [],
  factions: [...MATCHMAKER_FACTIONS],
  party: [],
  isOwner: true,
  searching: false,
  preparing: null,
  blocker: null,
  invites: [],
  partyChannel: null,
});
// A click on a matchmaker notification asks the app to show the matchmaker.
const focusRequest = ref<number | null>(null);
/** When the current search started, for its timer; the server does not say. */
const searchStartedAt = ref<number | null>(null);
let initialized = false;

function apply(next: MatchmakerState): void {
  if (next.searching && !state.value.searching) {
    searchStartedAt.value = Date.now();
  } else if (!next.searching) {
    searchStartedAt.value = null;
  }
  state.value = next;
}

export function useMatchmaker() {
  if (!initialized) {
    initialized = true;
    let receivedState = false;
    window.tfaf.matchmaker.onStateChanged((next) => {
      receivedState = true;
      apply(next);
    });
    window.tfaf.matchmaker.onFocusRequested(() => {
      focusRequest.value = Date.now();
    });
    void window.tfaf.matchmaker.getState().then((initial) => {
      if (!receivedState) {
        apply(initial);
      }
    });
  }
  return { state: readonly(state), focusRequest: readonly(focusRequest), searchStartedAt: readonly(searchStartedAt) };
}
