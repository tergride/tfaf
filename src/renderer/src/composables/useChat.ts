import { computed, readonly, ref, shallowRef } from 'vue';
import type { ChatMessage, ChatState, ChatUser } from '../../../shared/contract.ts';

const state = ref<ChatState>({ status: 'disconnected', error: null, nick: null, channels: [], clanChannel: null, tfafPlayers: {} });
// The channel the chat shows; its messages and users come from the main process as they change.
const selected = ref<string | null>(null);
const messages = shallowRef<ChatMessage[]>([]);
const users = shallowRef<ChatUser[]>([]);
// A clicked notification asks to show a channel; the app switches to the chat, the chat to the channel.
const focusRequest = ref<{ channel: string; at: number } | null>(null);
let visible = false;
let initialized = false;

const sameName = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

async function sync(): Promise<void> {
  const name = visible ? selected.value : null;
  const data = await window.tfaf.chat.open(name);
  if (sameName(data?.name ?? null, selected.value)) {
    messages.value = data?.messages ?? [];
    users.value = data?.users ?? [];
  }
}

export function useChat() {
  if (!initialized) {
    initialized = true;
    let receivedState = false;
    window.tfaf.chat.onStateChanged((next) => {
      receivedState = true;
      const had = state.value.channels.some((channel) => sameName(channel.name, selected.value));
      const has = next.channels.some((channel) => sameName(channel.name, selected.value));
      state.value = next;
      // A channel that is gone (left, closed, or not joined after a reconnect yet) leaves the view empty;
      // one that appears after it was chosen (a join just sent) is opened now.
      if (selected.value && !has) {
        messages.value = [];
        users.value = [];
      } else if (selected.value && has && !had) {
        void sync();
      }
    });
    window.tfaf.chat.onChannelChanged((data) => {
      if (!sameName(data.name, selected.value)) {
        return;
      }
      if (data.messages) {
        messages.value = data.messages;
      }
      if (data.users) {
        users.value = data.users;
      }
    });
    window.tfaf.chat.onFocusRequested((channel) => {
      focusRequest.value = { channel, at: Date.now() };
    });
    void window.tfaf.chat.getState().then((initial) => {
      if (!receivedState) {
        state.value = initial;
      }
    });
  }

  return {
    state: readonly(state),
    selected: readonly(selected),
    messages,
    users,
    focusRequest: readonly(focusRequest),
    /** Mentions and private messages not yet read, for the navigation badge. */
    attention: computed(() => state.value.channels.reduce((sum, channel) => sum + channel.mentions, 0)),
    select: (name: string | null): Promise<void> => {
      if (!sameName(name, selected.value)) {
        messages.value = [];
        users.value = [];
      }
      selected.value = name;
      return sync();
    },
    /** Whether the chat is on screen: only then do the messages of the selected channel count as read. */
    setVisible: (value: boolean): Promise<void> => {
      visible = value;
      return sync();
    },
    refresh: sync,
    /** Shows a channel from elsewhere in the app, the way a notification click does. */
    focus: (channel: string): void => {
      focusRequest.value = { channel, at: Date.now() };
    },
  };
}
