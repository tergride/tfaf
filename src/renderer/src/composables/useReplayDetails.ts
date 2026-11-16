import { computed, type Ref, ref } from 'vue';
import type { LiveGame, LocalReplay, ReplayDetails, VaultReplay } from '../../../shared/contract.ts';
import { errorMessage, isCancelled } from '../format.ts';

export type ReplaySelection =
  | { source: 'vault'; replay: VaultReplay }
  | { source: 'local'; replay: LocalReplay }
  | { source: 'live'; game: LiveGame };

export interface ReplayDetailsState {
  key: string;
  loading: boolean;
  error: string | null;
  data: ReplayDetails | null;
}

const CACHE_SIZE = 20;

function detailsKey(current: ReplaySelection): string | null {
  switch (current.source) {
    case 'vault':
      return `vault:${current.replay.id}`;
    case 'local':
      return `local:${current.replay.file}`;
    default:
      return null;
  }
}

/** What only the replay file tells about the selected replay; a running game has no file yet. */
export function useReplayDetails(selection: Ref<ReplaySelection | null>) {
  const details = ref<ReplayDetailsState | null>(null);
  // Details already read, so going back to a replay does not download it again.
  const cache = new Map<string, ReplayDetails>();

  async function load(current: ReplaySelection): Promise<void> {
    const key = detailsKey(current);
    if (!key || current.source === 'live') {
      return;
    }
    details.value = { key, loading: true, error: null, data: null };
    try {
      const data =
        current.source === 'vault'
          ? await window.tfaf.replays.details(current.replay.id)
          : await window.tfaf.replays.fileDetails(current.replay.file);
      cache.delete(key);
      cache.set(key, data);
      for (const old of [...cache.keys()].slice(0, -CACHE_SIZE)) {
        cache.delete(old);
      }
      if (details.value?.key === key) {
        details.value = { key, loading: false, error: null, data };
      }
    } catch (cause) {
      if (details.value?.key === key) {
        details.value = { key, loading: false, error: isCancelled(cause) ? null : errorMessage(cause), data: null };
      }
    }
  }

  /** Details of the replay in the panel; a replay on this computer is read at once, a vault one on request. */
  const selected = computed(() => {
    const key = selection.value ? detailsKey(selection.value) : null;
    return key && details.value?.key === key ? details.value : null;
  });

  function show(next: ReplaySelection): void {
    const key = detailsKey(next);
    if (!key || details.value?.key === key) {
      return;
    }
    const cached = cache.get(key);
    details.value = { key, loading: false, error: null, data: cached ?? null };
    if (!cached && next.source === 'local') {
      void load(next);
    }
  }

  return { selected, load, show };
}
