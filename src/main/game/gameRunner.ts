import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  GamePeer,
  GameSessionKind,
  GameSessionState,
  HostGameOptions,
  JoinOutcome,
  LobbyAction,
  LobbyCatalog,
  LobbyPresets,
  LobbyUnitCatalog,
  LobbyMap,
  LobbyNotice,
  LobbyLaunch,
  LobbyRoom,
  LobbySimMod,
} from '../../shared/contract.ts';
import { isStoneMapFolder, isTfafLobbyFeaturedMod } from '../../shared/contract.ts';
import { resolveTheme } from '../../shared/themes.ts';
import { CancelledError, describeError } from '../errors.ts';
import { isValidGamePath } from '../gameLocator.ts';
import { readFactions } from '../gameOptions/factionCatalog.ts';
import { gamePackages } from '../gameOptions/gamePackages.ts';
import { loadLaunchCatalog } from '../gameOptions/launchCatalog.ts';
import { loadLobbyCatalog, readBannedMods, readMapOptionKeys } from '../gameOptions/lobbyCatalog.ts';
import { loadUnitCatalog } from '../gameOptions/unitCatalog.ts';
import { currentLocale, t } from '../i18n.ts';
import { displayedRating, type GameLaunch, isGeneratedMap, type LobbyPlayer, type RawGame } from '../lobby/lobbyProtocol.ts';
import { GameFileSystem } from '../mapView/gameFileSystem.ts';
import { pathExists } from '../vault/fsUtil.ts';
import { ensureOwnPrefs } from '../vault/gamePrefs.ts';
import { BackgroundUpdate } from './backgroundUpdate.ts';
import { exitError } from './gameExit.ts';
import { GameFileChecks } from './gameFileChecks.ts';
import { GamePreparation, type PreparedFiles } from './gamePreparation.ts';
import {
  type FollowedHost,
  type GameDetails,
  type GameRunnerDependencies,
  type GameRunnerEvents,
  IDLE,
  type NextGame,
  type ReplayLaunch,
} from './gameRunnerTypes.ts';
import { FORGED_ALLIANCE_EXE } from './gameUpdater.ts';
import { type GameFileOverride, isBuiltInMod } from './gameVault.ts';
import { latestContent } from './hostedContent.ts';
import type { IceAdapter, IceAdapterEvents } from './iceAdapter.ts';
import { buildOfflineArguments, buildReplayArguments, buildSkirmishArguments, INIT_FILE_NAME } from './launchCommand.ts';
import {
  adapterStage,
  filesStage,
  gameDetails,
  gameSimMods,
  generatedMapStage,
  lobbyStage,
  mapDetails,
  mapStage,
  modsStage,
  openLobbyStage,
  preparePlan,
  serverJoinStage,
  startStage,
  verifyStage,
} from './launchPlans.ts';
import { LaunchProgress, type StagePlan } from './launchStages.ts';
import { LobbyFeatureChecks, type PeerLauncher } from './lobbyFeatureChecks.ts';
import {
  announceFeatures,
  describeFeatures,
  type FeatureAnnouncement,
  featureName,
  hasFeature,
  supportsFeature,
} from './lobbyFeatures.ts';
import { LobbyFiles, type LobbyFilesUpdate } from './lobbyFiles.ts';
import { OnlineGame } from './onlineGame.ts';
import { PeerNumbers } from './peerNumbers.ts';
import { preparePortablePrefs, type PortablePrefsSession } from './portablePrefs.ts';
import { isForgedAllianceRunning } from './processes.ts';
import { sameMods, waitForRehostedGame } from './rehost.ts';
import { isLobbyServerTitle, lobbyServerPassword, lobbyServerTitle, lobbyTitle } from './tfafLobby/lobbyAccess.ts';
import { unsupportedLaunchCode } from './tfafLobby/launchCodeGuard.ts';
import { resolveLaunch } from './tfafLobby/launchConfig.ts';
import {
  LOBBY_STAGE_MESSAGE,
  ONLINE_PROVIDER_SCRIPT,
  onlineProviderScript,
  ROOM_LAUNCH_SCRIPT,
  roomLaunchScript,
  SCREEN_LOGO,
} from './tfafLobby/roomLaunchScript.ts';
import { ddsFromBgra } from './tfafLobby/screenLogo.ts';
import { readStoneMapRecipe } from '../stoneMap/stoneMapRecipe.ts';
import { readLobbyMap } from './tfafLobby/lobbyMapInfo.ts';
import { LAST_GAME_PRESET, validOptions } from './tfafLobby/lobbyMemory.ts';
import { createRoom, type NewMember, presetOf, type RoomMemory } from './tfafLobby/lobbyRoom.ts';
import { TfafLobbySession } from './tfafLobby/tfafLobbySession.ts';

// The base featured mod; skirmish and the background update use its files.
const FAF_FEATURED_MOD = 'faf';
const SCREEN_LOGO_SIZE = 256;
// A room whose game files differ looks for a newer build at most this often.
const GAME_FILES_FOLLOW_INTERVAL_MS = 60_000;
// How long a TFAF host's answer stays good for the join with the password it asked for.
const LOBBY_ANSWER_TTL_MS = 60_000;

/** The TFAF logo for the screen a game shows during a start, as the game's DDS; null where Electron cannot draw it. */
async function screenLogo(): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    const { app, nativeImage } = await import('electron');
    const file = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'resources', 'icon.png');
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) {
      return null;
    }
    const resized = image.resize({ width: SCREEN_LOGO_SIZE, height: SCREEN_LOGO_SIZE, quality: 'best' });
    const { width, height } = resized.getSize();
    return { data: ddsFromBgra(width, height, resized.toBitmap()), width, height };
  } catch (error) {
    console.warn('The logo of the TFAF screen could not be drawn', describeError(error));
    return null;
  }
}

/**
 * How a lobby game starts: with mod isolation or not, and on which side of the TFAF lobby feature checks
 * (lobbyFeatureChecks.ts); `hostFeatures` is what a player learnt from the host's launcher before the start.
 */
interface LobbySetup {
  isolate: boolean;
  hosting: boolean;
  hostFeatures: FeatureAnnouncement | null;
}

/** How a TFAF lobby opens: the room for the host, null for a player, who gets it from the host. */
interface LobbyRoomSetup {
  room: LobbyRoom | null;
  hostLogin: string;
  hostFeatures: FeatureAnnouncement | null;
  /** The lobby asks for a password of the host's; the host tells the players about to join (lobbyAnnouncement). */
  passwordProtected: boolean;
}

/**
 * Hosts and joins games: prepares files, asks the lobby server, starts the replay relay and the ICE adapter, launches
 * Forged Alliance and cleans up when it exits (GameRunner of the official client).
 */
export class GameRunner {
  private readonly deps: GameRunnerDependencies;
  private readonly events: GameRunnerEvents;
  private state: GameSessionState = IDLE;
  private process: ChildProcess | null = null;
  /** Persists the portable game profile before another game or launcher shutdown can proceed. */
  private gameExitWork: Promise<void> = Promise.resolve();
  private gameSpawnWork: Promise<void> = Promise.resolve();
  private shuttingDown = false;
  private killed = false;
  private desyncReported = false;
  /** The game left its lobby and started, as Forged Alliance reports with GameState Launching. */
  private gameLaunched = false;
  private starting = false;
  private readonly backgroundUpdate: BackgroundUpdate;
  private lastGameId: number | null = null;
  private startup: LaunchProgress | null = null;
  private guard: () => string | null = () => null;
  private matchmakerGameId: number | null = null;
  private readonly preparation: GamePreparation;
  private fileChecks: GameFileChecks | null = null;
  private lobbyFiles: LobbyFiles | null = null;
  private featureChecks: LobbyFeatureChecks | null = null;
  private online: OnlineGame | null = null;
  /** The game we host, with the mods its lobby has; the host can create it again with other mods. */
  private hosted: HostGameOptions | null = null;
  /** The UI mods among the hosted ones: the lobby lists only sim mods. */
  private hostedUiMods: string[] = [];
  /** The game reported its lobby up: from then on its map and mods follow the lobby. */
  private gameInLobby = false;
  /** The sim mods the lobby of the game we host reported (GameMods); null until it does. */
  private reportedMods: string[] | null = null;
  /** The game we joined, whose host we follow when it creates the game again. */
  private joined: { gameId: number; password: string | null } | null = null;
  /**
   * The game we host or joined and the password the server checks for it (a TFAF lobby's comes from the host's,
   * lobbyAccess.ts): a friend we invite joins with it (inviteAccess).
   */
  private access: { gameId: number; password: string | null } | null = null;
  private next: NextGame | null = null;
  /** The host's rehost is being announced to the players. */
  private rehosting = false;
  /** Mods of the host's rehost, downloaded while our game closes. */
  private earlyDownload: Promise<void> | null = null;
  private readonly peerNumbers = new PeerNumbers((numbers) =>
    this.setPeers(this.state.peers.map((peer) => numbers.get(peer.playerId) ?? peer)),
  );
  /** The room of a TFAF lobby, from when it opens until its match ends or we leave it. */
  private lobbySession: TfafLobbySession | null = null;
  /** The TFAF lobby we are in asks for a password of the host's; null outside of one. */
  private lobbyPassword: boolean | null = null;
  /**
   * What the host's launcher told about a TFAF lobby that asks for a password: the host answers a player once a
   * second, so the join that brings the password soon after takes the answer from here.
   */
  private lobbyAnswer: { gameId: number; at: number; features: FeatureAnnouncement } | null = null;
  /** Ends what a TFAF lobby started, once. */
  private endLobby: (() => void) | null = null;
  private readonly gameFiles: GameFileSystem;
  private readonly packageFiles = new Map<string, GameFileSystem>();
  private gameFilesFollowing = false;
  private gameFilesFollowedAt = 0;
  /** Counts the room's game launches and their ends: a start given up while its game is on the way stops it. */
  private roomLaunches = 0;

