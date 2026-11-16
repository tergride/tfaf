<script setup lang="ts">
import { ExternalLink, Send, X } from '@lucide/vue';
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { CHAT_LIMITS, type ChatChannelData, type ChatMessage, type ChatUser } from '../../../shared/contract.ts';
import { useChat } from '../composables/useChat.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { errorMessage } from '../format.ts';
import { byteLength } from '../lib/chatText.ts';
import { t } from '../lib/i18n.ts';
import ChatMessageList from './ChatMessageList.vue';

// The party's channel next to the party, as in the official client: the main process sends its updates while it is
// watched, and its messages count as read then.
const props = defineProps<{ channel: string }>();

const chat = useChat();
const messages = shallowRef<ChatMessage[]>([]);
const users = shallowRef<ChatUser[]>([]);
const draft = ref('');
const replyTo = ref<ChatMessage | null>(null);
const error = ref<string | null>(null);
const active = ref(true);
const composer = useTemplateRef<HTMLInputElement>('composer');

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const connected = computed(() => chat.state.value.status === 'connected');
const tooLong = computed(() => byteLength(draft.value.trim()) > CHAT_LIMITS.messageMaxBytes);
const canSend = computed(() => connected.value && draft.value.trim() !== '' && !tooLong.value);

function apply(data: ChatChannelData): void {
  if (!sameName(data.name, props.channel)) {
    return;
  }
  if (data.messages) {
    messages.value = data.messages;
  }
  if (data.users) {
    users.value = data.users;
  }
}

const unsubscribe = window.tfaf.chat.onChannelChanged(apply);

// Watched only while the matchmaker is on screen, so the party's messages otherwise count as unread in the chat.
onActivated(() => {
  active.value = true;
});
onDeactivated(() => {
  active.value = false;
});
watch(
  [() => props.channel, active],
  async ([channel, isActive]) => {
    try {
      const data = await window.tfaf.chat.watch(isActive ? channel : null);
      if (data) {
        apply(data);
      }
    } catch (cause) {
      error.value = errorMessage(cause);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  unsubscribe();
  void window.tfaf.chat.watch(null).catch(() => undefined);
});

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = null;
  try {
    await action();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

function send(): void {
  const text = draft.value.trim();
  if (!canSend.value) {
    return;
  }
  void run(async () => {
    await window.tfaf.chat.send(props.channel, text, replyTo.value?.id ?? null);
    draft.value = '';
    replyTo.value = null;
  });
}

function focusComposer(): void {
  void nextTick(() => composer.value?.focus());
}

function reply(message: ChatMessage): void {
  replyTo.value = message;
  focusComposer();
}

function react(message: ChatMessage, shortcode: string): void {
  void run(() => window.tfaf.chat.react(props.channel, message.id, shortcode));
}

function mention(nick: string): void {
  draft.value = draft.value.trim() ? `${draft.value.trimEnd()} ${nick} ` : `${nick}, `;
  focusComposer();
}

async function remove(message: ChatMessage): Promise<void> {
  const confirmed = await confirmAction({
    title: t('chat.deleteMessage.title'),
    description: message.own ? t('chat.deleteMessage.ownDescription') : t('chat.deleteMessage.description', { nick: message.sender }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (confirmed) {
    await run(() => window.tfaf.chat.delete(props.channel, message.id));
  }
}
</script>

<template>
  <div class="flex h-80 flex-col border-t">
    <div class="flex h-10 shrink-0 items-center gap-2 px-5">
      <h3 class="text-sm font-semibold">{{ t('matchmaker.party.chat') }}</h3>
      <Button
        variant="ghost"
        size="icon-xs"
        class="ml-auto"
        :data-tooltip="t('matchmaker.party.openInChat')"
        :aria-label="t('matchmaker.party.openInChat')"
        @click="chat.focus(channel)"
      >
        <ExternalLink />
      </Button>
    </div>
    <ChatMessageList
      :messages="messages"
      :users="users"
      :nick="chat.state.value.nick"
      :moderator="false"
      @reply="reply"
      @react="react"
      @delete="remove"
      @mention="mention"
    />
    <p v-if="error" class="px-5 pb-1 text-xs text-destructive selectable">{{ error }}</p>
    <div class="flex flex-col gap-1.5 px-4 pb-4">
      <div v-if="replyTo" class="flex items-center gap-2 bg-background py-1 pr-1 pl-3 text-xs shadow-[inset_2px_0_0_var(--color-primary)]">
        <span class="shrink-0 text-muted-foreground">{{ t('chat.composer.replyingTo') }}</span>
        <span class="min-w-0 flex-1 truncate">
          <span class="font-semibold">{{ replyTo.sender }}</span> <span class="text-muted-foreground">{{ replyTo.text }}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          :data-tooltip="t('chat.composer.cancelReply')"
          :aria-label="t('chat.composer.cancelReply')"
          @click="replyTo = null"
        >
          <X />
        </Button>
      </div>
      <form
        class="plate plate-focus-within cut-sm flex items-center gap-1 bg-background pr-1 transition-colors"
        :class="tooLong ? '[--plate-border:var(--color-destructive)]!' : 'hover:[--plate-border:var(--color-input)]'"
        @submit.prevent="send"
      >
        <input
          ref="composer"
          v-model="draft"
          class="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-faint"
          :placeholder="t('matchmaker.party.chatPlaceholder')"
          :aria-label="t('matchmaker.party.chatPlaceholder')"
          :disabled="!connected"
          spellcheck="true"
          @keydown.esc="replyTo = null"
        />
        <Button type="submit" variant="ghost" size="icon-sm" :data-tooltip="t('chat.composer.send')" :aria-label="t('chat.composer.send')" :disabled="!canSend"><Send /></Button>
      </form>
    </div>
  </div>
</template>
