<script setup lang="ts">
import { computed, reactive } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { type GameSettingsImportCandidate, type GameSettingsPart, KEY_BINDINGS_PART } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { formatDateTime } from '../format.ts';
import { t } from '../lib/i18n.ts';

const props = defineProps<{ candidate: GameSettingsImportCandidate }>();
const emit = defineEmits<{ import: [parts: string[]]; close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const chosen = reactive(new Set(props.candidate.parts.map((part) => part.id)));

const description = computed(() => {
  const date = formatDateTime(props.candidate.exportedAt);
  const file = props.candidate.fileName;
  return date
    ? t('settings.forgedAlliance.import.description', { file, date })
    : t('settings.forgedAlliance.import.descriptionNoDate', { file });
});

function detail(part: GameSettingsPart): string {
  if (part.id !== KEY_BINDINGS_PART) {
    return t('settings.forgedAlliance.import.options', { count: part.count });
  }
  const preset = props.candidate.keyPreset ? t(`settings.keyBindings.presets.${props.candidate.keyPreset}`) : '';
  return part.count > 0
    ? t('settings.forgedAlliance.import.keyBindings', { preset, count: part.count })
    : t('settings.forgedAlliance.import.presetOnly', { preset });
}

function toggle(id: string, checked: boolean): void {
  if (checked) {
    chosen.add(id);
  } else {
    chosen.delete(id);
  }
}

function submit(): void {
  emit('import', props.candidate.parts.map((part) => part.id).filter((id) => chosen.has(id)));
  close();
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-md" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('settings.forgedAlliance.import.title') }}</DialogTitle>
        <DialogDescription class="selectable">{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-3">
        <Label v-for="part in candidate.parts" :key="part.id" class="cursor-pointer items-start gap-3 font-normal">
          <Checkbox :model-value="chosen.has(part.id)" class="mt-0.5" @update:model-value="(value) => toggle(part.id, value === true)" />
          <span class="flex flex-col gap-0.5">
            <span class="font-medium">{{ part.title }}</span>
            <span class="text-[13px] text-muted-foreground">{{ detail(part) }}</span>
          </span>
        </Label>
      </div>
      <DialogFooter>
        <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="chosen.size === 0" @click="submit">{{ t('settings.forgedAlliance.import.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
