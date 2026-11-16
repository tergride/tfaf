import type { PlayerAvatar } from './profile.ts';

/** `default`: the text color; `random`: a steady color per nick; `groups`: a color per group of the user list. */
export const CHAT_COLOR_MODES = ['default', 'random', 'groups'] as const;
export type ChatColorMode = (typeof CHAT_COLOR_MODES)[number];

/** The groups of the chat's user list, in their order (ChatUserCategory of the official client). */
export const CHAT_USER_GROUPS = ['self', 'moderators', 'friends', 'players', 'foes', 'chat', 'away'] as const;
export type ChatUserGroup = (typeof CHAT_USER_GROUPS)[number];

export const CHAT_TEXT_SCALES: readonly number[] = [85, 100, 115, 130, 150];
export const CHAT_MESSAGE_LIMITS: readonly number[] = [100, 250, 500, 1000, 2000];

export interface ChatAutoJoin {
  /** Off: only private conversations, the party channel and channels joined by hand this session. */
  enabled: boolean;
  /** Joined on every connect; joining a channel by hand adds it, leaving removes it. */
  channels: string[];
  /** The channels the lobby names: the clan's, and the moderators' for moderators. */
  lobbyChannels: boolean;
  /** `#newbie` while the player has played fewer than 50 games, as the official client does. */
  newbie: boolean;
}

export interface ChatPrefs {
  /** Messages of foes never reach the chat, private ones included; on by default as in the official client. */
  hideFoeMessages: boolean;
  /** Logins in lower case whose messages are hidden, kept on this computer only. */
  mutedUsers: string[];
  colorMode: ChatColorMode;
  /** `#rrggbb` per group, for the `groups` mode. */
  groupColors: Partial<Record<ChatUserGroup, string>>;
  /** `#rrggbb` per login in lower case; wins over the mode. */
  userColors: Record<string, string>;
  autoJoin: ChatAutoJoin;
  /** Size of the messages in percent; one of CHAT_TEXT_SCALES. */
  textScale: number;
  /** Messages kept per channel; one of CHAT_MESSAGE_LIMITS. */
  messageLimit: number;
  /** The map of a player's game shown at their nick in the user list. */
  showGameMap: boolean;
}

export type ChatStatus = 'disconnected' | 'connecting' | 'connected';

/** A channel or a private conversation, without its messages and users. */
export interface ChatChannelInfo {
  /** `#aeolus`, or the other player's nick for a private conversation. */
  name: string;
  kind: 'channel' | 'private';
  joined: boolean;
  topic: string | null;
  unread: number;
  /** Unread messages that mention us, and every unread private message. */
  mentions: number;
  userCount: number;
  /** Nicks of those typing right now. */
  typing: string[];
  /** We may change the topic and remove other people's messages. */
  moderator: boolean;
}

export interface ChatState {
  status: ChatStatus;
  error: string | null;
  nick: string | null;
  channels: ChatChannelInfo[];
  /** The channel of the player's clan: joined whatever the settings say, shown apart and never left; null without one. */
  clanChannel: string | null;
  /** Players whose launcher is TFAF, as far as the chat can tell: login in lower case → TFAF version. */
  tfafPlayers: Record<string, string>;
}

export interface ChatReaction {
  /** Shortcode of an emoticon of the official client's set, e.g. `:+1:`. */
  shortcode: string;
  users: string[];
  mine: boolean;
}

export interface ChatMessage {
  id: string;
  time: string;
  sender: string;
  text: string;
  /** `system`: a line from the launcher itself, such as "the player is offline". */
  kind: 'message' | 'action' | 'notice' | 'system';
  /** Sent by us and not yet confirmed by the server. */
  pending: boolean;
  own: boolean;
  mention: boolean;
  /** `sender` and `text` are null when the message replied to is older than the kept history. */
  replyTo: { id: string; sender: string | null; text: string | null } | null;
  reactions: ChatReaction[];
}

export type ChatRelation = 'self' | 'friend' | 'foe';

export interface ChatUser {
  nick: string;
  moderator: boolean;
  away: boolean;
  relation: ChatRelation | null;
  /** The lobby's view of the player; null for those in the chat only. */
  player: { id: number; clan: string | null; country: string | null; rating: number | null; avatar: PlayerAvatar | null } | null;
}

/** Messages and users of the open channel; an update carries only what changed. */
export interface ChatChannelData {
  name: string;
  messages?: ChatMessage[];
  users?: ChatUser[];
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** The page's picture or the linked image itself, as a data URL. */
  imageDataUrl: string | null;
}

export const CHAT_LIMITS = {
  /** IRC lines are limited to 512 bytes; this leaves room for the command, the target and the tags. */
  messageMaxBytes: 400,
  topicMaxLength: 300,
  channelNameMaxLength: 50,
  nickMaxLength: 50,
} as const;
