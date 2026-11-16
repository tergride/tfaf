<script setup lang="ts">
import { Hash, MessageSquare, MessagesSquare, Pencil, Plus, RefreshCw, Send, Shield, SmilePlus, Users, X } from '@lucide/vue';
import { computed, defineAsyncComponent, nextTick, onActivated, onDeactivated, ref, useTemplateRef, watch } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import {
  CHAT_LIMITS,
  type ChatChannelInfo,
  type ChatMessage,
  type ChatStatus,
  type ChatUser,
  type LiveGame,
  type LobbyGame,
} from '../../../shared/contract.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import ChatMessageList from '../components/ChatMessageList.vue';
import ChatUserList from '../components/ChatUserList.vue';
import EmoticonPicker from '../components/EmoticonPicker.vue';
import PrivateChatSummary from '../components/PrivateChatSummary.vue';
import { useChat } from '../composables/useChat.ts';
import { useChatPrefs } from '../composables/useChatPrefs.ts';
import { confirmAction } from '../composables/useConfirm.ts';
import { useGameFocus } from '../composables/useGameFocus.ts';
import { useJoinPassword } from '../composables/useJoinPassword.ts';
import { usePlayerGames } from '../composables/usePlayerGames.ts';
import { useReplayFocus } from '../composables/useReplayFocus.ts';
import { errorMessage } from '../format.ts';
import { byteLength, tokenize } from '../lib/chatText.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { nickColorFor } from '../lib/nickColors.ts';

const NickColorDialog = defineAsyncComponent(() => import('../components/NickColorDialog.vue'));
const PlayerNoteDialog = defineAsyncComponent(() => import('../components/PlayerNoteDialog.vue'));

const STATUS: Record<ChatStatus, { text: MessageKey; dot: string }> = {
  connected: { text: 'chat.status.connected', dot: 'bg-success' },
  connecting: { text: 'chat.status.connecting', dot: 'bg-warning animate-pulse' },
  disconnected: { text: 'chat.status.disconnected', dot: 'bg-destructive' },
};
// The open conversation is marked the way the sidebar marks the current section.
const CURRENT_ROW =
  'bg-accent text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:bg-primary [&>button:first-child>svg]:text-primary';
const HISTORY_SIZE = 50;
const collator = new Intl.Collator('ru', { sensitivity: 'base' });

const chat = useChat();
const { state, selected, messages, users } = chat;
const gameFocus = useGameFocus();
const joinPassword = useJoinPassword();
const replayFocus = useReplayFocus();
const { prefs, updateChatPrefs } = useChatPrefs();
const visible = ref(false);
// Running games are looked up only while the chat is on screen.
const playerGames = usePlayerGames(visible);

const error = ref<string | null>(null);
const draft = ref('');
const replyTo = ref<ChatMessage | null>(null);
const showUsers = ref(true);
const joinName = ref('');
const editingTopic = ref(false);
const topicDraft = ref('');
const pickerOpen = ref(false);
const noteFor = ref<{ playerId: number; login: string } | null>(null);
const colorFor = ref<string | null>(null);
const composer = useTemplateRef<HTMLInputElement>('composer');
const drafts = new Map<string, string>();
const sent: string[] = [];
let historyIndex = -1;
let completion: { start: number; end: number; matches: string[]; index: number } | null = null;

const sameName = (a: string, b: string | null): boolean => b !== null && a.toLowerCase() === b.toLowerCase();
// The clan's channel stands apart from the others and cannot be left.
const clanChannel = computed(
  () => state.value.channels.find((channel) => channel.kind === 'channel' && sameName(channel.name, state.value.clanChannel)) ?? null,
);
const channels = computed(() =>
  state.value.channels.filter((channel) => channel.kind === 'channel' && channel !== clanChannel.value),
);
const privates = computed(() => state.value.channels.filter((channel) => channel.kind === 'private'));
const current = computed(() => state.value.channels.find((channel) => sameName(channel.name, selected.value)) ?? null);
const topicTokens = computed(() => (current.value?.topic ? tokenize(current.value.topic, null) : []));
const bytes = computed(() => byteLength(draft.value.trim()));
const tooLong = computed(() => bytes.value > CHAT_LIMITS.messageMaxBytes);
const canSend = computed(
  () => state.value.status === 'connected' && current.value !== null && draft.value.trim() !== '' && !tooLong.value,
);
/** Outside the user list a nick has no group, so only the user's own color and the random mode apply. */
function nickStyle(nick: string): Record<string, string> | undefined {
  const color = nickColorFor(nick, null, prefs.value);
  return color ? { color } : undefined;
}

