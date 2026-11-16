import { randomUUID } from 'node:crypto';
import type {
  LobbyNotice,
  MatchmakerFaction,
  MatchmakerMapPool,
  MatchmakerPlayer,
  MatchmakerPrefs,
  MatchmakerQueue,
  MatchmakerQueueStatus,
  MatchmakerState,
  PartyMember,
  TaskProgress,
} from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import type { ChatService } from '../chat/chatService.ts';
import type { DesktopNotifier } from '../desktopNotifier.ts';
import { describeError } from '../errors.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import type { GameUpdater } from '../game/gameUpdater.ts';
import { isValidGamePath } from '../gameLocator.ts';
import { t } from '../i18n.ts';
import { displayedRating, type GameLaunch, type LobbyMessage, type LobbyPlayer } from '../lobby/lobbyProtocol.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import type { NotificationCenter } from '../notifications.ts';
import type { SettingsStore } from '../settings.ts';
import type { SoundPlayer } from '../sounds.ts';
import type { TaskReporter } from '../tasks.ts';
import type { MapGenerator } from '../vault/mapGenerator.ts';
import type { MapService } from '../vault/mapService.ts';
import { applyVeto, bracketForRating, queueTitle, vetoProblem, withVetoes } from './mapPools.ts';
import {
  parseMatchFound,
  parseMatchmakerInfo,
  parsePartyInfo,
  parsePartyInvite,
  parseSearchInfo,
  parseVetoesInfo,
  partyChannelName,
  type PartyInfo,
  type QueueInfo,
  vetoesMessage,
} from './matchmakerProtocol.ts';
import { downloadPoolMaps } from './poolDownloads.ts';
import { QueueCatalog } from './queueCatalog.ts';

export interface MatchmakerDependencies {
  api: Pick<FafApi, 'getCached' | 'getAll'>;
  lobby: Pick<
    LobbyService,
    | 'getState'
    | 'onStateChanged'
    | 'onServerMessage'
    | 'onGameChanged'
    | 'send'
    | 'getSelf'
    | 'getPlayer'
    | 'findPlayers'
    | 'getSocial'
    | 'isPlayerInGame'
    | 'countMatchmakerGames'
    | 'setLaunchHandler'
  >;
  settings: Pick<SettingsStore, 'get' | 'setMatchmakerPrefs'>;
  games: Pick<GameRunner, 'getState' | 'setGuard' | 'launchMatchmaker' | 'abortMatchmaker' | 'prepareAdapter'>;
  maps: Pick<MapService, 'ensureInstalled'>;
  generator: Pick<MapGenerator, 'prepare'>;
  updater: Pick<GameUpdater, 'update'>;
  tasks: Pick<TaskReporter, 'within'>;
  chat: Pick<ChatService, 'setPartyChannel'>;
  notifier: Pick<DesktopNotifier, 'show'>;
  notifications: Pick<NotificationCenter, 'add' | 'dismiss'>;
  sounds: Pick<SoundPlayer, 'play'>;
}

export interface MatchmakerEvents {
  onState(state: MatchmakerState): void;
  /** A click on a matchmaker notification. */
  onFocusRequested(): void;
  onNotice(notice: LobbyNotice): void;
}

// How long "match found", "starting" and "cancelled" stay on a queue (TeamMatchmakingService.setTimedOutMatchingStatus).
const STATUS_MS = 60_000;
const INVITE_LIFETIME_MS = 10 * 60 * 1000;
const FOUND_PLAYERS = 20;
const LISTED_FRIENDS = 100;
const EMIT_DELAY_MS = 100;

/**
 * The FAF matchmaker (TeamMatchmakingService of the official client): queues and their searches, the party, factions,
 * map vetoes and the start of a found match.
 */
