<script setup lang="ts">
import { computed, ref } from 'vue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LobbyCatalog, LobbyOption, LobbyOptionValue } from '../../../../shared/contract.ts';
import { confirmAction } from '../../composables/useConfirm.ts';
import { useDeferredClose } from '../../composables/useDeferredClose.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { t } from '../../lib/i18n.ts';
import { searchLobbyOptions } from '../../lib/lobbyOptions.ts';
import SearchInput from '../SearchInput.vue';

const props = defineProps<{ catalog: LobbyCatalog }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));
const { room, hosting, starting, act } = useTfafLobby();

const search = ref('');
const groups = computed(() => searchLobbyOptions(props.catalog.groups, search.value));

function chosen(option: LobbyOption): LobbyOptionValue {
  return room.value?.options[option.key] ?? option.defaultValue;
}

function change(option: LobbyOption, text: string): void {
  const value = option.choices.find((choice) => String(choice.value) === text)?.value;
  if (value !== undefined) {
    void act({ type: 'setOption', key: option.key, value: value === option.defaultValue ? null : value });
  }
}

async function reset(): Promise<void> {
  const confirmed = await confirmAction({
    title: t('tfafLobby.options.resetTitle'),
    description: t('tfafLobby.options.resetDescription'),
    confirmText: t('tfafLobby.options.reset'),
    destructive: true,
  });
  if (confirmed) {
    void act({ type: 'resetOptions' });
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="flex max-h-[80vh] flex-col gap-4 sm:max-w-2xl" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('tfafLobby.options.title') }}</DialogTitle>
        <DialogDescription>{{ hosting ? t('tfafLobby.options.dialogDescriptionHost') : t('tfafLobby.options.dialogDescriptionPlayer') }}</DialogDescription>
      </DialogHeader>
      <SearchInput v-model="search" :placeholder="t('tfafLobby.options.search')" />
      <div class="flex h-[60vh] min-h-0 flex-col gap-5 overflow-y-auto pr-2">
        <p v-if="groups.length === 0" class="text-sm text-muted-foreground">{{ t('tfafLobby.options.nothingFound') }}</p>
        <section v-for="group in groups" :key="group.id" class="flex flex-col gap-2">
          <h3 class="text-sm text-muted-foreground">{{ t(`tfafLobby.options.groups.${group.id}`) }}</h3>
          <div v-for="option in group.options" :key="option.key" class="grid grid-cols-[minmax(0,1fr)_14rem] items-center gap-3" :data-tooltip="option.help">
            <span class="text-sm" :class="chosen(option) !== option.defaultValue && 'text-primary'">{{ option.label }}</span>
            <Select
              :model-value="String(chosen(option))"
              :disabled="!hosting || starting"
              @update:model-value="(value) => change(option, String(value))"
            >
              <SelectTrigger size="sm" class="w-full" :aria-label="option.label"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="choice in option.choices" :key="String(choice.value)" :value="String(choice.value)" :data-tooltip="choice.help">
                  {{ choice.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
      </div>
      <div class="flex items-center justify-between">
        <Button v-if="hosting && !starting" variant="ghost" @click="reset">{{ t('tfafLobby.options.reset') }}</Button>
        <Button variant="ghost" class="ml-auto" @click="close">{{ t('common.close') }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
