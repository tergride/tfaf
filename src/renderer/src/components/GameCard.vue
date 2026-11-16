<script setup lang="ts">
import { Lock, Puzzle, UserRound, Users } from '@lucide/vue';
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import type { LobbyGame } from '../../../shared/contract.ts';
import { mapDisplayName, ratingRangeLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { friendsLabel } from '../lib/lobbyGames.ts';
import PreviewImage from './PreviewImage.vue';
import TfafBadge from './TfafBadge.vue';

// `mapName` replaces the name taken from the map folder, e.g. with the name of a coop mission.
const props = defineProps<{ game: LobbyGame; selected?: boolean; mapName?: string | null }>();
defineEmits<{ open: []; quickJoin: [] }>();

const fill = computed(() => (props.game.maxPlayers > 0 ? Math.min(props.game.numPlayers / props.game.maxPlayers, 1) : 0));
const full = computed(() => props.game.maxPlayers > 0 && props.game.numPlayers >= props.game.maxPlayers);
const ratingRange = computed(() => ratingRangeLabel(props.game.ratingMin, props.game.ratingMax));
// Games where friends host or wait in the lobby stand out in the list.
const friends = computed(() => friendsLabel(props.game));
</script>

<template>
  <div class="relative min-w-0" :class="{ brackets: selected }">
    <button
      type="button"
      class="group plate plate-focus cut-lg flex h-full w-full min-w-0 flex-col overflow-hidden text-left transition-colors"
      :class="[
        friends ? 'bg-[color-mix(in_srgb,var(--color-info)_8%,var(--color-card))]' : 'bg-card',
        selected
          ? '[--plate-border:var(--color-primary)]'
          : friends
            ? '[--plate-border:var(--color-info)]'
            : 'hover:[--plate-border:var(--color-input)]',
      ]"
      :aria-pressed="selected"
      :data-tooltip="t('games.quickJoinHint')"
      @click="$emit('open')"
      @dblclick="$emit('quickJoin')"
    >
      <div class="relative aspect-square overflow-hidden bg-background">
        <PreviewImage :src="game.mapPreviewUrl" :fallback="game.mapPreviewUrl ? '?' : 'GEN'" lazy />
        <div class="absolute inset-x-2 top-2 flex flex-wrap gap-1">
          <Badge v-if="game.tfafLobby" variant="accent" class="bg-background/80 backdrop-blur-sm">TFAF</Badge>
          <Badge v-else-if="game.passwordProtected" variant="warning" class="bg-background/80 backdrop-blur-sm">
            <Lock />
            {{ t('games.card.password') }}
          </Badge>
          <Badge v-if="game.friendsOnly" variant="muted" class="bg-background/80 backdrop-blur-sm">
            {{ t('games.card.friendsOnly') }}
          </Badge>
          <Badge v-if="game.featuredMod !== 'faf'" variant="accent" class="bg-background/80 backdrop-blur-sm">
            {{ game.featuredModName }}
          </Badge>
          <Badge
            v-if="game.simMods.length"
            variant="muted"
            class="bg-background/80 backdrop-blur-sm"
            :data-tooltip="game.simMods.map((mod) => mod.name).join(', ')"
          >
            <Puzzle />
            {{ game.simMods.length }}
          </Badge>
        </div>
      </div>
      <div class="flex flex-col gap-1 px-3 pt-2.5 pb-3">
        <div class="truncate font-display text-[15px] leading-tight font-semibold" :data-tooltip="game.title">
          {{ game.title || t('games.untitled') }}
        </div>
        <div v-if="friends" class="flex min-w-0 items-center gap-1 text-xs font-medium text-info" :data-tooltip="friends">
          <UserRound class="size-3 shrink-0" />
          <span class="truncate">{{ friends }}</span>
        </div>
        <div class="truncate text-xs text-muted-foreground" :data-tooltip="game.mapFolderName">
          {{ mapName ?? mapDisplayName(game.mapFolderName) }}
        </div>
        <div class="flex items-center gap-2">
          <div class="h-1 flex-1 overflow-hidden bg-background">
            <div class="h-full" :class="full ? 'bg-warning' : 'bg-success'" :style="{ width: `${fill * 100}%` }" />
          </div>
          <span class="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <Users class="size-3" />
            {{ game.numPlayers }}/{{ game.maxPlayers }}
          </span>
        </div>
        <div class="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground/80">
          <span class="flex max-w-full min-w-0 items-center gap-1">
            <span class="truncate">{{ game.host }}</span>
            <TfafBadge :login="game.host" />
          </span>
          <span v-if="game.averageRating !== null">⌀ {{ game.averageRating }}</span>
          <span v-if="ratingRange" :class="{ 'text-warning': game.enforceRatingRange }" :data-tooltip="t('games.card.ratingLimit')">
            {{ ratingRange }}
          </span>
        </div>
      </div>
    </button>
  </div>
</template>