export class MatchmakerService {
  private readonly deps: MatchmakerDependencies;
  private readonly events: MatchmakerEvents;
  private readonly queues = new Map<string, QueueInfo>();
  private readonly catalog: QueueCatalog;
  private readonly searching = new Set<string>();
  private readonly statuses = new Map<string, { status: MatchmakerQueueStatus; timer: NodeJS.Timeout }>();
  private party: PartyInfo | null = null;
  private partyChannel: string | null = null;
  private readonly invites = new Map<number, { login: string; receivedAt: number; timer: NodeJS.Timeout; notificationId: string }>();
  private preparing: { text: string; controller: AbortController } | null = null;
  /** The queue of a found match, until its game launches or the match is cancelled. */
  private matchQueue: string | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private sentState: string | null = null;
  private updatesPaused = false;
  private updateHeld = false;

  constructor(deps: MatchmakerDependencies, events: MatchmakerEvents) {
    this.deps = deps;
    this.events = events;
    this.catalog = new QueueCatalog(deps.api, () => this.schedule());
    deps.games.setGuard(() => this.guardReason());
    deps.lobby.setLaunchHandler((launch) => this.onLaunch(launch));
    deps.lobby.onStateChanged((state) => (state.status === 'connected' ? this.onConnected() : this.onDisconnected()));
    deps.lobby.onServerMessage((message) => this.onMessage(message));
    deps.lobby.onGameChanged(() => this.schedule());
  }

  /** Something the state depends on changed elsewhere, such as the game. */
  refresh(): void {
    this.schedule();
  }

  /** Paused, the matchmaker goes on but the renderer hears of it only when resumed. */
  setUpdatesPaused(paused: boolean): void {
    this.updatesPaused = paused;
    if (!paused && this.updateHeld) {
      this.updateHeld = false;
      this.schedule();
    }
  }

  getState(): MatchmakerState {
    const { lobby } = this.deps;
    const self = lobby.getSelf();
    const prefs = this.prefs();
    const party = this.members(self, prefs);
    const queues = [...this.queues.values()]
      .map((info) => this.queueState(info, self, prefs, party.length))
      .sort((a, b) => a.teamSize - b.teamSize || a.title.localeCompare(b.title));
    return {
      connected: lobby.getState().status === 'connected',
      queues,
      factions: prefs.factions,
      party,
      isOwner: this.isOwner(),
      searching: this.searching.size > 0,
      preparing: this.preparing?.text ?? null,
      blocker: this.blocker(queues, party),
      invites: [...this.invites.entries()].map(([playerId, invite]) => ({
        playerId,
        login: invite.login,
        receivedAt: new Date(invite.receivedAt).toISOString(),
      })),
      partyChannel: this.partyChannel,
    };
  }

  async setQueueSelected(name: string, selected: boolean): Promise<void> {
    const prefs = this.prefs();
    const unselected = prefs.unselectedQueues.filter((queue) => queue !== name);
    await this.savePrefs({ ...prefs, unselectedQueues: selected ? unselected : [...unselected, name] });
    // As in the official client, a search follows the selection: a queue switched off is left, one switched on joined.
    if (this.searching.size > 0 && this.isOwner()) {
      if (!selected && this.searching.has(name)) {
        this.deps.lobby.send({ command: 'game_matchmaking', queue_name: name, state: 'stop' });
      } else if (selected && !this.searching.has(name) && !this.preparing && this.getState().queues.find((queue) => queue.name === name)?.fits) {
        this.prepareAndJoin([name]).catch((error: unknown) =>
          this.toast('error', t('main.matchmaker.queueJoinFailed', { error: describeError(error) })),
        );
      }
    }
    this.schedule();
  }

  async setFactions(factions: MatchmakerFaction[]): Promise<void> {
    if (factions.length === 0) {
      throw new Error(t('main.matchmaker.factionRequired'));
    }
    await this.savePrefs({ ...this.prefs(), factions });
    if (this.connected()) {
      this.deps.lobby.send({ command: 'set_party_factions', factions });
    }
    this.schedule();
  }

