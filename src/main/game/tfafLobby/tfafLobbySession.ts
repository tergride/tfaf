// One launcher's side of a TFAF lobby. The host owns the room: it applies what the players ask for, sends everyone the
// room and tells the FAF server what the game's own lobby would. A player shows the host's room and reports its own
// files and connections. Start runs every game at once; if one fails, everyone is back in the room, and the server,
// which hears of a start only from the game itself, has noticed nothing.

import { randomInt } from 'node:crypto';
import type {
  GameFilesReport,
  GamePeer,
  LobbyAbortReason,
  LobbyAction,
  LobbyChatLine,
  LobbyFilesState,
  LobbyLaunch,
  LobbyPreset,
  LobbyRoom,
  LobbySimMod,
  LobbyMap,
  TfafLobbyView,
} from '../../../shared/contract.ts';
import { LOBBY_LIMITS } from '../../../shared/contract.ts';
import { factionKey, factionNumber, isSpotChange, roomQuality, slotPlayerId, SPOT_CHANGE_INTERVAL_MS, startBlockers } from '../../../shared/tfafLobby.ts';
import { describeError } from '../../errors.ts';
import { t } from '../../i18n.ts';
import type { LobbyAdapter } from '../iceAdapter.ts';
import { addMember, applyAction, applyPreset, type NewMember, removeMember, setMap, setMods, setPhase, updateMember } from './lobbyRoom.ts';
import { launchDigest } from './launchConfig.ts';
import { type LobbyWireMessage, parseLobbyMessage, serializeLobbyMessage } from './lobbyWire.ts';
import { type GameMessage, launchMessages, serverDifference } from './serverSync.ts';

// A map as big as the game knows takes a while to load, but nothing else takes this long.
const START_TIMEOUT_MS = 3 * 60 * 1000;
// A game named in `hostReady` before it hosts would fail to reach the host; the adapter gives it the same second.
const HOST_READY_DELAY_MS = 2_000;
const ROOM_SEND_DELAY_MS = 100;
const STATUS_SEND_DELAY_MS = 250;
// Delivery retries on its own, so a host this quiet is gone or stuck, and a player is not held up longer.
const SPOT_ANSWER_TIMEOUT_MS = 5_000;
// The chat commands of the game's lobby for a private message.
// eslint-disable-next-line regexp/no-super-linear-backtracking -- anchored, on one chat line of limited length
const WHISPER = /^\/(?:w|pm|private|whisper)\s+(\S+)\s+(.+)$/is;
// Above the numbers the host gives its lines: a private message is not numbered by the host.
const FIRST_OWN_LINE = 2 ** 40;

export interface TfafLobbySessionDependencies {
  selfId: number;
  selfLogin: string;
  /** Only this player's rooms and orders count. */
  hostLogin: string;
  adapter: LobbyAdapter;
  sendToServer(message: GameMessage): void;
  /** Who a player is, from the lobby server's list. */
  memberInfo(id: number, login: string): NewMember;
  /** Host: makes sure the map is installed and reads it. */
  loadMap(folderName: string): Promise<LobbyMap>;
  /** Host: installs the mods, makes them active and names the sim mods among them. */
  loadMods(modUids: string[]): Promise<LobbySimMod[]>;
  /** Host: the keys of a map's own options, which go with the map. */
  mapOptionKeys(folderName: string): Promise<string[]>;
  /** Host: the room's options changed, to start the next room with them. */
  rememberOptions(room: LobbyRoom): void;
  /** Host: a game of this room starts. */
  rememberGame(room: LobbyRoom): void;
  /** The faction (by its key) or colour the player chose for themselves. */
  rememberSeat(seat: { faction?: string; color?: number }): void;
  /** What the player chose in the last room, to take up in this one. */
  rememberedSeat: { faction: string | null; color: number | null };
  /** Host: every open position of the room is taken. */
  onRoomFull(): void;
  /** The room's map or mods changed: the launcher brings them in like those of a game's lobby. */
  followFiles(room: LobbyRoom): void;
  /** Host: settles the match of a start (launchConfig.ts); throws when the start cannot go ahead. */
  resolveLaunch(room: LobbyRoom): Promise<LobbyLaunch>;
  /** Starts the game of this room for the match the host settled. */
  launchGame(room: LobbyRoom, launch: LobbyLaunch): Promise<void>;
  /** Host: a start the launcher could not settle, with why. */
  onStartRefused(error: unknown): void;
  /** Closes the game of an abandoned start. */
  closeGame(): void;
  /** Leaves the room for good: the host removed us, saying why or not. */
  leave(reason: string | null): void;
  filesReport(): GameFilesReport | null;
  mapPreview(folderName: string): { small: string; large: string } | null;
  onChange(): void;
  log(message: string): void;
}