  constructor(deps: GameRunnerDependencies, events: GameRunnerEvents) {
    this.deps = deps;
    this.events = events;
    this.gameFiles = new GameFileSystem(deps.settings);
    this.preparation = new GamePreparation(deps, (style, text) => this.toast(style, text));
    this.backgroundUpdate = new BackgroundUpdate(deps.settings, deps.updater, FAF_FEATURED_MOD);
    deps.lobby.onStateChanged((lobbyState) => {
      if (lobbyState.status !== 'connected') {
        return;
      }
      // The server already launched the game once there is an id, even if Forged Alliance is still starting.
      if (this.state.phase !== 'idle' && this.state.gameId !== null) {
        deps.lobby.restoreGameSession(this.state.gameId);
        this.online?.signalingRestored();
        return;
      }
      // A game that ended while the lobby was away still owes the server its results.
      if (this.lastGameId !== null && deps.lobby.hasPendingGameMessages()) {
        deps.lobby.restoreGameSession(this.lastGameId);
      } else {
        deps.lobby.discardGameMessages();
      }
      this.lastGameId = null;
      this.backgroundUpdate.run();
    });
    deps.lobby.onGameChanged((gameId) => {
      const current = this.state.current;
      const lobbyGame = current && gameId === this.state.gameId ? deps.lobby.getLobbyGame(gameId) : null;
      // A closed game drops out of the lobby; the tab keeps what it last knew.
      if (current && lobbyGame) {
        this.setStateWithFiles({ ...this.state, current: { ...current, lobbyGame } });
        this.followLobby();
      }
      if (gameId === this.joined?.gameId && deps.lobby.getRawGame(gameId) === null) {
        this.leaveClosedLobby(gameId);
      }
    });
  }

  /**
   * The server closed the game we joined while it was in its lobby: the host left it. The FAF lobby notices a silent
   * host only after its keep-alive timeout, so the game is closed at once.
   */
  private leaveClosedLobby(gameId: number): void {
    const inRoom = this.lobbySession !== null;
    if ((this.process === null && !inRoom) || this.gameLaunched || this.next || this.state.gameId !== gameId) {
      return;
    }
    const host = this.state.current?.lobbyGame?.host ?? this.fileChecks?.hostLogin ?? '';
    console.info(`Game ${gameId} was closed in its lobby: the host ${host} left, closing the game`);
    this.toast('warning', t('main.game.hostLeft', { host }));
    if (inRoom) {
      this.closeRoom();
    } else {
      this.kill();
    }
  }

  getState(): GameSessionState {
    return this.state;
  }

  /**
   * The TFAF lobby features of the game we host, for a player about to join it, and whether a TFAF lobby asks for a
   * password; null for any other game.
   */
  lobbyAnnouncement(gameId: number): FeatureAnnouncement | null {
    const checks = this.featureChecks;
    const { gameId: ourGame, phase } = this.state;
    const inLobby = ourGame === gameId && (phase === 'running' || phase === 'lobby') && !this.gameLaunched;
    if (!checks?.hosting || !inLobby) {
      return null;
    }
    return this.lobbyPassword === null ? checks.own : { ...checks.own, password: this.lobbyPassword };
  }

  /**
   * What a player we invite into our game (gameInvites.ts), or one joining from our Discord status, needs to join it
   * without its password: the game and the password the server checks for it. Null unless we are in a custom or coop
   * game that is still in its lobby.
   */
  inviteAccess(): { gameId: number; password: string | null } | null {
    const access = this.access;
    const { gameId, phase, kind } = this.state;
    if (!access || access.gameId !== gameId || kind !== 'online' || this.gameLaunched || (phase !== 'running' && phase !== 'lobby')) {
      return null;
    }
    return this.deps.lobby.getRawGame(access.gameId)?.state === 'open' ? access : null;
  }

  async host(options: HostGameOptions): Promise<void> {
    if (options.lobbyMode === 'tfaf') {
      await this.hostLobby(options);
      return;
    }
    const self = await this.preflight();
    const adapter = this.deps.adapterPreparation();
    const plan: StagePlan[] = [
      ...(options.modUids.length > 0 ? [modsStage()] : []),
      ...preparePlan(options.mapFolderName, [], adapter),
      { id: 'server', title: t('main.game.stages.hostOnServer') },
      startStage(),
    ];
    void this.run(options.title, 'online', plan, async (startup) => {
      const { mapFolderName, modUids } = await latestContent(options, {
        settings: this.deps.settings,
        maps: this.deps.maps,
        mods: this.deps.mods,
        notice: (style, text) => this.toast(style, text),
        onUpdated: (chosen, latest) => this.events.onHostContentUpdated(chosen, latest),
      });
      this.hosted = { ...options, mapFolderName, modUids };
      // A preset may name mods that are not installed yet; they come from the vault like the mods of a joined game.
      const setMods = (): Promise<void> => this.deps.mods.ensureInstalledAndActive(modUids, { replace: true });
      await (modUids.length > 0 ? startup.run('mods', setMods) : setMods());
      const prepared = await this.preparation.prepare(startup, options.featuredMod, [], mapFolderName, adapter, modUids);
      const simMods = new Set(prepared.mods.map((mod) => mod.uid.toLowerCase()));
      this.hostedUiMods = modUids.filter((uid) => !isBuiltInMod(uid) && !simMods.has(uid.toLowerCase()));
      this.setPhase('waitingForServer');
      const launch = await startup.run('server', () =>
        this.deps.lobby.requestHostGame({
          title: options.title,
          mapName: mapFolderName,
          featuredMod: options.featuredMod,
          password: options.password,
          friendsOnly: options.friendsOnly,
          ratingMin: options.ratingMin,
          ratingMax: options.ratingMax,
          enforceRatingRange: options.enforceRatingRange,
        }),
      );
      this.access = { gameId: launch.uid, password: options.password };
      const details = gameDetails(this.deps.maps, options.featuredMod, mapFolderName, prepared.localFiles);
      const setup: LobbySetup = { isolate: options.modIsolation, hosting: true, hostFeatures: null };
      await startup.run('start', () => this.launch(launch, self, prepared, details, setup));
    });
  }

  async join(gameId: number, password: string | null): Promise<JoinOutcome> {
    const game = this.deps.lobby.getRawGame(gameId);
    if (!game) {
      throw new Error(t('main.game.gameClosed'));
    }
    if (isLobbyServerTitle(game.title)) {
      return this.joinLobby(game, password, null);
    }
    if (game.passwordProtected && !password) {
      return 'passwordRequired';
    }
    const self = await this.preflight();
    const adapter = this.deps.adapterPreparation();
    const plan: StagePlan[] = [
      // Only a TFAF host can tell its lobby features; a host the chat has not seen is asked about first.
      ...(this.deps.tfafChat.tfafVersion(game.host) !== null ? [lobbyStage()] : []),
      ...preparePlan(game.mapFolderName, gameSimMods(game), adapter),
      serverJoinStage(),
      startStage(),
    ];
    void this.run(game.title, 'online', plan, (startup) => this.joinGame(startup, game, password, self, adapter));
    return 'joining';
  }

  /**
   * Joins by an invitation (gameInvites.ts). `serverPassword` is what the server checks for the game, which a TFAF
   * lobby derives from its host's password, so the player is never asked for one.
   */
  async joinInvited(gameId: number, serverPassword: string | null): Promise<JoinOutcome> {
    const game = this.deps.lobby.getRawGame(gameId);
    if (!game) {
      throw new Error(t('main.game.gameClosed'));
    }
    if (isLobbyServerTitle(game.title)) {
      return this.joinLobby(game, null, serverPassword ?? lobbyServerPassword(null));
    }
    return this.join(gameId, serverPassword);
  }

  private async joinGame(
    startup: LaunchProgress,
    game: RawGame,
    password: string | null,
    self: LobbyPlayer,
    adapter: (() => Promise<void>) | null,
  ): Promise<void> {
    this.joined = { gameId: game.id, password };
    this.access = { gameId: game.id, password };
    const hostFeatures = startup.stages.some((stage) => stage.id === 'lobby')
      ? await startup.run('lobby', () => this.hostFeatures(game))
      : null;
    // Only a host that turned mod isolation on gets it; any other game sees the whole mods folder.
    const setup: LobbySetup = { isolate: hasFeature(hostFeatures, 'modIsolation'), hosting: false, hostFeatures };
    // The mods of a rehost may still be downloading; a second download of the same mod would collide with it.
    await this.earlyDownload;
    this.earlyDownload = null;
    const prepared = await this.preparation.prepare(startup, game.featuredMod, gameSimMods(game), game.mapFolderName, adapter);
    this.setPhase('waitingForServer');
    const launch = await startup.run('server', () => this.deps.lobby.requestJoinGame(game.id, password));
    const details = gameDetails(this.deps.maps, game.featuredMod, game.mapFolderName, prepared.localFiles);
    await startup.run('start', () => this.launch(launch, self, prepared, details, setup));
  }

