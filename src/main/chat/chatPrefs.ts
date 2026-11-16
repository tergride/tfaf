// The chat's settings: their defaults, reading them from settings.json or the renderer, and which channels to join
// on connect.

import {
  CHAT_COLOR_MODES,
  CHAT_MESSAGE_LIMITS,
  CHAT_TEXT_SCALES,
  CHAT_USER_GROUPS,
  type ChatAutoJoin,
  type ChatPrefs,
  type ChatUserGroup,
} from '../../shared/contract.ts';
import { TFAF_CHANNEL } from './tfafPresence.ts';

/** The official client's default channel, and the channel of the Russian-speaking community TFAF is made for. */
export const DEFAULT_AUTO_JOIN_CHANNELS: readonly string[] = ['#aeolus', '#russian'];
export const NEWBIE_CHANNEL = '#newbie';
export const MAX_AUTO_JOIN_CHANNELS = 50;
const MAX_MUTED = 500;
const MAX_USER_COLORS = 500;
const CHANNEL_NAME = /^#[^\s,\x00-\x1f]{1,49}$/;
const LOGIN = /^[^\s,#&:\x00-\x1f!@]{1,50}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function defaultChatPrefs(): ChatPrefs {
  return {
    hideFoeMessages: true,
    mutedUsers: [],
    colorMode: 'random',
    groupColors: {},
    userColors: {},
    autoJoin: { enabled: true, channels: [...DEFAULT_AUTO_JOIN_CHANNELS], lobbyChannels: true, newbie: true },
    textScale: 100,
    messageLimit: 500,
    showGameMap: false,
  };
}

export function isChannelName(value: unknown): value is string {
  return typeof value === 'string' && CHANNEL_NAME.test(value);
}

/** The channel of the player's clan, `#<tag>_clan` as the FAF server names it; null without a clan. */
export function clanChannel(clanTag: string | null | undefined): string | null {
  const name = clanTag ? `#${clanTag}_clan` : null;
  return isChannelName(name) ? name : null;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function channelList(value: unknown): string[] {
  const channels = (Array.isArray(value) ? value : []).filter(isChannelName);
  return uniqueBy(channels, (channel) => channel.toLowerCase()).slice(0, MAX_AUTO_JOIN_CHANNELS);
}

function loginList(value: unknown): string[] {
  const logins = (Array.isArray(value) ? value : [])
    .filter((login): login is string => typeof login === 'string' && LOGIN.test(login))
    .map((login) => login.toLowerCase());
  return [...new Set(logins)].slice(0, MAX_MUTED);
}

function groupColors(value: unknown): Partial<Record<ChatUserGroup, string>> {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    CHAT_USER_GROUPS.flatMap((group) => {
      const color = raw[group];
      return typeof color === 'string' && HEX_COLOR.test(color) ? [[group, color.toLowerCase()]] : [];
    }),
  );
}

function userColors(value: unknown): Record<string, string> {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => LOGIN.test(entry[0]) && typeof entry[1] === 'string' && HEX_COLOR.test(entry[1]),
  );
  return Object.fromEntries(entries.slice(0, MAX_USER_COLORS).map(([login, color]) => [login.toLowerCase(), color.toLowerCase()]));
}

/**
 * Chat settings from settings.json or the renderer, cut down to what is valid, with defaults for the rest. Settings
 * written before the chat had its own object kept the channels the user joined in `chatChannels`; they move into the
 * auto-join list once.
 */
export function mergeChatPrefs(stored: unknown, legacyChannels: unknown): ChatPrefs {
  const defaults = defaultChatPrefs();
  if (typeof stored !== 'object' || stored === null) {
    const legacy: unknown[] = Array.isArray(legacyChannels) ? legacyChannels : [];
    return { ...defaults, autoJoin: { ...defaults.autoJoin, channels: channelList([...defaults.autoJoin.channels, ...legacy]) } };
  }
  const raw = stored as Record<string, unknown>;
  const autoJoin = typeof raw.autoJoin === 'object' && raw.autoJoin !== null ? (raw.autoJoin as Record<string, unknown>) : {};
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  return {
    hideFoeMessages: flag(raw.hideFoeMessages, defaults.hideFoeMessages),
    mutedUsers: loginList(raw.mutedUsers),
    colorMode: CHAT_COLOR_MODES.find((mode) => mode === raw.colorMode) ?? defaults.colorMode,
    groupColors: groupColors(raw.groupColors),
    userColors: userColors(raw.userColors),
    autoJoin: {
      enabled: flag(autoJoin.enabled, defaults.autoJoin.enabled),
      channels: Array.isArray(autoJoin.channels) ? channelList(autoJoin.channels) : defaults.autoJoin.channels,
      lobbyChannels: flag(autoJoin.lobbyChannels, defaults.autoJoin.lobbyChannels),
      newbie: flag(autoJoin.newbie, defaults.autoJoin.newbie),
    },
    textScale: typeof raw.textScale === 'number' && CHAT_TEXT_SCALES.includes(raw.textScale) ? raw.textScale : defaults.textScale,
    messageLimit:
      typeof raw.messageLimit === 'number' && CHAT_MESSAGE_LIMITS.includes(raw.messageLimit) ? raw.messageLimit : defaults.messageLimit,
    showGameMap: flag(raw.showGameMap, defaults.showGameMap),
  };
}

/**
 * The channels to be in after connecting, in order: TFAF's own and the clan's whatever the settings say, the auto-join
 * list, the lobby's channels and #newbie as the settings allow, the party's channel and whatever is open already
 * (joined by hand, or before a reconnect).
 */
export function wantedChannels(
  autoJoin: ChatAutoJoin,
  context: {
    clanChannel: string | null;
    lobbyChannels: readonly string[];
    newbie: boolean;
    partyChannel: string | null;
    open: readonly string[];
  },
): string[] {
  const wanted = [
    TFAF_CHANNEL,
    ...(context.clanChannel ? [context.clanChannel] : []),
    ...(autoJoin.enabled ? autoJoin.channels : []),
    ...(autoJoin.enabled && autoJoin.lobbyChannels ? context.lobbyChannels : []),
    ...(autoJoin.enabled && autoJoin.newbie && context.newbie ? [NEWBIE_CHANNEL] : []),
    ...(context.partyChannel ? [context.partyChannel] : []),
    ...context.open,
  ];
  return uniqueBy(wanted.filter(isChannelName), (channel) => channel.toLowerCase());
}
