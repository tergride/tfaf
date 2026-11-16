// The chat as the IRC server reports it: channels and private conversations, their users, messages, reactions and who
// is typing (KittehChatService of the official client). It knows nothing of the network: ChatService feeds it the
// server's messages and sends what it asks for.

import type { ChatChannelInfo, ChatMessage } from '../../shared/contract.ts';
import { t } from '../i18n.ts';
import {
  type ChannelRecord,
  channelMessages,
  createChannel,
  dropPending,
  insertMessage,
  type MessageRecord,
  type UserRecord,
} from './chatChannel.ts';
import { addNames, applyModes, applySupport, defaultSupport } from './chatMembers.ts';
import { type IrcMessage, nickOf } from './ircMessage.ts';
import { CTCP, isTfafChannel, parseTfafRealname } from './tfafPresence.ts';

export const DEFAULT_MESSAGE_LIMIT = 500;
const TYPING_ACTIVE_MS = 6_000;
const TYPING_PAUSED_MS = 30_000;
// Like the official client: messages older than this are history, not news to notify about.
const STALE_MS = 60_000;
// HistServ replays history as notices; the official client hides it. The other services only answer commands, which
// show in a conversation the user opened with them (`/msg ChanServ ...`).
const SERVICE_NICKS = new Set(['histserv', 'nickserv', 'chanserv']);
export const MODERATOR_PREFIXES = new Set(['~', '&', '@', '%']);
// A player asked about with WHO outside our channels: their client is known this long.
const LOOKUP_TTL_MS = 5 * 60 * 1000;

export type ChannelPart = 'info' | 'messages' | 'users';

export interface ChatModelEvents {
  /** `channel` null: the list of channels changed. */
  onChanged(channel: string | null, part: ChannelPart): void;
  /** We joined a channel: its history and the away state of its users can be asked for. */
  onJoined(channel: string): void;
  /** A live message the user may want to hear about while the launcher is in the background. */
  onAttention(channel: string, sender: string, text: string, reason: 'private' | 'mention'): void;
  onError(text: string): void;
  /** Someone's launcher turned out to be TFAF, or such a player left (tfafPresence.ts). */
  onClientsChanged?(): void;
  /** A live CTCP message other than ACTION sent to us privately; `body` is the text between the \u0001 marks. */
  onCtcp?(sender: string, body: string, notice: boolean): void;
  /** The server answered a WHO query in full. */
  onWhoEnd?(mask: string): void;
}

export interface ChatModelOptions {
  /** Senders whose messages never enter the chat: foes and muted players. */
  isHidden(nick: string): boolean;
  /** Messages kept per channel. */
  messageLimit(): number;
}

const DEFAULT_OPTIONS: ChatModelOptions = { isHidden: () => false, messageLimit: () => DEFAULT_MESSAGE_LIMIT };

export function channelKey(name: string): string {
  return name.toLowerCase();
}

export class ChatModel {
  private readonly events: ChatModelEvents;
  private readonly options: ChatModelOptions;
  private readonly channels = new Map<string, ChannelRecord>();
  private readonly historyBatches = new Set<string>();
  private readonly namesInProgress = new Set<string>();
  private self = '';
  private openChannel: string | null = null;
  private watchedChannel: string | null = null;
  private localIds = 0;
  private readonly support = defaultSupport();
  /** The client of each user whose realname the server reported, by nick in lower case: a TFAF version or null. */
  private readonly clients = new Map<string, { nick: string; version: string | null; at: number }>();

  constructor(events: ChatModelEvents, options: ChatModelOptions = DEFAULT_OPTIONS) {
    this.events = events;
    this.options = options;
  }

  get nick(): string {
    return this.self;
  }

  setNick(nick: string): void {
    this.self = nick;
  }

  isChannelName(name: string): boolean {
    return name.length > 1 && this.support.channelTypes.includes(name[0]!);
  }

  isSelf(nick: string): boolean {
    return nick.toLowerCase() === this.self.toLowerCase();
  }

  hasChannel(name: string): boolean {
    return this.channels.has(channelKey(name));
  }

  channelNames(): string[] {
    return [...this.channels.values()].map((channel) => channel.name);
  }

  joinedChannels(): string[] {
    return [...this.channels.values()].filter((channel) => channel.kind === 'channel' && channel.joined).map((c) => c.name);
  }