  /**
   * Creates a TFAF lobby. Forged Alliance does not start: the server gets the game's state from us, and the players
   * gather in the room until the host presses Start.
   */
  private async hostLobby(options: HostGameOptions): Promise<void> {
    if (!isTfafLobbyFeaturedMod(options.featuredMod)) {
      throw new Error(t('main.tfafLobby.unsupportedFeaturedMod', { name: options.featuredMod }));
    }
    const self = await this.preflight();
    const plan: StagePlan[] = [
      ...(options.modUids.length > 0 ? [modsStage()] : []),
      ...preparePlan(options.mapFolderName, [], null),
      { id: 'server', title: t('main.game.stages.hostOnServer') },
      openLobbyStage(),
    ];
    void this.run(options.title, 'online', plan, async (startup) => {
      const { mapFolderName, modUids } = await latestContent(options, {
        settings: this.deps.settings,
        maps: this.deps.maps,
        mods: this.deps.mods,
        notice: (style, text) => this.toast(style, text),
        onUpdated: (chosen, latest) => this.events.onHostContentUpdated(chosen, latest),
      });
      await this.refuseBannedMods(options.featuredMod, modUids);
      const setMods = (): Promise<void> => this.deps.mods.ensureInstalledAndActive(modUids, { replace: true });
      await (modUids.length > 0 ? startup.run('mods', setMods) : setMods());
      const prepared = await this.preparation.prepare(startup, options.featuredMod, [], mapFolderName, null, modUids);
      const map = await this.loadRoomMap(mapFolderName);
      this.setPhase('waitingForServer');
      const launch = await startup.run('server', () =>
        this.deps.lobby.requestHostGame({
          title: lobbyServerTitle(options.title),
          mapName: mapFolderName,
          featuredMod: options.featuredMod,
          password: lobbyServerPassword(options.password),
          friendsOnly: options.friendsOnly,
          ratingMin: options.ratingMin,
          ratingMax: options.ratingMax,
          enforceRatingRange: options.enforceRatingRange,
        }),
      );
      this.access = { gameId: launch.uid, password: lobbyServerPassword(options.password) };
      const simMods = prepared.mods.map(({ uid, name }) => ({ uid, name }));
      const room = createRoom({
        host: this.memberInfo(self.id, self.login),
        title: options.title,
        featuredMod: options.featuredMod,
        factions: await readFactions(
          this.gamePackageFiles(options.featuredMod),
          simMods.map((mod) => mod.uid),
        ),
        map,
        simMods,
        memory: await this.roomMemory(options.featuredMod),
      });
      const details = gameDetails(this.deps.maps, options.featuredMod, mapFolderName, prepared.localFiles);
      await startup.run('start', () =>
        this.openLobby(launch, self, prepared, details, {
          room,
          hostLogin: self.login,
          hostFeatures: null,
          passwordProtected: Boolean(options.password),
        }),
      );
    });
  }

  /**
   * Joins a TFAF lobby: what the server calls our game runs without Forged Alliance until the host presses Start.
   * `serverPassword`, from an invitation, is what the server checks and replaces the host's `password`.
   */
  private async joinLobby(game: RawGame, password: string | null, serverPassword: string | null): Promise<JoinOutcome> {
    const self = await this.preflight();
    // Only the host's launcher knows whether its lobby has a password, so a player without one asks it first and is
    // asked for the password, instead of the server refusing the join after the downloads.
    const recent = this.lobbyAnswer;
    let told: FeatureAnnouncement | null | undefined =
      recent?.gameId === game.id && Date.now() - recent.at < LOBBY_ANSWER_TTL_MS ? recent.features : undefined;
    const checkedPassword = serverPassword ?? lobbyServerPassword(password);
    const hasPassword = password !== null || serverPassword !== null;
    if (told === undefined && !hasPassword) {
      this.starting = true;
      try {
        told = await this.hostFeatures(game);
      } finally {
        this.starting = false;
      }
    }
    if (told?.password && !hasPassword) {
      this.lobbyAnswer = { gameId: game.id, at: Date.now(), features: told };
      return 'passwordRequired';
    }
    // A StoneMap map comes with the room's recipe, which arrives only after joining; the room's files bring it in then.
    const deferMap = isStoneMapFolder(game.mapFolderName) && !(await this.deps.maps.hasCustomMap(game.mapFolderName));
    const preparedMap = deferMap ? '' : game.mapFolderName;
    const plan: StagePlan[] = [lobbyStage(), ...preparePlan(preparedMap, gameSimMods(game), null), serverJoinStage(), openLobbyStage()];
    void this.run(lobbyTitle(game.title), 'online', plan, async (startup) => {
      const hostFeatures = await startup.run('lobby', async () => (told === undefined ? this.hostFeatures(game) : told));
      if (!hasFeature(hostFeatures, 'launcherLobby')) {
        throw new Error(t('main.tfafLobby.notTfafHost'));
      }
      if (!hasFeature(hostFeatures, 'roomLaunch')) {
        throw new Error(t('main.tfafLobby.oldTfafHost'));
      }
      this.joined = { gameId: game.id, password };
      this.access = { gameId: game.id, password: checkedPassword };
      const prepared = await this.preparation.prepare(startup, game.featuredMod, gameSimMods(game), preparedMap, null);
      this.setPhase('waitingForServer');
      const launch = await startup.run('server', () => this.deps.lobby.requestJoinGame(game.id, checkedPassword));
      const details = gameDetails(this.deps.maps, game.featuredMod, game.mapFolderName, prepared.localFiles);
      await startup.run('start', () =>
        this.openLobby(launch, self, prepared, details, {
          room: null,
          hostLogin: game.host,
          hostFeatures,
          passwordProtected: Boolean(password),
        }),
      );
    });
    return 'joining';
  }

  /** What the user did in the room of the TFAF lobby. */
  async lobbyAct(action: LobbyAction): Promise<void> {
    await this.requireRoom().act(action);
  }

  lobbySay(text: string): void {
    this.requireRoom().say(text);
  }

  lobbyStart(): void {
    void this.requireRoom().start();
  }

  lobbyCancelStart(): void {
    this.requireRoom().cancelStart();
  }

  /** What the room can choose from with its map and mods; null before the host's first snapshot came. */
  async lobbyCatalog(): Promise<LobbyCatalog | null> {
    const room = this.requireRoom().currentRoom;
    if (!room) {
      return null;
    }
    const simModUids = room.simMods.map((mod) => mod.uid);
    return loadLobbyCatalog({
      files: this.gamePackageFiles(room.featuredMod),
      locale: currentLocale(),
      mapFolder: await this.gameFiles.mapFolder(room.map.folderName),
      modFolders: await this.deps.mods.gameModFolders(simModUids),
      simModUids,
    });
  }

  /** What the room can forbid with its mods; null before the host's first snapshot came. */
  async lobbyUnitCatalog(): Promise<LobbyUnitCatalog | null> {
    const room = this.requireRoom().currentRoom;
    if (!room) {
      return null;
    }
    return loadUnitCatalog({
      locale: currentLocale(),
      files: this.gamePackageFiles(room.featuredMod),
      modFolders: await this.deps.mods.gameModFolders(room.simMods.map((mod) => mod.uid)),
    });
  }

  lobbyPresets(): LobbyPresets {
    return this.deps.lobbyMemory.presets();
  }

  async lobbySavePreset(name: string): Promise<LobbyPresets> {
    const room = this.requireRoom().currentRoom;
    if (!room) {
      throw new Error(t('main.tfafLobby.notInLobby'));
    }
    const mapOptions = await this.mapOptionKeys(room.map.folderName);
    return this.deps.lobbyMemory.savePreset((id) => presetOf(room, id, name, mapOptions), name);
  }

  private async mapOptionKeys(folderName: string): Promise<string[]> {
    const folder = await this.gameFiles.mapFolder(folderName);
    return folder ? readMapOptionKeys(folder).catch(() => []) : [];
  }

  lobbyDeletePreset(id: string): Promise<LobbyPresets> {
    return this.deps.lobbyMemory.deletePreset(id);
  }

  async lobbyLoadPreset(id: string): Promise<void> {
    const preset = this.deps.lobbyMemory.preset(id);
    if (!preset) {
      throw new Error(t('main.tfafLobby.presetMissing'));
    }
    const installed = await this.deps.mods.installed();
    await this.requireRoom().loadPreset(preset, installed.filter((mod) => mod.type === 'UI' && mod.active).map((mod) => mod.uid));
  }

  /** The game would quietly drop such a mod from the match, and the room would show it all the same. */
  private async refuseBannedMods(featuredMod: string, modUids: readonly string[]): Promise<void> {
    const banned = new Set(await readBannedMods(this.gamePackageFiles(featuredMod)));
    const refused = modUids.filter((uid) => banned.has(uid.toLowerCase()));
    if (refused.length > 0) {
      throw new Error(t('main.tfafLobby.bannedMods', { mods: refused.join(', ') }));
    }
  }

  /** The host's last room, without what the game has stopped offering. Without the game's files a room just starts plain. */
  private async roomMemory(featuredMod: string): Promise<RoomMemory> {
    const { options, autoTeams, faction, color } = this.deps.lobbyMemory.current;
    const files = this.gamePackageFiles(featuredMod);
    const catalog = await loadLobbyCatalog({ files, locale: currentLocale(), mapFolder: null, modFolders: [], simModUids: [] }).catch(() => null);
    return { options: catalog ? validOptions(catalog.groups, options) : {}, autoTeams, faction, color };
  }

  /** The packages of a featured mod, which the scripts of a TFAF lobby are read from. */
  private gamePackageFiles(featuredMod: string): GameFileSystem {
    let files = this.packageFiles.get(featuredMod);
    if (!files) {
      files = new GameFileSystem(this.deps.settings, ({ dataPath, gamePath }) => gamePackages(featuredMod, dataPath, gamePath));
      this.packageFiles.set(featuredMod, files);
    }
    return files;
  }

  private requireRoom(): TfafLobbySession {
    if (!this.lobbySession) {
      throw new Error(t('main.tfafLobby.notInLobby'));
    }
    return this.lobbySession;
  }

