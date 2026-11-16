<script setup lang="ts">
import { SendHorizontal } from '@lucide/vue';
import { nextTick, ref, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LOBBY_LIMITS } from '../../../../shared/contract.ts';
import { useTfafLobby } from '../../composables/useTfafLobby.ts';
import { formatTime } from '../../format.ts';
import { t } from '../../lib/i18n.ts';

const { view, selfId, run } = useTfafLobby();
const text = ref('');
const list = useTemplateRef<HTMLElement>('list');
const form = useTemplateRef<HTMLFormElement>('form');

watch(
  () => view.value?.chat.length,
  async () => {
    await nextTick();
    list.value?.scrollTo({ top: list.value.scrollHeight });
  },
);

function send(): void {
  const message = text.value.trim();
  if (message) {
    text.value = '';
    void run(() => window.tfaf.tfafLobby.say(message));
  }
}

/** A click on a nickname starts a private message, like the game lobby's menu of a player. */
function whisperTo(login: string): void {
  text.value = `/w ${login} `;
  form.value?.querySelector('input')?.focus();
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <div ref="list" class="min-h-0 flex-1 overflow-y-auto text-sm selectable" role="log" :aria-label="t('tfafLobby.chat.label')">
      <p v-if="!view?.chat.length" class="text-muted-foreground">{{ t('tfafLobby.chat.empty') }}</p>
      <p v-for="line in view?.chat" :key="line.id" class="py-0.5 leading-snug" :class="line.whisperTo && 'text-info'">
        <span class="mr-1.5 text-xs text-faint tabular-nums">{{ formatTime(line.at) }}</span>
        <span v-if="line.senderId === null" class="text-muted-foreground">{{ line.text }}</span>
        <template v-else>
          <span v-if="line.senderId === selfId" class="font-semibold text-primary">{{ line.login }}</span>
          <button v-else type="button" class="font-semibold text-info outline-none hover:underline focus-visible:underline" :data-tooltip="t('tfafLobby.chat.whisperHint')" @click="whisperTo(line.login)">
            {{ line.login }}
          </button>
          <span v-if="line.whisperTo" class="text-xs"> → {{ line.senderId === selfId ? line.whisperTo : t('tfafLobby.chat.toYou') }}</span>
          <span>: {{ line.text }}</span>
        </template>
      </p>
    </div>
    <form ref="form" class="flex gap-2" @submit.prevent="send">
      <Input v-model="text" :maxlength="LOBBY_LIMITS.maxChatLength" :placeholder="t('tfafLobby.chat.placeholder')" :aria-label="t('tfafLobby.chat.label')" />
      <Button type="submit" variant="outline" size="icon" :disabled="!text.trim()" :aria-label="t('tfafLobby.chat.send')"><SendHorizontal /></Button>
    </form>
  </div>
</template>