/** What a start's match is made of: everything in the room but the members' readiness, files and connections. */
function matchOf(room: LobbyRoom): string {
  const { revision: _revision, members, phase: _phase, ...match } = room;
  return JSON.stringify({ ...match, members: members.map(({ id, login }) => [id, login]) });
}

/** Nobody else can come in, and someone did: the host alone does not fill a room by closing it. */
function isRoomFull(room: LobbyRoom): boolean {
  return room.members.length > 1 && room.slots.every((slot) => slot.closed || slot.occupant !== null);
}

export class TfafLobbySession {
  private readonly deps: TfafLobbySessionDependencies;
  private room: LobbyRoom | null;
  readonly hosting: boolean;
  /** The host's player id, once its launcher is known. */
  private hostId: number | null = null;
  private chat: LobbyChatLine[] = [];
  private nextLine = 1;
  private nextOwnLine = FIRST_OWN_LINE;
  /** A player takes up their faction and colour once, on first finding a seat in the room. */
  private seatTaken = false;
  private filesState: LobbyFilesState = 'preparing';
  private connected: number[] = [];
  private lastAbort: TfafLobbyView['lastAbort'] = null;
  /** What the server has been told so far. */
  private reported: LobbyRoom | null = null;
  private readonly kicked = new Set<number>();
  private startId: number | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private hostReadyTimer: NodeJS.Timeout | null = null;
  private roomTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private nextAct = 1;
  /** Our spot change the host has not answered yet. */
  private awaitedAct: number | null = null;
  /** Runs while our next spot change has to wait, for the host's answer or for the pause between changes. */
  private spotLockTimer: NodeJS.Timeout | null = null;
  /** Host: when each member last changed spots. */
  private readonly spotChangedAt = new Map<number, number>();
  private launched = false;
  private closed = false;
  /** The match of the start in progress. */
  private launch: LobbyLaunch | null = null;
  /** Host: settling a start, which a second press of Start must not repeat. */
  private resolving = false;
  /** The code of our game TFAF does not support (launchCodeGuard.ts). */
  private unsupported: string[] = [];

  constructor(deps: TfafLobbySessionDependencies, room: LobbyRoom | null) {
    this.deps = deps;
    this.room = room;
    this.hosting = room !== null;
  }

  get currentRoom(): LobbyRoom | null {
    return this.room;
  }

  view(files: GameFilesReport | null): TfafLobbyView {
    const { room } = this;
    return {
      selfId: this.deps.selfId,
      hosting: this.hosting,
      room,
      chat: this.chat,
      mapPreview: room ? this.deps.mapPreview(room.map.folderName) : null,
      startBlockers: room ? startBlockers(room, files, this.hosting ? this.unsupported : []) : [],
      quality: room ? roomQuality(room) : null,
      spotChangeLocked: this.spotLockTimer !== null,
      lastAbort: this.lastAbort,
      launch: this.startId === null ? null : this.launch,
    };
  }

  /** The code of our game TFAF does not support; it keeps the host from starting. */
  setUnsupportedCode(changes: readonly string[]): void {
    this.unsupported = [...changes];
    this.deps.onChange();
  }

  /** Host: the server has our game open, so it can hear about the room, and the room's files are to be followed. */
  announce(): void {
    if (this.room) {
      this.report(this.room);
      this.deps.followFiles(this.room);
    }
  }

  /** What the user did in the room: the host applies it at once, a player asks the host. */
  async act(action: LobbyAction): Promise<void> {
    const spotChange = isSpotChange(action);
    if (spotChange && this.spotLockTimer) {
      return;
    }
    this.noteOwnSeat(action);
    if (!this.hosting) {
      const id = this.nextAct++;
      if (spotChange) {
        this.awaitedAct = id;
        this.lockSpotChanges(SPOT_ANSWER_TIMEOUT_MS);
      }
      this.toHost({ t: 'act', id, action });
      return;
    }
    const before = this.room;
    await this.apply(this.deps.selfId, action);
    if (spotChange && this.room !== before) {
      this.lockSpotChanges(SPOT_CHANGE_INTERVAL_MS);
    }
  }