  private memberInfo(id: number, login: string): NewMember {
    const player = this.deps.lobby.getPlayer(id);
    const rating = player?.ratings.get('global');
    return {
      id,
      login: player?.login ?? login,
      clan: player?.clan ?? null,
      country: player?.country ?? null,
      rating: displayedRating(rating),
      games: player?.numberOfGames ?? null,
      mean: rating?.mean ?? null,
      deviation: rating?.deviation ?? null,
    };
  }

  private async loadRoomMap(folderName: string): Promise<LobbyMap> {
    await this.deps.maps.ensureInstalled(folderName);
    const folder = await this.gameFiles.mapFolder(folderName);
    const map = folder ? await readLobbyMap(folder) : null;
    if (!folder || !map) {
      throw new Error(t('main.tfafLobby.mapUnreadable', { map: folderName }));
    }
    // Players without a StoneMap map make it from its recipe; the vault has none to download.
    const recipe = isStoneMapFolder(folderName) ? await readStoneMapRecipe(folder, this.deps.stoneMap.buildId) : null;
    return recipe ? { ...map, recipe } : map;
  }

  private async loadRoomMods(modUids: string[]): Promise<LobbySimMod[]> {
    await this.refuseBannedMods(this.lobbySession?.currentRoom?.featuredMod ?? FAF_FEATURED_MOD, modUids);
    await this.deps.mods.ensureInstalledAndActive(modUids, { replace: true });
    const { mods } = await this.deps.mods.verify(modUids.filter((uid) => !isBuiltInMod(uid)));
    return mods.map(({ uid, name }) => ({ uid, name }));
  }

  /**
   * Opens the room of a TFAF lobby: the replay relay and our adapter run, the server hears from us what the game would
   * say, and the players connect. Forged Alliance starts later, from `launchRoom`.
   */
  private async openLobby(
    launch: GameLaunch,
    self: LobbyPlayer,
    prepared: PreparedFiles,
    details: GameDetails,
    setup: LobbyRoomSetup,
  ): Promise<void> {
    const { lobby, launcherVersion } = this.deps;
    const online = new OnlineGame(this.deps, launch, self);
    const lobbyFiles = new LobbyFiles(
      {
        maps: this.deps.maps,
        mods: this.deps.mods,
        notice: (style, text) => this.toast(style, text),
        onUpdate: (update) => this.onLobbyFiles(update),
        onSettled: (failed) => this.lobbySession?.setFiles(failed ? 'failed' : 'ready'),
      },
      prepared,
      details.map?.folderName ?? null,
    );
    const end = (): void => {
      this.endLobby = null;
      this.lobbySession?.close();
      this.lobbySession = null;
      online.stop();
      this.preparation.release();
      lobbyFiles.stop();
      this.fileChecks = null;
      this.lobbyFiles = null;
      this.featureChecks = null;
      this.lobbyPassword = null;
      this.online = null;
    };
    this.setState({ ...this.state, phase: 'launching', gameId: launch.uid });
    this.endLobby = end;
    this.online = online;
    this.lobbyFiles = lobbyFiles;
    this.gameInLobby = false;
    this.gameLaunched = false;
    this.fileChecks = new GameFileChecks({ playerId: self.id, login: self.login, fingerprint: prepared.fingerprint }, prepared.localFiles.mods);
    this.featureChecks = new LobbyFeatureChecks(announceFeatures(['launcherLobby', 'roomLaunch'], launcherVersion), setup.room !== null, setup.hostFeatures);
    this.lobbyPassword = setup.passwordProtected;
    try {
      const adapter = await online.startForLobby(prepared.fingerprint, this.featureChecks.own, {
        initFile: () => Promise.resolve(INIT_FILE_NAME),
        adapterEvents: (created) => this.adapterEvents(created),
        onLobbyCommand: (command, args) => this.noteHost(command, args, self.login),
      });
      const session = new TfafLobbySession(
        {
          selfId: self.id,
          selfLogin: self.login,
          hostLogin: setup.hostLogin,
          adapter,
          sendToServer: ({ command, args }) => lobby.sendGameMessage(command, args),
          memberInfo: (id, login) => this.memberInfo(id, login),
          loadMap: (folderName) => this.loadRoomMap(folderName),
          loadMods: (modUids) => this.loadRoomMods(modUids),
          mapOptionKeys: (folderName) => this.mapOptionKeys(folderName),
          rememberOptions: (room) => this.deps.lobbyMemory.update({ options: room.options, autoTeams: room.autoTeams }),
          rememberGame: (room) => {
            void this.mapOptionKeys(room.map.folderName).then((mapOptions) =>
              this.deps.lobbyMemory.update({ lastGame: presetOf(room, LAST_GAME_PRESET, LAST_GAME_PRESET, mapOptions) }),
            );
          },
          rememberSeat: (seat) => this.deps.lobbyMemory.update(seat),
          rememberedSeat: { faction: this.deps.lobbyMemory.current.faction, color: this.deps.lobbyMemory.current.color },
          onRoomFull: () => this.events.onGameFull(this.state.title, null),
          followFiles: (room) => {
            if (room.map.recipe) {
              this.deps.stoneMap.rememberRecipe(room.map.folderName, room.map.recipe);
            }
            this.lobbyFiles?.follow({ mapFolderName: room.map.folderName, simMods: room.simMods });
          },
          resolveLaunch: (room) => this.resolveRoomLaunch(room),
          launchGame: (room, launch) => this.launchRoom(room, launch),
          onStartRefused: (error) => this.toast('error', t('main.tfafLobby.startRefused', { error: describeError(error) })),
          closeGame: () => this.killGame(),
          leave: (reason) => this.leaveRoom(reason),
          filesReport: () => this.state.files,
          mapPreview: (folderName) => this.deps.maps.previewUrls(folderName),
          onChange: () => this.setState({ ...this.state, title: this.lobbySession?.currentRoom?.title ?? this.state.title }),
          log: (message) => console.info(`TFAF lobby: ${message}`),
        },
        setup.room,
      );
      this.lobbySession = session;
      this.setState({
        ...this.state,
        phase: 'lobby',
        message: null,
        stages: [],
        cancellable: false,
        current: {
          ...details,
          startedAt: new Date().toISOString(),
          launched: false,
          lobbyGame: lobby.getLobbyGame(launch.uid),
          desyncs: 0,
          hostedMods: null,
          lobbyFeatures: this.featureChecks.own.features.map(featureName),
        },
      });
      lobby.sendGameMessage('GameState', ['Idle']);
      lobby.sendGameMessage('GameState', ['Lobby']);
      session.announce();
      void this.checkLaunchCode(details.featuredMod ?? FAF_FEATURED_MOD);
    } catch (error) {
      end();
      throw error;
    }
  }

  /** Starts Forged Alliance for the room. Only the host's game plays the room out; the others follow it as players do. */
  private async launchRoom(room: LobbyRoom, launch: LobbyLaunch): Promise<void> {
    const attempt = ++this.roomLaunches;
    const { online } = this;
    const { updater, settings } = this.deps;
    const current = this.state.current;
    if (!online || !current) {
      throw new Error(t('main.tfafLobby.notInLobby'));
    }
    if (await isForgedAllianceRunning()) {
      this.toast('error', t('main.tfafLobby.gameRunning'));
      throw new Error(t('main.tfafLobby.gameRunning'));
    }
    // Our files may differ from the host's in code the launch relies on: the game is not started on them.
    const unsupported = await unsupportedLaunchCode(this.gamePackageFiles(launch.featuredMod), launch.featuredMod);
    if (unsupported.length > 0) {
      const error = t('main.tfafLobby.unsupportedGame', { changes: unsupported.join(', ') });
      this.notice('error', error);
      throw new Error(error);
    }
    await this.checkRoomGameFiles(launch.featuredMod);
    const logo = await screenLogo();
    const screen = { colors: resolveTheme(settings.get()).colors, logo: logo && { width: logo.width, height: logo.height } };
    const overrides: GameFileOverride[] = [
      { path: ONLINE_PROVIDER_SCRIPT, content: onlineProviderScript() },
      { path: ROOM_LAUNCH_SCRIPT, content: roomLaunchScript(launch, screen) },
      ...(logo ? [{ path: SCREEN_LOGO, content: logo.data }] : []),
    ];
    const modUids = room.simMods.map((mod) => mod.uid);
    const initFile = await this.preparation.lobbyInitFile(updater.binDirectory, modUids, overrides);
    const { args, logFile } = await online.launchCommand(initFile);
    const { featuredMod, map, localFiles } = current;
    if (attempt !== this.roomLaunches) {
      return;
    }
    await this.spawnGame(updater.binDirectory, args, logFile, { featuredMod, map, localFiles }, () => this.endLobby?.());
    if (attempt !== this.roomLaunches) {
      this.killGame();
    }
  }

  /** Host: the match of the room's start, from the scripts of the room's featured mod. */
  private async resolveRoomLaunch(room: LobbyRoom): Promise<LobbyLaunch> {
    const files = this.gamePackageFiles(room.featuredMod);
    const unsupported = await unsupportedLaunchCode(files, room.featuredMod);
    this.lobbySession?.setUnsupportedCode(unsupported);
    if (unsupported.length > 0) {
      throw new Error(t('main.tfafLobby.unsupportedGame', { changes: unsupported.join(', ') }));
    }
    const simModUids = room.simMods.map((mod) => mod.uid);
    const catalog = await loadLaunchCatalog({
      files,
      mapFolder: await this.gameFiles.mapFolder(room.map.folderName),
      modFolders: await this.deps.mods.gameModFolders(simModUids),
      simModUids,
    });
    return resolveLaunch(room, catalog);
  }

