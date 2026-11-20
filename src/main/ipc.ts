import { app, type BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, nativeImage, screen, shell } from 'electron';
import path from 'node:path';
import {
  COOP_MAX_PLAYERS,
  IPC,
  type IpcResult,
  LOBBY_LIMITS,
  type LobbyAction,
  MAP_TEXTURE_MAX_SIDE,
  type PathField,
  type WindowCloseAnswer,
} from '../shared/contract.ts';
import { type MessageKey, resolveLocale } from '../shared/i18n/index.ts';
import { openAppFolder } from './appFolders.ts';
import type { AppReleases } from './appReleases.ts';
import type { AppUpdates } from './appUpdates.ts';
import { applyInterfaceScale, windowState } from './appWindow.ts';
import type { AuthService } from './auth/authService.ts';
import type { ChatService } from './chat/chatService.ts';
import type { CoopService } from './coop/coopService.ts';
import { CancelledError, describeError } from './errors.ts';
import { parseLobbyAction } from './game/tfafLobby/lobbyWire.ts';
import type { GamePresetStore } from './gamePresets.ts';
import { setLocale, t } from './i18n.ts';
import type { LogCleaner } from './logCleanup.ts';
import type { MatchmakerService } from './matchmaker/matchmakerService.ts';
import type { NotificationCenter } from './notifications.ts';
import { type OldVersionFile, removeOldVersions } from './oldVersions.ts';
import { isServerId, listServers } from './servers.ts';
import type { SettingsStore } from './settings.ts';
import { parseBadgeImage } from './taskbar.ts';
import type { TaskReporter } from './tasks.ts';
import type { AppTray } from './tray.ts';
import {
  integer,
  InvalidInputError,
  parseApiId,
  parseChatMessageId,
  parseChatRelation,
  parseChatTarget,
  parseChatText,
  parseChatTopic,
  parseCoopHostRequest,
  parseCustomMapRequest,
  parseReplayQuery,
  parseLiveReplayAction,
  parseDraftInput,
  parseFactions,
  parseFolderNameList,
  parseGamePaths,
  parseGameOptionValue,
  parseHttpsUrl,
  parseKeyPreset,
  parseMapQuery,
  parseHostGameOptions,
  parseModQuery,
  parseOptionalPassword,
  parseAppFolder,
  parseAvatarUrl,
  parseBoolean,
  parsePathField,
  parsePlayerId,
  parsePlayerQuery,
  parsePlayerRef,
  parseProfilePeriod,
  parseReportInput,
  parseReviewInput,
  parseReviewKind,
  parseReviewTarget,
  parsePresetNameInput,
  parseQueueName,
  parseSettingsParts,
  parseSettingsPatch,
  parseUidList,
  parseUnitDatabaseId,
  parseUploadKind,
  parseUploadToken,
  parseWindowCloseAnswer,
  text,
} from './validation.ts';
import type { FeaturedModCatalog } from './game/featuredMods.ts';
import type { GameOptionsService } from './gameOptions/gameOptionsService.ts';
import type { GameLoadSaver } from './game/gameLoadSaver.ts';
import type { GameInvites } from './game/gameInvites.ts';
import type { GameRunner } from './game/gameRunner.ts';
import type { GameUpdater } from './game/gameUpdater.ts';
import type { RuntimeComponents } from './game/runtimeComponents.ts';
import type { LeagueService } from './info/leagues.ts';
import type { ClanService } from './info/clans.ts';
import type { NewsService } from './info/news.ts';
import type { TournamentService } from './info/tournaments.ts';
import type { TutorialService } from './info/tutorials.ts';
import type { UnitDatabases } from './info/unitDatabases.ts';
import type { JoinPasswordStore } from './joinPasswords.ts';
import { MAX_NOTE_LENGTH, type PlayerNotesStore } from './playerNotes.ts';
import type { FafApi } from './api/fafApi.ts';
import type { DiscordPresence } from './discord/discordPresence.ts';
import { parseTurnServers } from './game/iceSession.ts';
import type { ProfileService } from './players/profileService.ts';
import type { ReportService } from './players/reports.ts';
import type { LiveReplayTracker } from './replays/liveReplayTracker.ts';
import type { ReplayService } from './replays/replayService.ts';
import type { FriendList } from './lobby/friendList.ts';
import type { LobbyService } from './lobby/lobbyService.ts';
import type { StoneMapService } from './stoneMap/stoneMapService.ts';
import {
  parsePresentation,
  parsePreviewOptions,
  parseStoneMapBody,
  parseStoneMapJobId,
  parseStoneMapJobLimit,
} from './stoneMap/stoneMapValidation.ts';
import type { MapGenerator } from './vault/mapGenerator.ts';
import type { MapService } from './vault/mapService.ts';
import type { MapViewService } from './mapView/mapViewService.ts';
import type { ReviewService } from './vault/reviews.ts';
import type { UploadService } from './vault/uploads.ts';
import type { ModService } from './vault/modService.ts';

