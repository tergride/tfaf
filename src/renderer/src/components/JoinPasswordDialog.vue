<script setup lang="ts">
import { Eye, EyeOff, Swords } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { HOST_GAME_LIMITS, type LobbyGame } from '../../../shared/contract.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';

// Asks for the password of a game and joins it. The last password of the host's games can be remembered, and then it
// is filled in the next time.
const props = defineProps<{ game: LobbyGame }>();
const emit = defineEmits<{ close: []; joined: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));

const password = ref('');
const remember = ref(false);
const showPassword = ref(false);
const saved = ref<string | null>(null);
const joining = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    saved.value = await window.tfaf.joinPasswords.get(props.game.host);
  } catch (cause) {
    console.warn('The remembered password could not be read', cause);
  }
  if (saved.value !== null) {
    remember.value = true;
    password.value ||= saved.value;
  }
});

async function keepChoice(value: string): Promise<void> {
  const next = remember.value ? value : null;
  if (next === saved.value) {
    return;
  }
  try {
    await window.tfaf.joinPasswords.set(props.game.host, next);
  } catch (cause) {
    console.warn('The password could not be remembered', cause);
  }
}

async function submit(): Promise<void> {
  const value = password.value;
  if (!value || joining.value) {
    return;
  }
  error.value = null;
  joining.value = true;
  try {
    await window.tfaf.game.join(props.game.id, value);
    await keepChoice(value);
    emit('joined');
    close();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && close()">
    <DialogContent class="gap-4 sm:max-w-sm" @close-auto-focus="onContentClosed">
      <DialogHeader>
        <DialogTitle class="font-display text-lg">{{ t('games.passwordDialog.title') }}</DialogTitle>
        <DialogDescription class="selectable">
          {{
            t(game.tfafLobby ? 'games.passwordDialog.tfafDescription' : 'games.passwordDialog.description', {
              host: game.host,
              title: game.title || t('games.untitled'),
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <form id="join-password" class="flex flex-col gap-3" @submit.prevent="submit">
        <InputGroup>
          <InputGroupInput
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :maxlength="HOST_GAME_LIMITS.passwordMaxLength"
            :placeholder="t('games.passwordDialog.placeholder')"
            :aria-label="t('games.passwordDialog.placeholder')"
            autofocus
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              :aria-label="showPassword ? t('hostGame.hidePassword') : t('hostGame.showPassword')"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" />
              <Eye v-else />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Label class="cursor-pointer gap-2 font-normal">
          <Checkbox :model-value="remember" @update:model-value="(value) => (remember = value === true)" />
          {{ t('games.passwordDialog.remember', { host: game.host }) }}
        </Label>
      </form>
      <p v-if="error" class="text-sm text-destructive selectable">{{ error }}</p>
      <DialogFooter>
        <Button variant="ghost" :disabled="joining" @click="close">{{ t('common.cancel') }}</Button>
        <Button type="submit" form="join-password" :disabled="!password || joining">
          <Spinner v-if="joining" />
          <Swords v-else />
          {{ t('games.detail.join') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