const typingText = computed(() => {
  const typing = current.value?.typing ?? [];
  if (typing.length === 0) {
    return '';
  }
  if (typing.length === 1) {
    return t('chat.typing.one', { nick: typing[0]! });
  }
  return typing.length <= 3 ? t('chat.typing.several', { nicks: typing.join(', ') }) : t('chat.typing.many');
});

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = null;
  try {
    await action();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

function select(name: string): void {
  void chat.select(name);
}

function reconnect(): void {
  void run(() => window.tfaf.chat.reconnect());
}

// A channel that is left or closed gives way to the first one; the list is empty only while signing in.
watch(
  () => state.value.channels,
  (list) => {
    if (list.length > 0 && !list.some((channel) => sameName(channel.name, selected.value))) {
      select(list[0]!.name);
    }
  },
  { immediate: true },
);

watch(
  () => chat.focusRequest.value,
  (request) => {
    if (request) {
      select(request.channel);
    }
  },
  // The first notification click may be what opens the chat at all.
  { immediate: true },
);

watch(selected, (next, previous) => {
  if (previous) {
    drafts.set(previous.toLowerCase(), draft.value);
    if (draft.value) {
      void window.tfaf.chat.typing(previous, false).catch(() => undefined);
    }
  }
  draft.value = next ? (drafts.get(next.toLowerCase()) ?? '') : '';
  replyTo.value = null;
  editingTopic.value = false;
  completion = null;
  historyIndex = -1;
  void nextTick(() => composer.value?.focus());
});

onActivated(() => {
  visible.value = true;
  void chat.setVisible(true);
  void nextTick(() => composer.value?.focus());
});
onDeactivated(() => {
  visible.value = false;
  void chat.setVisible(false);
});

function onInput(): void {
  completion = null;
  historyIndex = -1;
  const channel = selected.value;
  if (channel && state.value.status === 'connected') {
    const text = draft.value.trim();
    void window.tfaf.chat.typing(channel, text !== '' && !text.startsWith('/')).catch(() => undefined);
  }
}

async function send(): Promise<void> {
  const channel = selected.value;
  const text = draft.value.trim();
  if (!channel || !canSend.value) {
    return;
  }
  await run(async () => {
    await window.tfaf.chat.send(channel, text, replyTo.value?.id ?? null);
    sent.unshift(text);
    sent.length = Math.min(sent.length, HISTORY_SIZE);
    draft.value = '';
    replyTo.value = null;
    // Commands that open a conversation show it right away.
    const target = /^\/(?:msg|query)\s+(\S+)/i.exec(text)?.[1] ?? /^\/join\s+#?(\S+)/i.exec(text)?.[1];
    if (target) {
      select(text.toLowerCase().startsWith('/join') ? `#${target}` : target);
    }
  });
}

/** Tab completes the nick before the caret, and further presses go through the other matches. */
function complete(): void {
  const input = composer.value;
  if (!input) {
    return;
  }
  if (!completion) {
    const caret = input.selectionStart ?? draft.value.length;
    const start = draft.value.slice(0, caret).search(/\S+$/);
    if (start < 0) {
      return;
    }
    // A leading @ stays: the mention reads the same with or without it.
    const at = draft.value[start] === '@' ? 1 : 0;
    const prefix = draft.value.slice(start + at, caret).toLowerCase();
    if (!prefix) {
      return;
    }
    // As in the official client, everyone in the channel, ourselves too; also those who wrote and have left since.
    const names = new Map<string, string>();
    const add = (nick: string): void => {
      if (nick.toLowerCase().startsWith(prefix) && !names.has(nick.toLowerCase())) {
        names.set(nick.toLowerCase(), nick);
      }
    };
    users.value.forEach((user) => add(user.nick));
    messages.value.filter((message) => message.kind !== 'system').forEach((message) => add(message.sender));
    if (current.value?.kind === 'private') {
      add(current.value.name);
    }
    if (state.value.nick) {
      add(state.value.nick);
    }
    const matches = [...names.values()].sort(collator.compare);
    if (matches.length === 0) {
      return;
    }
    completion = { start: start + at, end: caret, matches, index: -1 };
  }
  completion.index = (completion.index + 1) % completion.matches.length;
  const nick = completion.matches[completion.index]!;
  const suffix = completion.start === 0 ? ', ' : ' ';
  const before = draft.value.slice(0, completion.start);
  draft.value = `${before}${nick}${suffix}${draft.value.slice(completion.end)}`;
  completion.end = before.length + nick.length + suffix.length;
  const caret = completion.end;
  void nextTick(() => input.setSelectionRange(caret, caret));
}

function browseHistory(step: 1 | -1): boolean {
  const next = historyIndex + step;
  if (next < -1 || next >= sent.length) {
    return false;
  }
  historyIndex = next;
  draft.value = next === -1 ? '' : sent[next]!;
  return true;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    complete();
    return;
  }
  completion = null;
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    void send();
  } else if (event.key === 'Escape' && replyTo.value) {
    event.preventDefault();
    replyTo.value = null;
  } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (draft.value === '' || historyIndex >= 0)) {
    if (browseHistory(event.key === 'ArrowUp' ? 1 : -1)) {
      event.preventDefault();
    }
  }
}