  privateChannels(): string[] {
    return [...this.channels.values()].filter((channel) => channel.kind === 'private').map((channel) => channel.name);
  }

  /** The channel the user looks at: its messages count as read. */
  setOpen(name: string | null): void {
    this.openChannel = name === null ? null : channelKey(name);
    this.markRead(name);
  }

  /** A second channel on screen elsewhere, the party's chat of the matchmaker: its messages count as read too. */
  setWatched(name: string | null): void {
    this.watchedChannel = name === null ? null : channelKey(name);
    this.markRead(name);
  }

  private markRead(name: string | null): void {
    const channel = name === null ? null : this.channels.get(channelKey(name));
    if (channel && (channel.unread > 0 || channel.mentions > 0)) {
      channel.unread = 0;
      channel.mentions = 0;
      this.events.onChanged(channel.name, 'info');
    }
  }

  /** A conversation with a player, opened by the user or by their first message. */
  openPrivate(nick: string): string {
    return this.ensureChannel(nick, 'private').name;
  }

  /** Forgets a channel the user closed or left. */
  remove(name: string): void {
    if (this.channels.delete(channelKey(name))) {
      this.events.onChanged(null, 'info');
      for (const [key, client] of this.clients) {
        if (Date.now() - client.at >= LOOKUP_TTL_MS && !this.inChannel(key)) {
          this.forgetClient(key);
        }
      }
    }
  }

  /** The TFAF version of a user's launcher: null for another client, undefined while the server has not told. */
  tfafVersion(nick: string): string | null | undefined {
    const key = nick.toLowerCase();
    const client = this.clients.get(key);
    return client && (this.inChannel(key) || Date.now() - client.at < LOOKUP_TTL_MS) ? client.version : undefined;
  }

  /** Users whose launcher is TFAF, by nick in lower case, with its version. */
  tfafClients(): Map<string, string> {
    const clients = new Map<string, string>();
    for (const [key, client] of this.clients) {
      if (client.version !== null && this.tfafVersion(key) !== undefined) {
        clients.set(key, client.version);
      }
    }
    return clients;
  }

  /** The connection is gone: nobody is known to be anywhere; messages stay until the history replaces them. */
  disconnected(): void {
    this.historyBatches.clear();
    this.namesInProgress.clear();
    if ([...this.clients.values()].some((client) => client.version !== null)) {
      this.events.onClientsChanged?.();
    }
    this.clients.clear();
    for (const channel of this.channels.values()) {
      channel.users.clear();
      channel.typing.clear();
      channel.joined = false;
      channel.messages = channel.messages.filter((message) => message.pendingLabel === null);
    }
    this.events.onChanged(null, 'info');
  }

  /** Shows a message of ours until the server echoes it back under its own id. */
  addPending(name: string, label: string, text: string, kind: 'message' | 'action', replyTo: string | null): void {
    const channel = this.channels.get(channelKey(name));
    if (!channel) {
      return;
    }
    this.insert(channel, {
      id: `pending-${label}`,
      time: Date.now(),
      sender: this.self,
      text,
      kind,
      replyTo,
      mention: false,
      pendingLabel: label,
    });
    this.events.onChanged(channel.name, 'messages');
  }

  /** A line from us or the launcher itself, such as "the player is offline". */
  addSystem(name: string, text: string): void {
    const channel = this.channels.get(channelKey(name));
    if (!channel) {
      return;
    }
    this.insert(channel, {
      id: `system-${++this.localIds}`,
      time: Date.now(),
      sender: '',
      text,
      kind: 'system',
      replyTo: null,
      mention: false,
      pendingLabel: null,
    });
    this.events.onChanged(channel.name, 'messages');
  }

  info(name: string): ChatChannelInfo | null {
    const channel = this.channels.get(channelKey(name));
    return channel ? this.toInfo(channel) : null;
  }

  list(): ChatChannelInfo[] {
    return [...this.channels.values()].filter((channel) => !isTfafChannel(channel.name)).map((channel) => this.toInfo(channel));
  }

  messages(name: string): ChatMessage[] {
    const channel = this.channels.get(channelKey(name));
    return channel ? channelMessages(channel, (nick) => this.isSelf(nick)) : [];
  }

