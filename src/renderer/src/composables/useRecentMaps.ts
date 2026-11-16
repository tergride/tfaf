import { type DeepReadonly, readonly, type Ref, ref } from 'vue';

const STORAGE_KEY = 'tfaf.recentMaps';
// More than the picker shows: some of them may be gone from the disk or be the map chosen now.
const LIMIT = 8;

function load(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

const recent = ref(load());

/** Folder names of the maps of the last games hosted and lobby maps set on this computer, the latest first. */
export function useRecentMaps(): DeepReadonly<Ref<string[]>> {
  return readonly(recent);
}

export function rememberMap(folderName: string): void {
  const key = folderName.toLowerCase();
  recent.value = [folderName, ...recent.value.filter((item) => item.toLowerCase() !== key)].slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.value));
  } catch {
    // Ignore unavailable storage.
  }
}