  say(text: string): void {
    const trimmed = text.trim().slice(0, LOBBY_LIMITS.maxChatLength);
    if (!trimmed) {
      return;
    }
    const whisper = WHISPER.exec(trimmed);
    if (whisper) {
      this.whisper(whisper[1]!, whisper[2]!);
    } else if (this.hosting) {
      this.addLine(this.deps.selfId, this.deps.selfLogin, trimmed);
    } else {
      this.toHost({ t: 'say', text: trimmed });
    }
  }

  /** Host: settles the match and starts everyone's game for it. */
  async start(): Promise<void> {
    const room = this.room;
    if (!this.hosting || !room || room.phase !== 'open' || this.resolving || startBlockers(room, this.deps.filesReport(), this.unsupported).length > 0) {
      return;
    }
    this.resolving = true;
    let launch: LobbyLaunch;
    try {
      launch = await this.deps.resolveLaunch(room);
    } catch (error) {
      this.deps.onStartRefused(error);
      return;
    } finally {
      this.resolving = false;
    }
    const current = this.room;
    if (this.closed || !current || current.phase !== 'open') {
      return;
    }
    // Someone moved or the host changed a setting while the match was settled: it is not that room's match any more.
    if (matchOf(current) !== matchOf(room)) {
      this.deps.onStartRefused(new Error(t('main.tfafLobby.roomChanged')));
      return;
    }
    const id = randomInt(1, 2 ** 31);
    this.deps.rememberGame(current);
    this.setRoom(setPhase(current, 'starting'));
    for (const message of launchMessages(launch)) {
      this.deps.sendToServer(message);
    }
    this.sendRoomNow();
    this.toPlayers({ t: 'start', id, launch }, null);
    this.startTimer = setTimeout(() => this.abort('timeout', null), START_TIMEOUT_MS);
    this.beginGame(id, launch);
  }

  /** Host: gives up the start in progress. */
  cancelStart(): void {
    if (this.hosting && this.startId !== null) {
      this.abort('hostCancelled', null);
    }
  }

  /** Host: gives the room saved game settings; `uiMods` are the host's own, which stay on. */
  async loadPreset(preset: LobbyPreset, uiMods: readonly string[]): Promise<void> {
    const room = this.room;
    if (!this.hosting || !room || room.phase !== 'open') {
      return;
    }
    const simMods = await this.deps.loadMods([...preset.simMods.map((mod) => mod.uid), ...uiMods]);
    const mapOptions = await this.deps.mapOptionKeys(room.map.folderName);
    this.setRoom(applyPreset(this.room ?? room, preset, simMods, mapOptions));
  }

  onLobbyMessage(playerId: number, login: string, text: string): void {
    const message = parseLobbyMessage(text);
    if (!message) {
      this.deps.log(`a malformed lobby message from ${login}`);
      return;
    }
    if (message.t === 'whisper') {
      this.pushOwnLine(playerId, login, message.text, this.deps.selfLogin);
    } else if (this.hosting) {
      void this.onPlayerMessage(playerId, login, message).catch((error: unknown) =>
        this.deps.log(`a lobby message from ${login} failed: ${describeError(error)}`),
      );
    } else if (this.isHost(login)) {
      this.hostId = playerId;
      this.onHostMessage(message);
    } else {
      this.deps.log(`${login} is not the host, its lobby message is ignored`);
    }
  }

  /** A player's launcher turned out to take part in the lobby. */
  onPlayerKnown(playerId: number, login: string): void {
    if (!this.hosting) {
      if (this.isHost(login)) {
        this.hostId = playerId;
        this.sendStatus();
      }
      return;
    }
    if (this.kicked.has(playerId)) {
      this.sendTo(playerId, { t: 'kicked', reason: null }, null);
    } else if (this.room) {
      this.setRoom(addMember(this.room, this.deps.memberInfo(playerId, login)));
      this.sendRoomNow();
    }
  }

  onPlayerLeft(playerId: number): void {
    if (this.hosting && this.room) {
      this.setRoom(removeMember(this.room, playerId));
    }
  }