  users(name: string): UserRecord[] {
    return [...(this.channels.get(channelKey(name))?.users.values() ?? [])];
  }

  /** The id of our own reaction to a message, which removing it refers to. */
  ownReaction(name: string, messageId: string, shortcode: string): string | null {
    for (const [id, reaction] of this.channels.get(channelKey(name))?.reactions ?? []) {
      if (reaction.target === messageId && reaction.shortcode === shortcode && this.isSelf(reaction.nick)) {
        return id;
      }
    }
    return null;
  }

  hasMessage(name: string, messageId: string): boolean {
    return this.channels.get(channelKey(name))?.messages.some((message) => message.id === messageId) ?? false;
  }

  isModerator(name: string): boolean {
    const user = this.channels.get(channelKey(name))?.users.get(this.self.toLowerCase());
    return [...(user?.prefixes ?? '')].some((prefix) => MODERATOR_PREFIXES.has(prefix));
  }

  /** Drops typing marks that ran out; true when one did. */
  expireTyping(now: number): boolean {
    let expired = false;
    for (const channel of this.channels.values()) {
      for (const [key, typing] of channel.typing) {
        if (typing.until <= now) {
          channel.typing.delete(key);
          expired = true;
          this.events.onChanged(channel.name, 'info');
        }
      }
    }
    return expired;
  }

  handle(message: IrcMessage): void {
    const params = message.params;
    switch (message.command) {
      case '005':
        applySupport(this.support, params.slice(1, -1));
        break;
      case 'PRIVMSG':
      case 'NOTICE':
        this.onText(message);
        break;
      case 'TAGMSG':
        this.onTagMessage(message);
        break;
      case 'REDACT':
        this.onRedact(message);
        break;
      case 'BATCH': {
        const reference = params[0] ?? '';
        if (reference.startsWith('+') && params[1] === 'chathistory') {
          this.historyBatches.add(reference.slice(1));
        } else if (reference.startsWith('-')) {
          this.historyBatches.delete(reference.slice(1));
        }
        break;
      }
      case 'JOIN':
        if (!this.isHistory(message)) {
          this.onJoin(nickOf(message.source), params[0]);
          // With extended-join the account and the realname follow the channel.
          if (params.length >= 3) {
            this.setClient(nickOf(message.source), params[2]!);
          }
        }
        break;
      case 'PART':
        if (!this.isHistory(message)) {
          this.onLeave(nickOf(message.source), params[0], null);
        }
        break;
      case 'KICK':
        if (!this.isHistory(message)) {
          this.onLeave(params[1] ?? null, params[0], nickOf(message.source));
        }
        break;
      case 'QUIT':
        if (!this.isHistory(message)) {
          this.onQuit(nickOf(message.source));
        }
        break;
      case 'NICK':
        if (!this.isHistory(message)) {
          this.onNick(nickOf(message.source), params[0]);
        }
        break;
      case 'AWAY':
        this.onAway(nickOf(message.source), params.length > 0);
        break;
      case 'MODE':
        this.onMode(params);
        break;
      case 'TOPIC':
        this.setTopic(params[0], params[1] ?? '');
        break;
      case '332':
        this.setTopic(params[1], params[2] ?? '');
        break;
      case '331':
        this.setTopic(params[1], '');
        break;
      case '353':
        this.onNames(params[2], params[3] ?? '');
        break;
      case '366':
        this.namesInProgress.delete(channelKey(params[1] ?? ''));
        break;
      case '352':
        this.onWho(params[1], params[5], params[6] ?? '');
        // The last parameter is "<hop count> <realname>".
        this.setClient(params[5] ?? null, (params[7] ?? '').replace(/^\d+ /, ''));
        break;
      case '315':
        this.events.onWhoEnd?.(params[1] ?? '');
        break;
      case '401':
        this.undelivered(params[1], t('main.chat.playerOffline'));
        break;
      case '404':
        this.undelivered(params[1], t('main.chat.notSent', { reason: params.at(-1) ?? '' }));
        break;
      case '482':
        this.events.onError(t('main.chat.moderatorRequired', { channel: params[1] ?? '' }));
        break;
      case '324':
        // Only `/mode` without modes asks for them.
        this.events.onError(t('main.chat.channelModes', { channel: params[1] ?? '', modes: params.slice(2).join(' ') }));
        break;
      case '403':
      case '405':
      case '471':
      case '473':
      case '474':
      case '475':
      case '477':
        // The user never asked for TFAF's own channel; without it only shared channels tell TFAF players.
        if (isTfafChannel(params[1] ?? '')) {
          console.warn(`TFAF's chat channel could not be joined: ${params.at(-1) ?? message.command}`);
          break;
        }
        this.events.onError(
          t('main.chat.joinFailed', { channel: params[1] ?? '', reason: params.at(-1) ?? message.command }),
        );
        break;
      case 'FAIL':
        this.events.onError(t('main.chat.serverError', { reason: params.at(-1) ?? params.join(' ') }));
        break;
      default:
        break;
    }
  }

