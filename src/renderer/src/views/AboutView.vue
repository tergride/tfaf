<script setup lang="ts">
import { Download, ExternalLink, RefreshCw } from '@lucide/vue';
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import logoUrl from '../assets/logo.png';
import type { AppRelease, AppReleaseHistory } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { compareVersions, isPrerelease } from '../../../shared/versions.ts';
import ProgressLine from '../components/ProgressLine.vue';
import ReleaseNotes from '../components/ReleaseNotes.vue';
import { useAppUpdate } from '../composables/useAppUpdate.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { errorMessage, formatDate } from '../format.ts';
import { locale, t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';

// Older versions stay folded until asked for.
const SHOWN_RELEASES = 5;

const appUpdate = useAppUpdate();
const { state: session } = useGameSession();
const history = ref<AppReleaseHistory | null>(null);
const loadingHistory = ref(false);
const showOlder = ref(false);
const error = ref<string | null>(null);
const active = ref(false);
const betaUpdates = ref(false);

const inGame = computed(() => session.value.phase !== 'idle');
const statusText = computed(() => {
  const state = appUpdate.value;
  switch (state?.status) {
    case 'disabled':
      return t(state.disabledReason === 'portable' ? 'about.update.portable' : 'about.update.disabled');
    case 'checking':
      return t('about.update.checking');
    case 'downloading':
      return t('about.update.downloading', { version: state.version ?? '', percent: Math.round((state.progress ?? 0) * 100) });
    case 'ready':
      return t('about.update.ready', { version: state.version ?? '' });
    case 'error':
      return t('about.update.failed', { error: state.error ?? '' });
    default:
      return t('about.update.latest');
  }
});
// A manual download helps when the updater cannot: a build without it, or a failed check or download.
const manualUrl = computed(() =>
  appUpdate.value?.status === 'disabled' || appUpdate.value?.status === 'error' ? (history.value?.releasesUrl ?? null) : null,
);
const releases = computed(() => history.value?.releases ?? []);
const shownReleases = computed(() =>
  (showOlder.value ? releases.value : releases.value.slice(0, SHOWN_RELEASES)).map((release) => ({
    release,
    notes: release.notes[locale.value],
    badge: releaseBadge(release),
    beta: isPrerelease(release.version),
  })),
);

const RELEASE_BADGES = {
  installed: { label: 'about.history.installed', variant: 'success' },
  ready: { label: 'about.history.ready', variant: 'info' },
  downloading: { label: 'about.history.downloading', variant: 'info' },
  newer: { label: 'about.history.newer', variant: 'muted' },
} as const satisfies Record<string, { label: MessageKey; variant: 'success' | 'info' | 'muted' }>;

function releaseBadge(release: AppRelease): (typeof RELEASE_BADGES)[keyof typeof RELEASE_BADGES] | null {
  const state = appUpdate.value;
  if (!state) {
    return null;
  }
  if (release.version === state.currentVersion) {
    return RELEASE_BADGES.installed;
  }
  if (release.version === state.version && (state.status === 'ready' || state.status === 'downloading')) {
    return RELEASE_BADGES[state.status];
  }
  return compareVersions(release.version, state.currentVersion) > 0 ? RELEASE_BADGES.newer : null;
}

async function loadHistory(): Promise<void> {
  loadingHistory.value = true;
  try {
    history.value = await window.tfaf.appUpdate.releases(true);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loadingHistory.value = false;
  }
}

async function loadBetaUpdates(): Promise<void> {
  try {
    betaUpdates.value = (await window.tfaf.settings.get()).betaUpdates;
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

/** Betas also change which versions the history lists. */
async function setBetaUpdates(value: boolean): Promise<void> {
  error.value = null;
  betaUpdates.value = value;
  try {
    betaUpdates.value = (await window.tfaf.settings.update({ betaUpdates: value })).betaUpdates;
    await loadHistory();
  } catch (cause) {
    betaUpdates.value = !value;
    error.value = errorMessage(cause);
  }
}

async function runUpdateAction(action: 'check' | 'install'): Promise<void> {
  error.value = null;
  try {
    await (action === 'check' ? window.tfaf.appUpdate.check() : window.tfaf.appUpdate.install());
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

onActivated(() => {
  active.value = true;
  void loadBetaUpdates();
  void loadHistory();
});
onDeactivated(() => {
  active.value = false;
});
// A found update gets its notes from GitHub while the page is open.
watch(
  () => appUpdate.value?.version,
  (version) => {
    if (version && active.value) {
      void loadHistory();
    }
  },
);
</script>

<template>
  <section class="flex max-w-[880px] flex-col gap-6 px-7 pt-3 pb-8">
    <div class="flex items-center gap-4">
      <img :src="logoUrl" alt="" class="size-14" draggable="false" />
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl">{{ t('about.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('about.intro') }}</p>
      </div>
    </div>

    <Card v-if="appUpdate" class="gap-3 px-6 py-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="font-medium">{{ t('about.update.version', { version: appUpdate.currentVersion }) }}</span>
          <span class="text-[13px] text-muted-foreground selectable">{{ statusText }}</span>
        </div>
        <Button v-if="manualUrl" variant="outline" @click="openExternal(manualUrl)">
          <ExternalLink />
          {{ t('about.update.manual') }}
        </Button>
        <Button v-if="appUpdate.status === 'ready'" :disabled="inGame" @click="runUpdateAction('install')">
          <Download />
          {{ t('about.update.restart') }}
        </Button>
        <Button
          v-else-if="appUpdate.status !== 'disabled'"
          variant="outline"
          :disabled="appUpdate.status === 'checking' || appUpdate.status === 'downloading'"
          @click="runUpdateAction('check')"
        >
          <Spinner v-if="appUpdate.status === 'checking'" />
          <RefreshCw v-else />
          {{ t('about.update.check') }}
        </Button>
      </div>
      <ProgressLine v-if="appUpdate.status === 'downloading'" :value="appUpdate.progress" />
      <span v-if="appUpdate.status === 'ready' && inGame" class="text-[13px] text-warning">{{ t('about.update.closeGame') }}</span>
      <span v-else-if="appUpdate.status !== 'disabled'" class="text-[13px] text-faint">{{ t('about.update.schedule') }}</span>
      <Label v-if="appUpdate.status !== 'disabled'" class="flex cursor-pointer items-start gap-3 font-normal">
        <Checkbox :model-value="betaUpdates" class="mt-0.5" @update:model-value="(value) => setBetaUpdates(value === true)" />
        <span class="flex flex-col gap-1">
          <span class="font-medium">{{ t('about.update.beta') }}</span>
          <span class="text-[13px] text-muted-foreground">{{ t('about.update.betaHint') }}</span>
        </span>
      </Label>
    </Card>
    <Alert v-if="error" variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>

    <section class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <h2 class="text-lg">{{ t('about.history.title') }}</h2>
        <Spinner v-if="loadingHistory" class="text-primary" />
        <Button
          v-if="history?.releasesUrl"
          variant="ghost"
          size="sm"
          class="ml-auto text-muted-foreground"
          @click="openExternal(history.releasesUrl)"
        >
          <ExternalLink />
          {{ t('about.history.allReleases') }}
        </Button>
      </div>
      <p v-if="history?.error" class="text-[13px] text-warning selectable">{{ t('about.history.offline', { error: history.error }) }}</p>
      <p v-if="history && releases.length === 0" class="text-sm text-muted-foreground">{{ t('about.history.empty') }}</p>
      <Card v-for="{ release, notes, badge, beta } in shownReleases" :key="release.version" class="gap-3 px-6 py-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-display text-lg font-semibold selectable">{{ release.version }}</span>
          <Badge v-if="beta" variant="warning">{{ t('about.history.beta') }}</Badge>
          <Badge v-if="badge" :variant="badge.variant">{{ t(badge.label) }}</Badge>
          <span v-if="release.date" class="text-[13px] text-muted-foreground">{{ formatDate(release.date) }}</span>
          <Button
            v-if="release.url"
            variant="ghost"
            size="icon-sm"
            class="ml-auto text-muted-foreground"
            :data-tooltip="t('about.history.openRelease')"
            :aria-label="t('about.history.openRelease')"
            @click="openExternal(release.url)"
          >
            <ExternalLink />
          </Button>
        </div>
        <ReleaseNotes v-if="notes.length" :blocks="notes" />
        <span v-else class="text-[13px] text-muted-foreground">{{ t('about.history.noNotes') }}</span>
      </Card>
      <Button v-if="!showOlder && releases.length > SHOWN_RELEASES" variant="outline" class="self-start" @click="showOlder = true">
        {{ t('about.history.showOlder') }}
      </Button>
    </section>
  </section>
</template>
