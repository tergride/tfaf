import { type Ref, ref, watch } from 'vue';
import type { ViewMode } from '../components/listKit.ts';

/** One of `modes`, remembered on this computer; storage may be unavailable. */
export function useStoredMode<Mode extends string>(key: string, modes: readonly Mode[], initial: Mode): Ref<Mode> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    // Ignore unreadable storage.
  }
  const mode = ref(modes.find((candidate) => candidate === stored) ?? initial) as Ref<Mode>;
  watch(mode, (value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore unavailable storage.
    }
  });
  return mode;
}

/** Cards or a table for a list, remembered per list. */
export function useViewMode(list: string, initial: ViewMode = 'cards'): Ref<ViewMode> {
  return useStoredMode(`tfaf.viewMode.${list}`, ['cards', 'table'], initial);
}