function insert(text: string): void {
  const input = composer.value;
  const start = input?.selectionStart ?? draft.value.length;
  const end = input?.selectionEnd ?? start;
  const before = draft.value.slice(0, start);
  const after = draft.value.slice(end);
  // Emoticons and nicks are recognized only as separate words.
  const value = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${after.startsWith(' ') ? '' : ' '}`;
  draft.value = `${before}${value}${after}`;
  const caret = before.length + value.length;
  void nextTick(() => {
    input?.focus();
    input?.setSelectionRange(caret, caret);
  });
}

function mention(nick: string): void {
  if (draft.value.trim() === '') {
    draft.value = `${nick}, `;
    void nextTick(() => composer.value?.focus());
  } else {
    insert(nick);
  }
}

function pickEmoticon(shortcode: string): void {
  pickerOpen.value = false;
  insert(shortcode);
}

function reply(message: ChatMessage): void {
  replyTo.value = message;
  void nextTick(() => composer.value?.focus());
}

function react(message: ChatMessage, shortcode: string): void {
  const channel = selected.value;
  if (channel) {
    void run(() => window.tfaf.chat.react(channel, message.id, shortcode));
  }
}

async function remove(message: ChatMessage): Promise<void> {
  const channel = selected.value;
  const confirmed = await confirmAction({
    title: t('chat.deleteMessage.title'),
    description: message.own ? t('chat.deleteMessage.ownDescription') : t('chat.deleteMessage.description', { nick: message.sender }),
    confirmText: t('common.delete'),
    destructive: true,
  });
  if (channel && confirmed) {
    await run(() => window.tfaf.chat.delete(channel, message.id));
  }
}

function openPrivate(nick: string): void {
  void run(async () => select(await window.tfaf.chat.openPrivate(nick)));
}

function setRelation(user: ChatUser, relation: 'friend' | 'foe' | null): void {
  const player = user.player;
  if (player) {
    void run(() => window.tfaf.chat.setRelation(player.id, relation));
  }
}

// The game banner and the start window show the rest; a failure is shown above the messages. A game with a password
// asks for it in the app's dialog: for a TFAF lobby the launcher learns from the host whether it has one.
function joinGame(game: LobbyGame): void {
  void run(async () => {
    if ((await window.tfaf.game.join(game.id, null)) === 'passwordRequired') {
      joinPassword.ask(game.id);
    }
  });
}

function inviteToGame(playerId: number): void {
  void run(() => window.tfaf.game.invite(playerId));
}

function watchGame(game: LiveGame): void {
  void run(() => window.tfaf.replays.watchLive(game.id));
}

function invite(playerId: number): void {
  void run(() => window.tfaf.matchmaker.invite(playerId));
}

function openClan(tag: string, target: 'website' | 'leader'): void {
  void run(async () => {
    const clan = await window.tfaf.chat.clan(tag);
    if (!clan) {
      throw new Error(t('chat.clan.notFound', { tag }));
    }
    if (target === 'website') {
      if (!clan.websiteUrl) {
        throw new Error(t('chat.clan.noWebsite', { tag }));
      }
      openExternal(clan.websiteUrl);
    } else {
      if (!clan.leader) {
        throw new Error(t('chat.clan.noLeader', { tag }));
      }
      select(await window.tfaf.chat.openPrivate(clan.leader));
    }
  });
}

function editNote(user: ChatUser): void {
  if (user.player) {
    noteFor.value = { playerId: user.player.id, login: user.nick };
  }
}

function setMuted(nick: string, muted: boolean): void {
  const key = nick.toLowerCase();
  void run(() =>
    updateChatPrefs((current) => ({
      ...current,
      mutedUsers: muted ? [...current.mutedUsers.filter((entry) => entry !== key), key] : current.mutedUsers.filter((entry) => entry !== key),
    })),
  );
}

function join(): void {
  const raw = joinName.value.trim();
  if (!raw) {
    return;
  }
  const name = raw.startsWith('#') ? raw : `#${raw}`;
  void run(async () => {
    await window.tfaf.chat.join(name);
    joinName.value = '';
    select(name);
  });
}

