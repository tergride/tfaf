<script setup lang="ts">
import { CircleCheck, FolderOpen, TriangleAlert } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type { IceAdapterKind, PathField, PathsStatus, Settings, TurnServer } from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { errorMessage } from '../format.ts';
import { setReduceGameLoad } from '../lib/gameLoad.ts';
import { t } from '../lib/i18n.ts';
import type { SettingsUpdate } from './settingsTab.ts';

const props = defineProps<{ settings: Settings; status: PathsStatus; update: SettingsUpdate }>();
defineEmits<{ pick: [field: PathField] }>();

// The app follows the switch at once; if saving fails, it goes back to the stored value.
async function setReduceGameLoadEnabled(value: boolean): Promise<void> {
  setReduceGameLoad(value);
  const saved = await props.update({ reduceGameLoad: value });
  setReduceGameLoad((saved ?? props.settings).reduceGameLoad);
}

const ADAPTERS: { value: IceAdapterKind; title: MessageKey; description: MessageKey; recommended?: boolean }[] = [
  {
    value: 'tfaf',
    title: 'settings.iceAdapter.tfaf.title',
    description: 'settings.iceAdapter.tfaf.description',
    recommended: true,
  },
  {
    value: 'java',
    title: 'settings.iceAdapter.java.title',
    description: 'settings.iceAdapter.java.description',
  },
];

function setIceAdapter(value: unknown): void {
  const adapter = ADAPTERS.find((candidate) => candidate.value === value);
  if (adapter) {
    void props.update({ iceAdapter: adapter.value });
  }
}

const turnServers = ref<TurnServer[] | null>(null);
const turnError = ref<string | null>(null);

async function loadTurnServers(): Promise<void> {
  turnError.value = null;
  try {
    turnServers.value = await window.tfaf.ice.turnServers();
  } catch (cause) {
    turnError.value = errorMessage(cause);
  }
}

function toggleTurnServer(id: string, preferred: boolean): void {
  const others = props.settings.preferredTurnIds.filter((entry) => entry !== id);
  void props.update({ preferredTurnIds: preferred ? [...others, id] : others });
}

onMounted(loadTurnServers);
</script>

