import type { AppFolder, AppNotification, AppReleaseHistory, AppUpdateState, AuthState, NavigationTarget, ServerId, ServerInfo, TaskProgress, WindowCloseAnswer, WindowState } from './app.ts';
import type { ChatChannelData, ChatState, LinkPreview } from './chat.ts';
import type { League, LeagueEntry, LeaguePlayerLocation, LeagueSeason, LeagueStanding, NewsItem, Tournament, TutorialCategory } from './community.ts';
import type { CoopHostRequest, CoopResult, CoopScenario } from './coop.ts';
import type { FoundPlayer, FriendsState } from './friends.ts';
import type {
  GameFilesCheck,
  GameInvitee,
  GameSessionState,
  JoinOutcome,
  LogsCleanup,
  LogsUsage,
  ModCheck,
  OldVersion,
  OldVersionsCleanup,
} from './game.ts';
import type {
  GameOptionsView,
  GameOptionValue,
  GameSettingsImportCandidate,
  GameSettingsImportResult,
  KeyBindingsView,
  KeyPreset,
} from './gameOptions.ts';
import type { CustomMapRequest, GeneratorOptionLists, HostGameDraft, HostGameOptions, HostGamePreset, HostGamePresets } from './hostGame.ts';
import type { FeaturedModInfo, LobbyGame, LobbyGamesUpdate, LobbyState } from './lobby.ts';
import type { MapMesh, MapScene, MapTexture } from './mapView.ts';
import type { MatchmakerFaction, MatchmakerMapPool, MatchmakerPlayer, MatchmakerState } from './matchmaker.ts';
import type { AvatarChoice, ClanInfo, ModerationReportInput, ModerationReportItem, PlayerAvatar, PlayerProfile, PlayerSearchResult, PlayerStatistics, ProfileAchievement, ProfilePeriod, RatingHistoryPoint } from './profile.ts';
import type { LiveGame, LiveReplayAction, LiveReplayTracking, LocalReplay, ReplayDetails, ReplayQuery, VaultReplay } from './replays.ts';
import type { PathField, PathsStatus, Settings, SettingsPatch, SoundId, TurnServer } from './settings.ts';
import type {
  AdjustmentDelete,
  AdjustmentMove,
  AdjustmentPlacementMap,
  AdjustmentPlacementRequest,
  AdjustmentScene,
  GenerationCapabilities,
  GenerationRequest,
  MapAdjustments,
  MapFile,
  MapPresentation,
  MapResources,
  MapResult,
  NavigationReport,
  PreviewOptions,
  ReclaimPoint,
  ResolvedParameters,
  StoneMapJob,
  StoneMapJobList,
  StoneMapSavedMap,
  StoneMapState,
  StoneMapTextureAssets,
  StoneMapTextureLayer,
} from './stoneMap.ts';
import type { LobbyAction, LobbyCatalog, LobbyPresets, LobbyUnitCatalog } from './tfafLobby.ts';
import type { UnitDatabaseId } from './unitDatabases.ts';
import type { LocalMap, LocalMod, MapQuery, MapVaultCheck, ModQuery, Page, ReviewInput, ReviewKind, ReviewTarget, UploadCandidate, VaultMap, VaultMod, VaultReview } from './vault.ts';