function parseAction(input: unknown): LobbyAction {
  const action = parseLobbyAction(input);
  if (!action) {
    throw new InvalidInputError(t('main.validation.invalidRequest'));
  }
  return action;
}

export interface IpcServices {
  settings: SettingsStore;
  auth: AuthService;
  maps: MapService;
  mapView: MapViewService;
  mods: ModService;
  lobby: LobbyService;
  games: GameRunner;
  updater: GameUpdater;
  appUpdates: AppUpdates;
  appReleases: AppReleases;
  presets: GamePresetStore;
  featuredMods: FeaturedModCatalog;
  news: NewsService;
  leagues: LeagueService;
  tournaments: TournamentService;
  tutorials: TutorialService;
  unitDatabases: UnitDatabases;
  tasks: TaskReporter;
  replays: ReplayService;
  liveReplays: LiveReplayTracker;
  coop: CoopService;
  chat: ChatService;
  matchmaker: MatchmakerService;
  runtime: RuntimeComponents;
  generator: MapGenerator;
  stoneMap: StoneMapService;
  notifications: NotificationCenter;
  clans: ClanService;
  notes: PlayerNotesStore;
  joinPasswords: JoinPasswordStore;
  invites: GameInvites;
  friends: FriendList;
  profiles: ProfileService;
  reports: ReportService;
  reviews: ReviewService;
  uploads: UploadService;
  discord: DiscordPresence;
  loadSaver: GameLoadSaver;
  api: FafApi;
  gameOptions: GameOptionsService;
  logs: LogCleaner;
  tray: AppTray;
  /** The answer to the question the first close of the main window asked in the interface. */
  windowClose: { answer(answer: WindowCloseAnswer): Promise<void> };
}

const MAX_VERSION_ID = 2 ** 31 - 1;
const MAX_PAGE = 10_000;
const MAX_LOGIN_LENGTH = 100;
const MAX_FILE_PATH_LENGTH = 1024;
const MAX_ID_LENGTH = 100;
const MAX_CLAN_TAG_LENGTH = 10;
const MAX_BADGE_COUNT = 9999;
const MAX_KEY_BINDING_LENGTH = 64;

const PATH_DIALOG_TITLES: Record<Exclude<PathField, 'gamePrefsPath'>, MessageKey> = {
  gamePath: 'main.ipc.dialogs.gamePath',
  vaultPath: 'main.ipc.dialogs.vaultPath',
  dataPath: 'main.ipc.dialogs.dataPath',
};

