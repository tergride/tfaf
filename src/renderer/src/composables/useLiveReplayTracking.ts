import { readonly, ref } from 'vue';
import type { LiveReplayAction, LiveReplayTracking } from '../../../shared/contract.ts';

const tracking = ref<LiveReplayTracking | null>(null);
let initialized = false;

/** The running game the main process waits for until it can be watched; one at a time. */
export function useLiveReplayTracking() {
  if (!initialized) {
    initialized = true;
    let receivedEvent = false;
    window.tfaf.replays.onTrackingChanged((next) => {
      receivedEvent = true;
      tracking.value = next;
    });
    void window.tfaf.replays.getTracking().then((initial) => {
      if (!receivedEvent) {
        tracking.value = initial;
      }
    });
  }
  return {
    tracking: readonly(tracking),
    async track(gameId: number, action: LiveReplayAction): Promise<void> {
      tracking.value = await window.tfaf.replays.trackLive(gameId, action);
    },
    async untrack(): Promise<void> {
      await window.tfaf.replays.untrackLive();
      tracking.value = null;
    },
  };
}
