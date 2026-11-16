import { randomUUID } from 'node:crypto';
import type { LiveGame, LobbyGame, LobbyGamesUpdate, LobbyNotice, LobbyState, PlayerAvatar } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import type { AuthService } from '../auth/authService.ts';
import type { FeaturedModCatalog } from '../game/featuredMods.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { isFafWebSocketUrl } from '../servers.ts';
import { FriendActivity, type FriendEvent, type GameChange, type PlayerChange } from './friendActivity.ts';
import { LobbyConnection } from './lobbyConnection.ts';
import { LobbyKeepAlive } from './lobbyKeepAlive.ts';
import { LobbyGameFeed } from './lobbyGameFeed.ts';
import {
  gameHasPlayer,
  type GameLaunch,
  type GameMappingContext,
  isLiveGame,
  joinFailureReason,
  type LobbyMessage,
  type LobbyPlayer,
  parseAvatarList,
  parseGameInfo,
  parseGameLaunch,
  parsePlayer,
  parsePlayerInfo,
  parseSessionId,
  parseSocial,
  type RawGame,
  repeatsJoinFailure,
  type SocialInfo,
  stripHtml,
  toLobbyGame,
} from './lobbyProtocol.ts';
import { LobbyReplies } from './lobbyReplies.ts';
import { generateUid } from './uid.ts';

export interface LobbyEvents {
  onState(state: LobbyState): void;
  onGames(update: LobbyGamesUpdate): void;
  onNotice(notice: LobbyNotice): void;
}

/** The server rejected the login itself; retrying with the same credentials will not help. */
class LobbyLoginError extends Error {}

export interface HostGameRequest {
  title: string;
  mapName: string;
  featuredMod: string;
  password: string | null;
  friendsOnly: boolean;
  ratingMin: number | null;
  ratingMax: number | null;
  enforceRatingRange: boolean;
}

/** A server message addressed to the running game (HostGame, JoinGame, ConnectToPeer, IceMsg, ...). */
export type GameMessageListener = (command: string, args: unknown[]) => void;

/** Takes a game launch nobody asked for, such as a matchmaker match; false leaves it to the default handling. */
export type LaunchHandler = (launch: GameLaunch) => boolean;

const USER_AGENT = 'tfaf-launcher';
const AVATAR_LIST_TIMEOUT_MS = 10_000;
const GAME_LAUNCH_TIMEOUT_MS = 60_000;
const INITIAL_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
// While a game or a room is on, players reconnect through the lobby server: it comes back within seconds, and a
// login step that hangs is given up sooner.
const GAME_RECONNECT_DELAY_FACTOR = 0.2;
const GAME_MAX_RECONNECT_DELAY_MS = 5_000;
const GAME_REPLY_TIMEOUT_MS = 10_000;
const MAX_PENDING_GAME_MESSAGES = 1_000;

/** Connection to the FAF lobby server: login, keep-alive, reconnects and the live list of games. */
export class LobbyService {
  private readonly api: FafApi;
  private readonly auth: AuthService;
  private readonly featuredMods: FeaturedModCatalog;
  private readonly events: LobbyEvents;
  private readonly version: string;
  private readonly localMapPreview: (mapFolderName: string) => string | null;

  private state: LobbyState = { status: 'disconnected', error: null };
  private connection: LobbyConnection | null = null;
  private attempt = 0;
  private wanted = false;
  private kicked = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private gameActive = false;
  private readonly keepAlive = new LobbyKeepAlive({
    sendPing: () => this.connection?.send({ command: 'ping' }),
    onDead: () => {
      this.connection?.close();
      this.onClose(t('main.lobby.serverSilent'));
    },
  });
  private previousCommand: string | null = null;
  private readonly replies = new LobbyReplies();
  private readonly gameMessageListeners = new Set<GameMessageListener>();
  private readonly stateListeners = new Set<(state: LobbyState) => void>();
  private readonly gameListeners = new Set<(gameId: number) => void>();
  private readonly socialListeners = new Set<() => void>();
  private readonly messageListeners = new Set<(message: LobbyMessage) => void>();
  private readonly friendListeners = new Set<(event: FriendEvent) => void>();
  private readonly playerListeners = new Set<(playerIds: ReadonlySet<number> | null) => void>();
  private readonly friendActivity = new FriendActivity();
  private launchHandler: LaunchHandler | null = null;
  private readonly playersByLogin = new Map<string, LobbyPlayer>();
  private social: SocialInfo = { channels: [], friends: new Set(), foes: new Set() };
  private self: LobbyPlayer | null = null;

