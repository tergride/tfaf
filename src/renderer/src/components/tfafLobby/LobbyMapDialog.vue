<script setup lang="ts">
import { rememberMap } from '../../composables/useRecentMaps.ts';
import { t } from '../../lib/i18n.ts';
import MapBrowserDialog, { type MapChoice } from '../MapBrowserDialog.vue';

defineProps<{ folderName: string }>();
const emit = defineEmits<{ close: [] }>();

async function apply({ folderName }: MapChoice): Promise<void> {
  await window.tfaf.tfafLobby.act({ type: 'setMap', folderName });
  rememberMap(folderName);
}
</script>

<template>
  <MapBrowserDialog
    :current="folderName"
    :title="t('tfafLobby.map.dialogTitle')"
    :description="t('tfafLobby.map.dialogDescription')"
    :pick-label="t('tfafLobby.map.apply')"
    :apply="apply"
    @close="emit('close')"
  />
</template>
