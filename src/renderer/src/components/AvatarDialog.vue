<script setup lang="ts">
import { Ban, Check } from '@lucide/vue';
import { onMounted, ref, shallowRef } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import type { AvatarChoice } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import AvatarImage from './AvatarImage.vue';

const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const choice = shallowRef<AvatarChoice | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  try {
    choice.value = await window.tfaf.avatars.list();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
});

// The server confirms nothing; the new avatar shows once it sends the player's info again.
async function select(url: string | null): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await window.tfaf.avatars.select(url);
    close();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-lg" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('profile.avatars.title') }}</DialogTitle>
        <DialogDescription>{{ t('profile.avatars.description') }}</DialogDescription>
      </DialogHeader>
      <Alert v-if="error" variant="destructive"><AlertDescription class="selectable">{{ error }}</AlertDescription></Alert>
      <div v-if="!choice && !error" class="grid h-24 place-items-center"><Spinner class="size-5 text-primary" /></div>
      <template v-else-if="choice">
        <p v-if="choice.available.length === 0" class="text-sm text-muted-foreground">{{ t('profile.avatars.none') }}</p>
        <div v-else class="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 overflow-y-auto" role="listbox" :aria-label="t('profile.avatars.title')">
          <button
            v-for="avatar in choice.available"
            :key="avatar.url"
            type="button"
            role="option"
            class="plate plate-focus cut-sm flex items-center gap-2.5 bg-background px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:opacity-50"
            :class="{ 'bg-primary/10 [--plate-border:var(--color-primary)]': choice.current === avatar.url }"
            :aria-selected="choice.current === avatar.url"
            :disabled="busy"
            @click="select(avatar.url)"
          >
            <AvatarImage :avatar="avatar" />
            <span class="min-w-0 flex-1 truncate">{{ avatar.tooltip || t('profile.avatars.untitled') }}</span>
            <Check v-if="choice.current === avatar.url" class="size-4 shrink-0 text-primary" />
          </button>
        </div>
      </template>
      <DialogFooter>
        <Button v-if="choice?.current" variant="ghost" class="mr-auto" :disabled="busy" @click="select(null)">
          <Ban />{{ t('profile.avatars.remove') }}
        </Button>
        <Button variant="ghost" @click="close">{{ t('common.close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