  private readonly players = new Map<number, LobbyPlayer>();
  private readonly games = new Map<number, RawGame>();
  private readonly feed = new LobbyGameFeed({
    games: this.games,
    context: () => this.mappingContext(),
    onGameChanged: (gameId) => {
      for (const listener of this.gameListeners) {
        listener(gameId);
      }
    },
    onUpdate: (update) => this.events.onGames(update),
    onStale: () => this.clearData(),
  });
  private featuredModNames = new Map<string, string>();
  private readonly pendingGameMessages: LobbyMessage[] = [];

  constructor(
    api: FafApi,
    auth: AuthService,
    featuredMods: FeaturedModCatalog,
    version: string,
    events: LobbyEvents,
    localMapPreview: (mapFolderName: string) => string | null,
  ) {
    this.api = api;
    this.auth = auth;
    this.featuredMods = featuredMods;
    this.version = version;
    this.events = events;
    this.localMapPreview = localMapPreview;
  }

  getState(): LobbyState {
    return this.state;
  }

  /** Full list of visible games; the renderer replaces its copy with it and applies later updates on top. */
  getGames(): LobbyGame[] {
    return this.feed.snapshot();
  }

  /** Paused, the renderer's list of games waits; everything else that follows the lobby goes on. */
  setUpdatesPaused(paused: boolean): void {
    this.feed.setPaused(paused);
  }

  /** Started games, newest first; the replays tab asks for them while it is shown. */
  getLiveGames(): LiveGame[] {
    const context = this.mappingContext();
    return [...this.games.values()]
      .filter(isLiveGame)
      .map((game) => ({ ...toLobbyGame(game, context), launchedAt: game.launchedAt }))
      .sort((a, b) => (b.launchedAt ?? '').localeCompare(a.launchedAt ?? ''));
  }

  /** The logged in player as the lobby server knows it (ratings, clan, country). */
  getSelf(): LobbyPlayer | null {
    return this.self ? (this.players.get(this.self.id) ?? this.self) : null;
  }

  getRawGame(gameId: number): RawGame | null {
    return this.games.get(gameId) ?? null;
  }

  /** Every game the server announced, listed or not. */
  getRawGames(): RawGame[] {
    return [...this.games.values()];
  }

  /** Any game as the renderer shows it, listed or not, like the one the player is in. */
  getLobbyGame(gameId: number): LobbyGame | null {
    const game = this.games.get(gameId);
    return game ? toLobbyGame(game, this.mappingContext()) : null;
  }

  getPlayer(playerId: number): LobbyPlayer | null {
    return this.players.get(playerId) ?? null;
  }

  /** Online players whose login contains the text, those starting with it first. */
  findPlayers(query: string, limit: number): LobbyPlayer[] {
    const text = query.trim().toLowerCase();
    if (!text) {
      return [];
    }
    return [...this.playersByLogin.entries()]
      .filter(([login]) => login.includes(text))
      .sort(([a], [b]) => Number(!a.startsWith(text)) - Number(!b.startsWith(text)) || a.localeCompare(b))
      .slice(0, limit)
      .map(([, player]) => player);
  }

  /** The player is in a game that is open or running. */
  isPlayerInGame(playerId: number): boolean {
    return this.getPlayerGame(playerId) !== null;
  }

  /** The open or running game a player is in. */
  getPlayerGame(playerId: number): RawGame | null {
    return (
      [...this.games.values()].find(
        (game) => (game.state === 'open' || game.state === 'playing') && game.teamIds.some((team) => team.playerIds.includes(playerId)),
      ) ?? null
    );
  }

  /** Running matchmaker games of a leaderboard. */
  countMatchmakerGames(leaderboard: string): number {
    return [...this.games.values()].filter(
      (game) => game.gameType === 'matchmaker' && game.ratingType === leaderboard && game.state === 'playing',
    ).length;
  }

