<script setup lang="ts">
import { CircleCheck, ShieldCheck, Trash2, TriangleAlert } from '@lucide/vue';
import { computed, onActivated, ref, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  NumberField,
  NumberFieldContent,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/components/ui/number-field';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  type GameFilesCheck,
  LOG_CLEANUP_LIMITS,
  type LogCleanupPrefs,
  type LogsCleanup,
  type LogsUsage,
  type ModCheck,
  type ModCheckStatus,
  type OldVersion,
  type OldVersionsCleanup,
  type Settings,
} from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { errorMessage, formatSize, isCancelled } from '../format.ts';
import { t } from '../lib/i18n.ts';
import type { SettingsUpdate } from './settingsTab.ts';

const props = defineProps<{ settings: Settings; update: SettingsUpdate }>();
const emit = defineEmits<{ error: [message: string | null] }>();

const MOD_STATUS: Record<ModCheckStatus, { label: MessageKey; tone: 'success' | 'info' | 'muted' | 'warning' | 'destructive' }> = {
  ok: { label: 'settings.integrity.modStatus.ok', tone: 'success' },
  repaired: { label: 'settings.integrity.modStatus.repaired', tone: 'info' },
  notInVault: { label: 'settings.integrity.modStatus.notInVault', tone: 'muted' },
  unchecked: { label: 'settings.integrity.modStatus.unchecked', tone: 'warning' },
  failed: { label: 'settings.integrity.modStatus.failed', tone: 'destructive' },
};

const checkingGame = ref(false);
const checkingMods = ref(false);
const gameCheck = ref<GameFilesCheck | null>(null);
const modChecks = ref<ModCheck[] | null>(null);

const gameCheckText = computed(() => {
  const check = gameCheck.value;
  if (!check) {
    return '';
  }
  return check.repaired.length === 0
    ? t('settings.integrity.gameFilesMatch', { count: check.checked })
    : t('settings.integrity.gameFilesRepaired', {
        count: check.checked,
        repaired: check.repaired.length,
        files: check.repaired.join(', '),
      });
});
const modProblems = computed(() =>
  (modChecks.value ?? []).filter((check) => check.status === 'unchecked' || check.status === 'failed'),
);
const modNotes = computed(() => (modChecks.value ?? []).filter((check) => check.status !== 'ok'));
const modSummary = computed(() => {
  const checks = modChecks.value ?? [];
  if (checks.length === 0) {
    return t('settings.integrity.noMods');
  }
  const count = (status: ModCheckStatus): number => checks.filter((check) => check.status === status).length;
  const parts = [
    t('settings.integrity.modsOk', { number: count('ok') }),
    count('repaired') ? t('settings.integrity.modsRepaired', { number: count('repaired') }) : null,
    count('notInVault') ? t('settings.integrity.modsNotInVault', { number: count('notInVault') }) : null,
    modProblems.value.length ? t('settings.integrity.modsFailed', { number: modProblems.value.length }) : null,
  ].filter((part) => part !== null);
  return t('settings.integrity.modsSummary', { count: checks.length, parts: parts.join(', ') });
});

async function checkGameFiles(): Promise<void> {
  emit('error', null);
  checkingGame.value = true;
  try {
    gameCheck.value = await window.tfaf.integrity.checkGameFiles();
  } catch (cause) {
    emit('error', isCancelled(cause) ? null : errorMessage(cause));
  } finally {
    checkingGame.value = false;
  }
}

async function checkMods(): Promise<void> {
  emit('error', null);
  checkingMods.value = true;
  try {
    modChecks.value = await window.tfaf.integrity.checkMods();
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    checkingMods.value = false;
  }
}

const oldVersions = ref<OldVersion[] | null>(null);
const cleanup = ref<OldVersionsCleanup | null>(null);
const removingOldVersions = ref(false);

const oldVersionsText = computed(() => {
  const versions = oldVersions.value ?? [];
  if (versions.length === 0) {
    return t('settings.disk.none');
  }
  const total = versions.reduce((sum, version) => sum + version.bytes, 0);
  return t('settings.disk.canFree', { size: formatSize(total), versions: versions.map((version) => version.title).join(', ') });
});
const cleanupText = computed(() => {
  const result = cleanup.value;
  if (!result) {
    return '';
  }
  const size = formatSize(result.freedBytes);
  return result.remaining.length === 0
    ? t('settings.disk.freed', { size })
    : t('settings.disk.freedWithRemaining', { size, versions: result.remaining.map((version) => version.title).join(', ') });
});

async function loadOldVersions(): Promise<void> {
  try {
    oldVersions.value = await window.tfaf.storage.oldVersions();
    cleanup.value = null;
  } catch (cause) {
    emit('error', errorMessage(cause));
  }
}

async function removeOldVersions(): Promise<void> {
  emit('error', null);
  removingOldVersions.value = true;
  try {
    cleanup.value = await window.tfaf.storage.removeOldVersions();
    oldVersions.value = cleanup.value.remaining;
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    removingOldVersions.value = false;
  }
}

