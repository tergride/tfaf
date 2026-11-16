<script setup lang="ts">
import { UserRound } from '@lucide/vue';
import type { LiveGame } from '../../../shared/contract.ts';
import { formatQuality, joinParts, mapDisplayName, timeAgo } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { useListTable } from '../lib/listTable.ts';
import { friendsIn, friendsLabel } from '../lib/lobbyGames.ts';
import { playersLine, watchableIn } from '../lib/replayLists.ts';
import DataTable from './DataTable.vue';
import GameCard from './GameCard.vue';
import type { ViewMode } from './listKit.ts';
import LiveTrackControls from './LiveTrackControls.vue';
import PreviewImage from './PreviewImage.vue';
import StatusLamp from './StatusLamp.vue';

const props = defineProps<{ games: LiveGame[]; view: ViewMode; selectedId: string | null; now: number }>();
defineEmits<{ open: [game: LiveGame] }>();

const table = useListTable({
  data: () => props.games,
  columns: [
    { id: 'game', header: () => t('replays.columns.game'), meta: { class: 'w-[38%] max-w-0' } },
    { id: 'players', header: () => t('replays.columns.players'), meta: { class: 'w-[30%] max-w-0 @max-[34rem]:hidden' } },
    { id: 'started', header: () => t('replays.columns.launched'), meta: { class: '@max-[44rem]:hidden' } },
    { id: 'rating', header: () => t('replays.columns.rating'), meta: { numeric: true } },
    { id: 'quality', header: () => t('replays.columns.quality'), meta: { numeric: true, class: '@max-[60rem]:hidden' } },
    { id: 'watch', header: () => t('replays.columns.watch'), meta: { class: 'w-48' } },
  ],
  rowId: (game) => String(game.id),
});

function teams(game: LiveGame): { team: number; players: string[] }[] {
  return game.teams.map((team) => ({ team: team.team, players: team.players.map((one) => one.login) }));
}
</script>

<template>
  <div v-if="view === 'cards'" class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4.5 pt-1.5">
    <GameCard
      v-for="game in games"
      :key="game.id"
      :game="game"
      :selected="selectedId === String(game.id)"
      @open="$emit('open', game)"
      @quick-join="$emit('open', game)"
    />
  </div>
  <DataTable
    v-else
    :table="table"
    :label="t('replays.live.table')"
    :selected-id="selectedId"
    :highlighted="(game) => friendsIn(game).length > 0"
    @select="(game) => $emit('open', game)"
  >
    <template #cell-game="{ row: game }">
      <div class="flex min-w-0 items-center gap-3">
        <span class="plate cut-xs size-9.5 shrink-0 overflow-hidden bg-background [--plate-border:transparent]">
          <PreviewImage small :src="game.mapPreviewUrl" :fallback="game.mapPreviewUrl ? '?' : 'GEN'" lazy />
        </span>
        <span class="flex min-w-0 flex-col">
          <span class="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
            <span class="truncate" :data-tooltip="game.title">{{ game.title || t('replays.live.untitled') }}</span>
            <span v-if="friendsLabel(game)" class="flex shrink-0" role="img" :data-tooltip="friendsLabel(game) ?? undefined" :aria-label="friendsLabel(game) ?? undefined">
              <UserRound class="size-3.5 text-info" />
            </span>
          </span>
          <span class="truncate text-xs text-muted-foreground">
            {{ joinParts(mapDisplayName(game.mapFolderName), game.featuredModName) }}
          </span>
        </span>
      </div>
    </template>
    <template #cell-players="{ row: game }">
      <span class="block truncate text-muted-foreground" :data-tooltip="playersLine(teams(game)) ?? undefined">
        {{ playersLine(teams(game)) ?? '—' }}
      </span>
    </template>
    <template #cell-started="{ row: game }">{{ timeAgo(game.launchedAt, now) ?? '—' }}</template>
    <template #cell-rating="{ row: game }">{{ game.averageRating ?? '—' }}</template>
    <template #cell-quality="{ row: game }">{{ formatQuality(game.quality) ?? '—' }}</template>
    <template #cell-watch="{ row: game }">
      <LiveTrackControls v-if="watchableIn(game, now) > 0" :game="game" :watchable-in="watchableIn(game, now)" compact />
      <StatusLamp v-else tone="success">{{ t('replays.live.watchable') }}</StatusLamp>
    </template>
  </DataTable>
</template>