  /** Server messages that are not for the game, after the lobby handled them itself. */
  onServerMessage(listener: (message: LobbyMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  setLaunchHandler(handler: LaunchHandler | null): void {
    this.launchHandler = handler;
  }

  /** Sends a command that has no answer to wait for, such as the matchmaker's. */
  send(message: LobbyMessage): void {
    this.requireConnection().send(message);
  }

  /** An online player by login, as the chat knows them; null for those in the chat only. */
  getPlayerByLogin(login: string): LobbyPlayer | null {
    return this.playersByLogin.get(login.toLowerCase()) ?? null;
  }

  /** Chat channels the server asks the client to join, and the player's friends and foes. */
  getSocial(): SocialInfo {
    return this.social;
  }

  onSocialChanged(listener: () => void): () => void {
    this.socialListeners.add(listener);
    return () => this.socialListeners.delete(listener);
  }

  /** Makes a player a friend or a foe, or neither; the server keeps the lists for every client of the account. */
  setRelation(playerId: number, relation: 'friend' | 'foe' | null): void {
    const connection = this.requireConnection();
    const current = this.social.friends.has(playerId) ? 'friend' : this.social.foes.has(playerId) ? 'foe' : null;
    if (current === relation) {
      return;
    }
    if (current) {
      connection.send({ command: 'social_remove', [current]: playerId });
      this.social[current === 'friend' ? 'friends' : 'foes'].delete(playerId);
    }
    if (relation) {
      connection.send({ command: 'social_add', [relation]: playerId });
      this.social[relation === 'friend' ? 'friends' : 'foes'].add(playerId);
    }
    this.notifySocial();
    this.feed.resend();
  }

  /** The avatars the server lets the signed-in player wear (`AvatarListRequest` of faf-java-commons). */
  async listAvatars(): Promise<PlayerAvatar[]> {
    this.requireConnection().send({ command: 'avatar', action: 'list_avatar' });
    const reply = await this.replies.wait(['avatar'], AVATAR_LIST_TIMEOUT_MS, (message) => Array.isArray(message.avatarlist));
    return parseAvatarList(reply);
  }

  /** Null takes the avatar off; the server then sends the player's info again with the new avatar. */
  selectAvatar(url: string | null): void {
    this.requireConnection().send({ command: 'avatar', action: 'select', avatar: url });
  }

  /** Friends coming online or leaving, joining an open game or starting to play. */
  onFriendActivity(listener: (event: FriendEvent) => void): () => void {
    this.friendListeners.add(listener);
    return () => this.friendListeners.delete(listener);
  }

  /** Players coming online, leaving or changing (clan, avatar, ratings); null when the whole list is dropped. */
  onPlayersChanged(listener: (playerIds: ReadonlySet<number> | null) => void): () => void {
    this.playerListeners.add(listener);
    return () => this.playerListeners.delete(listener);
  }

  /** Changes of any game, listed or not: players joining, teams, state. */
  onGameChanged(listener: (gameId: number) => void): () => void {
    this.gameListeners.add(listener);
    return () => this.gameListeners.delete(listener);
  }

  onStateChanged(listener: (state: LobbyState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onGameMessage(listener: GameMessageListener): () => void {
    this.gameMessageListeners.add(listener);
    return () => this.gameMessageListeners.delete(listener);
  }

  async requestHostGame(request: HostGameRequest): Promise<GameLaunch> {
    this.requireConnection().send({
      command: 'game_host',
      title: request.title,
      mapname: request.mapName,
      mod: request.featuredMod,
      visibility: request.friendsOnly ? 'friends' : 'public',
      password: request.password,
      access: request.password ? 'password' : 'public',
      rating_min: request.ratingMin,
      rating_max: request.ratingMax,
      enforce_rating_range: request.enforceRatingRange,
    });
    // The server reports a rejected game (bad title, unknown map) as an error notice instead of an answer.
    const reply = await this.replies.wait(
      ['game_launch', 'notice'],
      GAME_LAUNCH_TIMEOUT_MS,
      (message) => message.command !== 'notice' || message.style === 'error',
    );
    if (reply.command === 'notice') {
      const reason = stripHtml(asString(reply.text) ?? '') || t('main.lobby.noReason');
      throw new Error(t('main.lobby.hostRejected', { reason }));
    }
    return parseGameLaunch(reply);
  }

  async requestJoinGame(gameId: number, password: string | null): Promise<GameLaunch> {
    this.requireConnection().send({ command: 'game_join', uid: gameId, password });
    const reply = await this.replies.wait(['game_launch', 'game_join_failed'], GAME_LAUNCH_TIMEOUT_MS);
    if (reply.command === 'game_join_failed') {
      throw new Error(t('main.lobby.joinFailed', { reason: joinFailureReason(reply.reason) }));
    }
    return parseGameLaunch(reply);
  }

  /** While the lobby reconnects, the game's reports (results, ICE candidates) wait for restore_game_session. */
  sendGameMessage(command: string, args: unknown[]): void {
    const message: LobbyMessage = { command, target: 'game', args };
    if (this.connection && this.state.status === 'connected') {
      this.connection.send(message);
    } else if (this.pendingGameMessages.length < MAX_PENDING_GAME_MESSAGES) {
      this.pendingGameMessages.push(message);
    }
  }

  /** Re-attaches the running game to the lobby after a reconnect and sends what the game reported meanwhile. */
  restoreGameSession(gameId: number): void {
    if (!this.connection) {
      return;
    }
    this.connection.send({ command: 'restore_game_session', game_id: gameId });
    for (const message of this.pendingGameMessages.splice(0)) {
      this.connection.send(message);
    }
  }

  hasPendingGameMessages(): boolean {
    return this.pendingGameMessages.length > 0;
  }

  /** Drops queued reports when there is no game left to attach them to. */
  discardGameMessages(): void {
    this.pendingGameMessages.length = 0;
  }

  /** After sleep the socket usually only looks alive; a fresh connection is faster than waiting for the silence limit. */
  onSystemResume(): void {
    if (this.wanted && !this.kicked) {
      this.reconnect();
    }
  }

  /** While a game or a room is on, a dead connection is noticed within seconds and comes back sooner. */
  setGameActive(active: boolean): void {
    this.gameActive = active;
    this.keepAlive.setGameActive(active);
  }

  /** The network adapter lost every player at once: asks the server for an answer and reconnects without one. */
  probe(): void {
    if (this.state.status === 'connected') {
      this.keepAlive.probe();
    }
  }

  start(): void {
    this.wanted = true;
    this.kicked = false;
    void this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.attempt++;
    this.cancelReconnect();
    this.closeConnection();
    this.clearData();
    this.discardGameMessages();
    this.setState({ status: 'disconnected', error: null });
  }

  /** Starts a fresh attempt right away; one that hangs or a connection that only looks alive is dropped. */
  reconnect(): void {
    if (!this.wanted) {
      throw new Error(t('main.auth.signInRequired'));
    }
    this.kicked = false;
    this.cancelReconnect();
    this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    if (this.state.status !== 'disconnected') {
      this.attempt++;
      this.closeConnection();
      this.feed.markStale();
      this.setState({ status: 'disconnected', error: null });
    }
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.wanted || this.state.status !== 'disconnected') {
      return;
    }
    const attempt = ++this.attempt;
    this.setState({ status: 'connecting', error: null });
    const startedAt = Date.now();
    const timings: string[] = [];
    const timed = async <T>(name: string, work: Promise<T>): Promise<T> => {
      const stepStartedAt = Date.now();
      const result = await work;
      timings.push(`${name} ${Date.now() - stepStartedAt} ms`);
      return result;
    };
    try {
      // The mod names only label the game list, so they load while the login runs.
      const featuredMods = this.loadFeaturedMods();
      const access = asObject(await timed('access', this.api.getFromUserService('/lobby/access')));
      const url = asString(access?.accessUrl);
      if (!url || !isFafWebSocketUrl(url)) {
        throw new Error(t('main.lobby.invalidUrl'));
      }
      const connection = await timed(
        'socket',
        LobbyConnection.open(url, {
          onMessage: (message) => {
            if (attempt === this.attempt) {
              this.onMessage(message);
            }
          },
          onClose: (reason) => {
            if (attempt === this.attempt) {
              this.onClose(reason);
            }
          },
        }),
      );
      if (attempt !== this.attempt) {
        connection.close();
        return;
      }
      this.connection = connection;
      const replyTimeoutMs = this.gameActive ? GAME_REPLY_TIMEOUT_MS : undefined;

      connection.send({ command: 'ask_session', user_agent: USER_AGENT, version: this.version });
      const session = parseSessionId(await timed('session', this.replies.wait(['session'], replyTimeoutMs)));
      if (session === null) {
        throw new Error(t('main.lobby.noSession'));
      }
      const [uniqueId, token] = await Promise.all([
        timed('uid', generateUid(session)),
        timed('token', this.auth.getAccessToken()),
      ]);
      connection.send({ command: 'auth', token: token.value, unique_id: uniqueId, session });
      const reply = await timed('welcome', this.replies.wait(['welcome', 'authentication_failed'], replyTimeoutMs));
      if (reply.command === 'authentication_failed') {
        throw new LobbyLoginError(stripHtml(asString(reply.text) ?? '') || t('main.lobby.loginRejected'));
      }
      this.self = parsePlayer(reply.me) ?? parsePlayer({ id: reply.id, login: reply.login });
      await featuredMods;
      if (attempt !== this.attempt) {
        return;
      }
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      this.keepAlive.start();
      console.info(`Lobby connected in ${Date.now() - startedAt} ms (${timings.join(', ')})`);
      this.setState({ status: 'connected', error: null });
    } catch (error) {
      if (attempt !== this.attempt) {
        return;
      }
      console.warn('Lobby connection failed', describeError(error));
      this.closeConnection();
      this.feed.markStale();
      this.setState({ status: 'disconnected', error: describeError(error) });
      if (!(error instanceof LobbyLoginError)) {
        this.scheduleReconnect();
      }
    }
  }

  private onMessage(message: LobbyMessage): void {
    this.keepAlive.messageReceived();
    const previousCommand = this.previousCommand;
    this.previousCommand = message.command;
    if (message.command === 'welcome') {
      this.friendActivity.reset();
      this.beginResync();
    }
    const awaited = this.replies.deliver(message);
    if (message.command === 'game_launch' && !awaited) {
      if (this.takeLaunch(message)) {
        return;
      }
      // The answer came after host/join had given up, so no game will start; the server is told so.
      console.warn('Lobby server launched a game nobody waits for, reporting it as ended');
      this.connection?.send({ command: 'GameState', target: 'game', args: ['Ended'] });
      return;
    }

    if (message.target === 'game') {
      const args = Array.isArray(message.args) ? message.args : [];
      for (const listener of this.gameMessageListeners) {
        listener(message.command, args);
      }
      return;
    }

    switch (message.command) {
      case 'ping':
        this.connection?.send({ command: 'pong' });
        break;
      case 'player_info':
        this.onPlayers(message);
        break;
      case 'game_info':
        this.onGames(message);
        break;
      case 'notice':
        if (!repeatsJoinFailure(previousCommand, message)) {
          this.onNotice(message);
        }
        break;
      case 'social':
        this.social = parseSocial(message);
        this.notifySocial();
        this.feed.resend();
        break;
      case 'invalid':
        console.warn('Lobby server rejected a message');
        break;
      default:
        break;
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private takeLaunch(message: LobbyMessage): boolean {
    if (!this.launchHandler) {
      return false;
    }
    try {
      return this.launchHandler(parseGameLaunch(message));
    } catch (error) {
      console.warn('Game launch could not be handled', describeError(error));
      return false;
    }
  }

  private onPlayers(message: LobbyMessage): void {
    const { online, offlineIds } = parsePlayerInfo(message);
    const changes: PlayerChange[] = [];
    const changed = new Set<number>();
    for (const player of online) {
      const previous = this.players.get(player.id);
      if (previous && previous.login.toLowerCase() !== player.login.toLowerCase()) {
        this.playersByLogin.delete(previous.login.toLowerCase());
      }
      this.players.set(player.id, player);
      this.playersByLogin.set(player.login.toLowerCase(), player);
      changes.push({ previous, next: player });
      changed.add(player.id);
    }
    for (const id of offlineIds) {
      const previous = this.players.get(id);
      if (previous) {
        this.players.delete(id);
        if (this.playersByLogin.get(previous.login.toLowerCase()) === previous) {
          this.playersByLogin.delete(previous.login.toLowerCase());
        }
        changes.push({ previous, next: null });
        changed.add(id);
      }
    }
    for (const game of this.games.values()) {
      if (gameHasPlayer(game, changed)) {
        this.feed.markDirty(game.id);
      }
    }
    this.emitFriendEvents(this.friendActivity.playersChanged(changes, this.social.friends));
    if (changed.size > 0) {
      this.notifyPlayers(changed);
    }
  }

  private onGames(message: LobbyMessage): void {
    const changes: GameChange[] = [];
    for (const game of parseGameInfo(message)) {
      changes.push({ previous: this.games.get(game.id), next: game });
      if (game.state === 'closed') {
        this.games.delete(game.id);
      } else {
        this.games.set(game.id, game);
      }
      this.feed.markDirty(game.id);
    }
    const snapshot = Array.isArray(message.games);
    this.emitFriendEvents(this.friendActivity.gamesChanged(changes, snapshot, this.players, this.social.friends));
  }

  private emitFriendEvents(events: readonly FriendEvent[]): void {
    for (const event of events) {
      for (const listener of this.friendListeners) {
        listener(event);
      }
    }
  }

  private onNotice(message: LobbyMessage): void {
    const style = asString(message.style);
    const text = stripHtml(asString(message.text) ?? '');
    if (style === 'kick') {
      this.kicked = true;
      this.events.onNotice({ id: randomUUID(), style: 'error', text: text || t('main.lobby.kicked') });
      this.connection?.close();
      return;
    }
    if (text) {
      const level = style === 'error' ? 'error' : style === 'warning' ? 'warning' : 'info';
      this.events.onNotice({ id: randomUUID(), style: level, text });
    }
  }

  private onClose(reason: string): void {
    this.replies.rejectAll(new Error(t('main.lobby.closedReason', { reason })));
    if (this.state.status !== 'connected') {
      return;
    }
    console.warn('Lobby connection lost', reason);
    this.closeConnection();
    this.feed.markStale();
    this.setState({
      status: 'disconnected',
      error: this.kicked ? t('main.lobby.kicked') : t('main.lobby.connectionLost', { reason }),
    });
    this.scheduleReconnect();
  }

  private requireConnection(): LobbyConnection {
    if (!this.connection || this.state.status !== 'connected') {
      throw new Error(t('main.lobby.notConnected'));
    }
    return this.connection;
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.kicked || this.reconnectTimer) {
      return;
    }
    const baseMs = this.gameActive
      ? Math.min(this.reconnectDelayMs * GAME_RECONNECT_DELAY_FACTOR, GAME_MAX_RECONNECT_DELAY_MS)
      : this.reconnectDelayMs;
    // ±20% jitter, so clients dropped by the same server restart do not all come back at once.
    const delayMs = Math.round(baseMs * (0.8 + Math.random() * 0.4));
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeConnection(): void {
    this.keepAlive.stop();
    this.connection?.close();
    this.connection = null;
    this.replies.rejectAll(new Error(t('main.lobby.closed')));
  }

  /**
   * The server sends the whole list again after login. The renderer keeps showing the old one until the new list has
   * arrived and then gets it in one update, so the games do not blink out on every reconnect.
   */
  private beginResync(): void {
    const showingGames = this.feed.showing;
    this.clearData(!showingGames);
    if (showingGames) {
      this.feed.resyncSoon();
    }
  }

  private clearData(notify = true): void {
    this.self = null;
    this.players.clear();
    this.playersByLogin.clear();
    this.games.clear();
    this.feed.reset(notify);
    this.notifyPlayers(null);
  }

  private notifySocial(): void {
    for (const listener of this.socialListeners) {
      listener();
    }
  }

  private notifyPlayers(playerIds: ReadonlySet<number> | null): void {
    for (const listener of this.playerListeners) {
      listener(playerIds);
    }
  }

  private mappingContext(): GameMappingContext {
    return {
      players: this.players,
      friends: this.social.friends,
      featuredModNames: this.featuredModNames,
      contentBaseUrl: this.auth.getServer().contentBaseUrl,
      localMapPreview: this.localMapPreview,
    };
  }

  private async loadFeaturedMods(): Promise<void> {
    try {
      this.featuredModNames = await this.featuredMods.displayNames();
    } catch (error) {
      console.warn('Featured mods could not be loaded', describeError(error));
    }
  }

  private setState(state: LobbyState): void {
    this.state = state;
    this.events.onState(state);
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}
