import { shallowRef } from 'vue';

const watched = shallowRef<ReadonlySet<number>>(new Set());
let loaded = false;

async function refresh(): Promise<void> {
  try {
    watched.value = new Set((await window.tfaf.settings.get()).watchedReplays);
  } catch {
    // The marks are a convenience; the lists work without them.
  }
}

/**
 * Replays the user started watching. The main process records them when a replay starts, so the list is read again
 * when a view comes back on screen or a replay has started.
 */
export function useWatchedReplays() {
  if (!loaded) {
    loaded = true;
    void refresh();
  }
  return {
    refresh,
    isWatched: (replayId: number | null): boolean => replayId !== null && watched.value.has(replayId),
  };
}