  async startSearch(): Promise<void> {
    if (this.searching.size > 0 || this.preparing) {
      return;
    }
    const state = this.getState();
    if (state.blocker) {
      throw new Error(state.blocker);
    }
    await this.prepareAndJoin(state.queues.filter((queue) => queue.selected && queue.fits).map((queue) => queue.name));
  }

  stopSearch(): void {
    if (this.preparing) {
      this.preparing.controller.abort();
      this.preparing = null;
    }
    if (this.searching.size > 0) {
      if (!this.isOwner()) {
        throw new Error(t('main.matchmaker.party.ownerStopsSearch'));
      }
      for (const name of this.searching) {
        this.deps.lobby.send({ command: 'game_matchmaking', queue_name: name, state: 'stop' });
      }
    }
    this.schedule();
  }

  async mapPool(name: string): Promise<MatchmakerMapPool> {
    const brackets = await this.catalog.pool(name);
    const leaderboard = this.catalog.get(name)?.leaderboard ?? null;
    const self = this.deps.lobby.getSelf();
    const rating = self && leaderboard ? displayedRating(self.ratings.get(leaderboard)) : null;
    return {
      queue: name,
      brackets: withVetoes(brackets, this.prefs().vetoes),
      playerBracketId: bracketForRating(brackets, rating)?.id ?? null,
    };
  }

  async setVeto(bracketId: number, assignmentId: number, tokens: number): Promise<MatchmakerMapPool> {
    const found = this.catalog.findBracket(bracketId);
    if (!found) {
      throw new Error(t('main.matchmaker.poolOutdated'));
    }
    const prefs = this.prefs();
    const problem = vetoProblem(found.bracket, prefs.vetoes, assignmentId, tokens);
    if (problem) {
      throw new Error(problem);
    }
    const vetoes = applyVeto(prefs.vetoes, bracketId, assignmentId, tokens);
    await this.savePrefs({ ...prefs, vetoes });
    if (this.connected()) {
      this.deps.lobby.send(vetoesMessage(vetoes));
    }
    return this.mapPool(found.queue);
  }

  /** Online players to invite: the friends while the query is empty, otherwise the matching logins, friends first. */
  findPlayers(query: string): MatchmakerPlayer[] {
    const { lobby } = this.deps;
    const text = query.trim().toLowerCase();
    const { friends } = lobby.getSocial();
    const excluded = new Set([lobby.getSelf()?.id, ...(this.party?.members.map((member) => member.playerId) ?? [])]);
    const onlineFriends = [...friends]
      .flatMap((id) => lobby.getPlayer(id) ?? [])
      .filter((player) => !excluded.has(player.id) && player.login.toLowerCase().includes(text))
      .sort((a, b) => a.login.localeCompare(b.login));
    const others = text
      ? lobby
          .findPlayers(text, FOUND_PLAYERS + excluded.size + onlineFriends.length)
          .filter((player) => !excluded.has(player.id) && !friends.has(player.id))
      : [];
    return [...onlineFriends, ...others]
      .slice(0, text ? FOUND_PLAYERS : LISTED_FRIENDS)
      .map(({ id, login, clan, country }) => ({ id, login, clan, country, friend: friends.has(id) }));
  }

  invite(playerId: number): void {
    this.requireConnected();
    if (this.searching.size > 0 || this.preparing) {
      throw new Error(t('main.matchmaker.party.inviteDuringSearch'));
    }
    if (!this.isOwner()) {
      throw new Error(t('main.matchmaker.party.ownerInvites'));
    }
    const player = this.deps.lobby.getPlayer(playerId);
    if (!player) {
      throw new Error(t('main.matchmaker.party.playerOffline'));
    }
    if (player.id === this.deps.lobby.getSelf()?.id) {
      throw new Error(t('main.matchmaker.party.inviteSelf'));
    }
    this.deps.lobby.send({ command: 'invite_to_party', recipient_id: playerId });
    // Feedback on the user's own click: a toast, not an entry of the list.
    this.deps.notifications.add({
      severity: 'info',
      title: t('notifications.sources.matchmaker'),
      body: t('main.matchmaker.party.inviteSent', { login: player.login }),
      transient: true,
    });
  }

