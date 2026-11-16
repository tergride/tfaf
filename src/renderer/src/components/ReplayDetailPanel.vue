<script setup lang="ts">
import { Check, Flag, FolderOpen, Link, Play, Trash2 } from '@lucide/vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { LocalReplay, VaultReplay } from '../../../shared/contract.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import type { ImagePreview } from '../composables/useImagePreview.ts';
import { usePlayerDialogs } from '../composables/usePlayerDialogs.ts';
import type { ReplayDetailsState, ReplaySelection } from '../composables/useReplayDetails.ts';
import {
  durationBetween,
  errorMessage,
  factionLabel,
  formatDateTime,
  formatDuration,
  formatQuality,
  mapDisplayName,
  resultLabel,
  timeAgo,
  validityLabel,
} from '../format.ts';
import { t } from '../lib/i18n.ts';
import CountryFlag from './CountryFlag.vue';
import DetailPanel from './DetailPanel.vue';
import DetailPreview from './DetailPreview.vue';
import DetailStats from './DetailStats.vue';
import LiveTrackControls from './LiveTrackControls.vue';
import PlayerName from './PlayerName.vue';
import ReplayDetailsSection from './ReplayDetailsSection.vue';
import Reviews from './Reviews.vue';
import TeamList from './TeamList.vue';

const props = defineProps<{
  selection: ReplaySelection;
  itemKey: string;
  details: ReplayDetailsState | null;
  error: string | null;
  /** The replay is being started. */
  starting: boolean;
  now: number;
  /** Seconds until a running game can be watched. */
  watchableIn: number;
}>();
const emit = defineEmits<{
  close: [];
  watch: [];
  loadDetails: [];
  reveal: [file: string];
  remove: [replay: LocalReplay];
  error: [message: string | null];
}>();

const COPIED_MS = 2_000;

const auth = useAuth();
const { openReport } = usePlayerDialogs();
const { state: session } = useGameSession();
const gameBusy = computed(() => session.value.phase !== 'idle');

const preview = computed<ImagePreview>(() => {
  const current = props.selection;
  switch (current.source) {
    case 'vault':
      return {
        title: current.replay.mapName ?? current.replay.title,
        details: current.replay.mapFolderName,
        src: current.replay.mapPreviewLargeUrl,
        fallbackSrc: current.replay.mapPreviewUrl,
      };
    case 'local':
      return {
        title: current.replay.mapFolderName ? mapDisplayName(current.replay.mapFolderName) : current.replay.title,
        details: current.replay.mapFolderName,
        src: current.replay.mapPreviewLargeUrl,
        fallbackSrc: current.replay.mapPreviewUrl,
      };
    case 'live':
      return {
        title: mapDisplayName(current.game.mapFolderName),
        details: current.game.mapFolderName,
        src: current.game.mapPreviewLargeUrl,
        fallbackSrc: current.game.mapPreviewUrl,
      };
  }
});

/** The players of the game are offered in the report, the signed-in player aside. */
function reportReplay(replay: VaultReplay): void {
  const self = auth.value?.status === 'signedIn' ? auth.value.user.login.toLowerCase() : null;
  openReport({
    gameId: replay.id,
    candidates: replay.teams
      .flatMap((team) => team.players)
      .filter((player) => !player.ai && player.login.toLowerCase() !== self)
      .map((player) => player.login),
  });
}

const copiedLink = ref<number | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copyLink(replayId: number): Promise<void> {
  emit('error', null);
  try {
    await navigator.clipboard.writeText(await window.tfaf.replays.link(replayId));
    copiedLink.value = replayId;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedLink.value = null;
    }, COPIED_MS);
  } catch (cause) {
    emit('error', errorMessage(cause));
  }
}
</script>