  /** Whether TFAF supports the code of our game; the host cannot start while it does not. */
  private async checkLaunchCode(featuredMod: string): Promise<void> {
    const unsupported = await unsupportedLaunchCode(this.gamePackageFiles(featuredMod), featuredMod).catch((error: unknown) => {
      console.warn('The code of the game could not be checked', describeError(error));
      return [];
    });
    if (unsupported.length > 0) {
      console.warn(`TFAF lobby: unsupported game code of ${featuredMod}: ${unsupported.join(', ')}`);
    }
    this.lobbySession?.setUnsupportedCode(unsupported);
  }

  /**
   * The data folder serves every featured mod, so another update may have changed the game's files since the room
   * opened, and a new build may have come out. The start goes ahead only on the files the others compared with ours.
   */
  private async checkRoomGameFiles(featuredMod: string): Promise<void> {
    if (await this.updateRoomGameFiles(featuredMod)) {
      this.notice('warning', t('main.tfafLobby.gameFilesChanged'));
      throw new Error(t('main.tfafLobby.gameFilesChanged'));
    }
  }

  /** Brings the room's game files up to date; true when they changed, which the other players then hear of. */
  private async updateRoomGameFiles(featuredMod: string): Promise<boolean> {
    const report = await this.deps.updater.update(featuredMod);
    const checks = this.fileChecks;
    const own = checks?.ownFingerprint;
    const current = this.state.current;
    if (!checks || !own || own.gameFiles === report.digest) {
      return false;
    }
    const fingerprint = { ...own, gameFiles: report.digest };
    checks.setOwn(fingerprint, []);
    this.online?.updateFingerprint(fingerprint);
    if (current?.localFiles) {
      this.setStateWithFiles({ ...this.state, current: { ...current, localFiles: { ...current.localFiles, gameVersion: report.version } } });
    }
    // A new build may change the code the launch relies on.
    await this.checkLaunchCode(featuredMod);
    return true;
  }

  /** A game that gives up its start says why before it closes; its player learns it here. */
  private noteStage([stage, detail]: unknown[]): void {
    const text = typeof detail === 'string' ? detail : '';
    if (stage === 'unsupported') {
      this.notice('error', t('main.tfafLobby.gameUnsupported', { changes: text }));
    } else if (stage === 'failed') {
      this.notice('error', t('main.tfafLobby.gameFailed', { problem: text }));
    }
  }

  /** Closes the game of a start that was given up; the room stays. */
  private killGame(): void {
    this.roomLaunches++;
    if (this.process) {
      this.killed = true;
      this.process.kill();
    }
  }

  /** The host removed us from the room. */
  private leaveRoom(reason: string | null): void {
    this.notice('error', reason ? t('main.tfafLobby.kickedWithReason', { reason }) : t('main.tfafLobby.kicked'));
    this.killGame();
    this.closeRoom();
  }

  private closeRoom(): void {
    this.roomLaunches++;
    const { kind, title } = this.state;
    this.endLobby?.();
    this.peerNumbers.clear();
    this.setState({ ...IDLE, kind, title });
  }

  /**
   * The lobby features of the host's game, from its TFAF launcher. A feature our launcher cannot play stops the start
   * if it is required and is only reported otherwise. Null when the host runs another client or does not answer.
   */
  private async hostFeatures(game: RawGame): Promise<FeatureAnnouncement | null> {
    const { tfafChat } = this.deps;
    if ((await tfafChat.lookupTfaf(game.host)) === null) {
      return null;
    }
    const features = await tfafChat.queryLobby(game.host, game.id);
    if (!features) {
      this.toast('warning', t('main.lobbyFeatures.noAnswer', { host: game.host }));
      return null;
    }
    const unsupported = features.features.filter((feature) => !supportsFeature(feature));
    const blocking = unsupported.filter((feature) => feature.required);
    if (blocking.length > 0) {
      throw new Error(t('main.lobbyFeatures.unsupportedRequired', { features: describeFeatures(blocking, true) }));
    }
    if (unsupported.length > 0) {
      this.toast('warning', t('main.lobbyFeatures.unsupportedOptional', { features: describeFeatures(unsupported, true) }));
    }
    return features;
  }

  /** The host changes the mods of the game it hosts while the game is in its lobby: everyone starts over (rehost.ts). */
  async changeHostedMods(modUids: string[]): Promise<void> {
    const hosted = this.hosted;
    if (!hosted) {
      throw new Error(t('main.game.cannotChangeMods'));
    }
    if (!sameMods(modUids, hosted.modUids)) {
      await this.rehost(modUids);
    }
  }

  /** Tells the TFAF players, closes our game and hosts it again with these mods once it has exited. */
  private async rehost(modUids: string[]): Promise<void> {
    const hosted = this.hosted;
    const gameId = this.state.gameId;
    if (!hosted || gameId === null || !this.canRehost()) {
      throw new Error(t('main.game.cannotChangeMods'));
    }
    const options: HostGameOptions = {
      ...hosted,
      modUids,
      // The host may have picked another map in the game's lobby.
      mapFolderName: this.deps.lobby.getRawGame(gameId)?.mapFolderName || hosted.mapFolderName,
    };
    console.info(`Hosting game ${gameId} again with the mods ${modUids.join(', ') || '(none)'}`);
    this.rehosting = true;
    this.toast('info', t('main.game.rehosting'));
    try {
      await this.online?.announceRehost(modUids);
    } finally {
      this.rehosting = false;
    }
    if (!this.canRehost() || this.state.gameId !== gameId) {
      console.warn(`Game ${gameId} left its lobby while the rehost was announced; it is not hosted again`);
      return;
    }
    this.next = { kind: 'host', options };
    this.kill();
  }

  private canRehost(): boolean {
    return this.state.phase === 'running' && this.process !== null && !this.gameLaunched && !this.rehosting && !this.next;
  }

  /** The host of the game we joined announced a rehost: download its mods, close our game and follow it. */
  private followRehost(login: string, modUids: string[]): void {
    const joined = this.joined;
    const host = this.fileChecks?.hostLogin ?? this.state.current?.lobbyGame?.host ?? null;
    if (!joined || this.process === null || this.gameLaunched || this.next || host?.toLowerCase() !== login.toLowerCase()) {
      console.warn(`Rehost announced by ${login} ignored`);
      return;
    }
    const game = this.deps.lobby.getRawGame(joined.gameId);
    const mods = modUids.filter((uid) => !isBuiltInMod(uid));
    console.info(`The host ${login} creates game ${joined.gameId} again with the mods ${mods.join(', ') || '(none)'}`);
    this.toast('info', t('main.game.followingRehost', { host: login }));
    this.earlyDownload =
      mods.length > 0
        ? this.deps.mods
            .ensureInstalled(mods)
            .catch((error: unknown) => console.warn('Mods of the rehost could not be downloaded early', describeError(error)))
        : null;
    this.next = {
      kind: 'follow',
      host: login,
      previousId: joined.gameId,
      password: joined.password,
      title: game?.title ?? this.state.title ?? '',
      mapFolderName: game?.mapFolderName ?? this.state.current?.map?.folderName ?? '',
      modUids: mods,
    };
    this.kill();
  }

  /**
   * A player's launcher became known in the lobby. The host disconnects a player without a required feature of its
   * game and reports one without an optional feature; a player leaves a game whose host needs what it cannot play.
   */
  private onPeerLauncher(playerId: number, login: string, launcher: PeerLauncher): void {
    const checks = this.featureChecks;
    const room = this.lobbySession;
    if (!checks || (this.process === null && !room) || this.gameLaunched) {
      return;
    }
    if (checks.hosting) {
      const verdict = checks.checkPlayer(playerId, login, launcher);
      this.setState({ ...this.state, featureIssues: checks.list() });
      if (verdict.action === 'kick') {
        console.info(`Player ${login} is disconnected, the game lacks ${verdict.missing.map((feature) => feature.id).join(', ')}`);
        this.toast('warning', t('main.lobbyFeatures.playerKicked', { player: login, features: describeFeatures(verdict.missing, false) }));
        void this.online?.kickPeer(playerId, verdict.missing.map((feature) => feature.id));
      } else if (verdict.action === 'warn' && verdict.fresh) {
        this.toast('warning', t('main.lobbyFeatures.playerMissing', { player: login, features: describeFeatures(verdict.missing, false) }));
      } else {
        room?.onPlayerKnown(playerId, login);
      }
      return;
    }
    if (launcher.kind === 'tfaf') {
      room?.onPlayerKnown(playerId, login);
    }
    const host = this.fileChecks?.hostLogin ?? this.state.current?.lobbyGame?.host ?? null;
    if (launcher.kind !== 'tfaf' || host?.toLowerCase() !== login.toLowerCase()) {
      return;
    }
    const comparison = checks.compareWithHost(launcher.announcement);
    if (!comparison) {
      return;
    }
    const blocking = comparison.unsupported.filter((feature) => feature.required);
    if (blocking.length > 0) {
      console.info(`Leaving game ${String(this.state.gameId)}: the host's game needs ${blocking.map((feature) => feature.id).join(', ')}`);
      this.notice('error', t('main.lobbyFeatures.unsupportedRequired', { features: describeFeatures(blocking, true) }));
      this.kill();
      return;
    }
    if (comparison.unsupported.length > 0) {
      this.toast('warning', t('main.lobbyFeatures.unsupportedOptional', { features: describeFeatures(comparison.unsupported, true) }));
    }
    if (comparison.mismatched.length > 0) {
      this.notice('warning', t('main.lobbyFeatures.mismatched', { host: login, features: describeFeatures(comparison.mismatched, false) }));
    }
  }