export interface TfafApi {
  /** Chromium's locale (`app.getLocale()`), which the `system` language follows. */
  systemLocale: string;
  /** Hands back what the page no longer uses, such as cached images, and lets the garbage collector run. */
  releaseMemory(): void;
  servers(): Promise<ServerInfo[]>;
  settings: {
    get(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<Settings>;
    pickPath(field: PathField): Promise<Settings>;
    pathsStatus(): Promise<PathsStatus>;
  };
  auth: {
    getState(): Promise<AuthState>;
    login(server: ServerId): Promise<void>;
    cancelLogin(): Promise<void>;
    logout(): Promise<void>;
    onStateChanged(listener: (state: AuthState) => void): () => void;
  };
  maps: {
    query(query: MapQuery): Promise<Page<VaultMap>>;
    installed(): Promise<LocalMap[]>;
    install(versionId: number): Promise<void>;
    uninstall(folderName: string): Promise<void>;
    reveal(folderName: string): Promise<void>;
    vaultCheck(folderNames: string[]): Promise<MapVaultCheck>;
  };
  mapView: {
    /** Whether the map is on disk, so that it can be drawn. */
    available(folderName: string): Promise<boolean>;
    scene(folderName: string): Promise<MapScene>;
    /**
     * At most MAP_VIEW_BATCH game paths per call; null for a file that could not be read. Mip levels larger than
     * `maxSide` are left out, so a view far out loads only the small ones.
     */
    textures(paths: string[], maxSide: number): Promise<(MapTexture | null)[]>;
    meshes(paths: string[]): Promise<(MapMesh | null)[]>;
  };
  mods: {
    query(query: ModQuery): Promise<Page<VaultMod>>;
    installed(): Promise<LocalMod[]>;
    install(versionId: number): Promise<void>;
    uninstall(uid: string): Promise<void>;
    reveal(uid: string): Promise<void>;
    setActive(uids: string[]): Promise<void>;
    /** Those of these mods the FAF vault does not have: the other players of a game cannot download them. */
    notInVault(uids: string[]): Promise<string[]>;
  };
  reviews: {
    /** The signed-in player's reviews first. */
    list(target: ReviewTarget): Promise<VaultReview[]>;
    /** A new review of the target's version, or a change of an existing one. */
    save(target: ReviewTarget, reviewId: string | null, review: ReviewInput): Promise<void>;
    delete(kind: ReviewKind, reviewId: string): Promise<void>;
  };
  uploads: {
    /** Asks for a map or mod folder and checks it; null when the user cancelled. */
    pick(kind: 'map' | 'mod'): Promise<UploadCandidate | null>;
    /** Zips and uploads a picked folder, reporting progress as a cancellable task. */
    uploadMap(token: string, ranked: boolean): Promise<void>;
    uploadMod(token: string): Promise<void>;
    /** Hides the signed-in player's own map or mod version from the vault. */
    hideVersion(kind: 'map' | 'mod', versionId: number): Promise<void>;
  };
  folders: {
    open(folder: AppFolder): Promise<void>;
  };
  ice: {
    /** The TURN servers the API offers now. */
    turnServers(): Promise<TurnServer[]>;
  };
  tasks: {
    onProgress(listener: (task: TaskProgress) => void): () => void;
    /** Stops a running cancellable task; whoever waits for it gets an error that `isCancelledMessage` recognises. */
    cancel(taskId: string): Promise<void>;
  };
  lobby: {
    getState(): Promise<LobbyState>;
    getGames(): Promise<LobbyGame[]>;
    reconnect(): Promise<void>;
    onStateChanged(listener: (state: LobbyState) => void): () => void;
    onGamesChanged(listener: (update: LobbyGamesUpdate) => void): () => void;
  };
  game: {
    featuredMods(): Promise<FeaturedModInfo[]>;
    host(options: HostGameOptions): Promise<void>;
    join(gameId: number, password: string | null): Promise<JoinOutcome>;
    /** Online players to invite into our game: the friends while the query is empty, otherwise matching logins. */
    invitees(query: string): Promise<GameInvitee[]>;
    /**
     * Invites a TFAF player into the game we are in while it is in its lobby; the player joins without the password.
     * Resolves once the player's launcher took the invitation.
     */
    invite(playerId: number): Promise<void>;
    getState(): Promise<GameSessionState>;
    kill(): Promise<void>;
    /**
     * Creates the game we host again with these mods (`CurrentGameDetails.hostedMods`); the TFAF players close their
     * games and join the new one.
     */
    changeMods(modUids: string[]): Promise<void>;
    /** Stops a start that has not reached the server yet; its downloads are cancelled. */
    cancelLaunch(): Promise<void>;
    /**
     * Forged Alliance on the FAF files without the server, for skirmish against the AI. `update` refreshes the files
     * first, which needs a signed-in session; without it the installed files are used.
     */
    skirmish(update: boolean): Promise<void>;
    onStateChanged(listener: (state: GameSessionState) => void): () => void;
  };
  /** The room of a TFAF lobby, which `GameSessionState.tfafLobby` shows. */
  tfafLobby: {
    act(action: LobbyAction): Promise<void>;
    say(text: string): Promise<void>;
    /** Host: everyone's game starts, once nothing in `TfafLobbyView.startBlockers` stands in the way. */
    start(): Promise<void>;
    cancelStart(): Promise<void>;
    /** What the room can choose from with its map and mods; null before the room has arrived. */
    catalog(): Promise<LobbyCatalog | null>;
    /** What the room can forbid with its mods; null before the room has arrived. */
    units(): Promise<LobbyUnitCatalog | null>;
    /** Host: the game settings saved on this computer. */
    presets(): Promise<LobbyPresets>;
    /** Host: saves the room's game settings under this name, over a preset that has it. */
    savePreset(name: string): Promise<LobbyPresets>;
    deletePreset(id: string): Promise<LobbyPresets>;
    /** Host: gives the room these game settings; `lastGame` is the id of the last game's. */
    loadPreset(id: string): Promise<void>;
  };
  /** Opens an https link in the system browser. */
  openExternal(url: string): Promise<void>;
  news: {
    list(): Promise<NewsItem[]>;
  };
  leagues: {
    list(): Promise<League[]>;
    /** Seasons that have started, newest first. */
    seasons(leagueId: string): Promise<LeagueSeason[]>;
    standing(seasonId: string): Promise<LeagueStanding>;
    entries(seasonId: string, subdivisionId: string, page: number): Promise<Page<LeagueEntry>>;
    /** Where a player stands in a season, by exact login; null when they have no score there. */
    find(seasonId: string, login: string): Promise<LeaguePlayerLocation | null>;
  };
  tournaments: {
    list(): Promise<Tournament[]>;
  };
  unitDatabases: {
    /** Replaces the copy of a database on disk with the site; without a connection the copy stays and this fails. */
    refresh(id: UnitDatabaseId): Promise<void>;
  };
  tutorials: {
    list(): Promise<TutorialCategory[]>;
    /** Starts Forged Alliance offline on the tutorial's map. */
    launch(tutorialId: string): Promise<void>;
  };
  replays: {
    query(query: ReplayQuery): Promise<Page<VaultReplay>>;
    /** Replays of TFAF's folder and of the official client's, newest first. */
    local(): Promise<LocalReplay[]>;
    live(): Promise<LiveGame[]>;
    /** Downloads a vault replay and plays it with the game files of its version. */
    watch(replayId: number): Promise<void>;
    watchFile(file: string): Promise<void>;
    /** Asks for a `.fafreplay` or `.scfareplay` file and plays it; false when the user cancelled. */
    openFile(): Promise<boolean>;
    watchLive(gameId: number): Promise<void>;
    reveal(file: string): Promise<void>;
    /** Only replays of TFAF's own folder can be deleted. */
    delete(file: string): Promise<void>;
    /** Downloads a vault replay and reads its options and chat; watching it then does not download it again. */
    details(replayId: number): Promise<ReplayDetails>;
    fileDetails(file: string): Promise<ReplayDetails>;
    /** The download address of a vault replay on the current server. */
    link(replayId: number): Promise<string>;
    /** Waits until the running game can be watched, then acts; replaces the game followed before. */
    trackLive(gameId: number, action: LiveReplayAction): Promise<LiveReplayTracking>;
    untrackLive(): Promise<void>;
    getTracking(): Promise<LiveReplayTracking | null>;
    /** The followed game changed, became watchable (null) or ended (null). */
    onTrackingChanged(listener: (tracking: LiveReplayTracking | null) => void): () => void;
  };
  coop: {
    scenarios(): Promise<CoopScenario[]>;
    /** The fastest finish of each group of players; `playerCount` 0 takes any number of players. */
    leaderboard(missionId: string, playerCount: number): Promise<CoopResult[]>;
    /** Hosts a game of the mission; the active mods stay as they are. */
    host(request: CoopHostRequest): Promise<void>;
  };
  integrity: {
    /** Hashes every FAF game file and downloads the ones that differ. */
    checkGameFiles(): Promise<GameFilesCheck>;
    /** Compares every installed mod with the FAF vault and reinstalls the ones that differ. */
    checkMods(): Promise<ModCheck[]>;
  };
  storage: {
    /** Earlier versions of Java, the Java ICE adapter and the map generator (all but the newest). */
    oldVersions(): Promise<OldVersion[]>;
    removeOldVersions(): Promise<OldVersionsCleanup>;
    logs(): Promise<LogsUsage>;
    /** Applies the saved log cleanup rules now, whether or not the automatic cleanup is on. */
    cleanLogs(): Promise<LogsCleanup>;
  };
  /** Options of the game itself in Game.prefs; changes are refused while Forged Alliance runs. */
  gameOptions: {
    get(): Promise<GameOptionsView>;
    /** Saves an option together with the ones the game changes with it, like a graphics preset. */
    set(key: string, value: GameOptionValue): Promise<GameOptionsView>;
    /** Saves the options and key bindings to a file the user picks; its path, or null when cancelled. */
    exportSettings(): Promise<string | null>;
    /** Reads a settings file the user picks; null when cancelled. */
    pickImport(): Promise<GameSettingsImportCandidate | null>;
    /** Takes the chosen parts of the picked file, skipping what the game does not offer here. */
    importSettings(token: string, parts: string[]): Promise<GameSettingsImportResult>;
  };
  keyBindings: {
    get(): Promise<KeyBindingsView>;
    /** Binds the key to the action instead of its keys, taking it from any other action, as the game's dialog does. */
    assign(action: string, key: string): Promise<KeyBindingsView>;
    unbind(action: string, key: string): Promise<KeyBindingsView>;
    /** Drops the profile's own key map and switches to the preset. */
    reset(preset: KeyPreset): Promise<KeyBindingsView>;
  };
  presets: {
    get(): Promise<HostGamePresets>;
    saveDraft(draft: HostGameDraft): Promise<void>;
    /** Adds a preset, or replaces the one with the same name; returns the updated list. */
    save(name: string, draft: HostGameDraft): Promise<HostGamePreset[]>;
    delete(id: string): Promise<HostGamePreset[]>;
  };
  generator: {
    /** Choices of the newest map generator 1.x; Java and the generator are downloaded first if needed. */
    options(): Promise<GeneratorOptionLists>;
    /** Generates a map into the maps folder and returns its folder name, which is also the map name of a game. */
    generate(request: CustomMapRequest): Promise<string>;
  };
  /** StoneMap, a map generator with its own local API; every call but getState starts it first. */
  stoneMap: {
    getState(): Promise<StoneMapState>;
    onStateChanged(listener: (state: StoneMapState) => void): () => void;
    /** Every snapshot of the jobs this launcher queued, until each ends. */
    onJobChanged(listener: (job: StoneMapJob) => void): () => void;
    /** Downloads the generator if needed and starts it. */
    start(): Promise<void>;
    capabilities(): Promise<GenerationCapabilities>;
    /** Checks a request without generating: the canonical recipe, the seed and what the generator would choose. */
    resolve(request: GenerationRequest): Promise<ResolvedParameters>;
    generate(request: GenerationRequest): Promise<StoneMapJob>;
    /** The newest jobs first, at most STONEMAP_MAX_JOBS. */
    jobs(limit: number): Promise<StoneMapJobList>;
    job(id: string): Promise<StoneMapJob>;
    cancel(id: string): Promise<StoneMapJob>;
    /** Deletes a finished job with its files; a copy saved to the maps folder stays. */
    remove(id: string): Promise<void>;
    result(id: string): Promise<MapResult>;
    resources(id: string): Promise<MapResources>;
    reclaim(id: string): Promise<ReclaimPoint[]>;
    navigation(id: string): Promise<NavigationReport>;
    files(id: string): Promise<MapFile[]>;
    /** Heights as uint16 little-endian, (mapSize + 1)² samples by rows, 1/128 per unit. */
    heightmap(id: string): Promise<Uint8Array<ArrayBuffer>>;
    /** A PNG. */
    preview(id: string, options: PreviewOptions): Promise<Uint8Array<ArrayBuffer>>;
    textureLayers(id: string): Promise<StoneMapTextureLayer[]>;
    textureAssets(): Promise<StoneMapTextureAssets>;
    /** The textures preview with the game's textures from the game folder, or in plain colours. */
    useGameTextures(enabled: boolean): Promise<StoneMapTextureAssets>;
    /** Sets the map's name and description without generating it again; save or export it again afterwards. */
    updatePresentation(id: string, presentation: MapPresentation): Promise<MapResult>;
    adjustments(id: string): Promise<AdjustmentScene>;
    moveAdjustment(id: string, move: AdjustmentMove): Promise<MapAdjustments>;
    deleteAdjustment(id: string, deletion: AdjustmentDelete): Promise<MapAdjustments>;
    adjustmentPlacement(id: string, request: AdjustmentPlacementRequest): Promise<AdjustmentPlacementMap>;
    /** Queues the adjusted map as a new job. */
    applyAdjustments(id: string, draft: MapAdjustments): Promise<StoneMapJob>;
    /** Copies the map into the maps folder of the vault. */
    saveToMaps(id: string): Promise<StoneMapSavedMap>;
    /** Asks where to save the map's ZIP and writes it there; false when the user cancelled. */
    exportZip(id: string): Promise<boolean>;
  };
  chat: {
    getState(): Promise<ChatState>;
    onStateChanged(listener: (state: ChatState) => void): () => void;
    /** The channel shown, null when the chat is hidden: its messages count as read and its updates are sent. */
    open(name: string | null): Promise<ChatChannelData | null>;
    onChannelChanged(listener: (data: ChatChannelData) => void): () => void;
    /** A click on a chat notification: the channel to show. */
    onFocusRequested(listener: (name: string) => void): () => void;
    /** Text may be a command: `/me`, `/join`, `/part`, `/msg`. */
    send(channel: string, text: string, replyTo: string | null): Promise<void>;
    /** Adds our reaction, or takes it back when it is there. */
    react(channel: string, messageId: string, shortcode: string): Promise<void>;
    delete(channel: string, messageId: string): Promise<void>;
    setTopic(channel: string, topic: string): Promise<void>;
    join(channel: string): Promise<void>;
    /** Leaves a channel or closes a private conversation. */
    leave(channel: string): Promise<void>;
    openPrivate(nick: string): Promise<string>;
    typing(channel: string, active: boolean): Promise<void>;
    previewLink(url: string): Promise<LinkPreview>;
    reconnect(): Promise<void>;
    /** Friend or foe in the lobby, or neither. */
    setRelation(playerId: number, relation: 'friend' | 'foe' | null): Promise<void>;
    /**
     * A second channel kept up to date while it is on screen elsewhere (the party chat of the matchmaker tab), its
     * updates coming through onChannelChanged like the open channel's; null stops it.
     */
    watch(name: string | null): Promise<ChatChannelData | null>;
    /** A clan by tag, for its website and leader; null when there is no such clan. */
    clan(tag: string): Promise<ClanInfo | null>;
  };
  /** The user's notes about players, by player id; kept on this computer only. */
  notes: {
    list(): Promise<Record<number, string>>;
    /** An empty text removes the note; returns all notes. */
    set(playerId: number, text: string): Promise<Record<number, string>>;
  };
  /** Game passwords the user chose to remember, by the host's login; kept on this computer only. */
  joinPasswords: {
    get(host: string): Promise<string | null>;
    /** null forgets the host's password. */
    set(host: string, password: string | null): Promise<void>;
  };
  profile: {
    /** By player id or exact login; fails when there is no such player. */
    get(player: number | string): Promise<PlayerProfile>;
    /** Oldest first. */
    ratingHistory(playerId: number, leaderboardId: string, period: ProfilePeriod): Promise<RatingHistoryPoint[]>;
    achievements(playerId: number): Promise<ProfileAchievement[]>;
    statistics(playerId: number): Promise<PlayerStatistics>;
    /** Players whose login starts with the text, for the report form. */
    search(text: string): Promise<PlayerSearchResult[]>;
  };
  avatars: {
    list(): Promise<AvatarChoice>;
    /** Null takes the avatar off. */
    select(url: string | null): Promise<void>;
    /** The avatar the signed-in player wears, as the lobby knows it; null without one or without the lobby. */
    getCurrent(): Promise<PlayerAvatar | null>;
    onCurrentChanged(listener: (avatar: PlayerAvatar | null) => void): () => void;
  };
  reports: {
    /** The signed-in player's reports of the last year, newest first. */
    list(): Promise<ModerationReportItem[]>;
    submit(report: ModerationReportInput): Promise<void>;
  };
  matchmaker: {
    getState(): Promise<MatchmakerState>;
    onStateChanged(listener: (state: MatchmakerState) => void): () => void;
    /** A click on a matchmaker notification (match found, party invite). */
    onFocusRequested(listener: () => void): () => void;
    setQueueSelected(queue: string, selected: boolean): Promise<void>;
    setFactions(factions: MatchmakerFaction[]): Promise<void>;
    /** Updates the game files, downloads the maps of the selected queues, then joins them. */
    startSearch(): Promise<void>;
    stopSearch(): Promise<void>;
    mapPool(queue: string): Promise<MatchmakerMapPool>;
    /** Puts tokens on a map of a pool the renderer loaded; returns that pool with the vetoes applied. */
    setVeto(bracketId: number, assignmentId: number, tokens: number): Promise<MatchmakerMapPool>;
    /** Online players by login, friends first; an empty query lists the friends who are online. */
    findPlayers(query: string): Promise<MatchmakerPlayer[]>;
    invite(playerId: number): Promise<void>;
    acceptInvite(playerId: number): Promise<void>;
    declineInvite(playerId: number): Promise<void>;
    kick(playerId: number): Promise<void>;
    leaveParty(): Promise<void>;
  };
  /** Friends are added and removed with chat.setRelation. */
  friends: {
    getState(): Promise<FriendsState>;
    onStateChanged(listener: (state: FriendsState) => void): () => void;
    /** Online players whose login contains the text, those starting with it first. */
    find(query: string): Promise<FoundPlayer[]>;
  };
  appUpdate: {
    getState(): Promise<AppUpdateState>;
    check(): Promise<void>;
    /** Restarts the launcher into the downloaded version. */
    install(): Promise<void>;
    onStateChanged(listener: (state: AppUpdateState) => void): () => void;
    /** Versions with their notes; `online` also asks GitHub, otherwise only the changelog in the build is read. */
    releases(online: boolean): Promise<AppReleaseHistory>;
  };
  appWindow: {
    getState(): Promise<WindowState>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    /** Goes through the window's close event, so closing during a game still asks first. */
    close(): Promise<void>;
    /**
     * Quits the launcher even when closing hides the window to the tray, after the tray menu's question: it can be
     * turned off with confirmQuit, the warning about a running game cannot. Resolves when the player cancels.
     */
    quit(): Promise<void>;
    onStateChanged(listener: (state: WindowState) => void): () => void;
    /** The first close of the window asks the interface what closing should do; the answer goes to `answerClose`. */
    onCloseQuestion(listener: () => void): () => void;
    /** Ignored unless the question is open; `tray` and `quit` also become the closeToTray setting. */
    answerClose(answer: WindowCloseAnswer): Promise<void>;
    /**
     * The count on the launcher's taskbar button, drawn by the renderer as a PNG data URL of at most 64×64 pixels;
     * a count of 0 removes it.
     */
    setBadge(count: number, image: string | null): Promise<void>;
  };
  notifications: {
    /** Newest first; transient notifications are not listed. */
    list(): Promise<AppNotification[]>;
    onChanged(listener: (notifications: AppNotification[]) => void): () => void;
    /** Every new notification, transient ones included, for the toasts. */
    onAdded(listener: (notification: AppNotification) => void): () => void;
    markAllRead(): Promise<void>;
    dismiss(id: string): Promise<void>;
    clear(): Promise<void>;
    /** Runs an action of a notification; `null` is a click on the notification itself. */
    act(id: string, actionId: string | null): Promise<void>;
  };
  sounds: {
    /** The main process asks for a sound whose setting is on; the renderer plays it at the set volume. */
    onPlay(listener: (sound: SoundId) => void): () => void;
  };
  onNavigate(listener: (target: NavigationTarget) => void): () => void;
}
