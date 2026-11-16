// The color of a nick in the chat, by the chat settings: the user's own pick for that player, then the color mode.
import type { ChatPrefs, ChatUser, ChatUserGroup } from '../../../shared/contract.ts';

/** The colors of the `groups` mode until the user picks their own; null keeps the text color. */
export const DEFAULT_GROUP_COLORS: Record<ChatUserGroup, string | null> = {
  self: '#5ec8f0',
  moderators: '#f0b75e',
  friends: '#6fd08c',
  players: null,
  foes: '#e06666',
  chat: '#9aa5b1',
  away: '#7c8794',
};

/** The swatches of the color picker, all readable on the dark theme. */
export const NICK_SWATCHES: readonly string[] = [
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#4ade80',
  '#2dd4bf',
  '#22d3ee',
  '#60a5fa',
  '#818cf8',
  '#c084fc',
  '#f472b6',
  '#e5e7eb',
];

/** A steady color per nick, readable on the dark theme (the official client's "random" color mode). */
export function nickColor(nick: string): string {
  let hash = 0;
  for (const char of nick.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 65% 68%)`;
}

/** The group of the user list a user falls in; the order of the checks follows the official client. */
export function chatUserGroup(user: ChatUser): ChatUserGroup {
  if (user.relation === 'self') {
    return 'self';
  }
  if (user.away) {
    return 'away';
  }
  if (user.moderator) {
    return 'moderators';
  }
  if (user.relation === 'friend') {
    return 'friends';
  }
  if (user.relation === 'foe') {
    return 'foes';
  }
  return user.player ? 'players' : 'chat';
}

/** Null keeps the text color. A nick not in the user list has no group, so the `groups` mode leaves it plain. */
export function nickColorFor(
  nick: string,
  group: ChatUserGroup | null,
  prefs: Pick<ChatPrefs, 'colorMode' | 'groupColors' | 'userColors'>,
): string | null {
  const own = prefs.userColors[nick.toLowerCase()];
  if (own) {
    return own;
  }
  switch (prefs.colorMode) {
    case 'random':
      return nickColor(nick);
    case 'groups':
      return group ? (prefs.groupColors[group] ?? DEFAULT_GROUP_COLORS[group]) : null;
    default:
      return null;
  }
}
