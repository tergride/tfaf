import {
  CHAT_LIMITS,
  type ChatChannelData,
  type ChatState,
  type ChatStatus,
  type ChatUser,
  type LinkPreview,
} from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import type { AuthService } from '../auth/authService.ts';
import type { DesktopNotifier } from '../desktopNotifier.ts';
import { describeError } from '../errors.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import { type FeatureAnnouncement, parseAnnouncement, releaseVersion, serializeAnnouncement } from '../game/lobbyFeatures.ts';
import { t } from '../i18n.ts';
import { displayedRating } from '../lobby/lobbyProtocol.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import { isFafWebSocketUrl } from '../servers.ts';
import type { SettingsStore } from '../settings.ts';
import type { SoundPlayer } from '../sounds.ts';
import { type ChannelPart, ChatModel, channelKey, MODERATOR_PREFIXES } from './chatModel.ts';
import { clanChannel, NEWBIE_CHANNEL, wantedChannels } from './chatPrefs.ts';
import { IrcConnection } from './ircConnection.ts';
import { fetchLinkPreview } from './linkPreview.ts';
import {
  gameInvite,
  gameInviteReply,
  type InviteAnswer,
  isTfafChannel,
  lobbyQuery,
  lobbyReply,
  lobbyReplyRoom,
  parseTfafCtcp,
  TFAF_CHANNEL,
  tfafRealname,
} from './tfafPresence.ts';

export interface ChatServiceDependencies {
  api: FafApi;
  auth: AuthService;
  lobby: LobbyService;
  settings: SettingsStore;
  games: GameRunner;
  userAgent: string;
  /** Put into our realname, which tells other TFAF launchers that we run one (tfafPresence.ts). */
  launcherVersion: string;
  notifier: DesktopNotifier;
  sounds: Pick<SoundPlayer, 'play'>;
}

export interface ChatServiceEvents {
  onState(state: ChatState): void;
  onChannel(data: ChatChannelData): void;
  /** A chat notification was clicked: the channel to show. */
  onFocusRequested(channel: string): void;
  /** Something the server refused, such as joining a channel. */
  onNotice(text: string): void;
  /** Another TFAF launcher invites us into its game (gameInvites.ts); the answer goes back to it. */
  onGameInvite?(sender: string, gameId: number, password: string | null): InviteAnswer;
}