  /** The host disconnected us for lacking required features of its game: our game closes with the reason. */
  private onKicked(login: string, ids: string[]): void {
    const checks = this.featureChecks;
    const host = this.fileChecks?.hostLogin ?? this.state.current?.lobbyGame?.host ?? null;
    const running = this.process !== null || this.lobbySession !== null;
    if (!checks || checks.hosting || !running || host?.toLowerCase() !== login.toLowerCase()) {
      return;
    }
    const { features, unsupported } = checks.kickedFor(ids);
    const key = unsupported ? 'main.lobbyFeatures.kickedUnsupported' : 'main.lobbyFeatures.kicked';
    this.notice('error', t(key, { host: login, features: describeFeatures(features, false) }));
    this.kill();
  }

  /** Waits for the host's new game, then joins it like `join`. */
  private async followHost(follow: FollowedHost): Promise<void> {
    const self = await this.preflight();
    const adapter = this.deps.adapterPreparation();
    const plan: StagePlan[] = [
      { id: 'host', title: t('main.game.stages.waitForHost', { host: follow.host }) },
      // The host announced the rehost, so it runs TFAF; the lobby features of its new game may differ.
      lobbyStage(),
      filesStage(),
      modsStage(),
      ...(follow.mapFolderName ? [isGeneratedMap(follow.mapFolderName) ? generatedMapStage() : mapStage()] : []),
      ...(adapter ? [adapterStage()] : []),
      verifyStage(),
      serverJoinStage(),
      startStage(),
    ];
    void this.run(follow.title, 'online', plan, async (startup) => {
      const game = await startup.run('host', (signal) => waitForRehostedGame(this.deps.lobby, follow.host, follow.previousId, signal));
      if (gameSimMods(game).length === 0) {
        startup.remove('mods');
      }
      if (!game.mapFolderName) {
        startup.remove('map');
      }
      await this.joinGame(startup, game, follow.password, self, adapter);
    });
  }

  /**
   * Forged Alliance on the FAF files without the lobby, for skirmish against the AI from the game's own menu. With
   * `update` the files are brought up to date first; signed out, the installed ones are used as they are.
   */
  async launchSkirmish(update: boolean): Promise<void> {
    this.requireIdle();
    await this.requireGameReady();
    const { settings, updater } = this.deps;
    const binDirectory = updater.binDirectory;
    if (!update && !(await pathExists(path.join(binDirectory, INIT_FILE_NAME)))) {
      throw new Error(t('main.game.skirmishNoFiles'));
    }
    const plan = [...(update ? [filesStage()] : []), startStage()];
    void this.run(t('main.game.skirmishTitle'), 'offline', plan, async (startup) => {
      const files = update ? await startup.run('files', () => updater.update(FAF_FEATURED_MOD)) : null;
      this.setPhase('launching');
      await startup.run('start', async () => {
        await mkdir(settings.logsDirectory, { recursive: true });
        const logFile = path.join(settings.logsDirectory, 'skirmish.log');
        const details = gameDetails(this.deps.maps, FAF_FEATURED_MOD, null, { gameVersion: files?.version ?? null, map: null, mods: [] });
        await this.spawnGame(binDirectory, buildSkirmishArguments(logFile), logFile, details);
      });
    });
  }

  /** Starts Forged Alliance on a scenario without the lobby: no other players, no results, no replay. */
  async launchOffline(title: string, featuredMod: string, scenario: string, mapFolderName: string | null): Promise<void> {
    this.requireIdle();
    await this.requireGameReady();
    const plan = [filesStage(), ...(mapFolderName ? [mapStage()] : []), startStage()];
    void this.run(title, 'offline', plan, async (startup) => {
      const { settings, maps, updater } = this.deps;
      const [files] = await Promise.all([
        startup.run('files', () => updater.update(featuredMod)),
        mapFolderName ? startup.run('map', () => maps.ensureInstalled(mapFolderName)) : null,
      ]);
      this.setPhase('launching');
      await startup.run('start', async () => {
        const logsDirectory = settings.logsDirectory;
        await mkdir(logsDirectory, { recursive: true });
        const logFile = path.join(logsDirectory, `offline_${scenario.replace(/[^\w-]+/g, '_')}.log`);
        const details = gameDetails(this.deps.maps, featuredMod, mapFolderName, { gameVersion: files.version, map: null, mods: [] });
        await this.spawnGame(updater.binDirectory, buildOfflineArguments(logFile, scenario), logFile, details);
      });
    });
  }

  /**
   * Plays a replay file or watches a live game (ReplayRunner). `prepare` downloads or opens the replay once it is clear
   * that the game can start; `preparing` names that step.
   */
  async watchReplay(
    title: string,
    prepare: (signal: AbortSignal) => Promise<ReplayLaunch>,
    preparing = t('main.game.stages.replayDownload'),
  ): Promise<void> {
    this.requireIdle();
    await this.requireGameReady();
    const plan: StagePlan[] = [
      { id: 'replay', title: preparing },
      filesStage(),
      modsStage(),
      mapStage(),
      { id: 'start', title: t('main.game.stages.replayStart') },
    ];
    void this.run(title, 'replay', plan, async (startup) => {
      const { settings, maps, mods, updater } = this.deps;
      const replay = await startup.run('replay', prepare);
      try {
        this.setState({ ...this.state, title: replay.title ?? this.state.title });
        const { mapFolderName } = replay;
        const simModUids = replay.simModUids.filter((uid) => !isBuiltInMod(uid));
        if (simModUids.length === 0) {
          startup.remove('mods');
        }
        if (!mapFolderName) {
          startup.remove('map');
        }
        const [files] = await Promise.all([
          startup.run('files', () => updater.update(replay.featuredMod, replay.versions ? { replay: replay.versions } : {})),
          simModUids.length > 0 ? startup.run('mods', () => mods.ensureInstalledAndActive(simModUids)) : null,
          mapFolderName ? startup.run('map', () => maps.ensureInstalled(mapFolderName)) : null,
        ]);
        this.setPhase('launching');
        await startup.run('start', async () => {
          const logsDirectory = settings.logsDirectory;
          await mkdir(logsDirectory, { recursive: true });
          const logFile = path.join(logsDirectory, `replay_${replay.replayId ?? 'file'}.log`);
          const binDirectory = replay.versions ? updater.replayBinDirectory : updater.binDirectory;
          const details = gameDetails(this.deps.maps, replay.featuredMod, mapFolderName, { gameVersion: files.version, map: null, mods: [] });
          const args = buildReplayArguments(logFile, replay.source, replay.replayId);
          await this.spawnGame(binDirectory, args, logFile, details, () => replay.cleanup?.());
        });
      } catch (error) {
        replay.cleanup?.();
        throw error;
      }
    });
  }

  /** Refuses other games while something else holds the game, such as a matchmaker search. */
  setGuard(guard: () => string | null): void {
    this.guard = guard;
  }

  /**
   * Starts the game of a found match (game_launch of type matchmaker). The server has created the game already, so the
   * start cannot be cancelled; if it fails, the server learns that the game ended.
   */
  launchMatchmaker(launch: GameLaunch, title: string): boolean {
    const self = this.deps.lobby.getSelf();
    if (this.state.phase !== 'idle' || this.starting || !self) {
      console.warn(`Matchmaker game ${launch.uid} cannot start: another game is running or starting`);
      this.deps.lobby.sendGameMessage('GameState', ['Ended']);
      return false;
    }
    const adapter = this.deps.adapterPreparation();
    const mapFolderName = launch.mapName ?? '';
    const plan: StagePlan[] = [...preparePlan(mapFolderName, [], adapter), startStage()];
    this.matchmakerGameId = launch.uid;
    void this.run(
      title,
      'online',
      plan,
      async (startup) => {
        // The game exists on the server; after a lobby reconnect the session is restored for it.
        this.setState({ ...this.state, gameId: launch.uid });
        let started = false;
        try {
          const prepared = await this.preparation.prepare(startup, launch.featuredMod, [], mapFolderName, adapter);
          const details = gameDetails(this.deps.maps, launch.featuredMod, launch.mapName, prepared.localFiles);
          started = true;
          await startup.run('start', () => this.launch(launch, self, prepared, details, null));
        } catch (error) {
          if (!started) {
            this.deps.lobby.sendGameMessage('GameState', ['Ended']);
          }
          throw error;
        }
      },
      { committed: true },
    );
    return true;
  }

  /** Downloads what the selected adapter needs ahead of a game that will start without waiting, such as a match. */
  async prepareAdapter(): Promise<void> {
    await this.deps.adapterPreparation()?.();
  }

  /** The server cancelled the match: its game stops wherever it got to. False when it is not running or starting. */
  abortMatchmaker(): boolean {
    if (this.matchmakerGameId === null || this.state.gameId !== this.matchmakerGameId) {
      return false;
    }
    if (this.startup) {
      this.startup.stop();
      return true;
    }
    if (this.process) {
      this.kill();
      return true;
    }
    return false;
  }

  /** Stops a start that has not asked the server yet; its downloads are cancelled. */
  cancelLaunch(): void {
    if (this.startup && !this.startup.cancel()) {
      throw new Error(t('main.game.cannotCancel'));
    }
  }

  kill(): void {
    if (this.process) {
      this.killGame();
    } else if (this.lobbySession) {
      this.closeRoom();
    }
  }