  acceptInvite(playerId: number): void {
    this.requireConnected();
    if (this.searching.size > 0 || this.preparing) {
      throw new Error(t('main.matchmaker.stopSearchFirst'));
    }
    if (this.deps.games.getState().phase !== 'idle') {
      throw new Error(t('main.game.closeGameFirst'));
    }
    if (!this.deps.lobby.getPlayer(playerId)) {
      this.dropInvite(playerId);
      throw new Error(t('main.matchmaker.party.inviterOffline'));
    }
    this.deps.lobby.send({ command: 'accept_party_invite', sender_id: playerId });
    this.dropInvite(playerId);
  }

  declineInvite(playerId: number): void {
    this.dropInvite(playerId);
  }

  kick(playerId: number): void {
    this.requireConnected();
    if (!this.party || !this.isOwner()) {
      throw new Error(t('main.matchmaker.party.ownerKicks'));
    }
    this.deps.lobby.send({ command: 'kick_player_from_party', kicked_player_id: playerId });
  }

  leaveParty(): void {
    this.requireConnected();
    if (!this.party) {
      return;
    }
    this.deps.lobby.send({ command: 'leave_party' });
    this.setParty(null);
  }

  private onConnected(): void {
    const { lobby } = this.deps;
    this.searching.clear();
    this.clearStatuses();
    this.matchQueue = null;
    this.setParty(null);
    // The server keeps none of this between sessions; the official client sends it on every connect.
    const prefs = this.prefs();
    lobby.send({ command: 'set_party_factions', factions: prefs.factions });
    lobby.send(vetoesMessage(prefs.vetoes));
    lobby.send({ command: 'matchmaker_info' });
    this.schedule();
  }

  private onDisconnected(): void {
    this.preparing?.controller.abort();
    this.preparing = null;
    this.searching.clear();
    this.setParty(null);
    this.schedule();
  }

  private onMessage(message: LobbyMessage): void {
    switch (message.command) {
      case 'matchmaker_info':
        for (const queue of parseMatchmakerInfo(message)) {
          this.queues.set(queue.name, queue);
        }
        if ([...this.queues.keys()].some((name) => !this.catalog.has(name))) {
          void this.catalog.load();
        }
        break;
      case 'search_info': {
        const search = parseSearchInfo(message);
        if (search?.searching) {
          this.searching.add(search.queue);
          this.setStatus(search.queue, null);
        } else if (search) {
          this.searching.delete(search.queue);
        }
        break;
      }
      case 'match_found':
        this.onMatchFound(parseMatchFound(message));
        break;
      case 'match_cancelled':
        this.onMatchCancelled();
        break;
      case 'update_party':
        this.onPartyInfo(parsePartyInfo(message));
        break;
      case 'party_invite':
        this.onInvite(parsePartyInvite(message));
        break;
      case 'kicked_from_party':
        this.setParty(null);
        this.notice('info', t('main.matchmaker.party.kicked'));
        break;
      case 'vetoes_info':
        this.onVetoes(message);
        break;
      default:
        return;
    }
    this.schedule();
  }

  private onMatchFound(queue: string | null): void {
    this.searching.clear();
    this.matchQueue = queue;
    if (queue) {
      this.setStatus(queue, 'matchFound');
    }
    const title = this.titleOf(queue);
    console.info(`Match found in ${queue ?? 'an unknown queue'}`);
    this.deps.sounds.play('matchFound');
    this.deps.notifier.show({
      title: t('main.matchmaker.matchFound.title'),
      body: t('main.matchmaker.matchFound.body', { queue: title }),
      onClick: () => this.events.onFocusRequested(),
    });
  }

