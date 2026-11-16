<script setup lang="ts">
import { Award, Download, EyeOff, FolderOpen, Trash2, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type { LocalMod, ModType, VaultMod } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { useAuth } from '../composables/useAuth.ts';
import { formatDate } from '../format.ts';
import { t } from '../lib/i18n.ts';
import DetailPanel from './DetailPanel.vue';
import DetailPreview from './DetailPreview.vue';
import DetailStats from './DetailStats.vue';
import Reviews from './Reviews.vue';

export type ModSelection = { source: 'vault'; mod: VaultMod } | { source: 'local'; mod: LocalMod };

const props = defineProps<{
  selection: ModSelection;
  /** The installed copy of the selected mod. */
  installed: LocalMod | null;
  /** The mod is being installed or removed. */
  pending: boolean;
  error: string | null;
}>();
defineEmits<{
  close: [];
  install: [mod: VaultMod];
  uninstall: [uid: string, name: string];
  setActive: [uid: string, active: boolean];
  reveal: [uid: string];
  hideVersion: [mod: VaultMod];
}>();

const TYPE_LABELS: Record<ModType, MessageKey> = { UI: 'mods.types.uiMod', SIM: 'mods.types.simMod' };

const auth = useAuth();
/** The uploader may hide a version of their own mod. */
const ownVersion = computed(
  () =>
    props.selection.source === 'vault' &&
    auth.value?.status === 'signedIn' &&
    props.selection.mod.uploader?.toLowerCase() === auth.value.user.login.toLowerCase(),
);
</script>

<template>
  <DetailPanel
    :title="selection.source === 'vault' ? selection.mod.displayName : selection.mod.name"
    :kind="selection.source === 'vault' ? t('mods.detail.vaultKind') : t('mods.detail.installedKind')"
    :item-key="selection.mod.uid"
    @close="$emit('close')"
  >
    <template v-if="selection.source === 'vault' ? selection.mod.thumbnailUrl : selection.mod.iconDataUrl" #media>
      <DetailPreview
        :preview="{
          title: selection.source === 'vault' ? selection.mod.displayName : selection.mod.name,
          details: selection.mod.version ? t('vault.versionTitle', { version: selection.mod.version }) : null,
          src: selection.source === 'vault' ? selection.mod.thumbnailUrl : selection.mod.iconDataUrl,
        }"
        wide
      />
    </template>

    <div class="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span v-if="selection.mod.author" class="flex items-center gap-1.5">
        <UserRound class="size-3.5" />
        <span class="text-foreground selectable">{{ selection.mod.author }}</span>
      </span>
      <span v-if="selection.mod.version">{{ t('vault.version', { version: selection.mod.version }) }}</span>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <Badge :variant="selection.mod.type === 'UI' ? 'info' : 'accent'">{{ t(TYPE_LABELS[selection.mod.type]) }}</Badge>
      <template v-if="selection.source === 'vault'">
        <Badge :variant="selection.mod.ranked ? 'success' : 'muted'">
          {{ selection.mod.ranked ? t('mods.ranked') : t('vault.unranked') }}
        </Badge>
        <Badge v-if="selection.mod.recommended" variant="accent"><Award />{{ t('mods.recommended') }}</Badge>
      </template>
      <Badge v-if="installed?.active" variant="success">{{ t('mods.status.active') }}</Badge>
      <Badge v-else-if="installed" variant="info">{{ t('mods.status.installed') }}</Badge>
    </div>
    <DetailStats
      v-if="selection.source === 'vault'"
      :items="[
        {
          label: t('vault.rating'),
          value: selection.mod.reviews?.numReviews ? selection.mod.reviews.averageScore.toFixed(1) : null,
          note: selection.mod.reviews?.numReviews
            ? t('vault.reviews', { count: selection.mod.reviews.numReviews })
            : t('vault.noReviews'),
        },
        { label: t('mods.detail.uploader'), value: selection.mod.uploader },
        { label: t('mods.detail.uploaded'), value: formatDate(selection.mod.createTime) },
        { label: t('mods.detail.updated'), value: formatDate(selection.mod.updateTime) },
      ]"
    />
    <DetailStats v-else :items="[{ label: t('mods.detail.folder'), value: selection.mod.folderName }]" />

    <p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground/85 wrap-anywhere selectable">
      {{ selection.mod.description || t('vault.noDescription') }}
    </p>
    <p class="text-xs text-faint selectable">{{ selection.mod.uid }}</p>

    <Reviews
      v-if="selection.source === 'vault'"
      :target="{ kind: 'mod', id: selection.mod.modId, versionId: selection.mod.versionId }"
    />

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>

    <template #actions>
      <template v-if="installed">
        <Label class="plate cut-sm h-10 cursor-pointer justify-between bg-secondary px-3.5 [--plate-border:transparent]">
          {{ installed.active ? t('mods.detail.enabled') : t('mods.detail.disabled') }}
          <Switch
            :model-value="installed.active"
            @update:model-value="(active) => installed && $emit('setActive', installed.uid, active)"
          />
        </Label>
        <div class="flex gap-2">
          <Button variant="outline" class="flex-1" @click="$emit('reveal', installed.uid)">
            <FolderOpen />
            {{ t('vault.openFolder') }}
          </Button>
          <Button
            variant="outline"
            size="icon"
            class="hover:text-destructive"
            :data-tooltip="t('mods.detail.uninstall')"
            :aria-label="t('mods.detail.uninstall')"
            :disabled="pending"
            @click="$emit('uninstall', installed.uid, installed.name)"
          >
            <Trash2 />
          </Button>
        </div>
      </template>
      <Button
        v-else-if="selection.source === 'vault'"
        size="lg"
        :disabled="pending"
        @click="selection.source === 'vault' && $emit('install', selection.mod)"
      >
        <Spinner v-if="pending" />
        <Download v-else />
        {{ t('common.install') }}
      </Button>
      <Button
        v-if="ownVersion && selection.source === 'vault'"
        variant="ghost"
        size="sm"
        class="self-start text-muted-foreground hover:text-destructive"
        @click="selection.source === 'vault' && $emit('hideVersion', selection.mod)"
      >
        <EyeOff />{{ t('vault.hideVersion.button') }}
      </Button>
    </template>
  </DetailPanel>
</template>