  /** Closes Forged Alliance before the launcher quits and waits a little for its cleanup to reach the server. */
  async shutdown(timeoutMs: number): Promise<void> {
    this.shuttingDown = true;
    this.startup?.cancel();
    this.next = null;
    await this.gameSpawnWork;
    const child = this.process;
    if (!child) {
      if (this.lobbySession) {
        this.closeRoom();
      }
      await this.gameExitWork;
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      await this.gameExitWork;
      return;
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    this.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    await this.gameExitWork;
  }

  /**
   * Checks that are cheap to fail early. Returns the player as the lobby knows them now, because a reconnect while the
   * game starts would drop that information.
   */
  private async preflight(): Promise<LobbyPlayer> {
    this.requireIdle();
    if (this.deps.lobby.getState().status !== 'connected') {
      throw new Error(t('main.lobby.notConnected'));
    }
    const self = this.deps.lobby.getSelf();
    if (!self) {
      throw new Error(t('main.game.noPlayerData'));
    }
    await this.requireGameReady();
    return self;
  }

  private requireIdle(): void {
    if (this.state.phase !== 'idle' || this.starting) {
      throw new Error(t('main.game.alreadyRunning'));
    }
    const reason = this.guard();
    if (reason) {
      throw new Error(reason);
    }
  }

  /** `starting` keeps two quick clicks from launching two games while the process list is read. */
  private async requireGameReady(): Promise<void> {
    if (!isValidGamePath(this.deps.settings.get().gamePath)) {
      throw new Error(t('main.game.gamePathMissing'));
    }
    this.starting = true;
    try {
      if (await isForgedAllianceRunning()) {
        throw new Error(t('main.game.gameProcessRunning'));
      }
    } finally {
      this.starting = false;
    }
  }

  /** Runs the steps of a start; the renderer shows them until the game runs, or the failed one after a failure. */
  private async run(
    title: string,
    kind: GameSessionKind,
    plan: StagePlan[],
    work: (startup: LaunchProgress) => Promise<void>,
    { committed = false }: { committed?: boolean } = {},
  ): Promise<void> {
    const { tasks } = this.deps;
    const startup: LaunchProgress = new LaunchProgress(plan, tasks.within.bind(tasks), () => this.publish(startup));
    if (committed) {
      startup.commit();
    }
    this.startup = startup;
    this.hosted = null;
    this.joined = null;
    this.access = null;
    this.setState({ ...IDLE, phase: 'preparing', kind, title, stages: startup.stages, cancellable: startup.cancellable });
    try {
      await work(startup);
    } catch (error) {
      this.hosted = null;
      this.joined = null;
      this.access = null;
      if (error instanceof CancelledError && startup.cancelled) {
        console.info(`Start of "${title}" cancelled`);
        this.setState({ ...IDLE, kind, title });
        return;
      }
      startup.stop();
      this.preparation.release();
      console.warn('Game could not be started', describeError(error));
      this.setState({ ...IDLE, kind, title: this.state.title ?? title, error: describeError(error), stages: startup.failedStages() });
    } finally {
      if (this.startup === startup) {
        this.startup = null;
      }
    }
  }

  private publish(startup: LaunchProgress): void {
    if (this.startup !== startup || this.state.phase === 'idle' || this.state.phase === 'running' || this.state.phase === 'lobby') {
      return;
    }
    const { stages } = startup;
    this.setState({
      ...this.state,
      stages,
      cancellable: startup.cancellable,
      message: stages.find((stage) => stage.state === 'running')?.title ?? null,
    });
  }

  /**
   * Starts the game the server launched, with the adapter and the replay relay (onlineGame.ts). `setup` is null for a
   * matchmaker game, which has no lobby to check and no sim mods to isolate.
   */
  private async launch(
    launch: GameLaunch,
    self: LobbyPlayer,
    prepared: PreparedFiles,
    details: GameDetails,
    setup: LobbySetup | null,
  ): Promise<void> {
    const { updater, launcherVersion } = this.deps;
    this.setState({ ...this.state, phase: 'launching', gameId: launch.uid });
    const online = new OnlineGame(this.deps, launch, self);
    const cleanup = (): void => {
      online.stop();
      this.preparation.release();
      this.lobbyFiles?.stop();
      this.fileChecks = null;
      this.lobbyFiles = null;
      this.featureChecks = null;
      this.online = null;
    };
    this.online = online;
    this.fileChecks = new GameFileChecks({ playerId: self.id, login: self.login, fingerprint: prepared.fingerprint }, prepared.localFiles.mods);
    // A matchmaker game has no lobby to pick other files in.
    this.lobbyFiles = setup
      ? new LobbyFiles(
          {
            maps: this.deps.maps,
            mods: this.deps.mods,
            notice: (style, text) => this.toast(style, text),
            onUpdate: (update) => this.onLobbyFiles(update),
          },
          prepared,
          details.map?.folderName ?? null,
        )
      : null;
    const isolate = setup?.isolate ?? false;
    this.featureChecks = setup
      ? new LobbyFeatureChecks(announceFeatures(isolate ? ['modIsolation'] : [], launcherVersion), setup.hosting, setup.hostFeatures)
      : null;

    try {
      const { args, logFile } = await online.start(prepared.fingerprint, this.featureChecks?.own ?? null, {
        initFile: async () => (isolate ? this.preparation.initFile(updater.binDirectory, prepared.simModUids) : INIT_FILE_NAME),
        adapterEvents: (adapter) => this.adapterEvents(adapter),
        onLobbyCommand: (command, args) => this.noteHost(command, args, self.login),
      });
      await this.spawnGame(updater.binDirectory, args, logFile, details, cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /** Starts Forged Alliance; once it exits, `cleanup` runs and the session ends (onGameExit). */
  private spawnGame(
    binDirectory: string,
    args: string[],
    logFile: string,
    details: GameDetails,
    cleanup: () => void = () => {},
  ): Promise<void> {
    const work = this.spawnGameWithPrefs(binDirectory, args, logFile, details, cleanup);
    this.gameSpawnWork = work.catch(() => undefined);
    return work;
  }

  private async spawnGameWithPrefs(
    binDirectory: string,
    args: string[],
    logFile: string,
    details: GameDetails,
    cleanup: () => void,
  ): Promise<void> {
    if (this.shuttingDown) throw new CancelledError();
    // Every game TFAF starts keeps its settings in TFAF.prefs, apart from the official client's Game.prefs.
    const prefs = await ensureOwnPrefs(this.deps.settings.get().gamePrefsPath);
    const portable = this.deps.settings.pathsStatus().portable ? await preparePortablePrefs(prefs) : null;
    try {
      if (this.shuttingDown) throw new CancelledError();
      const child = spawn(path.join(binDirectory, FORGED_ALLIANCE_EXE), [...args, '/prefs', portable?.argument ?? path.basename(prefs)], {
        cwd: binDirectory,
        stdio: 'ignore',
      });
      const started = this.started(child, details);
      child.once('exit', (code) => {
        this.gameExitWork = started.then(async () => {
          await this.finishPortablePrefs(portable);
          this.onGameExit(code, logFile, cleanup);
        }).catch((error: unknown) => {
          console.error('Game exit cleanup failed', describeError(error));
        });
      });
      await started;
    } catch (error) {
      await portable?.cancel();
      throw error;
    }
  }

  private async finishPortablePrefs(portable: PortablePrefsSession | null): Promise<void> {
    try {
      await portable?.finish();
    } catch (error) {
      // Keep the journal and working copy; another launch must recover them first.
      this.next = null;
      this.notice('error', describeError(error));
    }
  }

  private async started(child: ChildProcess, details: GameDetails): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', (error) => reject(new Error(t('main.game.spawnFailed', { error: describeError(error) }))));
    });
    this.process = child;
    this.killed = false;
    this.desyncReported = false;
    this.gameLaunched = false;
    this.gameInLobby = false;
    this.reportedMods = null;
    const { gameId } = this.state;
    this.setState({
      ...this.state,
      phase: 'running',
      message: null,
      stages: [],
      cancellable: false,
      current: {
        ...details,
        startedAt: new Date().toISOString(),
        launched: this.state.kind !== 'online',
        lobbyGame: gameId === null ? null : this.deps.lobby.getLobbyGame(gameId),
        desyncs: 0,
        hostedMods: this.hosted?.modUids ?? null,
        lobbyFeatures: this.featureChecks?.own.features.map(featureName) ?? null,
      },
    });
  }

  private adapterEvents(adapter: IceAdapter): IceAdapterEvents {
    const { lobby } = this.deps;
    return {
      onGpgNetMessage: (header, args) => {
        const room = this.lobbySession;
        if (header === 'GameFull') {
          if (!room) {
            this.events.onGameFull(this.state.title, this.process?.pid ?? null);
          }
          return;
        }
        // For the adapter's log, which has it by now: the server does not know this message.
        if (header === LOBBY_STAGE_MESSAGE) {
          this.noteStage(args);
          return;
        }
        // The server has heard these from us long ago, when the room opened.
        if (room && header === 'GameState' && (args[0] === 'Idle' || args[0] === 'Lobby')) {
          if (args[0] === 'Lobby') {
            room.onGameInLobby();
          }
          return;
        }
        if (header === 'GameState' && args[0] === 'Lobby') {
          this.gameInLobby = true;
          this.followLobby();
        }
        if (header === 'GameMods') {
          this.noteGameMods(args);
        }
        if (header === 'GameState' && args[0] === 'Launching') {
          this.gameLaunched = true;
          this.lobbyFiles?.stop();
          room?.onGameLaunched();
          // The game has left its lobby and plays with the mods it has.
          const current = this.state.current;
          if (current) {
            this.setState({ ...this.state, current: { ...current, launched: true, hostedMods: null } });
          }
        }
        if (header === 'Desync') {
          const current = this.state.current;
          if (current) {
            this.setState({ ...this.state, current: { ...current, desyncs: current.desyncs + 1 } });
          }
          if (!this.desyncReported) {
            this.desyncReported = true;
            this.notice('warning', t('main.game.desync'));
          }
        }
        lobby.sendGameMessage(header, args);
      },
      onIceMessage: (remotePlayerId, message) => lobby.sendGameMessage('IceMsg', [remotePlayerId, message]),
      onConnectionStateChanged: (state) => {
        // A room outlives the games of its failed starts.
        if (state === 'Disconnected' && !this.lobbySession) {
          adapter.stop();
        }
      },
      onPeerStatus: (status) => {
        const others = this.state.peers.filter((peer) => peer.playerId !== status.playerId);
        const known = this.state.peers.find((peer) => peer.playerId === status.playerId);
        if (!this.peerNumbers.hold(known, status)) {
          this.setPeers([...others, status]);
        }
      },
      onLobbyMessage: (playerId, login, text) => this.lobbySession?.onLobbyMessage(playerId, login, text),
      onPeerFiles: (playerId, login, fingerprint) => {
        if (this.fileChecks) {
          this.fileChecks.setPeer({ playerId, login, fingerprint });
          this.setStateWithFiles(this.state);
        }
      },
      onPeerRehost: (_playerId, login, modUids) => this.followRehost(login, modUids),
      onPeerLauncher: (playerId, login, launcher) => this.onPeerLauncher(playerId, login, launcher),
      onPeerKick: (_playerId, login, features) => this.onKicked(login, features),
      onPeerRemoved: (playerId) => {
        this.peerNumbers.forget(playerId);
        this.fileChecks?.removePeer(playerId);
        this.featureChecks?.removePlayer(playerId);
        this.setPeers(this.state.peers.filter((peer) => peer.playerId !== playerId));
        this.lobbySession?.onPlayerLeft(playerId);
      },
      onNetworkSuspect: () => lobby.probe(),
      onExit: (reason) => {
        if (this.state.phase === 'running') {
          this.notice('error', reason);
        }
      },
    };
  }

  private onGameExit(code: number | null, logFile: string, cleanup: () => void): void {
    const room = this.lobbySession;
    if (room && !this.gameLaunched) {
      this.onRoomGameExit(room, code, logFile);
      return;
    }
    cleanup();
    this.peerNumbers.clear();
    this.process = null;
    this.lastGameId = this.state.gameId;
    const error = this.killed ? null : exitError(code, logFile);
    const { kind, title, gameId } = this.state;
    this.setState({ ...IDLE, kind, title, error });
    if (error) {
      this.events.onGameFailed(error, logFile);
    } else if (kind === 'online' && !this.killed && this.gameLaunched && gameId !== null) {
      this.events.onGameEnded(gameId, title);
    }
    const next = this.next;
    this.next = null;
    this.hosted = null;
    this.joined = null;
    this.access = null;
    if (next) {
      const start = next.kind === 'host' ? this.host(next.options) : this.followHost(next);
      start.catch((cause: unknown) => {
        console.warn('The game could not be started again after the rehost', describeError(cause));
        this.notice('error', t('main.game.rehostFailed', { error: describeError(cause) }));
      });
    }
  }

  /** The game of a start closed before its match began: the room is still there, only this start is over. */
  private onRoomGameExit(room: TfafLobbySession, code: number | null, logFile: string): void {
    this.process = null;
    const error = this.killed ? null : exitError(code, logFile);
    if (error) {
      this.notice('error', t('main.tfafLobby.gameExited', { error }));
    }
    this.preparation.release();
    this.setState({ ...this.state, phase: 'lobby' });
    room.onGameExited();
  }

  /** Goes to the bell: what must be read whenever the user gets to it. */
  private notice(style: LobbyNotice['style'], text: string): void {
    this.events.onNotice({ id: randomUUID(), style, text });
  }

  /** Matters only in the moment, such as the course of this start or the answer to the user's own click. */
  private toast(style: LobbyNotice['style'], text: string): void {
    this.events.onNotice({ id: randomUUID(), style, text, transient: true });
  }

  private setPeers(peers: GamePeer[]): void {
    // The adapter may still report while it shuts down after the game exited.
    if (this.state.phase === 'idle') {
      return;
    }
    this.setStateWithFiles({
      ...this.state,
      peers: peers.sort((a, b) => a.login.localeCompare(b.login)),
      featureIssues: this.featureChecks?.list() ?? [],
    });
    this.lobbySession?.setPeers(this.state.peers);
  }

  /** The lobby of the game we host reports its sim mods: `activated <count>`, then `uids <uid uid ...>` unless none. */
  private noteGameMods(args: unknown[]): void {
    if (args[0] === 'activated' && Number(args[1]) === 0) {
      this.reportedMods = [];
    } else if (args[0] === 'uids' && typeof args[1] === 'string') {
      this.reportedMods = args[1].split(' ').filter(Boolean);
    } else {
      return;
    }
    this.followLobby();
  }

  /**
   * The game's lobby changed its map or sim mods: the files follow, and so do the mods of the game we host. The server
   * learns those from our game later than we do, and before that its info lists none, so a host takes them from the game.
   */
  private followLobby(): void {
    const lobbyGame = this.state.current?.lobbyGame;
    // The files of a TFAF lobby follow its room.
    if (!lobbyGame || !this.gameInLobby || this.gameLaunched || this.lobbySession) {
      return;
    }
    const names = new Map(lobbyGame.simMods.map((mod) => [mod.uid.toLowerCase(), mod.name]));
    const simMods = this.hosted
      ? (this.reportedMods?.map((uid) => ({ uid, name: names.get(uid.toLowerCase()) ?? uid })) ?? null)
      : lobbyGame.simMods;
    this.lobbyFiles?.follow({ mapFolderName: lobbyGame.mapFolderName, simMods });
    if (simMods) {
      this.followHostedMods(simMods.map((mod) => mod.uid));
    }
  }

  /**
   * The host ticked other sim mods in the game's lobby: the mods dialog starts from them and a rehost compares with them.
   * The mods of the game's mods.scd stay out, as in the mod picker: they are not installed and the vault must not
   * bring them.
   */
  private followHostedMods(simModUids: string[]): void {
    const hosted = this.hosted;
    const current = this.state.current;
    if (!hosted || !current?.hostedMods) {
      return;
    }
    const simMods = simModUids.filter((uid) => !isBuiltInMod(uid));
    const modUids = [...this.hostedUiMods, ...simMods];
    if (sameMods(modUids, hosted.modUids)) {
      return;
    }
    console.info(`The lobby of our game has the mods ${simMods.join(', ') || '(none)'}`);
    this.hosted = { ...hosted, modUids };
    this.setState({ ...this.state, current: { ...current, hostedMods: modUids } });
  }

  /** The map or the sim mods changed in the game's lobby and are checked: the tab and the TFAF players get our files. */
  private onLobbyFiles(update: LobbyFilesUpdate): void {
    const current = this.state.current;
    if (!current || !this.fileChecks) {
      return;
    }
    this.fileChecks.setOwn(update.fingerprint, update.checkedMods);
    this.online?.updateFingerprint(update.fingerprint);
    this.setStateWithFiles({
      ...this.state,
      current: { ...current, map: mapDetails(this.deps.maps, update.mapFolderName) ?? current.map, localFiles: update.localFiles },
    });
  }

  /** The lobby tells the game whom it joins, or that it hosts; that player's files are the reference. */
  private noteHost(command: string, args: unknown[], selfLogin: string): void {
    const checks = this.fileChecks;
    const host = command === 'HostGame' ? selfLogin : command === 'JoinGame' && typeof args[0] === 'string' ? args[0] : null;
    if (checks && host) {
      checks.hostLogin = host;
      this.setStateWithFiles(this.state);
    }
  }

  /** Sets the state with every player's files compared with the host's; a new difference sounds the alarm. */
  private setStateWithFiles(state: GameSessionState): void {
    const checks = this.fileChecks;
    if (!checks || state.phase === 'idle') {
      this.setState(state);
      return;
    }
    const { files, fresh } = checks.compare(state.peers, state.current?.lobbyGame ?? null);
    this.setState({ ...state, files });
    if (fresh) {
      this.events.onFilesDiffer();
    }
    if (files.players.some((player) => player.gameFiles === 'different')) {
      this.followRoomGameFiles();
    }
  }

  /**
   * In a TFAF lobby the game's files of everyone come from the same API, so files that differ are an older build on
   * one side: FAF Develop comes out often. Every launcher of the room looks for the newest build then, and the one that
   * had the older one tells the others its new files.
   */
  private followRoomGameFiles(): void {
    const room = this.lobbySession?.currentRoom;
    if (!room || room.phase !== 'open' || this.gameFilesFollowing || Date.now() - this.gameFilesFollowedAt < GAME_FILES_FOLLOW_INTERVAL_MS) {
      return;
    }
    this.gameFilesFollowing = true;
    this.updateRoomGameFiles(room.featuredMod)
      .catch((error: unknown) => console.warn('The game files of the room could not be brought up to date', describeError(error)))
      .finally(() => {
        this.gameFilesFollowing = false;
        this.gameFilesFollowedAt = Date.now();
      });
  }

  private setPhase(phase: GameSessionState['phase']): void {
    this.setState({ ...this.state, phase });
  }

  private setState(state: GameSessionState): void {
    if (state.phase === 'idle') {
      this.matchmakerGameId = null;
    }
    this.state = { ...state, tfafLobby: this.lobbySession?.view(state.files) ?? null };
    // Players reconnect through the lobby server, so it is watched closely while a game or a room is on.
    this.deps.lobby.setGameActive(this.state.phase !== 'idle');
    this.events.onState(this.state);
  }
}