<template>
  <DetailPanel
    :title="selection.source === 'live' ? selection.game.title || t('replays.live.untitled') : selection.replay.title"
    :kind="t(`replays.panel.kind.${selection.source}`)"
    :item-key="itemKey"
    @close="$emit('close')"
  >
    <template #media>
      <DetailPreview :preview="preview" :fallback="preview.fallbackSrc ? '?' : 'GEN'" :map-folder="preview.details" />
    </template>

    <template v-if="selection.source === 'vault'">
      <div class="flex flex-wrap gap-1.5">
        <Badge variant="muted">{{ selection.replay.featuredModName }}</Badge>
        <Badge v-if="selection.replay.validity" :variant="selection.replay.validity === 'VALID' ? 'success' : 'muted'">
          {{ validityLabel(selection.replay.validity) }}
        </Badge>
        <Badge v-if="!selection.replay.available" variant="warning">{{ t('replays.panel.noFile') }}</Badge>
      </div>
      <DetailStats
        :items="[
          { label: t('replays.panel.map'), value: selection.replay.mapName },
          { label: t('replays.panel.ended'), value: formatDateTime(selection.replay.endedAt) },
          { label: t('replays.panel.duration'), value: formatDuration(selection.replay.durationSeconds) },
          { label: t('replays.panel.averageRating'), value: selection.replay.averageRating },
          { label: t('replays.panel.quality'), value: formatQuality(selection.replay.quality) },
          {
            label: t('replays.panel.reviews'),
            value: selection.replay.reviews?.numReviews ? selection.replay.reviews.averageScore.toFixed(1) : null,
            note: selection.replay.reviews?.numReviews
              ? t('replays.panel.reviewCount', { count: selection.replay.reviews.numReviews })
              : t('replays.panel.noReviews'),
          },
          { label: t('replays.panel.gameId'), value: selection.replay.id },
        ]"
      />
      <TeamList :teams="selection.replay.teams" :player-key="(one) => one.login">
        <template #default="{ player: one }">
          <span class="w-16 shrink-0 text-xs text-muted-foreground">{{ one.faction ? factionLabel(one.faction) : '' }}</span>
          <span v-if="one.ai" class="flex-1 truncate selectable">{{ one.login }}</span>
          <PlayerName v-else :login="one.login" />
          <span
            v-if="one.result"
            class="text-xs"
            :class="one.result === 'victory' ? 'text-success' : one.result === 'defeat' ? 'text-destructive' : 'text-muted-foreground'"
          >
            {{ resultLabel(one.result) }}
          </span>
          <span class="text-muted-foreground tabular-nums">
            {{ one.ratingBefore ?? '—' }}
            <span
              v-if="one.ratingBefore !== null && one.ratingAfter !== null"
              :class="one.ratingAfter >= one.ratingBefore ? 'text-success' : 'text-destructive'"
            >
              {{ one.ratingAfter >= one.ratingBefore ? '+' : '' }}{{ one.ratingAfter - one.ratingBefore }}
            </span>
          </span>
        </template>
      </TeamList>
      <ReplayDetailsSection
        :details="details?.data ?? null"
        :loading="details?.loading ?? false"
        :error="details?.error ?? null"
        :loadable="selection.replay.available"
        @load="$emit('loadDetails')"
      />
      <Reviews :target="{ kind: 'game', id: selection.replay.id, versionId: null }" />
    </template>

    <template v-else-if="selection.source === 'local'">
      <div v-if="selection.replay.featuredModName || selection.replay.official" class="flex flex-wrap gap-1.5">
        <Badge v-if="selection.replay.featuredModName" variant="muted">{{ selection.replay.featuredModName }}</Badge>
        <Badge v-if="selection.replay.official" variant="info">{{ t('replays.panel.fromOfficialClient') }}</Badge>
      </div>
      <DetailStats
        :items="[
          {
            label: t('replays.panel.map'),
            value: selection.replay.mapFolderName ? mapDisplayName(selection.replay.mapFolderName) : null,
          },
          { label: t('replays.panel.started'), value: formatDateTime(selection.replay.startedAt) },
          {
            label: t('replays.panel.duration'),
            value: formatDuration(durationBetween(selection.replay.startedAt, selection.replay.endedAt)),
          },
          { label: t('replays.panel.quality'), value: formatQuality(details?.data?.quality ?? null) },
          { label: t('replays.panel.gameId'), value: selection.replay.id },
        ]"
      />
      <TeamList :teams="selection.replay.teams" :player-key="(name) => name">
        <template #default="{ player: name }">
          <PlayerName :login="name" />
        </template>
      </TeamList>
      <ReplayDetailsSection
        :details="details?.data ?? null"
        :loading="details?.loading ?? false"
        :error="details?.error ?? null"
        :loadable="false"
      />
      <p class="text-xs break-all text-faint selectable">{{ selection.replay.file }}</p>
    </template>

    <template v-else>
      <div class="flex flex-wrap gap-1.5">
        <Badge variant="muted">{{ selection.game.featuredModName }}</Badge>
      </div>
      <DetailStats
        :items="[
          { label: t('replays.panel.map'), value: mapDisplayName(selection.game.mapFolderName) },
          { label: t('replays.panel.launched'), value: timeAgo(selection.game.launchedAt, now) },
          { label: t('replays.panel.averageRating'), value: selection.game.averageRating },
          { label: t('replays.panel.quality'), value: formatQuality(selection.game.quality) },
          { label: t('replays.panel.host'), value: selection.game.host },
        ]"
      />
      <TeamList :teams="selection.game.teams" :player-key="(one) => String(one.id ?? one.login)">
        <template #default="{ player: one }">
          <CountryFlag v-if="one.country" :country="one.country" />
          <PlayerName :login="one.login" :id="one.id" :clan="one.clan" :avatar="one.avatar" />
          <span v-if="one.friend" class="text-xs text-info">{{ t('replays.panel.friend') }}</span>
          <span class="text-muted-foreground tabular-nums">{{ one.rating ?? '—' }}</span>
        </template>
      </TeamList>
      <div v-if="selection.game.simMods.length" class="flex flex-col gap-1">
        <h3 class="font-sans text-xs font-normal text-muted-foreground">{{ t('replays.panel.mods') }}</h3>
        <ul class="flex flex-col gap-px border bg-border">
          <li v-for="mod in selection.game.simMods" :key="mod.uid" class="bg-background px-2.5 py-1.5 text-[13px] selectable">
            {{ mod.name }}
          </li>
        </ul>
      </div>
    </template>

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>

    <template #actions>
      <div v-if="selection.source === 'vault'" class="flex gap-2">
        <Button
          size="lg"
          class="flex-1"
          :disabled="starting || gameBusy || !selection.replay.available"
          @click="$emit('watch')"
        >
          <Spinner v-if="starting" />
          <Play v-else />
          {{ t('replays.panel.watch') }}
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          :data-tooltip="copiedLink === selection.replay.id ? t('replays.panel.linkCopied') : t('replays.panel.copyLink')"
          :aria-label="t('replays.panel.copyLink')"
          @click="copyLink(selection.replay.id)"
        >
          <Check v-if="copiedLink === selection.replay.id" class="text-success" />
          <Link v-else />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          class="hover:text-destructive"
          :data-tooltip="t('replays.panel.report')"
          :aria-label="t('replays.panel.report')"
          @click="selection.source === 'vault' && reportReplay(selection.replay)"
        >
          <Flag />
        </Button>
      </div>
      <template v-else-if="selection.source === 'local'">
        <Button size="lg" :disabled="starting || gameBusy" @click="$emit('watch')">
          <Spinner v-if="starting" />
          <Play v-else />
          {{ t('replays.panel.watch') }}
        </Button>
        <div class="flex gap-2">
          <Button variant="outline" class="flex-1" @click="$emit('reveal', selection.replay.file)">
            <FolderOpen />
            {{ t('common.showInFolder') }}
          </Button>
          <Button
            v-if="selection.replay.id !== null"
            variant="outline"
            size="icon"
            :data-tooltip="copiedLink === selection.replay.id ? t('replays.panel.linkCopied') : t('replays.panel.copyLink')"
            :aria-label="t('replays.panel.copyLink')"
            @click="selection.source === 'local' && selection.replay.id !== null && copyLink(selection.replay.id)"
          >
            <Check v-if="copiedLink === selection.replay.id" class="text-success" />
            <Link v-else />
          </Button>
          <Button
            v-if="!selection.replay.official"
            variant="outline"
            size="icon"
            class="hover:text-destructive"
            :data-tooltip="t('replays.panel.delete')"
            :aria-label="t('replays.panel.delete')"
            @click="selection.source === 'local' && $emit('remove', selection.replay)"
          >
            <Trash2 />
          </Button>
        </div>
      </template>
      <LiveTrackControls
        v-else-if="watchableIn > 0"
        :game="selection.game"
        :watchable-in="watchableIn"
      />
      <Button v-else size="lg" :disabled="starting || gameBusy" @click="$emit('watch')">
        <Spinner v-if="starting" />
        <Play v-else />
        {{ t('replays.panel.watch') }}
      </Button>
      <p v-if="gameBusy && !(selection.source === 'live' && watchableIn > 0)" class="text-xs text-muted-foreground">
        {{ t('replays.panel.closeGameFirst') }}
      </p>
    </template>
  </DetailPanel>
</template>