  /** Our own files as the launcher knows them now. */
  setFiles(state: LobbyFilesState): void {
    this.filesState = state;
    this.ownStatusChanged();
  }

  setPeers(peers: readonly GamePeer[]): void {
    const connected = peers.filter((peer) => peer.state === 'connected').map((peer) => peer.playerId);
    if (connected.join() !== this.connected.join()) {
      this.connected = connected;
      this.ownStatusChanged();
    }
  }

  /** The game of this start reached its lobby. */
  onGameInLobby(): void {
    if (this.startId === null) {
      return;
    }
    if (this.hosting) {
      this.deps.adapter.releaseGame();
      const id = this.startId;
      this.hostReadyTimer = setTimeout(() => this.toPlayers({ t: 'hostReady', id }, null), HOST_READY_DELAY_MS);
    }
  }

  /** The match began: the room's work is done. */
  onGameLaunched(): void {
    this.launched = true;
    this.clearStartTimers();
  }

  /** The game exited before the match began. */
  onGameExited(): void {
    const id = this.startId;
    if (id === null || this.launched) {
      return;
    }
    if (this.hosting) {
      this.abort('gameFailed', this.deps.selfLogin);
    } else {
      this.toHost({ t: 'startFailed', id });
      this.startId = null;
    }
  }