function leave(channel: Pick<ChatChannelInfo, 'name'>): void {
  void run(() => window.tfaf.chat.leave(channel.name));
}

function editTopic(): void {
  topicDraft.value = current.value?.topic ?? '';
  editingTopic.value = true;
}

function saveTopic(): void {
  const channel = selected.value;
  if (!channel) {
    return;
  }
  editingTopic.value = false;
  void run(() => window.tfaf.chat.setTopic(channel, topicDraft.value));
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside class="flex w-56 shrink-0 flex-col border-r max-[60rem]:w-44">
      <div class="flex items-center gap-2 border-b px-4 py-3">
        <span class="size-1.75 rounded-full" :class="STATUS[state.status].dot" />
        <span class="text-xs text-muted-foreground">{{ t(STATUS[state.status].text) }}</span>
        <Button
          v-if="state.status === 'disconnected'"
          variant="ghost"
          size="icon-xs"
          class="ml-auto"
          :data-tooltip="t('chat.reconnect')" :aria-label="t('chat.reconnect')"
          @click="reconnect"
        >
          <RefreshCw />
        </Button>
      </div>
      <nav class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
        <div v-if="clanChannel" class="flex flex-col gap-0.5">
          <span class="px-2 pt-1 pb-1 text-xs text-faint">{{ t('chat.clan.title') }}</span>
          <div
            class="plate cut-sm relative flex h-8 items-center transition-colors [--plate-border:transparent]"
            :class="sameName(clanChannel.name, selected) ? CURRENT_ROW : 'text-muted-foreground hover:bg-secondary hover:text-foreground'"
          >
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 text-left text-sm outline-none focus-visible:underline"
              :class="{
                'font-semibold text-foreground': clanChannel.unread > 0 && !sameName(clanChannel.name, selected),
                'opacity-50': !clanChannel.joined,
              }"
              :data-tooltip="clanChannel.joined ? t('chat.clan.pinned', { channel: clanChannel.name }) : t('chat.channels.joining', { channel: clanChannel.name })"
              @click="select(clanChannel.name)"
            >
              <Shield class="size-3.5 shrink-0" />
              <span class="truncate">{{ clanChannel.name.slice(1) }}</span>
            </button>
            <Badge v-if="clanChannel.mentions" variant="default" class="mr-1 tabular-nums">{{ clanChannel.mentions }}</Badge>
            <Badge v-else-if="clanChannel.unread" variant="muted" class="mr-1 tabular-nums">{{ clanChannel.unread }}</Badge>
          </div>
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="px-2 pt-1 pb-1 text-xs text-faint">{{ t('chat.channels.title') }}</span>
          <div
            v-for="channel in channels"
            :key="channel.name"
            class="group plate cut-sm relative flex h-8 items-center transition-colors [--plate-border:transparent]"
            :class="sameName(channel.name, selected) ? CURRENT_ROW : 'text-muted-foreground hover:bg-secondary hover:text-foreground'"
          >
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 text-left text-sm outline-none focus-visible:underline"
              :class="{ 'font-semibold text-foreground': channel.unread > 0 && !sameName(channel.name, selected), 'opacity-50': !channel.joined }"
              :data-tooltip="channel.joined ? channel.name : t('chat.channels.joining', { channel: channel.name })"
              @click="select(channel.name)"
            >
              <Hash class="size-3.5 shrink-0" />
              <span class="truncate">{{ channel.name.slice(1) }}</span>
            </button>
            <Badge v-if="channel.mentions" variant="default" class="mr-1 tabular-nums">{{ channel.mentions }}</Badge>
            <Badge v-else-if="channel.unread" variant="muted" class="mr-1 tabular-nums">{{ channel.unread }}</Badge>
            <Button
              variant="ghost"
              size="icon-xs"
              class="mr-1 hidden group-hover:inline-flex"
              :data-tooltip="t('chat.channels.leave')" :aria-label="t('chat.channels.leave')"
              @click="leave(channel)"
            >
              <X />
            </Button>
          </div>
          <form class="mt-1 flex items-center gap-1 px-1" @submit.prevent="join">
            <Input
              v-model="joinName"
              :placeholder="t('chat.channels.namePlaceholder')"
              :maxlength="CHAT_LIMITS.channelNameMaxLength"
              class="h-7 text-[13px]"
              :disabled="state.status !== 'connected'"
            />
            <Button type="submit" variant="ghost" size="icon-xs" :data-tooltip="t('chat.channels.join')" :aria-label="t('chat.channels.join')" :disabled="state.status !== 'connected' || !joinName.trim()">
              <Plus />
            </Button>
          </form>
        </div>

        <div v-if="privates.length" class="flex flex-col gap-0.5">
          <span class="px-2 pt-1 pb-1 text-xs text-faint">{{ t('chat.privates.title') }}</span>
          <div
            v-for="channel in privates"
            :key="channel.name"
            class="group plate cut-sm relative flex h-8 items-center transition-colors [--plate-border:transparent]"
            :class="sameName(channel.name, selected) ? CURRENT_ROW : 'hover:bg-secondary'"
          >
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 text-left text-sm outline-none focus-visible:underline"
              :class="{ 'font-semibold': channel.unread > 0 }"
              @click="select(channel.name)"
            >
              <MessageSquare class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="truncate" :style="nickStyle(channel.name)">{{ channel.name }}</span>
            </button>
            <Badge v-if="channel.mentions" variant="default" class="mr-1 tabular-nums">{{ channel.mentions }}</Badge>
            <Button
              variant="ghost"
              size="icon-xs"
              class="mr-1 hidden group-hover:inline-flex"
              :data-tooltip="t('chat.privates.close')" :aria-label="t('chat.privates.close')"
              @click="leave(channel)"
            >
              <X />
            </Button>
          </div>
        </div>
      </nav>
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      <template v-if="current">
        <header class="flex items-start gap-3 border-b px-5 py-3">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 class="flex items-baseline gap-2 text-lg">
              <span v-if="current.kind === 'private'" :style="nickStyle(current.name)">{{ current.name }}</span>
              <span v-else>{{ current.name }}</span>
              <span v-if="current.kind === 'channel' && current.userCount" class="text-sm font-normal text-muted-foreground tabular-nums">
                {{ current.userCount }}
              </span>
            </h1>
            <form v-if="editingTopic" class="flex items-center gap-2" @submit.prevent="saveTopic">
              <Input
                v-model="topicDraft"
                class="h-7 text-[13px]"
                :maxlength="CHAT_LIMITS.topicMaxLength"
                :placeholder="t('chat.topic.placeholder')"
                autofocus
                @keydown.esc.stop="editingTopic = false"
              />
              <Button type="submit" size="sm">{{ t('common.save') }}</Button>
              <Button type="button" variant="ghost" size="sm" @click="editingTopic = false">{{ t('common.cancel') }}</Button>
            </form>
            <p
              v-else-if="current.kind === 'channel'"
              class="line-clamp-2 text-[13px] wrap-anywhere text-muted-foreground selectable"
              :data-tooltip="current.topic ?? undefined"
            >
              <template v-if="current.topic">
                <template v-for="(token, index) in topicTokens" :key="index">
                  <a
                    v-if="token.kind === 'link' && token.https"
                    :href="token.url"
                    class="text-info hover:underline"
                    @click.prevent="openExternal(token.url)"
                  >{{ token.url }}</a>
                  <template v-else-if="token.kind === 'link'">{{ token.url }}</template>
                  <img
                    v-else-if="token.kind === 'emoticon'"
                    :src="token.src"
                    :alt="token.shortcode"
                    class="inline size-4 align-text-bottom"
                    draggable="false"
                  />
                  <template v-else>{{ token.text }}</template>
                </template>
              </template>
              <template v-else>{{ t('chat.topic.none') }}</template>
            </p>
            <p v-else class="text-[13px] text-muted-foreground">{{ t('chat.privates.conversation') }}</p>
          </div>
          <Button v-if="current.moderator && !editingTopic" variant="ghost" size="icon-sm" :data-tooltip="t('chat.topic.edit')" :aria-label="t('chat.topic.edit')" @click="editTopic">
            <Pencil />
          </Button>
          <Button
            :variant="showUsers ? 'secondary' : 'ghost'"
            size="icon-sm"
            :data-tooltip="
              current.kind === 'channel'
                ? showUsers ? t('chat.hideUsers') : t('chat.showUsers')
                : showUsers ? t('chat.hideSummary') : t('chat.showSummary')
            " :aria-label="
              current.kind === 'channel'
                ? showUsers ? t('chat.hideUsers') : t('chat.showUsers')
                : showUsers ? t('chat.hideSummary') : t('chat.showSummary')
            "
            @click="showUsers = !showUsers"
          >
            <Users />
          </Button>
        </header>

        <div v-if="error" class="flex items-center gap-2 border-b bg-destructive/10 px-5 py-2 text-sm text-destructive">
          <span class="min-w-0 flex-1">{{ error }}</span>
          <Button variant="ghost" size="icon-xs" :data-tooltip="t('chat.hideError')" :aria-label="t('chat.hideError')" @click="error = null"><X /></Button>
        </div>
        <div v-if="state.status !== 'connected'" class="flex items-center gap-2 border-b bg-warning/10 px-5 py-2 text-sm text-warning">
          <Spinner v-if="state.status === 'connecting'" />
          <span class="min-w-0 flex-1">
            {{ state.status === 'connecting' ? t('chat.connecting') : (state.error ?? t('chat.noConnection')) }}
          </span>
        </div>

        <ChatMessageList
          :messages="messages"
          :users="users"
          :nick="state.nick"
          :moderator="current.moderator"
          @reply="reply"
          @react="react"
          @delete="remove"
          @mention="mention"
        />

        <div class="h-5 shrink-0 truncate px-5 text-xs text-muted-foreground">{{ typingText }}</div>
        <div class="flex flex-col gap-1.5 px-5 pb-4">
          <div v-if="replyTo" class="flex items-center gap-2 bg-card py-1.5 pr-1 pl-3 text-xs shadow-[inset_2px_0_0_var(--color-primary)]">
            <span class="shrink-0 text-muted-foreground">{{ t('chat.composer.replyingTo') }}</span>
            <span class="shrink-0 font-semibold" :style="nickStyle(replyTo.sender)">{{ replyTo.sender }}</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ replyTo.text }}</span>
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
          <div
            class="plate plate-focus-within cut-sm flex items-center gap-1 bg-background pr-1 transition-colors"
            :class="tooLong ? '[--plate-border:var(--color-destructive)]!' : 'hover:[--plate-border:var(--color-input)]'"
          >
            <input
              ref="composer"
              v-model="draft"
              class="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-faint"
              :placeholder="
                current.kind === 'private'
                  ? t('chat.composer.toPrivate', { nick: current.name })
                  : t('chat.composer.toChannel', { channel: current.name })
              "
              :disabled="state.status !== 'connected'"
              spellcheck="true"
              @input="onInput"
              @keydown="onKeydown"
            />
            <span v-if="bytes > CHAT_LIMITS.messageMaxBytes * 0.8" class="text-xs tabular-nums" :class="tooLong ? 'text-destructive' : 'text-muted-foreground'">
              {{ bytes }}/{{ CHAT_LIMITS.messageMaxBytes }}
            </span>
            <Popover v-model:open="pickerOpen">
              <PopoverTrigger as-child>
                <Button variant="ghost" size="icon-sm" :data-tooltip="t('chat.composer.emoticons')" :aria-label="t('chat.composer.emoticons')" :disabled="state.status !== 'connected'"><SmilePlus /></Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-2" align="end" side="top">
                <EmoticonPicker @pick="pickEmoticon" />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon-sm" :data-tooltip="t('chat.composer.send')" :aria-label="t('chat.composer.send')" :disabled="!canSend" @click="send"><Send /></Button>
          </div>
          <p class="text-[11px] text-faint">
            {{ t('chat.composer.hint') }}
          </p>
        </div>
      </template>

      <Empty v-else class="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner v-if="state.status === 'connecting'" />
            <MessagesSquare v-else />
          </EmptyMedia>
          <EmptyTitle>
            {{
              state.status === 'connecting'
                ? t('chat.connecting')
                : state.status === 'connected'
                  ? t('chat.empty.noChannels')
                  : t('chat.empty.notConnected')
            }}
          </EmptyTitle>
          <EmptyDescription>
            {{
              state.status === 'connected'
                ? t('chat.empty.joinHint')
                : state.status === 'disconnected'
                  ? (state.error ?? t('chat.empty.noConnection'))
                  : t('chat.empty.signingIn')
            }}
          </EmptyDescription>
          <Button v-if="state.status === 'disconnected'" variant="outline" class="mt-2" @click="reconnect">
            <RefreshCw />{{ t('chat.reconnect') }}
          </Button>
        </EmptyHeader>
      </Empty>
    </section>

    <aside v-if="current?.kind === 'private' && showUsers" class="flex w-60 shrink-0 flex-col border-l max-[60rem]:w-52">
      <PrivateChatSummary :login="current.name" />
    </aside>
    <aside v-if="current?.kind === 'channel' && showUsers" class="flex w-60 shrink-0 flex-col border-l max-[60rem]:w-52">
      <ChatUserList
        :users="users"
        :games="playerGames"
        :channel="current.name"
        @message="openPrivate"
        @mention="mention"
        @relation="setRelation"
        @join="joinGame"
        @show="(game) => gameFocus.focus(game.id)"
        @watch="watchGame"
        @invite="invite"
        @invite-to-game="inviteToGame"
        @replays="replayFocus.focusPlayer"
        @clan="openClan"
        @note="editNote"
        @color="(nick) => (colorFor = nick)"
        @mute="setMuted"
      />
    </aside>

    <PlayerNoteDialog v-if="noteFor" :player-id="noteFor.playerId" :login="noteFor.login" @close="noteFor = null" />
    <NickColorDialog v-if="colorFor" :nick="colorFor" @close="colorFor = null" />
  </div>
</template>
