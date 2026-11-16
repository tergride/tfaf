import { computed, shallowRef } from 'vue';
import type { ChatPrefs } from '../../../shared/contract.ts';

// Until the settings answer, the chat looks as it did before it had settings.
const prefs = shallowRef<ChatPrefs>({
  hideFoeMessages: true,
  mutedUsers: [],
  colorMode: 'random',
  groupColors: {},
  userColors: {},
  autoJoin: { enabled: true, channels: [], lobbyChannels: true, newbie: true },
  textScale: 100,
  messageLimit: 500,
  showGameMap: false,
});

/** Applies the chat settings saved in the settings. */
export function setChatPrefs(next: ChatPrefs): void {
  prefs.value = next;
}

/**
 * Saves a change made outside the settings screen, such as muting a player from the chat. The change applies to the
 * stored settings, since the main process updates the auto-join list itself when channels are joined or left.
 */
async function updateChatPrefs(change: (current: ChatPrefs) => ChatPrefs): Promise<void> {
  const stored = await window.tfaf.settings.get();
  const settings = await window.tfaf.settings.update({ chat: change(stored.chat) });
  prefs.value = settings.chat;
}

export function useChatPrefs() {
  return { prefs: computed(() => prefs.value), updateChatPrefs };
}