  private onMatchCancelled(): void {
    for (const [queue, entry] of this.statuses) {
      if (entry.status === 'matchFound' || entry.status === 'launching') {
        this.setStatus(queue, 'cancelled');
      }
    }
    if (this.matchQueue) {
      this.setStatus(this.matchQueue, 'cancelled');
    }
    this.matchQueue = null;
    const stopped = this.deps.games.abortMatchmaker();
    console.info(`Match cancelled by the server${stopped ? ', its game stopped' : ''}`);
    this.toast('warning', t('main.matchmaker.matchCancelled'));
  }

  /** A game launch that is a matchmaker match starts here, whether its match_found arrived or not. */
  private onLaunch(launch: GameLaunch): boolean {
    if (launch.gameType !== 'matchmaker') {
      return false;
    }
    const queue = this.matchQueue ?? this.catalog.byLeaderboard(launch.leaderboard)?.name ?? null;
    this.matchQueue = null;
    this.searching.clear();
    if (queue) {
      this.setStatus(queue, 'launching');
    }
    console.info(`Matchmaker game ${launch.uid} launched on ${launch.mapName ?? 'no map'}`);
    const gameTitle = queue ? t('main.matchmaker.gameTitle', { queue: this.titleOf(queue) }) : t('main.matchmaker.title');
    if (!this.deps.games.launchMatchmaker(launch, gameTitle)) {
      this.notice('error', t('main.matchmaker.matchFound.anotherGame'));
    }
    this.schedule();
    return true;
  }

  private onPartyInfo(info: PartyInfo | null): void {
    const selfId = this.deps.lobby.getSelf()?.id;
    // A party without us is one we were taken out of (TeamMatchmakingService.onPartyInfo).
    this.setParty(info && info.members.some((member) => member.playerId === selfId) ? info : null);
    for (const member of info?.members ?? []) {
      this.dropInvite(member.playerId);
    }
  }

  private onInvite(sender: number | null): void {
    if (sender === null) {
      return;
    }
    const login = this.deps.lobby.getPlayer(sender)?.login ?? `#${sender}`;
    this.dropInvite(sender);
    const timer = setTimeout(() => this.dropInvite(sender), INVITE_LIFETIME_MS).unref();
    const title = t('main.matchmaker.party.inviteTitle');
    const body = t('main.matchmaker.party.inviteBody', { login });
    const notification = this.deps.notifications.add({
      severity: 'info',
      title,
      body,
      actions: [
        { label: t('main.matchmaker.party.accept'), run: () => this.acceptInvite(sender) },
        { label: t('main.matchmaker.party.decline'), run: () => this.declineInvite(sender) },
      ],
      onClick: () => this.events.onFocusRequested(),
    });
    this.invites.set(sender, { login, receivedAt: Date.now(), timer, notificationId: notification.id });
    this.deps.sounds.play('notification');
    this.deps.notifier.show({ title, body, onClick: () => this.events.onFocusRequested() });
  }

  private onVetoes(message: LobbyMessage): void {
    const { vetoes, forced } = parseVetoesInfo(message);
    this.savePrefs({ ...this.prefs(), vetoes }).catch((error: unknown) => console.warn('Vetoes could not be saved', describeError(error)));
    if (forced) {
      this.notice('info', t('main.matchmaker.veto.changedByServer'));
    }
  }

  private async prepareAndJoin(names: string[]): Promise<void> {
    const controller = new AbortController();
    this.preparing = { text: t('main.matchmaker.preparing.gameFiles'), controller };
    this.schedule();
    try {
      await this.quietly(controller, t('main.matchmaker.preparing.gameFiles'), () => this.deps.updater.update('faf'));
      await this.quietly(controller, t('main.matchmaker.preparing.adapter'), () => this.deps.games.prepareAdapter());
      for (const name of names) {
        if (controller.signal.aborted) {
          return;
        }
        await this.downloadPool(name, controller);
      }
      if (controller.signal.aborted) {
        return;
      }
      this.requireConnected();
      for (const name of names) {
        this.deps.lobby.send({ command: 'game_matchmaking', queue_name: name, state: 'start' });
      }
      console.info(`Matchmaker search started in ${names.join(', ')}`);
    } catch (error) {
      // Stopping the search cancels its downloads; that is not a failure.
      if (!controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.preparing?.controller === controller) {
        this.preparing = null;
      }
      this.schedule();
    }
  }

