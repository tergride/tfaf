// One channel or private conversation as ChatModel keeps it, and its messages as the renderer gets them.

import type { ChatMessage, ChatReaction } from '../../shared/contract.ts';

export interface UserRecord {
  nick: string;
  prefixes: string;
  away: boolean;
}

export interface MessageRecord {
  id: string;
  time: number;
  sender: string;
  text: string;
  kind: ChatMessage['kind'];
  replyTo: string | null;
  mention: boolean;
  /** Set until the server echoes the message back with its id. */
  pendingLabel: string | null;
}

export interface ReactionRecord {
  shortcode: string;
  nick: string;
  target: string;
}

export interface ChannelRecord {
  name: string;
  kind: 'channel' | 'private';
  joined: boolean;
  topic: string | null;
  users: Map<string, UserRecord>;
  messages: MessageRecord[];
  /** Reactions by the id of the tag message that carried them, which is also what removing one refers to. */
  reactions: Map<string, ReactionRecord>;
  typing: Map<string, { nick: string; until: number }>;
  unread: number;
  mentions: number;
}

export function createChannel(name: string, kind: ChannelRecord['kind']): ChannelRecord {
  return {
    name,
    kind,
    joined: kind === 'private',
    topic: null,
    users: new Map(),
    messages: [],
    reactions: new Map(),
    typing: new Map(),
    unread: 0,
    mentions: 0,
  };
}

/** Adds a message in the order of time; beyond `limit` the oldest ones go, with their reactions. */
export function insertMessage(channel: ChannelRecord, record: MessageRecord, limit: number): void {
  // History arrives after newer live messages, so each one goes where its time says.
  let index = channel.messages.length;
  while (index > 0 && channel.messages[index - 1]!.time > record.time) {
    index--;
  }
  channel.messages.splice(index, 0, record);
  if (channel.messages.length > limit) {
    const removed = channel.messages.splice(0, channel.messages.length - limit);
    const removedIds = new Set(removed.map((message) => message.id));
    for (const [reactionId, reaction] of channel.reactions) {
      if (removedIds.has(reaction.target)) {
        channel.reactions.delete(reactionId);
      }
    }
  }
}

/** Our echoed message replaces the one shown while it was on its way; without a label, the oldest with its text. */
export function dropPending(channel: ChannelRecord, label: string | undefined, text: string): void {
  const index = channel.messages.findIndex((message) =>
    label ? message.pendingLabel === label : message.pendingLabel !== null && message.text === text,
  );
  if (index >= 0) {
    channel.messages.splice(index, 1);
  }
}

/** The messages with what they reply to and their reactions; `isSelf` tells our own nick. */
export function channelMessages(channel: ChannelRecord, isSelf: (nick: string) => boolean): ChatMessage[] {
  const byTarget = new Map<string, ReactionRecord[]>();
  for (const reaction of channel.reactions.values()) {
    const list = byTarget.get(reaction.target);
    if (list) {
      list.push(reaction);
    } else {
      byTarget.set(reaction.target, [reaction]);
    }
  }
  const byId = new Map(channel.messages.map((message) => [message.id, message]));
  return channel.messages.map((message) => {
    const target = message.replyTo ? byId.get(message.replyTo) : undefined;
    return {
      id: message.id,
      time: new Date(message.time).toISOString(),
      sender: message.sender,
      text: message.text,
      kind: message.kind,
      pending: message.pendingLabel !== null,
      own: message.kind !== 'system' && isSelf(message.sender),
      mention: message.mention,
      replyTo: message.replyTo ? { id: message.replyTo, sender: target?.sender ?? null, text: target?.text ?? null } : null,
      reactions: groupReactions(byTarget.get(message.id) ?? [], isSelf),
    };
  });
}

function groupReactions(reactions: ReactionRecord[], isSelf: (nick: string) => boolean): ChatReaction[] {
  const groups = new Map<string, string[]>();
  for (const reaction of reactions) {
    const users = groups.get(reaction.shortcode);
    if (users) {
      users.push(reaction.nick);
    } else {
      groups.set(reaction.shortcode, [reaction.nick]);
    }
  }
  return [...groups].map(([shortcode, users]) => ({ shortcode, users, mine: users.some((nick) => isSelf(nick)) }));
}
