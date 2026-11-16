<script setup lang="ts">
import { BookmarkPlus, Trash2 } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { HostGameDraft, HostGamePreset } from '../../../shared/contract.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { errorMessage } from '../format.ts';
import { createPresetNameSchema } from '../lib/hostGameForm.ts';
import { t } from '../lib/i18n.ts';

const props = defineProps<{ currentDraft: () => HostGameDraft; suggestedName: string }>();
const presets = defineModel<HostGamePreset[]>('presets', { required: true });
const activeId = defineModel<string | null>('activeId', { required: true });
const emit = defineEmits<{ apply: [preset: HostGamePreset] }>();

const saveOpen = ref(false);
const name = ref('');
const nameError = ref<string | null>(null);
const saving = ref(false);
const deleteError = ref<string | null>(null);

const active = computed(() => presets.value.find((preset) => preset.id === activeId.value) ?? null);
const sorted = computed(() => [...presets.value].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
const replacing = computed(() => {
  const trimmed = name.value.trim().toLocaleLowerCase('ru');
  return presets.value.some((preset) => preset.name.toLocaleLowerCase('ru') === trimmed);
});

watch(saveOpen, (open) => {
  if (open) {
    name.value = active.value?.name ?? props.suggestedName.trim();
    nameError.value = null;
  }
});

function select(id: unknown): void {
  const preset = presets.value.find((candidate) => candidate.id === id);
  if (preset) {
    activeId.value = preset.id;
    emit('apply', preset);
  }
}

async function save(): Promise<void> {
  const parsed = createPresetNameSchema().safeParse(name.value);
  if (!parsed.success) {
    nameError.value = parsed.error.issues[0]?.message ?? t('hostGame.validation.invalidPresetName');
    return;
  }
  saving.value = true;
  try {
    presets.value = await window.tfaf.presets.save(parsed.data, props.currentDraft());
    activeId.value = presets.value.find((preset) => preset.name.toLocaleLowerCase('ru') === parsed.data.toLocaleLowerCase('ru'))?.id ?? null;
    saveOpen.value = false;
  } catch (cause) {
    nameError.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}

async function remove(): Promise<void> {
  const preset = active.value;
  if (!preset) {
    return;
  }
  const confirmed = await confirmAction({
    title: t('hostGame.presets.deleteConfirm', { name: preset.name }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (!confirmed) {
    return;
  }
  deleteError.value = null;
  try {
    presets.value = await window.tfaf.presets.delete(preset.id);
    activeId.value = null;
  } catch (cause) {
    deleteError.value = errorMessage(cause);
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</span>
    <Select :model-value="activeId ?? undefined" @update:model-value="select">
      <SelectTrigger class="plate-control w-56" :aria-label="t('hostGame.presets.label')" :disabled="presets.length === 0">
        <!-- The label comes from the list itself: a preset saved while the menu is closed is not registered as an item yet. -->
        <SelectValue>
          <span v-if="active" class="truncate">{{ active.name }}</span>
          <span v-else class="text-muted-foreground">
            {{ presets.length ? t('hostGame.presets.choose') : t('hostGame.presets.none') }}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="preset in sorted" :key="preset.id" :value="preset.id">{{ preset.name }}</SelectItem>
      </SelectContent>
    </Select>
    <Popover v-model:open="saveOpen">
      <PopoverTrigger as-child>
        <Button variant="outline" :data-tooltip="t('hostGame.presets.saveHint')">
          <BookmarkPlus />
          {{ t('common.save') }}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-80">
        <form class="flex flex-col gap-3" @submit.prevent="save">
          <Field :data-invalid="nameError !== null">
            <FieldLabel for="preset-name">{{ t('hostGame.presets.name') }}</FieldLabel>
            <Input
              id="preset-name"
              v-model="name"
              maxlength="60"
              autofocus
              :aria-invalid="nameError !== null"
              @update:model-value="nameError = null"
            />
            <FieldError v-if="nameError">{{ nameError }}</FieldError>
          </Field>
          <p class="text-xs text-muted-foreground">
            {{ t('hostGame.presets.savesEverything') }}
            <template v-if="replacing">{{ t('hostGame.presets.willReplace') }}</template>
          </p>
          <Button type="submit" :disabled="saving">{{ replacing ? t('hostGame.presets.replace') : t('common.save') }}</Button>
        </form>
      </PopoverContent>
    </Popover>
    <Button v-if="active" variant="ghost" size="icon" :data-tooltip="t('hostGame.presets.delete', { name: active.name })" :aria-label="t('hostGame.presets.delete', { name: active.name })" @click="remove">
      <Trash2 />
    </Button>
  </div>
</template>
