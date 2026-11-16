<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { usePlayerNotes } from '../composables/usePlayerNotes.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';

const MAX_LENGTH = 1000;

const props = defineProps<{ playerId: number; login: string }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));
const { noteOf, save } = usePlayerNotes();

const text = ref(noteOf(props.playerId) ?? '');
const saving = ref(false);
const error = ref<string | null>(null);

async function submit(value: string): Promise<void> {
  error.value = null;
  saving.value = true;
  try {
    await save(props.playerId, value);
    close();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-md" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('chat.note.title', { login }) }}</DialogTitle>
        <DialogDescription>{{ t('chat.note.description') }}</DialogDescription>
      </DialogHeader>
      <form id="player-note" @submit.prevent="submit(text)">
        <Textarea v-model="text" :maxlength="MAX_LENGTH" rows="5" :placeholder="t('chat.note.placeholder')" autofocus />
      </form>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button v-if="noteOf(playerId)" variant="ghost" class="mr-auto text-destructive" :disabled="saving" @click="submit('')">
          {{ t('chat.note.remove') }}
        </Button>
        <Button variant="ghost" :disabled="saving" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" form="player-note" :disabled="saving">{{ t('common.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
