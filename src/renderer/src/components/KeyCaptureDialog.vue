<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { KeyAction } from '../../../shared/contract.ts';
import { formatKeyBinding, keyBinding, normalizeKeyBinding } from '../../../shared/keyBindings.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { t } from '../lib/i18n.ts';

const props = defineProps<{
  action: KeyAction;
  keyCodes: Readonly<Record<string, string>>;
  keyLabels: Readonly<Record<string, string>>;
  /** The action of each binding, by its normalized spelling. */
  owners: ReadonlyMap<string, KeyAction>;
}>();
const emit = defineEmits<{ assign: [binding: string]; close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const binding = ref<string | null>(null);
const unknownKey = ref(false);

const owner = computed(() => {
  const found = binding.value ? props.owners.get(normalizeKeyBinding(binding.value)) : undefined;
  return found && found.id !== props.action.id ? found : null;
});

// Every key goes to the binding, Tab, Enter and Esc included, as in the game's own key dialog; the buttons take clicks.
function onKeyDown(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  // keyCode is the Windows virtual key code, which is what the game's key names are listed by.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- `code` and `key` carry no virtual key code
  const name = props.keyCodes[event.keyCode.toString(16).toUpperCase().padStart(2, '0')];
  unknownKey.value = name === undefined;
  if (name !== undefined) {
    binding.value = keyBinding(name, { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
  }
}

function submit(): void {
  if (binding.value) {
    emit('assign', binding.value);
    close();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent
      class="gap-4 sm:max-w-md"
      @close-auto-focus="onContentClosed"
      @escape-key-down="(event) => event.preventDefault()"
      @keydown.capture="onKeyDown"
      @keyup.capture.prevent
    >
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('settings.keyBindings.capture.title', { action: action.title }) }}</DialogTitle>
        <DialogDescription>{{ t('settings.keyBindings.capture.description') }}</DialogDescription>
      </DialogHeader>
      <div class="plate cut-sm flex min-h-20 items-center justify-center bg-background px-4 py-5 text-center">
        <span v-if="binding" class="font-display text-2xl">{{ formatKeyBinding(binding, keyLabels) }}</span>
        <span v-else class="text-muted-foreground">{{ t('settings.keyBindings.capture.waiting') }}</span>
      </div>
      <p v-if="unknownKey" class="flex items-start gap-2 text-[13px] text-warning">
        <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{{ t('settings.keyBindings.capture.unknownKey') }}
      </p>
      <p v-else-if="owner" class="flex items-start gap-2 text-[13px] text-warning">
        <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{{ t('settings.keyBindings.capture.conflict', { action: owner.title }) }}
      </p>
      <DialogFooter>
        <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
        <Button :disabled="!binding" @click="submit">{{ t('settings.keyBindings.assign') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