<template>
  <div class="flex flex-col gap-5">
    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.folders.title') }}</CardTitle>
        <CardDescription>{{ t('settings.folders.description') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <div class="flex items-center gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.folders.game') }}</span>
            <span class="font-mono text-[13px] wrap-anywhere text-muted-foreground selectable">
              {{ settings.gamePath ?? t('settings.folders.notSelected') }}
            </span>
            <span v-if="status.gamePathValid" class="flex items-center gap-1.5 text-[13px] text-success">
              <CircleCheck class="size-3.5" />
              {{ t('settings.folders.gameFound') }}
            </span>
            <span v-else class="flex items-center gap-1.5 text-[13px] text-warning">
              <TriangleAlert class="size-3.5" />
              {{ t('settings.folders.gameMissing') }}
            </span>
          </div>
          <Button variant="outline" @click="$emit('pick', 'gamePath')"><FolderOpen />{{ t('settings.folders.pick') }}</Button>
        </div>
        <Separator />
        <div class="flex items-center gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.folders.vault') }}</span>
            <span class="font-mono text-[13px] wrap-anywhere text-muted-foreground selectable">{{ settings.vaultPath }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.folders.vaultHint') }}</span>
            <span v-if="!status.vaultPathAscii" class="flex items-center gap-1.5 text-[13px] text-warning">
              <TriangleAlert class="size-3.5 shrink-0" />
              {{ t('settings.folders.vaultNotAscii') }}
            </span>
          </div>
          <Button variant="outline" @click="$emit('pick', 'vaultPath')"><FolderOpen />{{ t('settings.folders.pick') }}</Button>
        </div>
        <Separator />
        <div class="flex items-center gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t(status.portable ? 'settings.portable.gamePrefs' : 'settings.folders.gamePrefs') }}</span>
            <span class="font-mono text-[13px] wrap-anywhere text-muted-foreground selectable">{{ settings.gamePrefsPath }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t(status.portable ? 'settings.portable.gamePrefsHint' : 'settings.folders.gamePrefsHint') }}</span>
          </div>
          <Button v-if="!status.portable" variant="outline" @click="$emit('pick', 'gamePrefsPath')"><FolderOpen />{{ t('settings.folders.pick') }}</Button>
        </div>
        <Separator />
        <div class="flex items-center gap-4 px-6 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="font-medium">{{ t('settings.folders.data') }}</span>
            <span class="font-mono text-[13px] wrap-anywhere text-muted-foreground selectable">{{ settings.dataPath }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.folders.dataHint') }}</span>
            <span v-if="!status.dataPathAscii" class="flex items-center gap-1.5 text-[13px] text-warning">
              <TriangleAlert class="size-3.5 shrink-0" />
              {{ t('settings.folders.dataNotAscii') }}
            </span>
          </div>
          <Button variant="outline" @click="$emit('pick', 'dataPath')"><FolderOpen />{{ t('settings.folders.pick') }}</Button>
        </div>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.iceAdapter.title') }}</CardTitle>
        <CardDescription>{{ t('settings.iceAdapter.description') }}</CardDescription>
      </CardHeader>
      <CardContent class="py-4">
        <RadioGroup :model-value="settings.iceAdapter" class="grid-cols-2" @update:model-value="setIceAdapter">
          <Label
            v-for="adapter in ADAPTERS"
            :key="adapter.value"
            class="plate plate-focus-within cut-sm flex cursor-pointer items-start gap-3 bg-background p-4 font-normal transition-colors hover:bg-secondary has-data-[state=checked]:bg-primary/6 has-data-[state=checked]:[--plate-border:var(--color-primary)]"
          >
            <RadioGroupItem :value="adapter.value" class="mt-0.5" />
            <span class="flex flex-col gap-1">
              <span class="flex items-center gap-2 font-semibold">
                {{ t(adapter.title) }}
                <Badge v-if="adapter.recommended" variant="accent">{{ t('settings.iceAdapter.recommended') }}</Badge>
              </span>
              <span class="text-[13px] leading-snug text-muted-foreground">{{ t(adapter.description) }}</span>
            </span>
          </Label>
        </RadioGroup>
        <div class="mt-4 flex flex-col gap-3 border-t pt-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.iceAdapter.turn') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.iceAdapter.turnHint') }}</span>
          </div>
          <p v-if="turnError" class="text-[13px] text-warning selectable">{{ turnError }}</p>
          <div v-else-if="turnServers === null" class="flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner />{{ t('common.loading') }}</div>
          <div v-else class="grid grid-cols-2 gap-x-6 gap-y-2.5">
            <Label v-for="server in turnServers" :key="server.id" class="cursor-pointer gap-2.5 font-normal">
              <Checkbox
                :model-value="settings.preferredTurnIds.includes(server.id)"
                @update:model-value="(value) => toggleTurnServer(server.id, value === true)"
              />
              {{ server.region }}
            </Label>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.discord.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.discord.showStatus"
            class="mt-0.5"
            @update:model-value="(value) => update({ discord: { ...settings.discord, showStatus: value } })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.discord.showStatus') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.discord.showStatusHint') }}</span>
          </span>
        </Label>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal" :class="{ 'opacity-50': !settings.discord.showStatus }">
          <Switch
            :model-value="settings.discord.allowJoin"
            class="mt-0.5"
            :disabled="!settings.discord.showStatus"
            @update:model-value="(value) => update({ discord: { ...settings.discord, allowJoin: value } })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.discord.allowJoin') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.discord.allowJoinHint') }}</span>
          </span>
        </Label>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.gameLoad.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch :model-value="settings.reduceGameLoad" class="mt-0.5" @update:model-value="setReduceGameLoadEnabled" />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.gameLoad.reduce') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.gameLoad.reduceHint') }}</span>
          </span>
        </Label>
      </CardContent>
    </Card>
  </div>
</template>
