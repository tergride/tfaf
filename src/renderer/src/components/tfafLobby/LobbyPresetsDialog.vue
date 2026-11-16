<script setup lang="ts">
import { Download, Save, Trash2 } from '@lucide/vue';
import { computed, onMounted, ref, shallowRef } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LOBBY_LIMITS, type LobbyPreset, type LobbyPresets } from '../../../../shared/contract.ts';
import { confirmAction } from '../../composables/useConfirm.ts';
import { useDeferredClose } from '../../composables/useDeferredClose.ts';
import { errorMessage } from '../../format.ts';
import { t } from '../../lib/i18n.ts';

const LAST_GAME = 'lastGame';

const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const saved = shallowRef<LobbyPresets | null>(null);
const name = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

const rows = computed(() => saved.value?.presets ?? []);
const replacing = computed(() => {
  const wanted = name.value.trim().toLocaleLowerCase('ru');
  return rows.value.some((preset) => preset.name.toLocaleLowerCase('ru') === wanted);
});

async function work(task: () => Promise<void>): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await task();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

onMounted(() =>
  work(async () => {
    saved.value = await window.tfaf.tfafLobby.presets();
  }),
);

function save(presetName: string): Promise<void> {
  return work(async () => {
    saved.value = await window.tfaf.tfafLobby.savePreset(presetName);
    name.value = '';
  });
}

function load(id: string): Promise<void> {
  return work(async () => {
    await window.tfaf.tfafLobby.loadPreset(id);
    close();
  });
}

async function remove(preset: LobbyPreset): Promise<void> {
  const confirmed = await confirmAction({
    title: t('tfafLobby.presets.deleteTitle', { name: preset.name }),
    confirmText: t('tfafLobby.presets.delete'),
    destructive: true,
  });
  if (confirmed) {
    await work(async () => {
      saved.value = await window.tfaf.tfafLobby.deletePreset(preset.id);
    });
  }
}

function summary(preset: LobbyPreset): string {
  return t('tfafLobby.presets.summary', { options: Object.keys(preset.options).length, units: preset.restrictions.length, mods: preset.simMods.length });
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="flex max-h-[80vh] flex-col gap-4 sm:max-w-xl" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('tfafLobby.presets.title') }}</DialogTitle>
        <DialogDescription>{{ t('tfafLobby.presets.description') }}</DialogDescription>
      </DialogHeader>

      <form class="flex gap-2" @submit.prevent="save(name.trim())">
        <Input v-model="name" :maxlength="LOBBY_LIMITS.maxPresetName" :placeholder="t('tfafLobby.presets.name')" :aria-label="t('tfafLobby.presets.name')" />
        <Button type="submit" variant="outline" :disabled="busy || !name.trim()"><Save />{{ replacing ? t('tfafLobby.presets.replace') : t('tfafLobby.presets.save') }}</Button>
      </form>

      <ul class="flex min-h-24 flex-col gap-1 overflow-y-auto pr-1">
        <li v-if="saved?.lastGame" class="flex items-center gap-2 rounded-xs px-2 py-1.5 hover:bg-accent/50">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ t('tfafLobby.presets.lastGame') }}</span>
            <span class="block truncate text-xs text-muted-foreground">{{ summary(saved.lastGame) }}</span>
          </span>
          <Button variant="outline" size="xs" :disabled="busy" @click="load(LAST_GAME)"><Download />{{ t('tfafLobby.presets.load') }}</Button>
        </li>
        <li v-for="preset in rows" :key="preset.id" class="flex items-center gap-2 rounded-xs px-2 py-1.5 hover:bg-accent/50">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium" :data-tooltip="preset.name">{{ preset.name }}</span>
            <span class="block truncate text-xs text-muted-foreground">{{ summary(preset) }}</span>
          </span>
          <Button variant="outline" size="xs" :disabled="busy" @click="load(preset.id)"><Download />{{ t('tfafLobby.presets.load') }}</Button>
          <Button variant="ghost" size="icon-xs" :disabled="busy" :aria-label="t('tfafLobby.presets.replace')" :data-tooltip="t('tfafLobby.presets.replace')" @click="save(preset.name)"><Save /></Button>
          <Button variant="ghost" size="icon-xs" :disabled="busy" :aria-label="t('tfafLobby.presets.delete')" :data-tooltip="t('tfafLobby.presets.delete')" @click="remove(preset)"><Trash2 /></Button>
        </li>
        <li v-if="saved && !saved.lastGame && rows.length === 0" class="px-2 py-1.5 text-sm text-muted-foreground">{{ t('tfafLobby.presets.empty') }}</li>
      </ul>

      <p v-if="error" class="text-sm text-destructive selectable">{{ error }}</p>
      <div class="flex items-center justify-end gap-3">
        <Spinner v-if="busy" class="text-primary" />
        <Button variant="ghost" @click="close">{{ t('common.close') }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
