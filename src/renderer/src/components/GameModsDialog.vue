<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { queries } from '../lib/queries.ts';
import ModPicker from './ModPicker.vue';

const props = defineProps<{ modUids: readonly string[] }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const modsQuery = useQuery(queries.installedMods());
const mods = computed(() => modsQuery.data.value ?? []);
const selected = ref([...props.modUids]);
const changed = computed(() => [...new Set(selected.value)].sort().join(' ') !== [...new Set(props.modUids)].sort().join(' '));
const applying = ref(false);
const error = ref<string | null>(null);

async function apply(): Promise<void> {
  error.value = null;
  applying.value = true;
  try {
    await window.tfaf.game.changeMods([...selected.value]);
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
        <DialogTitle class="font-display text-lg">{{ t('currentGame.changeMods.title') }}</DialogTitle>
        <DialogDescription>{{ t('currentGame.changeMods.description') }}</DialogDescription>
      </DialogHeader>
      <ModPicker v-model="selected" :mods="mods" />
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button variant="ghost" :disabled="applying" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="applying || !changed" @click="apply">{{ t('currentGame.changeMods.apply') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