  private async downloadPool(name: string, controller: AbortController): Promise<void> {
    const { maps, generator } = this.deps;
    await downloadPoolMaps(await this.catalog.pool(name), {
      maps,
      generator,
      queue: name,
      title: this.titleOf(name),
      signal: controller.signal,
      quietly: (work) => this.quietly(controller, null, work),
      progress: (text) => {
        if (this.preparing?.controller === controller) {
          this.preparing = { controller, text };
          this.schedule();
        }
      },
      notice: (style, text) => this.toast(style, text),
    });
  }

  /**
   * Runs downloads whose progress the preparation line shows instead of a toast each, and which stopping the search
   * cancels. `label` names the step for a download that reports its share.
   */
  private quietly<T>(controller: AbortController, label: string | null, work: () => Promise<T>): Promise<T> {
    const report = (task: TaskProgress): void => {
      if (label && task.state === 'running' && task.progress !== null && this.preparing?.controller === controller) {
        this.preparing = { controller, text: `${label}: ${Math.round(task.progress * 100)}%` };
        this.schedule();
      }
    };
    return this.deps.tasks.within({ report, signal: controller.signal }, work);
  }

  private queueState(info: QueueInfo, self: LobbyPlayer | null, prefs: MatchmakerPrefs, partySize: number): MatchmakerQueue {
    const definition = this.catalog.get(info.name);
    const teamSize = definition?.teamSize ?? info.teamSize;
    const leaderboard = definition?.leaderboard ?? null;
    return {
      name: info.name,
      title: queueTitle(info.name, teamSize),
      teamSize,
      leaderboard,
      selected: !prefs.unselectedQueues.includes(info.name),
      fits: partySize <= teamSize,
      playersInQueue: info.playersInQueue,
      activeGames: leaderboard ? this.deps.lobby.countMatchmakerGames(leaderboard) : 0,
      popAt: info.popAt,
      status: this.statuses.get(info.name)?.status ?? (this.searching.has(info.name) ? 'searching' : 'idle'),
      rating: self && leaderboard ? displayedRating(self.ratings.get(leaderboard)) : null,
    };
  }

  private members(self: LobbyPlayer | null, prefs: MatchmakerPrefs): PartyMember[] {
    if (!self) {
      return [];
    }
    const { lobby, games } = this.deps;
    const member = (playerId: number, factions: MatchmakerFaction[]): PartyMember => {
      const player = playerId === self.id ? self : lobby.getPlayer(playerId);
      const isSelf = playerId === self.id;
      return {
        playerId,
        login: player?.login ?? `#${playerId}`,
        clan: player?.clan ?? null,
        country: player?.country ?? null,
        factions,
        owner: this.party ? this.party.owner === playerId : isSelf,
        self: isSelf,
        inGame: lobby.isPlayerInGame(playerId) || (isSelf && games.getState().phase !== 'idle'),
      };
    };
    if (!this.party) {
      return [member(self.id, prefs.factions)];
    }
    return this.party.members
      .map((entry) => member(entry.playerId, entry.playerId === self.id ? prefs.factions : entry.factions))
      .sort((a, b) => Number(b.self) - Number(a.self) || Number(b.owner) - Number(a.owner) || a.login.localeCompare(b.login));
  }

