<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useDeferredClose } from '../../composables/useDeferredClose.ts';
import { errorMessage } from '../../format.ts';
import { t } from '../../lib/i18n.ts';
import { queries, queryClient } from '../../lib/queries.ts';
import ModPicker from '../ModPicker.vue';

const props = defineProps<{
  modUids: readonly string[];
  /** Mods FAF refuses, in lower case. */
  banned: readonly string[];
  /** A player chooses only their own UI mods; the sim mods are the host's. */
  uiOnly?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const modsQuery = useQuery(queries.installedMods());
const bannedMods = computed(() => new Set(props.banned));
const installed = computed(() => modsQuery.data.value ?? []);
const mods = computed(() => installed.value.filter((mod) => !bannedMods.value.has(mod.uid.toLowerCase()) && (!props.uiOnly || mod.type === 'UI')));
// The room lists sim mods; the UI mods the player has on stay on.
const activeUiMods = computed(() => installed.value.filter((mod) => mod.type === 'UI' && mod.active).map((mod) => mod.uid));
const selected = ref<string[] | null>(null);
const chosen = computed({
  get: () => selected.value ?? (props.uiOnly ? activeUiMods.value : [...props.modUids, ...activeUiMods.value]),
  set: (value: string[]) => {
    selected.value = value;
  },
});
const applying = ref(false);
const error = ref<string | null>(null);

async function applyOwnMods(): Promise<void> {
  const sim = installed.value.filter((mod) => mod.type !== 'UI' && mod.active).map((mod) => mod.uid);
  await window.tfaf.mods.setActive([...sim, ...chosen.value]);
  await queryClient.invalidateQueries(queries.installedMods());
}

async function apply(): Promise<void> {
  error.value = null;
  applying.value = true;
  try {
    if (props.uiOnly) {
      await applyOwnMods();
    } else {
      await window.tfaf.tfafLobby.act({ type: 'setMods', modUids: [...new Set(chosen.value)] });
    }
    close();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-lg" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ uiOnly ? t('tfafLobby.mods.uiDialogTitle') : t('tfafLobby.mods.dialogTitle') }}</DialogTitle>
        <DialogDescription>{{ uiOnly ? t('tfafLobby.mods.uiDialogDescription') : t('tfafLobby.mods.dialogDescription') }}</DialogDescription>
      </DialogHeader>
      <ModPicker v-model="chosen" :mods="mods" />
      <p v-if="error" class="text-sm text-destructive selectable">{{ error }}</p>
      <DialogFooter>
        <Button variant="ghost" :disabled="applying" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="applying" @click="apply"><Spinner v-if="applying" />{{ t('tfafLobby.mods.apply') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
