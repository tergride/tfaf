import { shallowRef } from 'vue';

// Notes by player id, read once and then kept in step with what the user saves.
const notes = shallowRef<Record<number, string>>({});
let loaded = false;

export function usePlayerNotes() {
  if (!loaded) {
    loaded = true;
    window.tfaf.notes.list().then(
      (list) => {
        notes.value = list;
      },
      (error: unknown) => console.warn('Player notes could not be read', error),
    );
  }
  return {
    notes,
    noteOf: (playerId: number | null | undefined): string | null => (playerId ? (notes.value[playerId] ?? null) : null),
    async save(playerId: number, text: string): Promise<void> {
      notes.value = await window.tfaf.notes.set(playerId, text);
    },
  };
}
