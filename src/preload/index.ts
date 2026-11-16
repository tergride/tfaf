import { contextBridge, ipcRenderer, type IpcRendererEvent, webFrame } from 'electron';
import { IPC, type IpcResult, type TfafApi } from '../shared/contract.ts';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const LOCALE_ARGUMENT = '--tfaf-system-locale=';

const api: TfafApi = {
  // Main passes it as a command line switch, so the first render already has it.
  systemLocale: process.argv.find((arg) => arg.startsWith(LOCALE_ARGUMENT))?.slice(LOCALE_ARGUMENT.length) ?? '',
  releaseMemory: () => webFrame.clearCache(),
  servers: () => invoke(IPC.serversList),
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    pickPath: (field) => invoke(IPC.settingsPickPath, field),
    pathsStatus: () => invoke(IPC.settingsPathsStatus),
  },
  auth: {
    getState: () => invoke(IPC.authGetState),
    login: (server) => invoke(IPC.authLogin, server),
    cancelLogin: () => invoke(IPC.authCancel),
    logout: () => invoke(IPC.authLogout),
    onStateChanged: (listener) => subscribe(IPC.authStateChanged, listener),
  },
  maps: {
    query: (query) => invoke(IPC.mapsQuery, query),
    installed: () => invoke(IPC.mapsInstalled),
    install: (versionId) => invoke(IPC.mapsInstall, versionId),
    uninstall: (folderName) => invoke(IPC.mapsUninstall, folderName),
    reveal: (folderName) => invoke(IPC.mapsReveal, folderName),
    vaultCheck: (folderNames) => invoke(IPC.mapsVaultCheck, folderNames),
  },
  mapView: {
    available: (folderName) => invoke(IPC.mapViewAvailable, folderName),
    scene: (folderName) => invoke(IPC.mapViewScene, folderName),
    textures: (paths, maxSide) => invoke(IPC.mapViewTextures, paths, maxSide),
    meshes: (paths) => invoke(IPC.mapViewMeshes, paths),
  },
  mods: {
    query: (query) => invoke(IPC.modsQuery, query),
    installed: () => invoke(IPC.modsInstalled),
    install: (versionId) => invoke(IPC.modsInstall, versionId),
    uninstall: (uid) => invoke(IPC.modsUninstall, uid),
    reveal: (uid) => invoke(IPC.modsReveal, uid),
    setActive: (uids) => invoke(IPC.modsSetActive, uids),
    notInVault: (uids) => invoke(IPC.modsNotInVault, uids),
  },
  tasks: {
    onProgress: (listener) => subscribe(IPC.taskProgress, listener),
    cancel: (taskId) => invoke(IPC.taskCancel, taskId),
  },
  lobby: {
    getState: () => invoke(IPC.lobbyGetState),
    getGames: () => invoke(IPC.lobbyGetGames),
    reconnect: () => invoke(IPC.lobbyReconnect),
    onStateChanged: (listener) => subscribe(IPC.lobbyStateChanged, listener),
    onGamesChanged: (listener) => subscribe(IPC.lobbyGamesChanged, listener),
  },
  game: {
    featuredMods: () => invoke(IPC.gameFeaturedMods),
    host: (options) => invoke(IPC.gameHost, options),
    join: (gameId, password) => invoke(IPC.gameJoin, gameId, password),
    invitees: (query) => invoke(IPC.gameInvitees, query),
    invite: (playerId) => invoke(IPC.gameInvite, playerId),
    getState: () => invoke(IPC.gameGetState),
    kill: () => invoke(IPC.gameKill),
    changeMods: (modUids) => invoke(IPC.gameChangeMods, modUids),
    cancelLaunch: () => invoke(IPC.gameCancelLaunch),
    skirmish: (update) => invoke(IPC.gameSkirmish, update),
    onStateChanged: (listener) => subscribe(IPC.gameStateChanged, listener),
  },
  tfafLobby: {
    act: (action) => invoke(IPC.tfafLobbyAct, action),
    say: (text) => invoke(IPC.tfafLobbySay, text),
    start: () => invoke(IPC.tfafLobbyStart),
    cancelStart: () => invoke(IPC.tfafLobbyCancelStart),
    catalog: () => invoke(IPC.tfafLobbyCatalog),
    units: () => invoke(IPC.tfafLobbyUnits),
    presets: () => invoke(IPC.tfafLobbyPresets),
    savePreset: (name) => invoke(IPC.tfafLobbySavePreset, name),
    deletePreset: (id) => invoke(IPC.tfafLobbyDeletePreset, id),
    loadPreset: (id) => invoke(IPC.tfafLobbyLoadPreset, id),
  },
  openExternal: (url) => invoke(IPC.openExternal, url),
  news: {
    list: () => invoke(IPC.newsList),
  },
  leagues: {
    list: () => invoke(IPC.leaguesList),
    seasons: (leagueId) => invoke(IPC.leaguesSeasons, leagueId),
    standing: (seasonId) => invoke(IPC.leaguesStanding, seasonId),
    entries: (seasonId, subdivisionId, page) => invoke(IPC.leaguesEntries, seasonId, subdivisionId, page),
    find: (seasonId, login) => invoke(IPC.leaguesFind, seasonId, login),
  },
  tournaments: {
    list: () => invoke(IPC.tournamentsList),
  },
  unitDatabases: {
    refresh: (id) => invoke(IPC.unitDatabasesRefresh, id),
  },
  tutorials: {
    list: () => invoke(IPC.tutorialsList),
    launch: (tutorialId) => invoke(IPC.tutorialsLaunch, tutorialId),
  },
  replays: {
    query: (query) => invoke(IPC.replaysQuery, query),
    local: () => invoke(IPC.replaysLocal),
    live: () => invoke(IPC.replaysLive),
    watch: (replayId) => invoke(IPC.replaysWatch, replayId),
    watchFile: (file) => invoke(IPC.replaysWatchFile, file),
    openFile: () => invoke(IPC.replaysOpenFile),
    watchLive: (gameId) => invoke(IPC.replaysWatchLive, gameId),
    reveal: (file) => invoke(IPC.replaysReveal, file),
    delete: (file) => invoke(IPC.replaysDelete, file),
    details: (replayId) => invoke(IPC.replaysDetails, replayId),
    fileDetails: (file) => invoke(IPC.replaysFileDetails, file),
    link: (replayId) => invoke(IPC.replaysLink, replayId),
    trackLive: (gameId, action) => invoke(IPC.replaysTrackLive, gameId, action),
    untrackLive: () => invoke(IPC.replaysUntrackLive),
    getTracking: () => invoke(IPC.replaysGetTracking),
    onTrackingChanged: (listener) => subscribe(IPC.replaysTrackingChanged, listener),
  },
  coop: {
    scenarios: () => invoke(IPC.coopScenarios),
    leaderboard: (missionId, playerCount) => invoke(IPC.coopLeaderboard, missionId, playerCount),
    host: (request) => invoke(IPC.coopHost, request),
  },
  integrity: {
    checkGameFiles: () => invoke(IPC.integrityCheckGameFiles),
    checkMods: () => invoke(IPC.integrityCheckMods),
  },
  storage: {
    oldVersions: () => invoke(IPC.storageOldVersions),
    removeOldVersions: () => invoke(IPC.storageRemoveOldVersions),
    logs: () => invoke(IPC.storageLogs),
    cleanLogs: () => invoke(IPC.storageCleanLogs),
  },
  gameOptions: {
    get: () => invoke(IPC.gameOptionsGet),
    set: (key, value) => invoke(IPC.gameOptionsSet, key, value),
    exportSettings: () => invoke(IPC.gameOptionsExport),
    pickImport: () => invoke(IPC.gameOptionsPickImport),
    importSettings: (token, parts) => invoke(IPC.gameOptionsImport, token, parts),
  },
  keyBindings: {
    get: () => invoke(IPC.keyBindingsGet),
    assign: (action, key) => invoke(IPC.keyBindingsAssign, action, key),
    unbind: (action, key) => invoke(IPC.keyBindingsUnbind, action, key),
    reset: (preset) => invoke(IPC.keyBindingsReset, preset),
  },
  presets: {
    get: () => invoke(IPC.presetsGet),
    saveDraft: (draft) => invoke(IPC.presetsSaveDraft, draft),
    save: (name, draft) => invoke(IPC.presetsSave, name, draft),
    delete: (id) => invoke(IPC.presetsDelete, id),
  },
  generator: {
    options: () => invoke(IPC.generatorOptions),
    generate: (request) => invoke(IPC.generatorGenerate, request),
  },
  chat: {
    getState: () => invoke(IPC.chatGetState),
    onStateChanged: (listener) => subscribe(IPC.chatStateChanged, listener),
    open: (name) => invoke(IPC.chatOpen, name),
    onChannelChanged: (listener) => subscribe(IPC.chatChannelChanged, listener),
    onFocusRequested: (listener) => subscribe(IPC.chatFocusRequested, listener),
    send: (channel, text, replyTo) => invoke(IPC.chatSend, channel, text, replyTo),
    react: (channel, messageId, shortcode) => invoke(IPC.chatReact, channel, messageId, shortcode),
    delete: (channel, messageId) => invoke(IPC.chatDelete, channel, messageId),
    setTopic: (channel, topic) => invoke(IPC.chatSetTopic, channel, topic),
    join: (channel) => invoke(IPC.chatJoin, channel),
    leave: (channel) => invoke(IPC.chatLeave, channel),
    openPrivate: (nick) => invoke(IPC.chatOpenPrivate, nick),
    typing: (channel, active) => invoke(IPC.chatTyping, channel, active),
    previewLink: (url) => invoke(IPC.chatPreviewLink, url),
    reconnect: () => invoke(IPC.chatReconnect),
    setRelation: (playerId, relation) => invoke(IPC.chatSetRelation, playerId, relation),
    watch: (name) => invoke(IPC.chatWatch, name),
    clan: (tag) => invoke(IPC.chatClan, tag),
  },
  notes: {
    list: () => invoke(IPC.notesList),
    set: (playerId, text) => invoke(IPC.notesSet, playerId, text),
  },
  joinPasswords: {
    get: (host) => invoke(IPC.joinPasswordsGet, host),
    set: (host, password) => invoke(IPC.joinPasswordsSet, host, password),
  },
  folders: {
    open: (folder) => invoke(IPC.foldersOpen, folder),
  },
  ice: {
    turnServers: () => invoke(IPC.iceTurnServers),
  },
  reviews: {
    list: (target) => invoke(IPC.reviewsList, target),
    save: (target, reviewId, review) => invoke(IPC.reviewsSave, target, reviewId, review),
    delete: (kind, reviewId) => invoke(IPC.reviewsDelete, kind, reviewId),
  },
  uploads: {
    pick: (kind) => invoke(IPC.uploadsPick, kind),
    uploadMap: (token, ranked) => invoke(IPC.uploadsMap, token, ranked),
    uploadMod: (token) => invoke(IPC.uploadsMod, token),
    hideVersion: (kind, versionId) => invoke(IPC.uploadsHideVersion, kind, versionId),
  },
  profile: {
    get: (player) => invoke(IPC.profileGet, player),
    ratingHistory: (playerId, leaderboardId, period) => invoke(IPC.profileRatingHistory, playerId, leaderboardId, period),
    achievements: (playerId) => invoke(IPC.profileAchievements, playerId),
    statistics: (playerId) => invoke(IPC.profileStatistics, playerId),
    search: (text) => invoke(IPC.profileSearch, text),
  },
  avatars: {
    list: () => invoke(IPC.avatarsList),
    select: (url) => invoke(IPC.avatarsSelect, url),
    getCurrent: () => invoke(IPC.avatarsGetCurrent),
    onCurrentChanged: (listener) => subscribe(IPC.avatarsCurrentChanged, listener),
  },
  reports: {
    list: () => invoke(IPC.reportsList),
    submit: (report) => invoke(IPC.reportsSubmit, report),
  },
  matchmaker: {
    getState: () => invoke(IPC.matchmakerGetState),
    onStateChanged: (listener) => subscribe(IPC.matchmakerStateChanged, listener),
    onFocusRequested: (listener) => subscribe(IPC.matchmakerFocusRequested, listener),
    setQueueSelected: (queue, selected) => invoke(IPC.matchmakerSetQueueSelected, queue, selected),
    setFactions: (factions) => invoke(IPC.matchmakerSetFactions, factions),
    startSearch: () => invoke(IPC.matchmakerStartSearch),
    stopSearch: () => invoke(IPC.matchmakerStopSearch),
    mapPool: (queue) => invoke(IPC.matchmakerMapPool, queue),
    setVeto: (bracketId, assignmentId, tokens) => invoke(IPC.matchmakerSetVeto, bracketId, assignmentId, tokens),
    findPlayers: (query) => invoke(IPC.matchmakerFindPlayers, query),
    invite: (playerId) => invoke(IPC.matchmakerInvite, playerId),
    acceptInvite: (playerId) => invoke(IPC.matchmakerAcceptInvite, playerId),
    declineInvite: (playerId) => invoke(IPC.matchmakerDeclineInvite, playerId),
    kick: (playerId) => invoke(IPC.matchmakerKick, playerId),
    leaveParty: () => invoke(IPC.matchmakerLeaveParty),
  },
  friends: {
    getState: () => invoke(IPC.friendsGetState),
    onStateChanged: (listener) => subscribe(IPC.friendsStateChanged, listener),
    find: (query) => invoke(IPC.friendsFind, query),
  },
  appUpdate: {
    getState: () => invoke(IPC.appUpdateGetState),
    check: () => invoke(IPC.appUpdateCheck),
    install: () => invoke(IPC.appUpdateInstall),
    onStateChanged: (listener) => subscribe(IPC.appUpdateStateChanged, listener),
    releases: (online) => invoke(IPC.appUpdateReleases, online),
  },
  appWindow: {
    getState: () => invoke(IPC.windowGetState),
    minimize: () => invoke(IPC.windowMinimize),
    toggleMaximize: () => invoke(IPC.windowToggleMaximize),
    close: () => invoke(IPC.windowClose),
    quit: () => invoke(IPC.windowQuit),
    onStateChanged: (listener) => subscribe(IPC.windowStateChanged, listener),
    onCloseQuestion: (listener) => subscribe(IPC.windowCloseQuestion, () => listener()),
    answerClose: (answer) => invoke(IPC.windowAnswerClose, answer),
    setBadge: (count, image) => invoke(IPC.windowSetBadge, count, image),
  },
  notifications: {
    list: () => invoke(IPC.notificationsList),
    onChanged: (listener) => subscribe(IPC.notificationsChanged, listener),
    onAdded: (listener) => subscribe(IPC.notificationsAdded, listener),
    markAllRead: () => invoke(IPC.notificationsMarkAllRead),
    dismiss: (id) => invoke(IPC.notificationsDismiss, id),
    clear: () => invoke(IPC.notificationsClear),
    act: (id, actionId) => invoke(IPC.notificationsAct, id, actionId),
  },
  sounds: {
    onPlay: (listener) => subscribe(IPC.soundPlay, listener),
  },
  onNavigate: (listener) => subscribe(IPC.navigate, listener),
};

contextBridge.exposeInMainWorld('tfaf', api);
