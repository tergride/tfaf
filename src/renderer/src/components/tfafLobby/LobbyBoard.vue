<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, watch } from 'vue';
import type { LobbySpot } from '../../../../shared/contract.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { useStoredMode } from '../../composables/useViewMode.ts';
import { t } from '../../lib/i18n.ts';
import { queries, queryClient } from '../../lib/queries.ts';
import PreviewImage from '../PreviewImage.vue';
import LobbyMapRender from './LobbyMapRender.vue';
import LobbySpawnMarkers from './LobbySpawnMarkers.vue';

const VIEWS = ['preview', 'render'] as const;

const { view, room, self, starting } = useTfafLobby();
const mode = useStoredMode('tfaf.tfafLobby.boardView', VIEWS, 'preview');

const folderName = computed(() => room.value?.map.folderName ?? '');
const onDiskQuery = useQuery(() => ({ ...queries.mapOnDisk(folderName.value), enabled: folderName.value !== '' }));
const canRender = computed(() => onDiskQuery.data.value === true);
// The game needs the video memory more once it starts.
const rendering = computed(() => mode.value === 'render' && canRender.value && !starting.value);

// A map that was still downloading has reached the disk.
watch(
  () => self.value?.files,
  () => void queryClient.invalidateQueries(queries.mapsOnDisk()),
);

function place(spot: LobbySpot): { left: number; top: number } {
  return { left: spot.x * 100, top: spot.y * 100 };
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-3">
      <span class="min-w-0 flex-1 truncate font-display font-semibold selectable" :data-tooltip="room?.map.name">{{ room?.map.name }}</span>
      <div class="plate cut-sm flex shrink-0 gap-0.5 bg-secondary p-0.75" role="group" :aria-label="t('tfafLobby.board.viewLabel')">
        <button
          v-for="option in VIEWS"
          :key="option"
          type="button"
          class="plate plate-control plate-focus cut-xs h-6.5 px-2.5 text-sm font-medium transition-colors [--plate-border:transparent] disabled:opacity-50"
          :class="mode === option ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
          :aria-pressed="mode === option"
          :disabled="option === 'render' && !canRender"
          :data-tooltip="option === 'render' && !canRender ? t('tfafLobby.board.renderUnavailable') : undefined"
          @click="mode = option"
        >
          {{ t(`tfafLobby.board.${option}`) }}
        </button>
      </div>
    </div>
    <div class="plate cut-lg relative aspect-square w-full overflow-hidden bg-hull" role="group" :aria-label="t('tfafLobby.board.label')">
      <PreviewImage :src="view?.mapPreview?.large" :fallback="room?.map.name" />
      <LobbyMapRender v-if="rendering" :folder-name="folderName" />
      <LobbySpawnMarkers :place="place" />
    </div>
  </div>
</template>
