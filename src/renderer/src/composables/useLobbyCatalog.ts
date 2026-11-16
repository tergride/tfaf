import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useTfafLobby } from './useTfafLobby.ts';

/** What the room can choose from; it follows the room's map and mods. */
export function useLobbyCatalog() {
  const { room } = useTfafLobby();
  const query = useQuery(() => ({
    queryKey: ['tfafLobby', 'catalog', room.value?.map.folderName ?? '', room.value?.simMods.map((mod) => mod.uid).join(' ') ?? ''],
    queryFn: () => window.tfaf.tfafLobby.catalog(),
    enabled: room.value !== null,
    // Dialogs that need a catalog are mounted only while there is one. Without the previous catalog a new map or mod
    // set would unmount them mid-close, before they report it, and the next catalog would mount them open again.
    placeholderData: keepPreviousData,
  }));
  const catalog = computed(() => query.data.value ?? null);
  return {
    query,
    catalog,
    colors: computed(() => catalog.value?.colors ?? []),
    ais: computed(() => catalog.value?.ais ?? []),
    restrictionPresets: computed(() => catalog.value?.restrictionPresets ?? []),
  };
}
