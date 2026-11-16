<script setup lang="ts">
import { Copy, Eye, Reply, SmilePlus, Trash2 } from '@lucide/vue';
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import type { ChatMessage, ChatUser, LinkPreview } from '../../../shared/contract.ts';
import { useChatPrefs } from '../composables/useChatPrefs.ts';
import { errorMessage, formatDayMonth, formatTime } from '../format.ts';
import { emoticonSrc, tokenize } from '../lib/chatText.ts';
import { t } from '../lib/i18n.ts';
import { openExternal } from '../lib/links.ts';
import { animationsEnabled } from '../lib/motion.ts';
import { chatUserGroup, nickColorFor } from '../lib/nickColors.ts';
import EmoticonPicker from './EmoticonPicker.vue';
import TfafBadge from './TfafBadge.vue';

const props = defineProps<{
  messages: ChatMessage[];
  users: ChatUser[];
  nick: string | null;
  /** We may remove other people's messages. */
  moderator: boolean;
}>();
const emit = defineEmits<{
  reply: [message: ChatMessage];
  react: [message: ChatMessage, shortcode: string];
  delete: [message: ChatMessage];
  mention: [nick: string];
}>();

// Messages of one sender within this time share a header, as in the official client.
const GROUP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 120;

const list = useTemplateRef<HTMLElement>('list');
const reacting = ref<string | null>(null);
const highlighted = ref<string | null>(null);
const previews = reactive(new Map<string, { loading: boolean; data: LinkPreview | null; error: string | null }>());

const { prefs } = useChatPrefs();

const usersByNick = computed(() => new Map(props.users.map((user) => [user.nick.toLowerCase(), user])));

function colorOf(nick: string): Record<string, string> | undefined {
  const user = usersByNick.value.get(nick.toLowerCase());
  const color = nickColorFor(nick, user ? chatUserGroup(user) : null, prefs.value);
  return color ? { color } : undefined;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return t('chat.messages.today');
  }
  return date.toDateString() === yesterday.toDateString() ? t('chat.messages.yesterday') : formatDayMonth(date);
}

const rows = computed(() =>
  props.messages.map((message, index) => {
    const previous = props.messages[index - 1];
    const at = Date.parse(message.time);
    const newDay = !previous || new Date(previous.time).toDateString() !== new Date(message.time).toDateString();
    const grouped =
      !newDay &&
      previous !== undefined &&
      previous.sender === message.sender &&
      previous.kind === 'message' &&
      message.kind === 'message' &&
      at - Date.parse(previous.time) < GROUP_MS &&
      message.replyTo === null;
    return { message, grouped, day: newDay ? dayLabel(new Date(message.time)) : null, tokens: tokenize(message.text, props.nick) };
  }),
);

function isNearBottom(): boolean {
  const element = list.value;
  return !element || element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
}

function scrollToBottom(): void {
  void nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }));
}

// New messages keep the list at the bottom unless the user scrolled up to read; our own always do.
watch(
  () => props.messages,
  (next, previous) => {
    const own = next.at(-1)?.own && next.at(-1)?.id !== previous?.at(-1)?.id;
    if (own || isNearBottom() || (previous?.length ?? 0) === 0) {
      scrollToBottom();
    }
  },
);

function showReplied(id: string): void {
  const element = list.value?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  if (element) {
    element.scrollIntoView({ block: 'center', behavior: animationsEnabled() ? 'smooth' : 'instant' });
    highlighted.value = id;
    setTimeout(() => {
      if (highlighted.value === id) {
        highlighted.value = null;
      }
    }, 1500);
  }
}

async function togglePreview(messageId: string, url: string): Promise<void> {
  const key = `${messageId}|${url}`;
  if (previews.has(key)) {
    previews.delete(key);
    return;
  }
  previews.set(key, { loading: true, data: null, error: null });
  try {
    const data = await window.tfaf.chat.previewLink(url);
    previews.set(key, { loading: false, data, error: null });
  } catch (cause) {
    previews.set(key, { loading: false, data: null, error: errorMessage(cause) });
  }
}

