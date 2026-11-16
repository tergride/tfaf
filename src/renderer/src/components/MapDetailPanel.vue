<script setup lang="ts">
import { Award, CircleArrowUp, Download, EyeOff, FolderOpen, Swords, Trash2, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { LocalMap, VaultMap } from '../../../shared/contract.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { formatDate, formatNumber, joinParts, mapSizeLabel, playersLabel } from '../format.ts';
import { t } from '../lib/i18n.ts';
import DetailPanel from './DetailPanel.vue';
import DetailPreview from './DetailPreview.vue';
import DetailStats from './DetailStats.vue';
import Reviews from './Reviews.vue';

export type MapSelection = { source: 'vault'; map: VaultMap } | { source: 'local'; map: LocalMap };
/** A vault map against the installed ones: this version, another version of the same map, or none. */
export type MapVaultStatus = 'installed' | 'outdated' | null;

const props = defineProps<{
  selection: MapSelection;
  vaultStatus: MapVaultStatus;
  /** The map is being installed or removed. */
  pending: boolean;
  canStartGame: boolean;
  error: string | null;
  /** In the map picker the panel only describes the map: picking it is the picker's own button. */
  picker?: boolean;
}>();
defineEmits<{
  close: [];
  install: [map: VaultMap];
  uninstall: [folderName: string, displayName: string];
  reveal: [folderName: string];
  host: [folderName: string];
  hideVersion: [map: VaultMap];
}>();

const { state: session } = useGameSession();
const auth = useAuth();
/** The uploader may hide a version of their own map. */
const ownVersion = computed(
  () =>
    props.selection.source === 'vault' &&
    auth.value?.status === 'signedIn' &&
    props.selection.map.author?.toLowerCase() === auth.value.user.login.toLowerCase(),
);
</script>

<template>
  <DetailPanel
    :title="selection.map.displayName"
    :kind="selection.source === 'vault' ? t('maps.detail.vaultKind') : t('maps.detail.installedKind')"
    :item-key="selection.map.folderName"
    @close="$emit('close')"
  >
    <template #media>
      <DetailPreview
        :preview="{
          title: selection.map.displayName,
          details: joinParts(
            playersLabel(selection.map.maxPlayers),
            mapSizeLabel(selection.map.widthPx, selection.map.heightPx),
            selection.map.folderName,
          ),
          src: selection.source === 'vault' ? selection.map.thumbnailUrlLarge : selection.map.previewLargeUrl,
          fallbackSrc: selection.source === 'vault' ? selection.map.thumbnailUrlSmall : selection.map.previewUrl,
        }"
        :fallback="selection.map.displayName.slice(0, 1).toUpperCase()"
        :map-folder="selection.map.folderName"
      />
    </template>

    <template v-if="selection.source === 'vault'">
      <div class="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span v-if="selection.map.author" class="flex items-center gap-1.5">
          <UserRound class="size-3.5" />
          <span class="text-foreground selectable">{{ selection.map.author }}</span>
        </span>
        <span v-if="selection.map.version">{{ t('vault.version', { version: selection.map.version }) }}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Badge :variant="selection.map.ranked ? 'success' : 'muted'">
          {{ selection.map.ranked ? t('maps.ranked') : t('vault.unranked') }}
        </Badge>
        <Badge v-if="selection.map.recommended" variant="accent"><Award />{{ t('maps.recommended') }}</Badge>
        <Badge v-if="vaultStatus === 'installed'" variant="success">{{ t('maps.status.installed') }}</Badge>
        <Badge v-else-if="vaultStatus === 'outdated'" variant="warning">{{ t('maps.status.oldVersionInstalled') }}</Badge>
      </div>
      <DetailStats
        :items="[
          { label: t('maps.players'), value: selection.map.maxPlayers },
          { label: t('maps.size'), value: mapSizeLabel(selection.map.widthPx, selection.map.heightPx) },
          {
            label: t('vault.rating'),
            value: selection.map.reviews?.numReviews ? selection.map.reviews.averageScore.toFixed(1) : null,
            note: selection.map.reviews?.numReviews
              ? t('vault.reviews', { count: selection.map.reviews.numReviews })
              : t('vault.noReviews'),
          },
          { label: t('maps.gamesPlayed'), value: formatNumber(selection.map.gamesPlayed) },
          { label: t('maps.uploaded'), value: formatDate(selection.map.createTime) },
          { label: t('maps.updated'), value: formatDate(selection.map.updateTime) },
        ]"
      />
    </template>
    <template v-else>
      <div v-if="selection.map.official || selection.map.version" class="flex flex-wrap gap-1.5">
        <Badge v-if="selection.map.official" variant="info">{{ t('maps.official') }}</Badge>
        <Badge v-if="selection.map.version" variant="muted">{{ t('vault.versionTitle', { version: selection.map.version }) }}</Badge>
      </div>
      <DetailStats
        :items="[
          { label: t('maps.players'), value: selection.map.maxPlayers },
          { label: t('maps.size'), value: mapSizeLabel(selection.map.widthPx, selection.map.heightPx) },
        ]"
      />
    </template>

    <p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85 wrap-anywhere selectable">
      {{ selection.map.description || t('vault.noDescription') }}
    </p>
    <p class="text-xs text-faint selectable">{{ selection.map.folderName }}</p>

    <Reviews
      v-if="selection.source === 'vault'"
      :target="{ kind: 'map', id: selection.map.mapId, versionId: selection.map.versionId }"
    />

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>

    <template v-if="!picker" #actions>
      <template v-if="selection.source === 'vault' && vaultStatus !== 'installed'">
        <Button size="lg" :disabled="pending" @click="selection.source === 'vault' && $emit('install', selection.map)">
          <Spinner v-if="pending" />
          <CircleArrowUp v-else-if="vaultStatus === 'outdated'" />
          <Download v-else />
          {{ vaultStatus === 'outdated' ? t('maps.installNewVersion') : t('common.install') }}
        </Button>
        <Button
          variant="outline"
          :disabled="!canStartGame"
          :data-tooltip="t('maps.detail.downloadOnHost')"
          @click="$emit('host', selection.map.folderName)"
        >
          <Swords />
          {{ t('maps.hostOnMap') }}
        </Button>
      </template>
      <template v-else>
        <Button size="lg" :disabled="!canStartGame" @click="$emit('host', selection.map.folderName)">
          <Swords />
          {{ t('maps.hostOnMap') }}
        </Button>
        <div class="flex gap-2">
          <Button variant="outline" class="flex-1" @click="$emit('reveal', selection.map.folderName)">
            <FolderOpen />
            {{ t('vault.openFolder') }}
          </Button>
          <Button
            v-if="selection.source === 'vault' || !selection.map.official"
            variant="outline"
            size="icon"
            class="hover:text-destructive"
            :data-tooltip="t('maps.detail.uninstall')"
            :aria-label="t('maps.detail.uninstall')"
            :disabled="pending"
            @click="$emit('uninstall', selection.map.folderName, selection.map.displayName)"
          >
            <Trash2 />
          </Button>
        </div>
      </template>
      <p v-if="!canStartGame" class="text-xs text-muted-foreground">
        {{ session.phase !== 'idle' ? t('maps.detail.otherGameRunning') : t('maps.detail.needsLobby') }}
      </p>
      <Button
        v-if="ownVersion && selection.source === 'vault'"
        variant="ghost"
        size="sm"
        class="self-start text-muted-foreground hover:text-destructive"
        @click="selection.source === 'vault' && $emit('hideVersion', selection.map)"
      >
        <EyeOff />{{ t('vault.hideVersion.button') }}
      </Button>
    </template>
  </DetailPanel>
</template>