const LIMIT_FORMAT: Intl.NumberFormatOptions = { useGrouping: false, maximumFractionDigits: 0 };

const logsUsage = ref<LogsUsage | null>(null);
const logsCleanup = ref<LogsCleanup | null>(null);
const cleaningLogs = ref(false);
// The form follows clicks and steps at once and returns to the stored settings when no save is pending, so a held
// step button counts from the shown value and a failed save shows what is really stored.
const logCleanup = ref<LogCleanupPrefs>({ ...props.settings.logCleanup });
let pendingSaves = 0;
let savingLogCleanup: Promise<unknown> = Promise.resolve();
// A cleared number field is mounted again to show the stored value instead of staying empty.
const limitFieldsKey = ref(0);

watch(
  () => props.settings.logCleanup,
  (prefs) => {
    if (pendingSaves === 0) {
      logCleanup.value = { ...prefs };
    }
  },
);

const logsUsageText = computed(() => {
  const usage = logsUsage.value;
  return !usage || usage.files === 0
    ? t('settings.disk.noLogs')
    : t('settings.disk.logsUsage', { count: usage.files, size: formatSize(usage.bytes) });
});
const logsCleanupText = computed(() => {
  const result = logsCleanup.value;
  if (!result) {
    return '';
  }
  return result.removedFiles === 0
    ? t('settings.disk.nothingToClean')
    : t('settings.disk.logsRemoved', { count: result.removedFiles, size: formatSize(result.freedBytes) });
});

async function updateLogCleanup(patch: Partial<LogCleanupPrefs>): Promise<void> {
  // A plain object: IPC cannot clone the reactive proxy of the ref.
  const next: LogCleanupPrefs = { ...logCleanup.value, ...patch };
  logCleanup.value = next;
  pendingSaves += 1;
  const saving = props.update({ logCleanup: next });
  savingLogCleanup = saving;
  await saving;
  pendingSaves -= 1;
  if (pendingSaves === 0) {
    logCleanup.value = { ...props.settings.logCleanup };
  }
}

function setLimit(field: 'maxAgeDays' | 'maxSizeMb', value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) {
    limitFieldsKey.value += 1;
    return;
  }
  const { min, max } = LOG_CLEANUP_LIMITS[field];
  const limit = Math.min(max, Math.max(min, Math.round(value)));
  if (limit !== logCleanup.value[field]) {
    void updateLogCleanup(field === 'maxAgeDays' ? { maxAgeDays: limit } : { maxSizeMb: limit });
  }
}

async function loadLogs(): Promise<void> {
  try {
    logsUsage.value = await window.tfaf.storage.logs();
    logsCleanup.value = null;
  } catch (cause) {
    emit('error', errorMessage(cause));
  }
}

async function cleanLogs(): Promise<void> {
  emit('error', null);
  cleaningLogs.value = true;
  try {
    // A limit typed right before the click is saved when the field loses focus, and the cleanup must see it.
    await savingLogCleanup;
    logsCleanup.value = await window.tfaf.storage.cleanLogs();
    logsUsage.value = logsCleanup.value.usage;
  } catch (cause) {
    emit('error', errorMessage(cause));
  } finally {
    cleaningLogs.value = false;
  }
}

// The tab stays alive while the settings are open, so the lists are read again each time it is shown.
onActivated(() => {
  void loadOldVersions();
  void loadLogs();
});
</script>