function previewsOf(message: ChatMessage): [string, { loading: boolean; data: LinkPreview | null; error: string | null }][] {
  return [...previews].filter(([key]) => key.startsWith(`${message.id}|`));
}

function pickReaction(message: ChatMessage, shortcode: string): void {
  reacting.value = null;
  emit('react', message, shortcode);
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

defineExpose({ scrollToBottom });
</script>

<template>
  <div ref="list" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
    <div class="mt-auto" />
    <!-- The text size of the chat settings scales the messages with their emoticons and previews. -->
    <div class="flex flex-col" :style="prefs.textScale === 100 ? undefined : { zoom: prefs.textScale / 100 }">
      <template v-for="row in rows" :key="row.message.id">
        <div v-if="row.day" class="my-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span class="h-px flex-1 bg-border" />
          {{ row.day }}
          <span class="h-px flex-1 bg-border" />
        </div>
        <div
          v-if="row.message.kind === 'system'"
          class="py-1 text-center text-xs text-muted-foreground italic selectable"
          :data-message-id="row.message.id"
        >
          {{ row.message.text }}
        </div>
        <div
          v-else
          class="group relative -mx-2 flex gap-3 px-2 transition-colors hover:bg-card/70"
          :class="[
            row.grouped ? 'py-0.5' : 'mt-2 py-1',
            {
              'bg-primary/8 shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-primary/12': row.message.mention,
              'bg-info/12': highlighted === row.message.id,
            },
          ]"
          :data-message-id="row.message.id"
        >
          <span class="min-w-11 shrink-0 pt-0.5 text-right text-[11px] text-muted-foreground/70 tabular-nums" :class="{ 'opacity-0 group-hover:opacity-100': row.grouped }">
            {{ formatTime(row.message.time) }}
          </span>
          <div class="min-w-0 flex-1">
            <button
              v-if="row.message.replyTo"
              type="button"
              class="mb-0.5 flex max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground hover:text-foreground"
              @click="showReplied(row.message.replyTo.id)"
            >
              <Reply class="size-3 shrink-0 -scale-x-100" />
              <span class="font-semibold" :style="row.message.replyTo.sender ? colorOf(row.message.replyTo.sender) : undefined">
                {{ row.message.replyTo.sender ?? t('chat.messages.unknownReplySender') }}
              </span>
              <span class="truncate">{{ row.message.replyTo.text ?? t('chat.messages.unknownReplyText') }}</span>
            </button>
            <div
              class="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap selectable"
              :class="{ 'opacity-60': row.message.pending, 'text-muted-foreground': row.message.kind === 'notice' }"
            >
              <template v-if="!row.grouped || row.message.kind === 'action'">
                <span v-if="row.message.kind === 'action'" class="mr-1 text-muted-foreground">*</span>
                <span
                  v-if="usersByNick.get(row.message.sender.toLowerCase())?.player?.clan"
                  class="mr-1 text-primary"
                >[{{ usersByNick.get(row.message.sender.toLowerCase())?.player?.clan }}]</span>
                <button
                  type="button"
                  class="mr-1.5 font-semibold hover:underline"
                  :style="colorOf(row.message.sender)"
                  :data-tooltip="t('chat.messages.mention')"
                  @click="emit('mention', row.message.sender)"
                >
                  {{ row.message.sender }}
                </button>
                <TfafBadge :login="row.message.sender" class="mr-1.5 inline-block align-text-bottom" />
              </template>
              <template v-for="(token, index) in row.tokens" :key="index">
                <template v-if="token.kind === 'text'">{{ token.text }}</template>
                <span v-else-if="token.kind === 'mention'" class="bg-primary/20 px-0.5 font-medium text-primary">{{ token.text }}</span>
                <img
                  v-else-if="token.kind === 'emoticon'"
                  :src="token.src"
                  :alt="token.shortcode"
                  :data-tooltip="token.shortcode"
                  class="mx-0.5 inline size-5 align-text-bottom"
                  draggable="false"
                />
                <span v-else-if="token.https" class="inline-flex items-baseline gap-0.5">
                  <a
                    :href="token.url"
                    class="text-info underline-offset-2 hover:underline"
                    @click.prevent="openExternal(token.url)"
                  >{{ token.url }}</a>
                  <button
                    type="button"
                    class="relative top-0.5 p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    :data-tooltip="t('chat.messages.preview')" :aria-label="t('chat.messages.preview')"
                    @click="togglePreview(row.message.id, token.url)"
                  >
                    <Eye class="size-3.5" />
                  </button>
                </span>
                <template v-else>{{ token.url }}</template>
              </template>
            </div>

            <div v-for="[key, preview] in previewsOf(row.message)" :key="key" class="plate cut-sm mt-1.5 max-w-md bg-card p-2.5 text-xs">
              <div v-if="preview.loading" class="flex items-center gap-2 text-muted-foreground"><Spinner />{{ t('chat.messages.loadingPreview') }}</div>
              <div v-else-if="preview.error" class="text-destructive">{{ preview.error }}</div>
              <div v-else-if="preview.data" class="flex flex-col gap-1.5">
                <img v-if="preview.data.imageDataUrl" :src="preview.data.imageDataUrl" alt="" class="max-h-56 object-contain" draggable="false" />
                <div v-if="preview.data.siteName" class="text-muted-foreground">{{ preview.data.siteName }}</div>
                <div v-if="preview.data.title" class="font-semibold">{{ preview.data.title }}</div>
                <div v-if="preview.data.description" class="text-muted-foreground">{{ preview.data.description }}</div>
              </div>
            </div>

            <div v-if="row.message.reactions.length" class="mt-1 flex flex-wrap gap-1">
              <button
                v-for="reaction in row.message.reactions"
                :key="reaction.shortcode"
                type="button"
                class="plate plate-control plate-focus cut-xs flex h-6 items-center gap-1 px-1.5 text-xs tabular-nums transition-colors"
                :class="
                  reaction.mine
                    ? 'bg-primary/12 text-primary [--plate-border:color-mix(in_srgb,var(--color-primary)_60%,transparent)]'
                    : 'bg-secondary hover:bg-accent'
                "
                :aria-pressed="reaction.mine"
                :data-tooltip="reaction.users.join(', ')"
                @click="emit('react', row.message, reaction.shortcode)"
              >
                <img v-if="emoticonSrc(reaction.shortcode)" :src="emoticonSrc(reaction.shortcode)!" alt="" class="size-4" draggable="false" />
                <span v-else>{{ reaction.shortcode }}</span>
                {{ reaction.users.length }}
              </button>
            </div>
          </div>

          <div
            v-if="!row.message.pending"
            class="plate cut-xs absolute -top-3 right-2 items-center bg-popover p-px [--plate-border:var(--color-input)]"
            :class="reacting === row.message.id ? 'flex' : 'hidden group-hover:flex'"
          >
            <Button variant="ghost" size="icon-xs" :data-tooltip="t('chat.messages.reply')" :aria-label="t('chat.messages.reply')" @click="emit('reply', row.message)"><Reply /></Button>
            <Popover :open="reacting === row.message.id" @update:open="(open) => (reacting = open ? row.message.id : null)">
              <PopoverTrigger as-child>
                <Button variant="ghost" size="icon-xs" :data-tooltip="t('chat.messages.react')" :aria-label="t('chat.messages.react')"><SmilePlus /></Button>
              </PopoverTrigger>
              <PopoverContent class="w-auto p-2" align="end">
                <EmoticonPicker @pick="(shortcode) => pickReaction(row.message, shortcode)" />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon-xs" :data-tooltip="t('chat.messages.copyText')" :aria-label="t('chat.messages.copyText')" @click="copy(row.message.text)"><Copy /></Button>
            <Button
              v-if="row.message.own || moderator"
              variant="ghost"
              size="icon-xs"
              class="text-destructive hover:text-destructive"
              :data-tooltip="t('chat.messages.delete')" :aria-label="t('chat.messages.delete')"
              @click="emit('delete', row.message)"
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
