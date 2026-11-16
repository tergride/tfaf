<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDeferredClose } from '../../composables/useDeferredClose.ts';
import { t } from '../../lib/i18n.ts';

// One line of text from the host: the game's title, the rules, why a player is kicked.
const props = defineProps<{
  heading: string;
  description?: string;
  label: string;
  initial?: string;
  maxLength: number;
  multiline?: boolean;
  /** An empty text is refused. */
  required?: boolean;
  /** The text has to match, with `invalidText` saying why not. */
  pattern?: RegExp;
  invalidText?: string;
  confirmText: string;
  destructive?: boolean;
}>();
const emit = defineEmits<{ confirm: [text: string]; close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const text = ref(props.initial ?? '');
const trimmed = computed(() => text.value.trim());
const invalid = computed(() => trimmed.value !== '' && props.pattern !== undefined && !props.pattern.test(trimmed.value));
const blocked = computed(() => invalid.value || (props.required && trimmed.value === ''));

function confirm(): void {
  if (!blocked.value) {
    emit('confirm', trimmed.value);
    close();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-md" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ heading }}</DialogTitle>
        <DialogDescription :class="{ 'sr-only': !description }">{{ description ?? heading }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="confirm">
        <Textarea v-if="multiline" v-model="text" rows="4" :maxlength="maxLength" :aria-label="label" :placeholder="label" />
        <Input v-else v-model="text" :maxlength="maxLength" :aria-label="label" :placeholder="label" />
        <p v-if="invalid" class="text-sm text-destructive">{{ invalidText }}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button type="submit" :variant="destructive ? 'destructive' : 'default'" :disabled="blocked">{{ confirmText }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