<template>
  <div class="flex flex-col gap-5">
    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.integrity.title') }}</CardTitle>
        <CardDescription>{{ t('settings.integrity.description') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <div class="flex items-center gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.integrity.gameFiles') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.integrity.gameFilesHint') }}</span>
            <span v-if="gameCheck" class="flex items-start gap-1.5 text-[13px]" :class="gameCheck.repaired.length ? 'text-warning' : 'text-success'">
              <CircleCheck v-if="!gameCheck.repaired.length" class="mt-0.5 size-3.5 shrink-0" />
              <TriangleAlert v-else class="mt-0.5 size-3.5 shrink-0" />
              <span class="selectable">{{ gameCheckText }}</span>
            </span>
          </div>
          <Button variant="outline" :disabled="checkingGame || checkingMods" @click="checkGameFiles">
            <Spinner v-if="checkingGame" />
            <ShieldCheck v-else />
            {{ t('settings.integrity.check') }}
          </Button>
        </div>
        <Separator />
        <div class="flex items-start gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.integrity.mods') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.integrity.modsHint') }}</span>
            <template v-if="modChecks">
              <span class="text-[13px]" :class="modProblems.length ? 'text-warning' : 'text-success'">{{ modSummary }}</span>
              <ul v-if="modNotes.length" class="mt-1 flex flex-col gap-1 text-[13px]">
                <li v-for="check in modNotes" :key="check.uid" class="flex items-start gap-2">
                  <Badge :variant="MOD_STATUS[check.status].tone" class="mt-px">{{ t(MOD_STATUS[check.status].label) }}</Badge>
                  <span class="min-w-0 selectable">
                    {{ check.name }}<template v-if="check.details">: <span class="text-muted-foreground">{{ check.details }}</span></template>
                  </span>
                </li>
              </ul>
            </template>
          </div>
          <Button variant="outline" :disabled="checkingGame || checkingMods" @click="checkMods">
            <Spinner v-if="checkingMods" />
            <ShieldCheck v-else />
            {{ t('settings.integrity.checkMods') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.disk.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <div class="flex items-center gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.disk.oldVersions') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.disk.oldVersionsHint') }}</span>
            <span
              v-if="cleanup"
              class="flex items-start gap-1.5 text-[13px]"
              :class="cleanup.remaining.length ? 'text-warning' : 'text-success'"
            >
              <CircleCheck v-if="!cleanup.remaining.length" class="mt-0.5 size-3.5 shrink-0" />
              <TriangleAlert v-else class="mt-0.5 size-3.5 shrink-0" />
              <span class="selectable">{{ cleanupText }}</span>
            </span>
            <span v-else-if="oldVersions" class="text-[13px] selectable">{{ oldVersionsText }}</span>
          </div>
          <Button variant="outline" :disabled="removingOldVersions || !oldVersions?.length" @click="removeOldVersions">
            <Spinner v-if="removingOldVersions" />
            <Trash2 v-else />
            {{ t('settings.disk.clean') }}
          </Button>
        </div>
        <Separator />
        <div class="flex items-start gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.disk.logs') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.disk.logsHint') }}</span>
            <span v-if="logsUsage" class="text-[13px] selectable">{{ logsUsageText }}</span>
            <span v-if="logsCleanup" class="flex items-start gap-1.5 text-[13px] text-success">
              <CircleCheck class="mt-0.5 size-3.5 shrink-0" />
              <span class="selectable">{{ logsCleanupText }}</span>
            </span>
            <span v-if="logsCleanup?.busyFiles" class="flex items-start gap-1.5 text-[13px] text-warning">
              <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
              <span class="selectable">{{ t('settings.disk.logsBusy', { number: logsCleanup.busyFiles }) }}</span>
            </span>
          </div>
          <Button
            variant="outline"
            :disabled="cleaningLogs || !logsUsage?.files || !(logCleanup.byAge || logCleanup.bySize)"
            @click="cleanLogs"
          >
            <Spinner v-if="cleaningLogs" />
            <Trash2 v-else />
            {{ t('settings.disk.cleanLogs') }}
          </Button>
        </div>
        <Label class="flex cursor-pointer items-start gap-3 px-6 pb-4 font-normal">
          <Switch
            :model-value="logCleanup.enabled"
            class="mt-0.5"
            @update:model-value="(value) => updateLogCleanup({ enabled: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.disk.autoCleanLogs') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.disk.autoCleanLogsHint') }}</span>
          </span>
        </Label>
        <div class="flex flex-col gap-2.5 px-6 pb-4">
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Label class="cursor-pointer gap-2.5 font-normal">
              <Switch :model-value="logCleanup.byAge" @update:model-value="(value) => updateLogCleanup({ byAge: value })" />
              {{ t('settings.disk.logsMaxAge') }}
            </Label>
            <NumberField
              :key="`age-${limitFieldsKey}`"
              :model-value="logCleanup.maxAgeDays"
              :min="LOG_CLEANUP_LIMITS.maxAgeDays.min"
              :max="LOG_CLEANUP_LIMITS.maxAgeDays.max"
              :step="1"
              :format-options="LIMIT_FORMAT"
              :disabled="!logCleanup.byAge"
              class="w-32"
              @update:model-value="(value) => setLimit('maxAgeDays', value)"
            >
              <NumberFieldContent>
                <NumberFieldDecrement />
                <NumberFieldInput :aria-label="t('settings.disk.logsMaxAgeLabel')" />
                <NumberFieldIncrement />
              </NumberFieldContent>
            </NumberField>
            <span :class="{ 'opacity-50': !logCleanup.byAge }">
              {{ t('settings.disk.logsMaxAgeUnit', { count: logCleanup.maxAgeDays }) }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Label class="cursor-pointer gap-2.5 font-normal">
              <Switch :model-value="logCleanup.bySize" @update:model-value="(value) => updateLogCleanup({ bySize: value })" />
              {{ t('settings.disk.logsMaxSize') }}
            </Label>
            <NumberField
              :key="`size-${limitFieldsKey}`"
              :model-value="logCleanup.maxSizeMb"
              :min="LOG_CLEANUP_LIMITS.maxSizeMb.min"
              :max="LOG_CLEANUP_LIMITS.maxSizeMb.max"
              :step="50"
              :step-snapping="false"
              :format-options="LIMIT_FORMAT"
              :disabled="!logCleanup.bySize"
              class="w-32"
              @update:model-value="(value) => setLimit('maxSizeMb', value)"
            >
              <NumberFieldContent>
                <NumberFieldDecrement />
                <NumberFieldInput :aria-label="t('settings.disk.logsMaxSizeLabel')" />
                <NumberFieldIncrement />
              </NumberFieldContent>
            </NumberField>
            <span :class="{ 'opacity-50': !logCleanup.bySize }">{{ t('settings.disk.logsMaxSizeUnit') }}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
