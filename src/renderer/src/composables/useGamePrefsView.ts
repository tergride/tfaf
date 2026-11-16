import { computed, onActivated, ref, type ShallowRef, shallowRef, watch } from 'vue';
import { errorMessage } from '../format.ts';
import { useGameSession } from './useGameSession.ts';

const revision = ref(0);

/** Tells every view of Game.prefs to read it again, e.g. after an import changed both options and key bindings. */
export function gamePrefsChanged(): void {
  revision.value++;
}

/**
 * A view of Game.prefs (the game's options or key bindings): read again whenever it is shown and when a game starts
 * or ends, since the game rewrites the file when it exits. Changes are refused while it runs.
 */
export function useGamePrefsView<T extends { gameRunning: boolean }>(load: () => Promise<T>) {
  const view: ShallowRef<T | null> = shallowRef(null);
  const error = ref<string | null>(null);
  const { state } = useGameSession();
  const gameIdle = computed(() => state.value.phase === 'idle');
  const locked = computed(() => !gameIdle.value || view.value?.gameRunning === true);
  // Only the answer to the latest request is shown, whatever order they come back in.
  let request = 0;

  async function refresh(): Promise<void> {
    const current = ++request;
    try {
      const next = await load();
      if (current === request) {
        view.value = next;
        error.value = null;
      }
    } catch (cause) {
      if (current === request) {
        error.value = errorMessage(cause);
      }
    }
  }

  /** Saves a change; the view comes back from the main process as the file now is. */
  async function save(change: () => Promise<T>): Promise<boolean> {
    const current = ++request;
    try {
      const next = await change();
      if (current === request) {
        view.value = next;
        error.value = null;
      }
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      // Read the file again: an earlier change may have been saved while its answer was dropped for this one.
      await refresh();
      error.value = message;
      return false;
    }
  }

  onActivated(refresh);
  watch([gameIdle, revision], () => void refresh());

  return { view, error, locked, save };
}