export function registerIpc(services: IpcServices, getWindow: () => BrowserWindow | null): void {
  const { settings, auth, maps, mods, lobby, games, updater, appUpdates, presets, featuredMods } = services;
  const { news, leagues, tournaments, tutorials, tasks, replays, coop, chat, matchmaker, runtime, generator, notifications } = services;

  const handle = (channel: string, handler: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      if (event.sender !== getWindow()?.webContents) {
        return { ok: false, error: t('main.ipc.untrustedSender') };
      }
      try {
        return { ok: true, value: await handler(...args) };
      } catch (error) {
        if (!(error instanceof InvalidInputError) && !(error instanceof CancelledError)) {
          console.warn(`IPC ${channel} failed: ${describeError(error)}`);
        }
        return { ok: false, error: describeError(error) };
      }
    });
  };

  const pickPath = async (field: PathField): Promise<void> => {
    const window = getWindow();
    const current = settings.get()[field] ?? undefined;
    const options: Electron.OpenDialogOptions =
      field === 'gamePrefsPath'
        ? {
            title: t('main.ipc.dialogs.gamePrefs'),
            defaultPath: current,
            properties: ['openFile'],
            filters: [{ name: 'Game.prefs', extensions: ['prefs'] }],
          }
        : {
            title: t(PATH_DIALOG_TITLES[field]),
            defaultPath: current ?? undefined,
            properties: ['openDirectory'],
          };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (!result.canceled && selected) {
      await settings.update({ [field]: path.normalize(selected) });
    }
  };

  handle(IPC.serversList, () => listServers());

  handle(IPC.settingsGet, () => settings.get());
  handle(IPC.settingsUpdate, async (patch) => {
    const parsed = parseSettingsPatch(patch);
    const updated = await settings.update(parsed);
    if (parsed.rememberMe !== undefined) {
      await auth.applyRememberMe();
    }
    if (parsed.language !== undefined) {
      setLocale(resolveLocale(updated.language, app.getLocale()));
      services.tray.refresh();
    }
    if (parsed.chat !== undefined) {
      chat.applySettings();
    }
    if (parsed.discord !== undefined) {
      services.discord.update();
    }
    if (parsed.reduceGameLoad !== undefined) {
      services.loadSaver.update();
    }
    if (parsed.betaUpdates !== undefined) {
      appUpdates.betasChanged();
    }
    const window = getWindow();
    if (parsed.interfaceScale !== undefined && window) {
      applyInterfaceScale(window, updated.interfaceScale, screen.getDisplayMatching(window.getBounds()).workAreaSize);
    }
    return updated;
  });
  handle(IPC.settingsPickPath, async (field) => {
    await pickPath(parsePathField(field));
    return settings.get();
  });
  handle(IPC.settingsPathsStatus, () => settings.pathsStatus());

  handle(IPC.authGetState, () => auth.getState());
  handle(IPC.authLogin, (server) => {
    if (!isServerId(server)) {
      throw new InvalidInputError(t('main.ipc.unknownServer'));
    }
    auth.login(server);
  });
  handle(IPC.authCancel, () => auth.cancelLogin());
  handle(IPC.authLogout, () => {
    if (games.getState().phase !== 'idle') {
      throw new Error(t('main.ipc.logoutDuringGame'));
    }
    return auth.logout();
  });

  handle(IPC.mapsQuery, (query) => maps.query(parseMapQuery(query)));
  handle(IPC.mapsInstalled, () => maps.installed());
  handle(IPC.mapsInstall, (versionId) => maps.install(integer(versionId, 1, MAX_VERSION_ID)));
  handle(IPC.mapsUninstall, (folderName) => maps.uninstall(text(folderName, 255)));
  handle(IPC.mapsReveal, (folderName) => maps.reveal(text(folderName, 255)));
  handle(IPC.mapsVaultCheck, (folderNames) => maps.vaultCheck(parseFolderNameList(folderNames)));

  handle(IPC.mapViewAvailable, (folderName) => services.mapView.available(text(folderName, 255)));
  handle(IPC.mapViewScene, (folderName) => services.mapView.scene(text(folderName, 255)));
  handle(IPC.mapViewTextures, (paths, maxSide) =>
    services.mapView.textures(parseGamePaths(paths, '.dds'), integer(maxSide, 1, MAP_TEXTURE_MAX_SIDE)),
  );
  handle(IPC.mapViewMeshes, (paths) => services.mapView.meshes(parseGamePaths(paths, '.scm')));

  handle(IPC.modsQuery, (query) => mods.query(parseModQuery(query)));
  handle(IPC.modsInstalled, () => mods.installed());
  handle(IPC.modsInstall, (versionId) => mods.install(integer(versionId, 1, MAX_VERSION_ID)));
  handle(IPC.modsUninstall, (uid) => mods.uninstall(text(uid, 256)));
  handle(IPC.modsReveal, (uid) => mods.reveal(text(uid, 256)));
  handle(IPC.modsSetActive, (uids) => mods.setActive(parseUidList(uids)));
  handle(IPC.modsNotInVault, (uids) => mods.notInVault(parseUidList(uids)));

  handle(IPC.taskCancel, (taskId) => tasks.cancel(text(taskId, 64)));

  handle(IPC.lobbyGetState, () => lobby.getState());
  handle(IPC.lobbyGetGames, () => lobby.getGames());
  handle(IPC.lobbyReconnect, () => lobby.reconnect());

  handle(IPC.gameFeaturedMods, () => featuredMods.hostable());
  handle(IPC.gameHost, (options) => games.host(parseHostGameOptions(options)));
  handle(IPC.gameJoin, (gameId, password) => games.join(integer(gameId, 1, MAX_VERSION_ID), parseOptionalPassword(password)));
  handle(IPC.gameInvitees, (query) => services.invites.invitees(parsePlayerQuery(query)));
  handle(IPC.gameInvite, (playerId) => services.invites.invite(integer(playerId, 1, MAX_VERSION_ID)));
  handle(IPC.gameGetState, () => games.getState());
  handle(IPC.gameKill, () => games.kill());
  handle(IPC.gameChangeMods, (modUids) => games.changeHostedMods(parseUidList(modUids)));
  handle(IPC.gameCancelLaunch, () => games.cancelLaunch());
  handle(IPC.tfafLobbyAct, (action) => games.lobbyAct(parseAction(action)));
  handle(IPC.tfafLobbySay, (message) => games.lobbySay(text(message, LOBBY_LIMITS.maxChatLength)));
  handle(IPC.tfafLobbyStart, () => games.lobbyStart());
  handle(IPC.tfafLobbyCancelStart, () => games.lobbyCancelStart());
  handle(IPC.tfafLobbyCatalog, () => games.lobbyCatalog());
  handle(IPC.tfafLobbyUnits, () => games.lobbyUnitCatalog());
  handle(IPC.tfafLobbyPresets, () => games.lobbyPresets());
  handle(IPC.tfafLobbySavePreset, (name) => games.lobbySavePreset(text(name, LOBBY_LIMITS.maxPresetName)));
  handle(IPC.tfafLobbyDeletePreset, (id) => games.lobbyDeletePreset(text(id, 64)));
  handle(IPC.tfafLobbyLoadPreset, (id) => games.lobbyLoadPreset(text(id, 64)));
  // Updating the files needs the session, so a signed-out launcher can only start the installed ones.
  handle(IPC.gameSkirmish, (update) => games.launchSkirmish(update === true && auth.getState().status === 'signedIn'));

  handle(IPC.openExternal, (url) => shell.openExternal(parseHttpsUrl(url)));
  handle(IPC.newsList, () => news.list());
  handle(IPC.leaguesList, () => leagues.list());
  handle(IPC.leaguesSeasons, (leagueId) => leagues.seasonsOf(parseApiId(leagueId)));
  handle(IPC.leaguesStanding, (seasonId) => leagues.standing(parseApiId(seasonId)));
  handle(IPC.leaguesEntries, (seasonId, subdivisionId, page) =>
    leagues.entries(parseApiId(seasonId), parseApiId(subdivisionId), integer(page, 1, MAX_PAGE)),
  );
  handle(IPC.leaguesFind, (seasonId, login) => leagues.find(parseApiId(seasonId), text(login, MAX_LOGIN_LENGTH).trim()));
  handle(IPC.tournamentsList, () => tournaments.list());
  handle(IPC.tutorialsList, () => tutorials.list());
  handle(IPC.tutorialsLaunch, (tutorialId) => tutorials.launch(parseApiId(tutorialId)));
  handle(IPC.unitDatabasesRefresh, (id) => services.unitDatabases.refresh(parseUnitDatabaseId(id)));

  handle(IPC.replaysQuery, (query) => replays.query(parseReplayQuery(query)));
  handle(IPC.replaysLocal, () => replays.local());
  handle(IPC.replaysLive, () => replays.live());
  handle(IPC.replaysWatch, (replayId) => replays.watch(integer(replayId, 1, MAX_VERSION_ID)));
  handle(IPC.replaysWatchFile, (file) => replays.watchFile(text(file, MAX_FILE_PATH_LENGTH)));
  handle(IPC.replaysOpenFile, async () => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: t('main.ipc.dialogs.replayFile'),
      properties: ['openFile'],
      filters: [{ name: t('main.ipc.dialogs.replayFilter'), extensions: ['fafreplay', 'scfareplay'] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) {
      return false;
    }
    await replays.watchPath(selected);
    return true;
  });
  handle(IPC.replaysWatchLive, (gameId) => replays.watchLive(integer(gameId, 1, MAX_VERSION_ID)));
  handle(IPC.replaysReveal, (file) => replays.reveal(text(file, MAX_FILE_PATH_LENGTH)));
  handle(IPC.replaysDelete, (file) => replays.delete(text(file, MAX_FILE_PATH_LENGTH)));
  handle(IPC.replaysDetails, (replayId) => replays.details(integer(replayId, 1, MAX_VERSION_ID)));
  handle(IPC.replaysFileDetails, (file) => replays.fileDetails(text(file, MAX_FILE_PATH_LENGTH)));
  handle(IPC.replaysLink, (replayId) => replays.link(integer(replayId, 1, MAX_VERSION_ID)));
  handle(IPC.replaysTrackLive, (gameId, action) =>
    services.liveReplays.track(integer(gameId, 1, MAX_VERSION_ID), parseLiveReplayAction(action)),
  );
  handle(IPC.replaysUntrackLive, () => services.liveReplays.untrack());
  handle(IPC.replaysGetTracking, () => services.liveReplays.get());

  handle(IPC.coopScenarios, () => coop.scenarios());
  handle(IPC.coopLeaderboard, (missionId, playerCount) =>
    coop.leaderboard(parseApiId(missionId), integer(playerCount, 0, COOP_MAX_PLAYERS)),
  );
  handle(IPC.coopHost, (request) => coop.host(parseCoopHostRequest(request)));

  handle(IPC.chatGetState, () => chat.getState());
  handle(IPC.chatOpen, (name) => chat.open(name === null ? null : parseChatTarget(name)));
  handle(IPC.chatSend, (channel, message, replyTo) =>
    chat.send(parseChatTarget(channel), parseChatText(message), replyTo === null ? null : parseChatMessageId(replyTo)),
  );
  handle(IPC.chatReact, (channel, messageId, shortcode) =>
    chat.react(parseChatTarget(channel), parseChatMessageId(messageId), text(shortcode, 40)),
  );
  handle(IPC.chatDelete, (channel, messageId) => chat.delete(parseChatTarget(channel), parseChatMessageId(messageId)));
  handle(IPC.chatSetTopic, (channel, topic) => chat.setTopic(parseChatTarget(channel), parseChatTopic(topic)));
  handle(IPC.chatJoin, (channel) => chat.join(parseChatTarget(channel)));
  handle(IPC.chatLeave, (channel) => chat.leave(parseChatTarget(channel)));
  handle(IPC.chatOpenPrivate, (nick) => chat.openPrivate(parseChatTarget(nick)));
  handle(IPC.chatTyping, (channel, active) => chat.typing(parseChatTarget(channel), active === true));
  handle(IPC.chatPreviewLink, (url) => chat.previewLink(parseHttpsUrl(url)));
  handle(IPC.chatReconnect, () => chat.reconnect());
  handle(IPC.chatSetRelation, (playerId, relation) =>
    chat.setRelation(integer(playerId, 1, MAX_VERSION_ID), parseChatRelation(relation)),
  );
  handle(IPC.chatWatch, (name) => chat.watch(name === null ? null : parseChatTarget(name)));
  handle(IPC.chatClan, (tag) => services.clans.byTag(text(tag, MAX_CLAN_TAG_LENGTH)));
  handle(IPC.notesList, () => services.notes.list());
  handle(IPC.notesSet, (playerId, note) =>
    services.notes.set(integer(playerId, 1, MAX_VERSION_ID), typeof note === 'string' ? note.slice(0, MAX_NOTE_LENGTH) : ''),
  );
  handle(IPC.joinPasswordsGet, (host) => services.joinPasswords.get(text(host, MAX_LOGIN_LENGTH)));
  handle(IPC.joinPasswordsSet, (host, password) =>
    services.joinPasswords.set(text(host, MAX_LOGIN_LENGTH), parseOptionalPassword(password)),
  );
  handle(IPC.profileGet, (player) => services.profiles.get(parsePlayerRef(player)));
  handle(IPC.profileRatingHistory, (playerId, leaderboardId, period) =>
    services.profiles.ratingHistory(parsePlayerId(playerId), Number(parseApiId(leaderboardId)), parseProfilePeriod(period)),
  );
  handle(IPC.profileAchievements, (playerId) => services.profiles.achievements(parsePlayerId(playerId)));
  handle(IPC.profileStatistics, (playerId) => services.profiles.statistics(parsePlayerId(playerId)));
  handle(IPC.profileSearch, (query) => services.profiles.search(parsePlayerQuery(query)));
  handle(IPC.avatarsList, async () => ({
    available: await services.lobby.listAvatars(),
    current: services.lobby.getSelf()?.avatar?.url ?? null,
  }));
  handle(IPC.avatarsSelect, (url) => services.lobby.selectAvatar(parseAvatarUrl(url)));
  handle(IPC.avatarsGetCurrent, () => services.lobby.getSelf()?.avatar ?? null);
  handle(IPC.reportsList, () => services.reports.list());
  handle(IPC.reportsSubmit, (report) => services.reports.submit(parseReportInput(report)));
  // Only these folders: the renderer names one, the main process knows where it is.
  handle(IPC.foldersOpen, (folder) => openAppFolder(settings, parseAppFolder(folder)));
  handle(IPC.iceTurnServers, async () => parseTurnServers(await services.api.getJson('/ice/server')));
  handle(IPC.reviewsList, (target) => services.reviews.list(parseReviewTarget(target)));
  handle(IPC.reviewsSave, (target, reviewId, review) =>
    services.reviews.save(parseReviewTarget(target), reviewId === null ? null : parseApiId(reviewId), parseReviewInput(review)),
  );
  handle(IPC.reviewsDelete, (kind, reviewId) => services.reviews.delete(parseReviewKind(kind), parseApiId(reviewId)));
  handle(IPC.uploadsPick, (kind) => services.uploads.pick(parseUploadKind(kind)));
  handle(IPC.uploadsMap, (token, ranked) => services.uploads.uploadMap(parseUploadToken(token), parseBoolean(ranked)));
  handle(IPC.uploadsMod, (token) => services.uploads.uploadMod(parseUploadToken(token)));
  handle(IPC.uploadsHideVersion, (kind, versionId) =>
    services.uploads.hideVersion(parseUploadKind(kind), integer(versionId, 1, MAX_VERSION_ID)),
  );

  handle(IPC.matchmakerGetState, () => matchmaker.getState());
  handle(IPC.matchmakerSetQueueSelected, (queue, selected) => matchmaker.setQueueSelected(parseQueueName(queue), selected === true));
  handle(IPC.matchmakerSetFactions, (factions) => matchmaker.setFactions(parseFactions(factions)));
  handle(IPC.matchmakerStartSearch, () => matchmaker.startSearch());
  handle(IPC.matchmakerStopSearch, () => matchmaker.stopSearch());
  handle(IPC.matchmakerMapPool, (queue) => matchmaker.mapPool(parseQueueName(queue)));
  handle(IPC.matchmakerSetVeto, (bracketId, assignmentId, tokens) =>
    matchmaker.setVeto(integer(bracketId, 1, MAX_VERSION_ID), integer(assignmentId, 1, MAX_VERSION_ID), integer(tokens, 0, 100)),
  );
  handle(IPC.matchmakerFindPlayers, (query) => matchmaker.findPlayers(parsePlayerQuery(query)));
  handle(IPC.matchmakerInvite, (playerId) => matchmaker.invite(integer(playerId, 1, MAX_VERSION_ID)));
  handle(IPC.matchmakerAcceptInvite, (playerId) => matchmaker.acceptInvite(integer(playerId, 1, MAX_VERSION_ID)));
  handle(IPC.matchmakerDeclineInvite, (playerId) => matchmaker.declineInvite(integer(playerId, 1, MAX_VERSION_ID)));
  handle(IPC.matchmakerKick, (playerId) => matchmaker.kick(integer(playerId, 1, MAX_VERSION_ID)));
  handle(IPC.matchmakerLeaveParty, () => matchmaker.leaveParty());

  handle(IPC.friendsGetState, () => services.friends.getState());
  handle(IPC.friendsFind, (query) => services.friends.find(parsePlayerQuery(query)));

  // A repair replaces files the game reads, so the checks wait until no game is running.
  const requireNoGame = (): void => {
    if (games.getState().phase !== 'idle') {
      throw new Error(t('main.game.closeGameFirst'));
    }
  };
  handle(IPC.integrityCheckGameFiles, async () => {
    requireNoGame();
    const { checked, repaired } = await updater.update('faf', { verify: true });
    return { checked, repaired };
  });
  handle(IPC.integrityCheckMods, () => {
    requireNoGame();
    return mods.checkAll();
  });

  const oldVersions = async (): Promise<OldVersionFile[]> => [
    ...(await runtime.oldVersions()),
    ...(await generator.oldVersions()),
    ...(await services.stoneMap.oldVersions()),
  ];
  handle(IPC.storageOldVersions, async () => (await oldVersions()).map(({ title, bytes }) => ({ title, bytes })));
  // A game being prepared may be about to run an older generator, and a matchmaker search has its generators ready.
  handle(IPC.storageRemoveOldVersions, async () => {
    requireNoGame();
    const search = matchmaker.getState();
    if (search.searching || search.preparing) {
      throw new Error(t('main.matchmaker.stopSearchFirst'));
    }
    return removeOldVersions(await oldVersions());
  });
  handle(IPC.storageLogs, () => services.logs.usage());
  handle(IPC.storageCleanLogs, () => services.logs.clean());

  handle(IPC.gameOptionsGet, () => services.gameOptions.options());
  handle(IPC.gameOptionsSet, (key, value) => services.gameOptions.setOption(text(key, MAX_ID_LENGTH), parseGameOptionValue(value)));
  handle(IPC.gameOptionsExport, () => services.gameOptions.exportSettings());
  handle(IPC.gameOptionsPickImport, () => services.gameOptions.pickImport());
  handle(IPC.gameOptionsImport, (token, parts) =>
    services.gameOptions.importSettings(parseUploadToken(token), parseSettingsParts(parts)),
  );
  handle(IPC.keyBindingsGet, () => services.gameOptions.keyBindings());
  handle(IPC.keyBindingsAssign, (action, key) =>
    services.gameOptions.assignKey(text(action, MAX_ID_LENGTH), text(key, MAX_KEY_BINDING_LENGTH)),
  );
  handle(IPC.keyBindingsUnbind, (action, key) =>
    services.gameOptions.unbindKey(text(action, MAX_ID_LENGTH), text(key, MAX_KEY_BINDING_LENGTH)),
  );
  handle(IPC.keyBindingsReset, (preset) => services.gameOptions.resetKeys(parseKeyPreset(preset)));

  handle(IPC.presetsGet, () => presets.get());
  handle(IPC.presetsSaveDraft, (draft) => presets.saveDraft(parseDraftInput(draft)));
  handle(IPC.presetsSave, (name, draft) => presets.save(parsePresetNameInput(name), parseDraftInput(draft)));
  handle(IPC.presetsDelete, (id) => presets.delete(text(id, 64)));

  handle(IPC.generatorOptions, async () => generator.options(await generator.latestVersion()));
  handle(IPC.generatorGenerate, (request) => generator.generateCustom(parseCustomMapRequest(request)));

  const { stoneMap } = services;
  handle(IPC.stoneMapGetState, () => stoneMap.getState());
  handle(IPC.stoneMapStart, () => stoneMap.start());
  handle(IPC.stoneMapCapabilities, () => stoneMap.capabilities());
  handle(IPC.stoneMapResolve, (request) => stoneMap.resolve(parseStoneMapBody(request)));
  handle(IPC.stoneMapGenerate, (request) => stoneMap.generate(parseStoneMapBody(request)));
  handle(IPC.stoneMapJobs, (limit) => stoneMap.jobs(parseStoneMapJobLimit(limit)));
  handle(IPC.stoneMapJob, (id) => stoneMap.job(parseStoneMapJobId(id)));
  handle(IPC.stoneMapCancel, (id) => stoneMap.cancel(parseStoneMapJobId(id)));
  handle(IPC.stoneMapRemove, (id) => stoneMap.remove(parseStoneMapJobId(id)));
  handle(IPC.stoneMapResult, (id) => stoneMap.result(parseStoneMapJobId(id)));
  handle(IPC.stoneMapResources, (id) => stoneMap.resources(parseStoneMapJobId(id)));
  handle(IPC.stoneMapReclaim, (id) => stoneMap.reclaim(parseStoneMapJobId(id)));
  handle(IPC.stoneMapNavigation, (id) => stoneMap.navigation(parseStoneMapJobId(id)));
  handle(IPC.stoneMapFiles, (id) => stoneMap.files(parseStoneMapJobId(id)));
  handle(IPC.stoneMapHeightmap, (id) => stoneMap.heightmap(parseStoneMapJobId(id)));
  handle(IPC.stoneMapPreview, (id, options) => stoneMap.preview(parseStoneMapJobId(id), parsePreviewOptions(options)));
  handle(IPC.stoneMapTextureLayers, (id) => stoneMap.textureLayers(parseStoneMapJobId(id)));
  handle(IPC.stoneMapTextureAssets, () => stoneMap.textureAssets());
  handle(IPC.stoneMapUseGameTextures, (enabled) => stoneMap.useGameTextures(parseBoolean(enabled)));
  handle(IPC.stoneMapUpdatePresentation, (id, presentation) =>
    stoneMap.updatePresentation(parseStoneMapJobId(id), parsePresentation(presentation)),
  );
  handle(IPC.stoneMapAdjustments, (id) => stoneMap.adjustments(parseStoneMapJobId(id)));
  handle(IPC.stoneMapMoveAdjustment, (id, move) => stoneMap.moveAdjustment(parseStoneMapJobId(id), parseStoneMapBody(move)));
  handle(IPC.stoneMapDeleteAdjustment, (id, deletion) => stoneMap.deleteAdjustment(parseStoneMapJobId(id), parseStoneMapBody(deletion)));
  handle(IPC.stoneMapAdjustmentPlacement, (id, request) =>
    stoneMap.adjustmentPlacement(parseStoneMapJobId(id), parseStoneMapBody(request)),
  );
  handle(IPC.stoneMapApplyAdjustments, (id, draft) => stoneMap.applyAdjustments(parseStoneMapJobId(id), parseStoneMapBody(draft)));
  handle(IPC.stoneMapSaveToMaps, (id) => stoneMap.saveToMaps(parseStoneMapJobId(id)));
  handle(IPC.stoneMapExportZip, async (id) => {
    const jobId = parseStoneMapJobId(id);
    const options: Electron.SaveDialogOptions = {
      title: t('main.stoneMap.zipDialog'),
      defaultPath: path.join(app.getPath('downloads'), await stoneMap.zipName(jobId)),
      filters: [{ name: t('main.stoneMap.zipFilter'), extensions: ['zip'] }],
      properties: ['showOverwriteConfirmation'],
    };
    const window = getWindow();
    const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) {
      return false;
    }
    await stoneMap.exportZip(jobId, choice.filePath);
    return true;
  });

  handle(IPC.appUpdateGetState, () => appUpdates.getState());
  handle(IPC.appUpdateCheck, () => appUpdates.check());
  handle(IPC.appUpdateInstall, () => {
    if (games.getState().phase !== 'idle') {
      throw new Error(t('main.ipc.updateDuringGame'));
    }
    appUpdates.install();
  });
  handle(IPC.appUpdateReleases, (online) => services.appReleases.history(parseBoolean(online), appUpdates.getState().version));

  handle(IPC.windowGetState, () => {
    const window = getWindow();
    return window ? windowState(window) : { maximized: false, focused: false };
  });
  handle(IPC.windowMinimize, () => getWindow()?.minimize());
  handle(IPC.windowToggleMaximize, () => {
    const window = getWindow();
    if (window?.isMaximized()) {
      window.unmaximize();
    } else {
      window?.maximize();
    }
  });
  handle(IPC.windowClose, () => getWindow()?.close());
  handle(IPC.windowQuit, () => services.tray.requestQuit());
  handle(IPC.windowAnswerClose, (answer) => services.windowClose.answer(parseWindowCloseAnswer(answer)));
  handle(IPC.windowSetBadge, (count, image) => {
    const number = integer(count, 0, MAX_BADGE_COUNT);
    const png = number > 0 ? parseBadgeImage(image) : null;
    if (number > 0 && !png) {
      throw new InvalidInputError(t('main.validation.invalidRequest'));
    }
    services.tray.setBadge(number, png);
    const window = getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    if (png) {
      window.setOverlayIcon(nativeImage.createFromDataURL(png), t('notifications.taskbarBadge', { count: number }));
    } else {
      window.setOverlayIcon(null, '');
    }
  });

  handle(IPC.notificationsList, () => notifications.list());
  handle(IPC.notificationsMarkAllRead, () => notifications.markAllRead());
  handle(IPC.notificationsDismiss, (id) => notifications.dismiss(text(id, MAX_ID_LENGTH)));
  handle(IPC.notificationsClear, () => notifications.clear());
  handle(IPC.notificationsAct, (id, actionId) =>
    notifications.act(text(id, MAX_ID_LENGTH), actionId === null ? null : text(actionId, MAX_ID_LENGTH)),
  );
}
