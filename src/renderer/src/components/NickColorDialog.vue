<script setup lang="ts">
import { Check } from '@lucide/vue';
import { computed, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useChatPrefs } from '../composables/useChatPrefs.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { NICK_SWATCHES } from '../lib/nickColors.ts';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const props = defineProps<{ nick: string }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));
const { prefs, updateChatPrefs } = useChatPrefs();

const key = props.nick.toLowerCase();
const color = ref(prefs.value.userColors[key] ?? '');
const error = ref<string | null>(null);
const valid = computed(() => HEX_COLOR.test(color.value.trim()));

async function apply(value: string | null): Promise<void> {
  error.value = null;
  try {
    await updateChatPrefs((current) => {
      const userColors = { ...current.userColors };
      if (value) {
        userColors[key] = value.toLowerCase();
      } else {
        delete userColors[key];
      }
      return { ...current, userColors };
    });
    close();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-sm" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('chat.nickColor.title') }}</DialogTitle>
        <DialogDescription>{{ t('chat.nickColor.description', { nick }) }}</DialogDescription>
      </DialogHeader>
      <div class="grid grid-cols-6 gap-2" role="group" :aria-label="t('chat.nickColor.swatches')">
        <button
          v-for="swatch in NICK_SWATCHES"
          :key="swatch"
          type="button"
          class="grid aspect-square place-items-center outline-offset-2 hover:scale-105 focus-visible:outline-2 focus-visible:outline-ring"
          :style="{ backgroundColor: swatch }"
          :aria-label="swatch"
          :aria-pressed="color.toLowerCase() === swatch"
          @click="color = swatch"
        >
          <Check v-if="color.toLowerCase() === swatch" class="size-4 text-black/70" />
        </button>
      </div>
      <form id="nick-color" class="flex items-center gap-3" @submit.prevent="valid && apply(color.trim())">
        <Input v-model="color" class="font-mono" :placeholder="t('chat.nickColor.hexPlaceholder')" maxlength="7" :aria-label="t('chat.nickColor.hex')" />
        <span class="shrink-0 font-semibold" :style="valid ? { color: color.trim() } : undefined">{{ nick }}</span>
      </form>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <Button v-if="prefs.userColors[nick.toLowerCase()]" variant="ghost" class="mr-auto" @click="apply(null)">
          {{ t('chat.nickColor.reset') }}
        </Button>
        <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" form="nick-color" :disabled="!valid">{{ t('common.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