// Like the official client, #newbie is for those new to FAF.
const NEWBIE_MAX_GAMES = 50;
const HISTORY_SIZE = 100;
const CAPABILITIES = [
  'message-tags',
  'server-time',
  'echo-message',
  'batch',
  'labeled-response',
  'away-notify',
  'extended-join',
  'multi-prefix',
  'userhost-in-names',
  'draft/chathistory',
  'draft/event-playback',
  'draft/message-redaction',
];
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
// The official client sends "typing" at most this often, and the others drop the mark after 6 seconds.
const TYPING_SEND_INTERVAL_MS = 3_000;
const TYPING_CHECK_MS = 1_000;
const STATE_FLUSH_MS = 150;
const MESSAGES_FLUSH_MS = 100;
// The user list of a busy channel is long and changes with every join, so it is sent less often.
const USERS_FLUSH_MS = 1_000;
const NOTIFICATION_TEXT_LENGTH = 200;
const CHANNEL_NAME = /^#[^\s,\x00-\x1f]{1,49}$/;
const NICK = /^[^\s,#&:\x00-\x1f!@]{1,50}$/;
const SHORTCODE = /^[^\s\x00-\x1f]{1,40}$/;
const WHO_TIMEOUT_MS = 2_000;
const LOBBY_QUERY_TIMEOUT_MS = 3_000;
// Answers to lobby queries: one per player and second at most, and only a few per second in all.
const CTCP_REPLY_INTERVAL_MS = 1_000;
const CTCP_REPLIES_PER_SECOND = 10;

/** FAF's IRC chat (KittehChatService of the official client): connection, channels, messages and notifications. */
export class ChatService {
  private readonly deps: ChatServiceDependencies;
  private readonly events: ChatServiceEvents;
  private readonly model: ChatModel;
  private connection: IrcConnection | null = null;
  private status: ChatStatus = 'disconnected';
  private error: string | null = null;
  private wanted = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  // The server address to try next; one that failed before the login gives way to the next one.
  private urlIndex = 0;
  private openChannel: string | null = null;
  private watchedChannel: string | null = null;
  private readonly timers = new Map<'state' | 'messages' | 'users', NodeJS.Timeout>();
  // Channels on screen (open or watched) whose messages or users changed since the last update was sent.
  private readonly dirty = { messages: new Set<string>(), users: new Set<string>() };
  private updatesPaused = false;
  private readonly heldUpdates = new Set<'state' | 'messages' | 'users'>();
  private readonly typingSent = new Map<string, number>();
  private readonly previews = new Map<string, Promise<LinkPreview>>();
  private partyChannel: string | null = null;
  private labels = 0;
  // Callers waiting for the end of a WHO about a nick, for a host's answer to a lobby query, by `<host> <game id>`, and
  // for an invited player's answer, by `<player> <game id>`.
  private readonly whoWaiters = new Map<string, Set<(value: string | null) => void>>();
  private readonly lobbyWaiters = new Map<string, Set<(value: string | null) => void>>();
  private readonly inviteWaiters = new Map<string, Set<(value: string | null) => void>>();
  private readonly repliedAt = new Map<string, number>();
  private recentReplies: number[] = [];

  constructor(deps: ChatServiceDependencies, events: ChatServiceEvents) {
    this.deps = deps;
    this.events = events;
    this.model = new ChatModel(
      {
        onChanged: (channel, part) => this.onChanged(channel, part),
        onJoined: (channel) => this.fetchChannel(channel),
        onAttention: (channel, sender, text, reason) => this.notify(channel, sender, text, reason),
        onError: (text) => events.onNotice(text),
        onClientsChanged: () => this.schedule('state'),
        onCtcp: (sender, body, notice) => this.onCtcp(sender, body, notice),
        onWhoEnd: (mask) => this.settle(this.whoWaiters, mask.toLowerCase(), null),
      },
      {
        isHidden: (nick) => this.isHidden(nick),
        messageLimit: () => deps.settings.get().chat.messageLimit,
      },
    );
    deps.lobby.onSocialChanged(() => {
      this.joinChannels();
      this.schedule('users');
      // The clan's channel comes with the player's data.
      this.schedule('state');
    });
    setInterval(() => this.model.expireTyping(Date.now()), TYPING_CHECK_MS);
  }

  /** Connects once the user is signed in; the chat stays up across lobby reconnects. */
  start(): void {
    if (this.wanted) {
      return;
    }
    this.wanted = true;
    void this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.clearReconnect();
    this.connection?.close();
    this.connection = null;
    for (const name of this.model.channelNames()) {
      this.model.remove(name);
    }
    this.setStatus('disconnected', null);
  }

  reconnect(): void {
    this.connection?.close('Reconnecting');
    this.connection = null;
    this.clearReconnect();
    this.wanted = true;
    void this.connect();
  }

  getState(): ChatState {
    return {
      status: this.status,
      error: this.error,
      nick: this.model.nick || null,
      channels: this.model.list(),
      clanChannel: this.clanChannel(),
      tfafPlayers: Object.fromEntries(this.model.tfafClients()),
    };
  }

  /** The TFAF version of a player's launcher: null for another client, undefined while the chat has not seen them. */
  tfafVersion(login: string): string | null | undefined {
    return this.model.tfafVersion(login);
  }

  /** Like tfafVersion, but asks the server about a player the chat has not seen; null without an answer. */
  async lookupTfaf(login: string): Promise<string | null> {
    const known = this.model.tfafVersion(login);
    const connection = this.connection;
    if (known !== undefined || !connection || this.status !== 'connected' || !NICK.test(login)) {
      return known ?? null;
    }
    await this.waitFor(this.whoWaiters, login.toLowerCase(), WHO_TIMEOUT_MS, () => connection.send('WHO', [login]));
    return this.model.tfafVersion(login) ?? null;
  }

  /** The lobby features of a game from its host's TFAF launcher; null when it does not answer or does not host the game. */
  async queryLobby(host: string, gameId: number): Promise<FeatureAnnouncement | null> {
    const connection = this.connection;
    if (!connection || this.status !== 'connected' || !NICK.test(host)) {
      return null;
    }
    const reply = await this.waitFor(this.lobbyWaiters, `${host.toLowerCase()} ${gameId}`, LOBBY_QUERY_TIMEOUT_MS, () =>
      connection.send('PRIVMSG', [host, lobbyQuery(gameId)]),
    );
    return reply === null ? null : parseAnnouncement(reply);
  }

  /**
   * Invites a TFAF player into our game with the password the server checks for it: how the player's launcher took
   * it, or null when it did not answer (another client, an old TFAF).
   */
  async sendGameInvite(login: string, gameId: number, password: string | null): Promise<InviteAnswer | null> {
    const connection = this.connection;
    if (!connection || this.status !== 'connected') {
      throw new Error(t('main.gameInvites.chatOffline'));
    }
    if (!NICK.test(login)) {
      throw new Error(t('main.gameInvites.playerOffline'));
    }
    const reply = await this.waitFor(this.inviteWaiters, `${login.toLowerCase()} ${gameId}`, LOBBY_QUERY_TIMEOUT_MS, () =>
      connection.send('PRIVMSG', [login, gameInvite(gameId, password)]),
    );
    return reply as InviteAnswer | null;
  }

  open(name: string | null): ChatChannelData | null {
    this.openChannel = name && this.model.hasChannel(name) ? name : null;
    this.model.setOpen(this.openChannel);
    if (!this.openChannel) {
      return null;
    }
    return { name: this.openChannel, messages: this.model.messages(this.openChannel), users: this.users(this.openChannel) };
  }

  /** A second channel kept up to date while it is on screen elsewhere: the party chat of the matchmaker tab. */
  watch(name: string | null): ChatChannelData | null {
    this.watchedChannel = name && this.model.hasChannel(name) ? name : null;
    this.model.setWatched(this.watchedChannel);
    if (!this.watchedChannel) {
      return null;
    }
    const watched = this.watchedChannel;
    return { name: watched, messages: this.model.messages(watched), users: this.users(watched) };
  }

  /** Paused, the chat goes on but the renderer hears of it only when resumed. */
  setUpdatesPaused(paused: boolean): void {
    this.updatesPaused = paused;
    if (!paused) {
      for (const kind of this.heldUpdates) {
        this.schedule(kind);
      }
      this.heldUpdates.clear();
    }
  }

  /** The chat settings changed: channels newly wanted are joined; the others stay until left by hand. */
  applySettings(): void {
    this.joinChannels();
    this.schedule('users');
  }

  async send(channel: string, input: string, replyTo: string | null): Promise<void> {
    const text = input.replace(/[\r\n]+/g, ' ').trim();
    if (!text) {
      return;
    }
    if (text.startsWith('/') && !text.startsWith('//')) {
      await this.command(channel, text);
      return;
    }
    this.sendText(channel, text.startsWith('//') ? text.slice(1) : text, 'message', replyTo);
  }

  react(channel: string, messageId: string, shortcode: string): void {
    if (!SHORTCODE.test(shortcode)) {
      throw new Error(t('main.chat.unknownReaction'));
    }
    const connection = this.requireConnection();
    const own = this.model.ownReaction(channel, messageId, shortcode);
    if (own) {
      connection.send('REDACT', [channel, own]);
    } else {
      connection.send('TAGMSG', [channel], { '+draft/reply': messageId, '+draft/react': shortcode });
    }
  }

  delete(channel: string, messageId: string): void {
    this.requireConnection().send('REDACT', [channel, messageId]);
  }

  setTopic(channel: string, topic: string): void {
    this.requireConnection().send('TOPIC', [channel, topic.replace(/[\r\n]+/g, ' ').trim()]);
  }

  async join(name: string): Promise<void> {
    if (!CHANNEL_NAME.test(name)) {
      throw new Error(t('main.chat.invalidChannelName'));
    }
    this.requireConnection().send('JOIN', [name]);
    const saved = this.deps.settings.get().chat.autoJoin.channels;
    if (!this.isAutomatic(name) && !saved.some((channel) => channelKey(channel) === channelKey(name))) {
      await this.deps.settings.setAutoJoinChannels([...saved, name]);
    }
  }

  async leave(name: string): Promise<void> {
    const clan = this.clanChannel();
    if (clan && channelKey(clan) === channelKey(name)) {
      throw new Error(t('main.chat.clanChannelPinned'));
    }
    if (isTfafChannel(name)) {
      throw new Error(t('main.chat.tfafChannelPinned'));
    }
    const info = this.model.info(name);
    if (info?.kind === 'channel' && info.joined) {
      this.connection?.send('PART', [name]);
    }
    this.model.remove(name);
    if (this.openChannel && channelKey(this.openChannel) === channelKey(name)) {
      this.openChannel = null;
    }
    if (this.watchedChannel && channelKey(this.watchedChannel) === channelKey(name)) {
      this.watchedChannel = null;
    }
    const saved = this.deps.settings.get().chat.autoJoin.channels;
    if (saved.some((channel) => channelKey(channel) === channelKey(name))) {
      await this.deps.settings.setAutoJoinChannels(saved.filter((channel) => channelKey(channel) !== channelKey(name)));
    }
  }

  openPrivate(nick: string): string {
    if (!NICK.test(nick)) {
      throw new Error(t('main.chat.invalidNick'));
    }
    if (this.model.isSelf(nick)) {
      throw new Error(t('main.chat.ownNick'));
    }
    const existed = this.model.hasChannel(nick);
    const name = this.model.openPrivate(nick);
    if (!existed) {
      this.fetchHistory(name);
    }
    return name;
  }

  typing(channel: string, active: boolean): void {
    const connection = this.connection;
    if (!connection?.capabilities.has('message-tags') || !this.model.hasChannel(channel)) {
      return;
    }
    const key = channelKey(channel);
    const last = this.typingSent.get(key);
    if (active && (last === undefined || Date.now() - last > TYPING_SEND_INTERVAL_MS)) {
      this.typingSent.set(key, Date.now());
      connection.send('TAGMSG', [channel], { '+typing': 'active' });
    } else if (!active && last !== undefined) {
      this.typingSent.delete(key);
      connection.send('TAGMSG', [channel], { '+typing': 'done' });
    }
  }

  previewLink(url: string): Promise<LinkPreview> {
    let preview = this.previews.get(url);
    if (!preview) {
      preview = fetchLinkPreview(url, this.deps.userAgent);
      this.previews.set(url, preview);
      // A failure may be passing, so it is not remembered.
      preview.catch(() => this.previews.delete(url));
    }
    return preview;
  }

  /** The party's channel (`#<owner>'sParty`, as the official client names it): joined while in a party, left after. */
  setPartyChannel(name: string | null): void {
    const previous = this.partyChannel;
    if (previous === name || (previous && name && channelKey(previous) === channelKey(name))) {
      return;
    }
    this.partyChannel = name && CHANNEL_NAME.test(name) ? name : null;
    if (previous) {
      this.leave(previous).catch((error: unknown) => console.warn('Party channel could not be left', describeError(error)));
    }
    this.joinChannels();
  }

  setRelation(playerId: number, relation: 'friend' | 'foe' | null): void {
    this.deps.lobby.setRelation(playerId, relation);
  }

  private async connect(): Promise<void> {
    const user = this.deps.auth.getUser();
    if (!this.wanted || !user || this.connection) {
      return;
    }
    this.setStatus('connecting', null);
    const server = this.deps.auth.getServer();
    const url = server.ircUrls[this.urlIndex % server.ircUrls.length]!;
    let token: string;
    try {
      // The chat accepts the same login as the API, as a token from the user service (IrcChatToken).
      token = asString(asObject(await this.deps.api.getFromUserService('/irc/ergochat/token'))?.value) ?? '';
      if (!token) {
        throw new Error(t('main.chat.noToken'));
      }
      if (!isFafWebSocketUrl(url)) {
        throw new Error(t('main.chat.invalidServerUrl'));
      }
    } catch (error) {
      this.scheduleReconnect(describeError(error));
      return;
    }
    if (!this.wanted || this.connection) {
      return;
    }
    let registered = false;
    const connection: IrcConnection = new IrcConnection(
      {
        url,
        nick: user.login,
        realname: tfafRealname(releaseVersion(this.deps.launcherVersion)),
        account: `${user.login}@FAF`,
        password: `token:${token}`,
        capabilities: CAPABILITIES,
      },
      {
        onRegistered: (_capabilities, nick) => {
          if (this.connection !== connection) {
            return;
          }
          registered = true;
          console.info(`Chat connected to ${url} as ${nick}`);
          this.model.setNick(nick);
          this.reconnectDelay = RECONNECT_MIN_MS;
          this.setStatus('connected', null);
          this.joinChannels();
          this.model.privateChannels().forEach((name) => this.fetchHistory(name));
        },
        onMessage: (message) => {
          if (this.connection === connection) {
            this.model.handle(message);
          }
        },
        onClosed: (error) => {
          if (this.connection !== connection) {
            return;
          }
          this.connection = null;
          this.model.disconnected();
          if (!registered) {
            this.urlIndex++;
          }
          if (this.wanted) {
            console.warn(`Chat connection to ${url} lost: ${error ?? 'closed'}`);
            this.scheduleReconnect(error ?? t('main.chat.connectionClosed'));
          } else {
            this.setStatus('disconnected', null);
          }
        },
      },
    );
    this.connection = connection;
  }

  private scheduleReconnect(error: string): void {
    this.setStatus('disconnected', error);
    if (!this.wanted) {
      return;
    }
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private requireConnection(): IrcConnection {
    if (!this.connection || this.status !== 'connected') {
      throw new Error(t('main.chat.notConnected'));
    }
    return this.connection;
  }

  /** The channel of the player's clan: always joined, whatever the settings say, and never left. */
  private clanChannel(): string | null {
    return clanChannel(this.deps.lobby.getSelf()?.clan);
  }

  /** Channels joined for the user rather than by them, which the auto-join list does not keep. */
  private isAutomatic(name: string): boolean {
    const key = channelKey(name);
    const clan = this.clanChannel();
    return [
      TFAF_CHANNEL,
      NEWBIE_CHANNEL,
      ...(clan ? [clan] : []),
      ...this.deps.lobby.getSocial().channels,
      ...(this.partyChannel ? [this.partyChannel] : []),
    ].some((channel) => channelKey(channel) === key);
  }

  /** What the settings want joined, the party's channel and those still open; joining twice does nothing. */
  private joinChannels(): void {
    const connection = this.connection;
    if (!connection || this.status !== 'connected') {
      return;
    }
    const wanted = wantedChannels(this.deps.settings.get().chat.autoJoin, {
      clanChannel: this.clanChannel(),
      lobbyChannels: this.deps.lobby.getSocial().channels,
      newbie: (this.deps.lobby.getSelf()?.numberOfGames ?? Infinity) < NEWBIE_MAX_GAMES,
      partyChannel: this.partyChannel,
      open: this.model.channelNames().filter((name) => this.model.isChannelName(name)),
    });
    const joined = new Set(this.model.joinedChannels().map(channelKey));
    for (const name of wanted) {
      if (!joined.has(channelKey(name))) {
        connection.send('JOIN', [name]);
      }
    }
  }

  /** Foes, when the settings hide them, and muted players: their messages never reach the chat. */
  private isHidden(nick: string): boolean {
    const prefs = this.deps.settings.get().chat;
    if (prefs.mutedUsers.includes(nick.toLowerCase())) {
      return true;
    }
    const player = prefs.hideFoeMessages ? this.deps.lobby.getPlayerByLogin(nick) : null;
    return player !== null && this.deps.lobby.getSocial().foes.has(player.id);
  }

  /** Recent messages and who is away, right after joining (as the official client does); WHO also tells TFAF players. */
  private fetchChannel(name: string): void {
    if (!isTfafChannel(name)) {
      this.fetchHistory(name);
    }
    this.connection?.send('WHO', [name]);
  }

  private fetchHistory(name: string): void {
    if (this.connection?.capabilities.has('draft/chathistory')) {
      this.connection.send('CHATHISTORY', ['LATEST', name, '*', String(HISTORY_SIZE)]);
    }
  }

  private async command(channel: string, text: string): Promise<void> {
    const [command = '', ...words] = text.slice(1).split(' ');
    const rest = words.join(' ').trim();
    switch (command.toLowerCase()) {
      case 'me':
        if (rest) {
          this.sendText(channel, rest, 'action', null);
        }
        return;
      case 'join':
        await this.join(rest.startsWith('#') ? rest : `#${rest}`);
        return;
      case 'part':
      case 'leave':
        await this.leave(rest || channel);
        return;
      case 'msg':
      case 'query': {
        const [nick = '', ...message] = words;
        const name = this.openPrivate(nick);
        if (message.length > 0) {
          this.sendText(name, message.join(' '), 'message', null);
        }
        return;
      }
      case 'topic':
        this.setTopic(channel, rest);
        return;
      case 'mode': {
        // `/mode #channel +sm` or `/mode +sm` for the open channel; without modes the server tells the current ones.
        const named = this.model.isChannelName(words[0] ?? '');
        const target = named ? words[0]! : channel;
        if (!this.model.isChannelName(target)) {
          throw new Error(t('main.chat.modeNeedsChannel'));
        }
        this.requireConnection().send('MODE', [target, ...(named ? words.slice(1) : words).filter(Boolean)]);
        return;
      }
      default:
        throw new Error(t('main.chat.unknownCommand', { command }));
    }
  }

  private sendText(channel: string, text: string, kind: 'message' | 'action', replyTo: string | null): void {
    if (Buffer.byteLength(text, 'utf8') > CHAT_LIMITS.messageMaxBytes) {
      throw new Error(t('main.chat.messageTooLong'));
    }
    const connection = this.requireConnection();
    const label = `tfaf${++this.labels}`;
    const tags: Record<string, string> = {};
    if (connection.capabilities.has('labeled-response')) {
      tags.label = label;
    }
    if (replyTo && connection.capabilities.has('message-tags')) {
      tags['+draft/reply'] = replyTo;
    }
    connection.send('PRIVMSG', [channel, kind === 'action' ? `\u0001ACTION ${text}\u0001` : text], tags);
    this.typing(channel, false);
    this.model.addPending(channel, label, text, kind, replyTo);
  }

  private users(name: string): ChatUser[] {
    const { friends, foes } = this.deps.lobby.getSocial();
    return this.model.users(name).map((user): ChatUser => {
      const player = this.deps.lobby.getPlayerByLogin(user.nick);
      const relation = this.model.isSelf(user.nick)
        ? 'self'
        : player && friends.has(player.id)
          ? 'friend'
          : player && foes.has(player.id)
            ? 'foe'
            : null;
      return {
        nick: user.nick,
        moderator: [...user.prefixes].some((prefix) => MODERATOR_PREFIXES.has(prefix)),
        away: user.away,
        relation,
        player: player
          ? {
              id: player.id,
              clan: player.clan,
              country: player.country,
              rating: displayedRating(player.ratings.get('global')),
              avatar: player.avatar,
            }
          : null,
      };
    });
  }

  private onChanged(channel: string | null, part: ChannelPart): void {
    if (part === 'info' || channel === null) {
      this.schedule('state');
      return;
    }
    const key = channelKey(channel);
    if ([this.openChannel, this.watchedChannel].some((shown) => shown !== null && channelKey(shown) === key)) {
      this.dirty[part].add(key);
      this.schedule(part);
    }
  }

  private schedule(kind: 'state' | 'messages' | 'users'): void {
    if (this.updatesPaused) {
      this.heldUpdates.add(kind);
      return;
    }
    if (this.timers.has(kind)) {
      return;
    }
    const delay = kind === 'state' ? STATE_FLUSH_MS : kind === 'messages' ? MESSAGES_FLUSH_MS : USERS_FLUSH_MS;
    this.timers.set(
      kind,
      setTimeout(() => {
        this.timers.delete(kind);
        if (kind === 'state') {
          this.events.onState(this.getState());
          return;
        }
        const changed = this.dirty[kind];
        for (const name of [this.openChannel, this.watchedChannel]) {
          if (name && changed.delete(channelKey(name)) && this.model.hasChannel(name)) {
            this.events.onChannel(
              kind === 'messages' ? { name, messages: this.model.messages(name) } : { name, users: this.users(name) },
            );
          }
        }
        changed.clear();
      }, delay),
    );
  }

  private setStatus(status: ChatStatus, error: string | null): void {
    this.status = status;
    this.error = error;
    this.schedule('state');
  }

  /**
   * Another TFAF launcher asks about the game we host or answers our question about the game it hosts, invites us
   * into its game or answers our invitation.
   */
  private onCtcp(sender: string, body: string, notice: boolean): void {
    const message = parseTfafCtcp(body, notice);
    if (message?.kind === 'lobbyReply') {
      this.settle(this.lobbyWaiters, `${sender.toLowerCase()} ${message.gameId}`, message.announcement);
      return;
    }
    if (message?.kind === 'inviteReply') {
      this.settle(this.inviteWaiters, `${sender.toLowerCase()} ${message.gameId}`, message.answer);
      return;
    }
    if (message?.kind === 'invite') {
      // The same limit as for the answers keeps a sender from flooding us with invitations.
      if (this.mayReply(sender)) {
        const answer = this.events.onGameInvite?.(sender, message.gameId, message.password) ?? 'unavailable';
        this.connection?.send('NOTICE', [sender, gameInviteReply(message.gameId, answer)]);
      }
      return;
    }
    if (message?.kind !== 'lobbyQuery' || !this.mayReply(sender)) {
      return;
    }
    const announcement = this.deps.games.lobbyAnnouncement(message.gameId);
    const text = announcement ? serializeAnnouncement(announcement, lobbyReplyRoom(message.gameId)) : null;
    if (announcement && text === null) {
      console.warn(`Lobby features of game ${message.gameId} do not fit into a chat message`);
    }
    this.connection?.send('NOTICE', [sender, lobbyReply(message.gameId, text)]);
  }

  private mayReply(sender: string): boolean {
    const now = Date.now();
    for (const [nick, at] of this.repliedAt) {
      if (now - at >= CTCP_REPLY_INTERVAL_MS) {
        this.repliedAt.delete(nick);
      }
    }
    this.recentReplies = this.recentReplies.filter((at) => now - at < 1_000);
    const key = sender.toLowerCase();
    if (this.repliedAt.has(key) || this.recentReplies.length >= CTCP_REPLIES_PER_SECOND) {
      return false;
    }
    this.repliedAt.set(key, now);
    this.recentReplies.push(now);
    return true;
  }

  /** Asks, then waits until `settle` brings the answer for `key`; null after the timeout. */
  private waitFor(
    waiters: Map<string, Set<(value: string | null) => void>>,
    key: string,
    timeoutMs: number,
    ask: () => void,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const done = (value: string | null): void => {
        clearTimeout(timer);
        const waiting = waiters.get(key);
        waiting?.delete(done);
        if (waiting?.size === 0) {
          waiters.delete(key);
        }
        resolve(value);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      const waiting = waiters.get(key) ?? new Set();
      waiting.add(done);
      waiters.set(key, waiting);
      ask();
    });
  }

  private settle(waiters: Map<string, Set<(value: string | null) => void>>, key: string, value: string | null): void {
    for (const done of [...(waiters.get(key) ?? [])]) {
      done(value);
    }
  }

  /** A sound, and a Windows notification while the launcher is in the background; neither over a running game. */
  private notify(channel: string, sender: string, text: string, reason: 'private' | 'mention'): void {
    if (this.deps.games.getState().phase === 'running') {
      return;
    }
    this.deps.sounds.play(reason === 'private' ? 'privateMessage' : 'mention');
    if (!this.deps.settings.get().chatNotifications) {
      return;
    }
    this.deps.notifier.show({
      title: reason === 'private' ? sender : t('main.chat.mentionTitle', { sender, channel }),
      body: text.length > NOTIFICATION_TEXT_LENGTH ? `${text.slice(0, NOTIFICATION_TEXT_LENGTH - 1)}…` : text,
      onClick: () => this.events.onFocusRequested(channel),
    });
  }

}
