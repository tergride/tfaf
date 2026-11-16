<script setup lang="ts">
import { Download, TriangleAlert, Upload } from '@lucide/vue';
import { computed, onActivated, ref, shallowRef } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { GameSettingsImportCandidate, GameSettingsImportResult } from '../../../shared/contract.ts';
import { gamePrefsChanged } from '../composables/useGamePrefsView.ts';
import { useGameSession } from '../composables/useGameSession.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import GameOptionsPanel from './GameOptionsPanel.vue';
import GameSettingsImportDialog from './GameSettingsImportDialog.vue';
import KeyBindingsPanel from './KeyBindingsPanel.vue';

const SKIPPED_SHOWN = 10;

const panel = ref<'options' | 'keys'>('options');
const { state: game } = useGameSession();
const busy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const skipped = ref<string[]>([]);
const candidate = shallowRef<GameSettingsImportCandidate | null>(null);

// The messages are about the last export or import, so the tab shown again starts without them.
onActivated(() => {
  error.value = null;
  notice.value = null;
  skipped.value = [];
});

const skippedText = computed(() => {
  const shown = skipped.value.slice(0, SKIPPED_SHOWN);
  const rest = skipped.value.length - shown.length;
  const items = rest > 0 ? [...shown, t('settings.forgedAlliance.import.skippedMore', { count: rest })] : shown;
  return t('settings.forgedAlliance.import.skipped', { items: items.join(', ') });
});

async function run(work: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = null;
  notice.value = null;
  skipped.value = [];
  try {
    await work();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function exportSettings(): Promise<void> {
  return run(async () => {
    const file = await window.tfaf.gameOptions.exportSettings();
    if (file) {
      notice.value = t('settings.forgedAlliance.exported', { file });
    }
  });
}

function pickImport(): Promise<void> {
  return run(async () => {
    candidate.value = await window.tfaf.gameOptions.pickImport();
  });
}

function summary(result: GameSettingsImportResult): string {
  const parts = [
    result.options > 0 ? t('settings.forgedAlliance.import.options', { count: result.options }) : null,
    result.keyBindings !== null ? t('settings.forgedAlliance.import.doneKeys') : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? t('settings.forgedAlliance.import.done', { parts: parts.join(', ') }) : t('settings.forgedAlliance.import.nothing');
}

function importSettings(token: string, parts: string[]): Promise<void> {
  return run(async () => {
    const result = await window.tfaf.gameOptions.importSettings(token, parts);
    gamePrefsChanged();
    notice.value = summary(result);
    skipped.value = result.skipped;
  });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <Tabs v-model="panel">
        <TabsList>
          <TabsTrigger value="options" class="px-4">{{ t('settings.forgedAlliance.options') }}</TabsTrigger>
          <TabsTrigger value="keys" class="px-4">{{ t('settings.forgedAlliance.keys') }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="ml-auto flex items-center gap-2">
        <Spinner v-if="busy" />
        <Button variant="outline" :disabled="busy" :data-tooltip="t('settings.forgedAlliance.exportHint')" @click="exportSettings">
          <Download />{{ t('settings.forgedAlliance.exportSettings') }}
        </Button>
        <!-- The game rewrites Game.prefs when it closes, so an import waits until it is closed. -->
        <Button
          variant="outline"
          :disabled="busy || game.phase !== 'idle'"
          :data-tooltip="t('settings.forgedAlliance.importHint')"
          @click="pickImport"
        >
          <Upload />{{ t('settings.forgedAlliance.importSettings') }}
        </Button>
      </div>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription class="selectable">{{ error }}</AlertDescription>
    </Alert>
    <p v-if="notice" class="text-[13px] text-success selectable">{{ notice }}</p>
    <p v-if="skipped.length" class="flex items-start gap-1.5 text-[13px] text-warning selectable">
      <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{{ skippedText }}
    </p>

    <!-- Both stay alive, so a search and the open groups survive switching; each reads Game.prefs again when shown. -->
    <KeepAlive>
      <GameOptionsPanel v-if="panel === 'options'" />
      <KeyBindingsPanel v-else />
    </KeepAlive>

    <GameSettingsImportDialog
      v-if="candidate"
      :candidate="candidate"
      @import="(parts) => candidate && importSettings(candidate.token, parts)"
      @close="candidate = null"
    />
  </div>
</template>