  /** The server refused our message, so it will never be echoed back. */
  private undelivered(name: string | undefined, text: string): void {
    const channel = name ? this.channels.get(channelKey(name)) : undefined;
    if (channel) {
      channel.messages = channel.messages.filter((message) => message.pendingLabel === null);
      this.addSystem(channel.name, text);
    }
  }

  private toInfo(channel: ChannelRecord): ChatChannelInfo {
    return {
      name: channel.name,
      kind: channel.kind,
      joined: channel.joined,
      topic: channel.topic,
      unread: channel.unread,
      mentions: channel.mentions,
      userCount: channel.users.size,
      typing: [...channel.typing.values()].map((typing) => typing.nick),
      moderator: this.isModerator(channel.name),
    };
  }

  private ensureChannel(name: string, kind: ChannelRecord['kind']): ChannelRecord {
    const key = channelKey(name);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = createChannel(name, kind);
      this.channels.set(key, channel);
      this.events.onChanged(null, 'info');
    }
    return channel;
  }

  private isHistory(message: IrcMessage): boolean {
    const batch = message.tags.get('batch');
    return batch !== undefined && this.historyBatches.has(batch);
  }

  /** The conversation a message to `target` from `sender` belongs to: the channel, or the other player. */
  private conversationOf(sender: string, target: string): ChannelRecord | null {
    if (this.isChannelName(target)) {
      // TFAF's own channel only tells who runs TFAF: whatever anyone says there is dropped.
      return isTfafChannel(target) ? null : (this.channels.get(channelKey(target)) ?? null);
    }
    return this.ensureChannel(this.isSelf(sender) ? target : sender, 'private');
  }

  private hidesService(nick: string): boolean {
    const key = nick.toLowerCase();
    return SERVICE_NICKS.has(key) && (key === 'histserv' || !this.hasChannel(nick));
  }

  private onText(message: IrcMessage): void {
    const sender = nickOf(message.source);
    const [target, rawText = ''] = message.params;
    if (!sender || !target || this.hidesService(sender)) {
      return;
    }
    // Launchers talk to each other with CTCP (tfafPresence.ts): never shown, and never from history or ourselves.
    if (rawText.startsWith(CTCP) && !rawText.startsWith(`${CTCP}ACTION `)) {
      if (!this.isSelf(sender) && !this.isChannelName(target) && !this.isHistory(message)) {
        this.events.onCtcp?.(sender, rawText.replace(/^\u0001|\u0001$/g, ''), message.command === 'NOTICE');
      }
      return;
    }
    // Checked before the conversation is looked up, so a private message does not open one either.
    if (!this.isSelf(sender) && this.options.isHidden(sender)) {
      return;
    }
    const channel = this.conversationOf(sender, target);
    if (!channel) {
      return;
    }
    let text = rawText;
    let kind: ChatMessage['kind'] = message.command === 'NOTICE' ? 'notice' : 'message';
    if (text.startsWith(CTCP)) {
      text = text.replace(/^\u0001|\u0001$/g, '').slice('ACTION '.length);
      kind = 'action';
    }
    const own = this.isSelf(sender);
    const label = message.tags.get('label');
    if (own) {
      dropPending(channel, label, text);
    }
    const id = message.tags.get('msgid') ?? `local-${++this.localIds}`;
    if (channel.messages.some((existing) => existing.id === id)) {
      return;
    }
    const time = Date.parse(message.tags.get('time') ?? '') || Date.now();
    const replyTo = message.tags.get('+draft/reply') ?? null;
    const repliedTo = replyTo ? channel.messages.find((existing) => existing.id === replyTo) : undefined;
    const mention = !own && (this.mentionsSelf(text) || (repliedTo !== undefined && this.isSelf(repliedTo.sender)));
    this.insert(channel, { id, time, sender, text, kind, replyTo, mention, pendingLabel: null });
    channel.typing.delete(sender.toLowerCase());
    this.events.onChanged(channel.name, 'messages');

    const live = !this.isHistory(message) && Date.now() - time < STALE_MS;
    const onScreen = channelKey(channel.name) === this.openChannel || channelKey(channel.name) === this.watchedChannel;
    if (live && !own && !onScreen) {
      channel.unread++;
      const reason = channel.kind === 'private' ? 'private' : mention ? 'mention' : null;
      if (reason) {
        channel.mentions++;
        this.events.onAttention(channel.name, sender, text, reason);
      }
    }
    this.events.onChanged(channel.name, 'info');
  }

  private mentionsSelf(text: string): boolean {
    if (!this.self) {
      return false;
    }
    const escaped = this.self.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`, 'i').test(text);
  }

  private onTagMessage(message: IrcMessage): void {
    const sender = nickOf(message.source);
    const target = message.params[0];
    if (!sender || !target || (!this.isSelf(sender) && this.options.isHidden(sender))) {
      return;
    }
    const channel = this.conversationOf(sender, target);
    if (!channel) {
      return;
    }
    const typing = message.tags.get('+typing');
    if (typing && !this.isSelf(sender) && !this.isHistory(message)) {
      const key = sender.toLowerCase();
      if (typing === 'done') {
        channel.typing.delete(key);
      } else {
        channel.typing.set(key, { nick: sender, until: Date.now() + (typing === 'paused' ? TYPING_PAUSED_MS : TYPING_ACTIVE_MS) });
      }
      this.events.onChanged(channel.name, 'info');
    }
    const shortcode = message.tags.get('+draft/react');
    const replyTo = message.tags.get('+draft/reply');
    const id = message.tags.get('msgid');
    if (shortcode && replyTo && id && !channel.reactions.has(id)) {
      channel.reactions.set(id, { shortcode, nick: sender, target: replyTo });
      this.events.onChanged(channel.name, 'messages');
    }
  }

  private onRedact(message: IrcMessage): void {
    const sender = nickOf(message.source);
    const [target, id] = message.params;
    if (!sender || !target || !id) {
      return;
    }
    const channel = this.conversationOf(sender, target);
    if (!channel) {
      return;
    }
    const before = channel.messages.length;
    channel.messages = channel.messages.filter((existing) => existing.id !== id);
    const removedMessage = channel.messages.length !== before;
    if (removedMessage) {
      for (const [reactionId, reaction] of channel.reactions) {
        if (reaction.target === id) {
          channel.reactions.delete(reactionId);
        }
      }
    }
    if (channel.reactions.delete(id) || removedMessage) {
      this.events.onChanged(channel.name, 'messages');
    }
  }

  private insert(channel: ChannelRecord, record: MessageRecord): void {
    insertMessage(channel, record, this.options.messageLimit());
  }

  private onJoin(nick: string | null, name: string | undefined): void {
    if (!nick || !name) {
      return;
    }
    if (this.isSelf(nick)) {
      const channel = this.ensureChannel(name, 'channel');
      channel.joined = true;
      channel.users.clear();
      this.events.onChanged(channel.name, 'info');
      this.events.onJoined(channel.name);
      return;
    }
    const channel = this.channels.get(channelKey(name));
    if (channel) {
      channel.users.set(nick.toLowerCase(), { nick, prefixes: '', away: false });
      this.events.onChanged(channel.name, 'users');
      this.events.onChanged(channel.name, 'info');
    }
  }

  private onLeave(nick: string | null, name: string | undefined, kickedBy: string | null): void {
    if (!nick || !name) {
      return;
    }
    const channel = this.channels.get(channelKey(name));
    if (!channel) {
      return;
    }
    if (this.isSelf(nick)) {
      if (kickedBy) {
        channel.joined = false;
        channel.users.clear();
        this.addSystem(channel.name, t('main.chat.kicked', { nick: kickedBy }));
        this.events.onChanged(channel.name, 'info');
      } else {
        this.remove(channel.name);
      }
      return;
    }
    if (channel.users.delete(nick.toLowerCase())) {
      channel.typing.delete(nick.toLowerCase());
      this.events.onChanged(channel.name, 'users');
      this.events.onChanged(channel.name, 'info');
      if (!this.inChannel(nick.toLowerCase())) {
        this.forgetClient(nick.toLowerCase());
      }
    }
  }

  private onQuit(nick: string | null): void {
    if (!nick) {
      return;
    }
    const key = nick.toLowerCase();
    for (const channel of this.channels.values()) {
      if (channel.users.delete(key)) {
        channel.typing.delete(key);
        this.events.onChanged(channel.name, 'users');
        this.events.onChanged(channel.name, 'info');
      }
    }
    this.forgetClient(key);
  }

  private onNick(oldNick: string | null, newNick: string | undefined): void {
    if (!oldNick || !newNick) {
      return;
    }
    if (this.isSelf(oldNick)) {
      this.self = newNick;
    }
    for (const channel of this.channels.values()) {
      const user = channel.users.get(oldNick.toLowerCase());
      if (user) {
        channel.users.delete(oldNick.toLowerCase());
        channel.users.set(newNick.toLowerCase(), { ...user, nick: newNick });
        this.events.onChanged(channel.name, 'users');
      }
    }
    const client = this.clients.get(oldNick.toLowerCase());
    if (client) {
      this.clients.delete(oldNick.toLowerCase());
      this.clients.set(newNick.toLowerCase(), { ...client, nick: newNick });
      if (client.version !== null) {
        this.events.onClientsChanged?.();
      }
    }
  }

  private inChannel(key: string): boolean {
    return [...this.channels.values()].some((channel) => channel.kind === 'channel' && channel.users.has(key));
  }

  /** Takes in the realname the server reported for a user, which tells a TFAF launcher. */
  private setClient(nick: string | null, realname: string): void {
    if (!nick) {
      return;
    }
    const key = nick.toLowerCase();
    const version = parseTfafRealname(realname);
    const previous = this.clients.get(key);
    this.clients.set(key, { nick, version, at: Date.now() });
    if ((previous?.version ?? null) !== version) {
      this.events.onClientsChanged?.();
    }
  }

  private forgetClient(key: string): void {
    const client = this.clients.get(key);
    if (client && this.clients.delete(key) && client.version !== null) {
      this.events.onClientsChanged?.();
    }
  }

  private onAway(nick: string | null, away: boolean): void {
    if (!nick) {
      return;
    }
    for (const channel of this.channels.values()) {
      const user = channel.users.get(nick.toLowerCase());
      if (user && user.away !== away) {
        user.away = away;
        this.events.onChanged(channel.name, 'users');
      }
    }
  }

  private onMode(params: string[]): void {
    const [target, modes = '', ...args] = params;
    const channel = target && this.isChannelName(target) ? this.channels.get(channelKey(target)) : undefined;
    if (channel && applyModes(channel, modes, args, this.support)) {
      this.events.onChanged(channel.name, 'users');
      this.events.onChanged(channel.name, 'info');
    }
  }

  private setTopic(name: string | undefined, topic: string): void {
    const channel = name ? this.channels.get(channelKey(name)) : undefined;
    if (channel) {
      channel.topic = topic || null;
      this.events.onChanged(channel.name, 'info');
    }
  }

  private onNames(name: string | undefined, names: string): void {
    const channel = name ? this.channels.get(channelKey(name)) : undefined;
    if (!channel) {
      return;
    }
    // A new NAMES reply replaces the list; its later lines add to it.
    if (!this.namesInProgress.has(channelKey(channel.name))) {
      this.namesInProgress.add(channelKey(channel.name));
      channel.users.clear();
    }
    addNames(channel, names, this.support);
    this.events.onChanged(channel.name, 'users');
    this.events.onChanged(channel.name, 'info');
  }

  private onWho(name: string | undefined, nick: string | undefined, flags: string): void {
    const channel = name ? this.channels.get(channelKey(name)) : undefined;
    const user = nick ? channel?.users.get(nick.toLowerCase()) : undefined;
    if (channel && user && user.away !== flags.startsWith('G')) {
      user.away = flags.startsWith('G');
      this.events.onChanged(channel.name, 'users');
    }
  }
}