  close(): void {
    this.closed = true;
    this.clearStartTimers();
    for (const timer of [this.roomTimer, this.statusTimer, this.spotLockTimer]) {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private isHost(login: string): boolean {
    return login.toLowerCase() === this.deps.hostLogin.toLowerCase();
  }

  private lockSpotChanges(ms: number): void {
    if (this.spotLockTimer) {
      clearTimeout(this.spotLockTimer);
    }
    this.spotLockTimer = setTimeout(() => {
      this.spotLockTimer = null;
      this.awaitedAct = null;
      this.deps.onChange();
    }, ms);
    this.deps.onChange();
  }

  private ownStatusChanged(): void {
    if (this.hosting) {
      if (this.room) {
        this.setRoom(updateMember(this.room, this.deps.selfId, { files: this.filesState, connected: this.connected }));
      }
      return;
    }
    if (!this.statusTimer) {
      this.statusTimer = setTimeout(() => {
        this.statusTimer = null;
        this.sendStatus();
      }, STATUS_SEND_DELAY_MS);
    }
  }

  private sendStatus(): void {
    this.toHost({ t: 'status', files: this.filesState, connected: this.connected });
  }

  private async onPlayerMessage(playerId: number, login: string, message: LobbyWireMessage): Promise<void> {
    if (!this.room?.members.some((member) => member.id === playerId)) {
      return;
    }
    switch (message.t) {
      case 'act':
        await this.apply(playerId, message.action);
        // The answer goes after the room it answers for.
        if (this.roomTimer) {
          this.sendRoomNow();
        }
        this.sendTo(playerId, { t: 'done', id: message.id }, null);
        break;
      case 'status':
        this.setRoom(updateMember(this.room, playerId, message));
        break;
      case 'say':
        this.addLine(playerId, login, message.text);
        break;
      case 'startFailed':
        if (message.id === this.startId) {
          this.abort('gameClosed', login);
        }
        break;
      default:
        this.deps.log(`${login} sent what only a host sends: ${message.t}`);
    }
  }

  private onHostMessage(message: LobbyWireMessage): void {
    switch (message.t) {
      case 'done':
        if (message.id === this.awaitedAct) {
          this.awaitedAct = null;
          this.lockSpotChanges(SPOT_CHANGE_INTERVAL_MS);
        }
        break;
      case 'room':
        if (this.room === null || message.room.revision > this.room.revision) {
          const previous = this.room;
          this.room = message.room;
          this.filesFollow(previous, message.room);
          if (previous === null) {
            this.sendStatus();
          }
          this.takeRememberedSeat(message.room);
          this.deps.onChange();
        }
        break;
      case 'chat':
        this.pushLine(message.line);
        break;
      case 'start':
        // A match that does not add up to its own digest was changed on the way.
        if (this.startId === null && launchDigest(message.launch) === message.launch.digest) {
          this.lastAbort = null;
          this.beginGame(message.id, message.launch);
        }
        break;
      case 'hostReady':
        if (message.id === this.startId) {
          this.deps.adapter.releaseGame();
        }
        break;
      case 'abort':
        if (message.id === this.startId) {
          this.startId = null;
          this.lastAbort = { reason: message.reason, login: message.login };
          this.deps.closeGame();
          this.deps.onChange();
        }
        break;
      case 'kicked':
        this.deps.leave(message.reason);
        break;
      default:
        this.deps.log(`the host sent what only a player sends: ${message.t}`);
    }
  }

  private async apply(actorId: number, action: LobbyAction): Promise<void> {
    const room = this.room;
    if (!room) {
      return;
    }
    if (actorId !== room.hostId && (action.type === 'setMap' || action.type === 'setMods' || action.type === 'kick')) {
      return;
    }
    if (room.phase !== 'open') {
      return;
    }
    switch (action.type) {
      case 'setMap': {
        const map = await this.deps.loadMap(action.folderName);
        const stale = await this.deps.mapOptionKeys(room.map.folderName);
        this.deps.adapter.setHostedMap(map.folderName);
        this.setRoom(setMap(this.room ?? room, map, stale));
        break;
      }
      case 'setMods': {
        const simMods = await this.deps.loadMods(action.modUids);
        this.setRoom(setMods(this.room ?? room, simMods));
        break;
      }
      case 'kick':
        this.kick(action.playerId, action.reason ?? null);
        break;
      default:
        this.applyToRoom(room, actorId, action);
    }
  }

  /** The pause between spot changes holds here too: a launcher is not trusted to keep it. */
  private applyToRoom(room: LobbyRoom, actorId: number, action: LobbyAction): void {
    const spotChange = isSpotChange(action);
    const lastChange = this.spotChangedAt.get(actorId);
    if (spotChange && lastChange !== undefined && Date.now() - lastChange < SPOT_CHANGE_INTERVAL_MS) {
      return;
    }
    const next = applyAction(room, actorId, action);
    if (spotChange && next !== room) {
      this.spotChangedAt.set(actorId, Date.now());
    }
    this.setRoom(next);
  }

  private kick(playerId: number, reason: string | null): void {
    if (playerId === this.deps.selfId || !this.room) {
      return;
    }
    this.kicked.add(playerId);
    this.sendTo(playerId, { t: 'kicked', reason }, null);
    this.setRoom(removeMember(this.room, playerId));
  }

  private addLine(senderId: number, login: string, text: string): void {
    const line: LobbyChatLine = { id: this.nextLine++, senderId, login, text, at: new Date().toISOString() };
    this.pushLine(line);
    this.toPlayers({ t: 'chat', line }, null);
  }

  /** A private message goes straight to the player, as in the game's lobby, and the host does not see it. */
  private whisper(target: string, text: string): void {
    const login = target.toLowerCase();
    const member = this.room?.members.find((candidate) => candidate.login.toLowerCase() === login);
    if (!member || member.id === this.deps.selfId) {
      this.pushOwnLine(null, '', t('main.tfafLobby.noWhisperTarget', { player: target }), null);
      return;
    }
    this.sendTo(member.id, { t: 'whisper', text }, null);
    this.pushOwnLine(this.deps.selfId, this.deps.selfLogin, text, member.login);
  }

  private pushOwnLine(senderId: number | null, login: string, text: string, whisperTo: string | null): void {
    this.pushLine({ id: this.nextOwnLine++, senderId, login, text, at: new Date().toISOString(), whisperTo });
  }

  /** A faction or colour chosen for one's own seat is the one to start with next time. */
  private noteOwnSeat(action: LobbyAction): void {
    if (action.type !== 'setFaction' && action.type !== 'setColor') {
      return;
    }
    const room = this.room;
    const own = room?.slots.find((slot) => slotPlayerId(slot) === this.deps.selfId);
    if (!room || own?.spot !== action.spot) {
      return;
    }
    if (action.type === 'setColor') {
      this.deps.rememberSeat({ color: action.color });
      return;
    }
    const faction = factionKey(room.factions, action.faction);
    if (faction !== null) {
      this.deps.rememberSeat({ faction });
    }
  }

  /** Player: asks for last time's faction and colour as soon as the room has a seat for us. */
  private takeRememberedSeat(room: LobbyRoom): void {
    const own = room.slots.find((slot) => slotPlayerId(slot) === this.deps.selfId);
    if (this.seatTaken || !own) {
      return;
    }
    this.seatTaken = true;
    const { color } = this.deps.rememberedSeat;
    const remembered = this.deps.rememberedSeat.faction;
    const faction = remembered === null ? null : factionNumber(room.factions, remembered);
    if (faction !== null && faction !== own.faction) {
      this.toHost({ t: 'act', id: this.nextAct++, action: { type: 'setFaction', spot: own.spot, faction } });
    }
    if (color !== null && color !== own.color) {
      this.toHost({ t: 'act', id: this.nextAct++, action: { type: 'setColor', spot: own.spot, color } });
    }
  }

  private pushLine(line: LobbyChatLine): void {
    this.chat = [...this.chat, line].slice(-LOBBY_LIMITS.maxChatLines);
    this.deps.onChange();
  }

  private beginGame(id: number, launch: LobbyLaunch): void {
    this.startId = id;
    this.launch = launch;
    this.launched = false;
    this.lastAbort = null;
    const room = this.room;
    if (!room) {
      return;
    }
    this.deps.onChange();
    this.deps.launchGame(room, launch).catch((error: unknown) => {
      this.deps.log(`the game of the room did not start: ${describeError(error)}`);
      this.onGameExited();
    });
  }

  /** Host: the start is off; everyone's game closes and the room is open again. */
  private abort(reason: LobbyAbortReason, login: string | null): void {
    const id = this.startId;
    const room = this.room;
    if (id === null || !room || this.launched) {
      return;
    }
    this.clearStartTimers();
    this.startId = null;
    this.lastAbort = { reason, login };
    this.toPlayers({ t: 'abort', id, reason, login }, null);
    this.deps.closeGame();
    // The server heard the match of the start; it hears the whole room again.
    this.reported = null;
    this.setRoom(setPhase(room, 'open'));
  }

  private clearStartTimers(): void {
    for (const timer of [this.startTimer, this.hostReadyTimer]) {
      if (timer) {
        clearTimeout(timer);
      }
    }
    this.startTimer = null;
    this.hostReadyTimer = null;
  }

  private filesFollow(previous: LobbyRoom | null, next: LobbyRoom): void {
    const mods = (room: LobbyRoom | null): string | undefined => room?.simMods.map((mod) => mod.uid).join();
    if (previous?.map.folderName !== next.map.folderName || mods(previous) !== mods(next)) {
      this.filesState = 'preparing';
      this.deps.followFiles(next);
      this.ownStatusChanged();
    }
  }

  private setRoom(next: LobbyRoom): void {
    const previous = this.room;
    if (next === previous) {
      return;
    }
    this.room = next;
    this.filesFollow(previous, next);
    this.report(next);
    this.scheduleRoomSend();
    if (previous && (previous.options !== next.options || previous.autoTeams !== next.autoTeams)) {
      this.deps.rememberOptions(next);
    }
    if (previous && !isRoomFull(previous) && isRoomFull(next)) {
      this.deps.onRoomFull();
    }
    this.deps.onChange();
  }

  /** Host: the server hears only what changed. */
  private report(room: LobbyRoom): void {
    for (const message of serverDifference(this.reported, room)) {
      this.deps.sendToServer(message);
    }
    this.reported = room;
  }

  private scheduleRoomSend(): void {
    if (!this.roomTimer) {
      this.roomTimer = setTimeout(() => this.sendRoomNow(), ROOM_SEND_DELAY_MS);
    }
  }

  private sendRoomNow(): void {
    if (this.roomTimer) {
      clearTimeout(this.roomTimer);
      this.roomTimer = null;
    }
    if (this.room) {
      this.toPlayers({ t: 'room', room: this.room }, 'room');
    }
  }

  private toHost(message: LobbyWireMessage): void {
    if (this.hostId !== null) {
      this.sendTo(this.hostId, message, message.t === 'status' ? 'status' : null);
    }
  }

  private toPlayers(message: LobbyWireMessage, key: string | null): void {
    for (const member of this.room?.members ?? []) {
      if (member.id !== this.deps.selfId) {
        this.sendTo(member.id, message, key);
      }
    }
  }

  private sendTo(playerId: number, message: LobbyWireMessage, key: string | null): void {
    if (!this.closed && !this.deps.adapter.sendLobbyMessage(playerId, serializeLobbyMessage(message), key)) {
      this.deps.log(`a lobby message to player ${playerId} could not be sent`);
    }
  }
}