  private blocker(queues: MatchmakerQueue[], party: PartyMember[]): string | null {
    if (!this.connected()) {
      return t('main.lobby.notConnected');
    }
    if (!this.isOwner()) {
      return t('main.matchmaker.blocker.ownerSearches');
    }
    if (party.find((member) => member.self)?.inGame) {
      return t('main.matchmaker.blocker.selfInGame');
    }
    if (party.some((member) => !member.self && member.inGame)) {
      return t('main.matchmaker.blocker.memberInGame');
    }
    if (!isValidGamePath(this.deps.settings.get().gamePath)) {
      return t('main.game.gamePathMissing');
    }
    if (!queues.some((queue) => queue.selected && queue.fits)) {
      return party.length > 1 ? t('main.matchmaker.blocker.noFittingQueue') : t('main.matchmaker.blocker.noQueue');
    }
    return null;
  }

  private guardReason(): string | null {
    if (this.matchQueue) {
      return t('main.matchmaker.guard.matchFound');
    }
    if (this.preparing || this.searching.size > 0) {
      return t('main.matchmaker.guard.searching');
    }
    return null;
  }

  private isOwner(): boolean {
    return !this.party || this.party.owner === this.deps.lobby.getSelf()?.id;
  }

  private connected(): boolean {
    return this.deps.lobby.getState().status === 'connected';
  }

  private requireConnected(): void {
    if (!this.connected()) {
      throw new Error(t('main.lobby.notConnected'));
    }
  }

  private setParty(party: PartyInfo | null): void {
    this.party = party;
    const self = this.deps.lobby.getSelf();
    const owner = party && party.members.length > 1 ? (party.owner === self?.id ? self : this.deps.lobby.getPlayer(party.owner)) : null;
    const channel = owner ? partyChannelName(owner.login) : null;
    if (channel !== this.partyChannel) {
      this.partyChannel = channel;
      this.deps.chat.setPartyChannel(channel);
    }
  }

  private setStatus(queue: string, status: MatchmakerQueueStatus | null): void {
    const previous = this.statuses.get(queue);
    if (previous) {
      clearTimeout(previous.timer);
      this.statuses.delete(queue);
    }
    if (status) {
      const timer = setTimeout(() => {
        if (this.statuses.get(queue)?.timer === timer) {
          this.statuses.delete(queue);
          this.schedule();
        }
      }, STATUS_MS).unref();
      this.statuses.set(queue, { status, timer });
    }
  }

  private clearStatuses(): void {
    for (const queue of [...this.statuses.keys()]) {
      this.setStatus(queue, null);
    }
  }

  private dropInvite(playerId: number): void {
    const invite = this.invites.get(playerId);
    if (invite) {
      clearTimeout(invite.timer);
      this.invites.delete(playerId);
      this.deps.notifications.dismiss(invite.notificationId);
    }
    this.schedule();
  }

  private titleOf(queue: string | null): string {
    if (!queue) {
      return t('main.matchmaker.title');
    }
    return queueTitle(queue, this.catalog.get(queue)?.teamSize ?? this.queues.get(queue)?.teamSize ?? 1);
  }

  private prefs(): MatchmakerPrefs {
    return this.deps.settings.get().matchmaker;
  }

  private savePrefs(prefs: MatchmakerPrefs): Promise<void> {
    return this.deps.settings.setMatchmakerPrefs(prefs);
  }

  /** Goes to the bell: what must be read whenever the user gets to it. */
  private notice(style: LobbyNotice['style'], text: string): void {
    this.events.onNotice({ id: randomUUID(), style, text });
  }

  /** Matters only in the moment, such as the course of a search or the answer to the user's own click. */
  private toast(style: LobbyNotice['style'], text: string): void {
    this.events.onNotice({ id: randomUUID(), style, text, transient: true });
  }

  private schedule(): void {
    if (this.updatesPaused) {
      this.updateHeld = true;
      return;
    }
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null;
      const state = this.getState();
      // Every change of any game ends up here, and hardly any of them changes what the matchmaker shows.
      const serialized = JSON.stringify(state);
      if (serialized !== this.sentState) {
        this.sentState = serialized;
        this.events.onState(state);
      }
    }, EMIT_DELAY_MS);
  }
}
