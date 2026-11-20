import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, powerMonitor, protocol, screen, session, shell, type Size } from 'electron';
import path from 'node:path';
import {
  type GameSessionState,
  IPC,
  type LobbyNotice,
  type NavigationTarget,
  type TaskProgress,
  UNIT_DATABASE_SCHEME,
  type WindowBounds,
  type WindowCloseAnswer,
} from '../shared/contract.ts';
import { resolveLocale } from '../shared/i18n/index.ts';
import { FafApi } from './api/fafApi.ts';
import { AppReleases } from './appReleases.ts';
import { AppUpdates } from './appUpdates.ts';
import { openAppFolder } from './appFolders.ts';
import { minimumWindowSize, restoredBounds, watchWindowState, windowCloseAction } from './appWindow.ts';
import { registerWindowShortcuts } from './windowShortcuts.ts';
import { AuthService } from './auth/authService.ts';
import { TokenStore } from './auth/tokenStore.ts';
import { ChatService } from './chat/chatService.ts';
import { CoopService } from './coop/coopService.ts';
import { DesktopNotifier } from './desktopNotifier.ts';
import { MapViewService } from './mapView/mapViewService.ts';
import { describeError } from './errors.ts';
import { watchFriendActivity } from './friendNotifications.ts';
import { FriendList } from './lobby/friendList.ts';
import { FeaturedModCatalog } from './game/featuredMods.ts';
import { GameInvites } from './game/gameInvites.ts';
import { GameLoadSaver, sessionChanged } from './game/gameLoadSaver.ts';
import { GameRunner } from './game/gameRunner.ts';
import { recoverPortablePrefs } from './game/portablePrefs.ts';
import { GameUpdater } from './game/gameUpdater.ts';
import { JavaIceAdapter } from './game/javaIceAdapter.ts';
import { isForgedAllianceRunning } from './game/processes.ts';
import { RuntimeComponents } from './game/runtimeComponents.ts';
import { GameOptionsService } from './gameOptions/gameOptionsService.ts';
import { notifyGameEnded, notifyGameFailed, notifyGameFull } from './gameNotifications.ts';
import { LobbyMemory } from './game/tfafLobby/lobbyMemory.ts';
import { GamePresetStore } from './gamePresets.ts';
import { setLocale, t } from './i18n.ts';
import { TfafIceAdapter } from './ice/tfafIceAdapter.ts';
import { LeagueService } from './info/leagues.ts';
import { ClanService } from './info/clans.ts';
import { NewsService } from './info/news.ts';
import { TournamentService } from './info/tournaments.ts';
import { TutorialService } from './info/tutorials.ts';
import { UnitDatabases, unitDatabaseSiteUrl } from './info/unitDatabases.ts';
import { registerIpc } from './ipc.ts';
import { LobbyService } from './lobby/lobbyService.ts';
import { LogCleaner } from './logCleanup.ts';
import { startFileLog } from './logger.ts';
import { MatchmakerService } from './matchmaker/matchmakerService.ts';
import { NotificationCenter } from './notifications.ts';
import { isExistingFile, replayFileArgument } from './openFiles.ts';
import { JoinPasswordStore } from './joinPasswords.ts';
import { PlayerNotesStore } from './playerNotes.ts';
import { DiscordJoins } from './discord/discordJoin.ts';
import { setDiscordLaunch } from './discord/discordLaunch.ts';
import { DISCORD_APP_ID, DiscordPresence } from './discord/discordPresence.ts';
import { ProfileService } from './players/profileService.ts';
import { ReportService } from './players/reports.ts';
import { ReviewService } from './vault/reviews.ts';
import { UploadService } from './vault/uploads.ts';
import { LiveReplayTracker } from './replays/liveReplayTracker.ts';
import { ReplayService } from './replays/replayService.ts';
import { isOpenableLink } from './servers.ts';
import { SettingsStore } from './settings.ts';
import { configureStorage } from './storage.ts';
import { SoundPlayer } from './sounds.ts';
import { developmentExecutable, StoneMapBuilds } from './stoneMap/stoneMapBuild.ts';
import { StoneMapService } from './stoneMap/stoneMapService.ts';
import { taskbarProgress } from './taskbar.ts';
import { TaskReporter } from './tasks.ts';
import { AppTray } from './tray.ts';
import { removeStaleTempDownloads } from './vault/download.ts';
import { removeInstallLeftovers } from './vault/installer.ts';
import { ManifestStore } from './vault/integrity.ts';
import { MapGenerator } from './vault/mapGenerator.ts';
import { existingLocalPreviewUrl, MAP_PREVIEW_SCHEME, serveLocalPreview } from './vault/mapPreviews.ts';
import { MapService } from './vault/mapService.ts';
import { ModService } from './vault/modService.ts';

let mainWindow: BrowserWindow | null = null;
let appTray: AppTray | null = null;
// Set once the launcher really quits (the tray or account menu, an update install, the end of the Windows session, a
// confirmed close during a game), so closing the window no longer hides it to the tray or asks about the game.
let quitting = false;

// The splash stays up while the session is restored, so the main window opens straight on the games list or the
// login screen; a slow network only delays that up to SESSION_WAIT_MS.
const SESSION_WAIT_MS = 8_000;
const SPLASH_MAX_MS = 15_000;
const WINDOW_SAVE_DELAY_MS = 1_000;
const MAX_SIZE_DRIFT = 16;

const MAX_RENDERER_RELOADS = 3;
const RENDERER_CRASH_WINDOW_MS = 60_000;
const GAME_SHUTDOWN_GRACE_MS = 5_000;

// A replay opened from Explorer, on the command line of this start or of a second start while the launcher runs. It
// plays once the user is signed in: the game files of its version come from the server.
let pendingReplayFile: string | null = replayFileArgument(process.argv.slice(1));
let openReplayFile: ((file: string) => void) | null = null;

// Packaged builds take the window icon from the executable.
const WINDOW_ICON = app.isPackaged ? undefined : path.join(__dirname, '../../resources/icon.png');
const TRAY_ICON = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../../resources/icon.png');

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadPage(window: BrowserWindow, page: 'index' | 'splash'): void {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(page === 'index' ? devServerUrl : `${devServerUrl}/${page}.html`);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${page}.html`));
  }
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 400,
    height: 400,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: 'TFAF',
    icon: WINDOW_ICON,
    backgroundColor: '#081016',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // did-finish-load waits for the image too, so the splash never appears half drawn.
  splash.webContents.once('did-finish-load', () => splash.show());
  splash.webContents.on('will-navigate', (event) => event.preventDefault());
  loadPage(splash, 'splash');
  return splash;
}

function createWindow(scalePercent: number, saved: WindowBounds | null, saveBounds: (bounds: WindowBounds) => void): BrowserWindow {
  // The window opens on the primary display; a later scale change measures the display the window is on.
  const minimum = minimumWindowSize(scalePercent, screen.getPrimaryDisplay().workAreaSize);
  const bounds = restoredBounds(
    saved,
    screen.getAllDisplays().map((display) => display.workArea),
    minimum,
  ) ?? { width: 1280, height: 820 };
  const window = new BrowserWindow({
    ...bounds,
    minWidth: minimum.width,
    minHeight: minimum.height,
    show: false,
    title: 'TFAF',
    icon: WINDOW_ICON,
    backgroundColor: '#0b1017',
    // The renderer draws its own title bar with the window buttons.
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: scalePercent / 100,
      additionalArguments: [`--tfaf-system-locale=${app.getLocale()}`],
    },
  });

  // Links that open a new window (FAF pages, blueprints from the unit databases) go to the system browser; the app
  // itself never opens new windows.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const link = unitDatabaseSiteUrl(url);
    if (isOpenableLink(link)) {
      void shell.openExternal(link);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  // The renderer has no log file of its own; its warnings and errors go to the launcher log.
  window.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.warn(`Renderer ${details.level}: ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  let recentCrashes: number[] = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process gone: ${details.reason} (${details.exitCode})`);
    const now = Date.now();
    recentCrashes = [...recentCrashes.filter((time) => now - time < RENDERER_CRASH_WINDOW_MS), now];
    // A blank window would leave a running game without controls; a renderer that keeps crashing is left alone.
    if (details.reason !== 'clean-exit' && recentCrashes.length <= MAX_RENDERER_RELOADS && !window.isDestroyed()) {
      loadPage(window, 'index');
    }
  });
  registerWindowShortcuts(window);
  watchWindowState(window, (state) => send(IPC.windowStateChanged, state));
  rememberWindowBounds(window, bounds, saveBounds);
  loadPage(window, 'index');
  return window;
}

/** The window's place is saved a moment after it was moved or resized, and when it closes. */
function rememberWindowBounds(window: BrowserWindow, requested: Size, save: (bounds: WindowBounds) => void): void {
  // A frameless window on a scaled display comes out a few pixels larger than asked; saved as is, it would grow with
  // every start.
  const created = window.getBounds();
  const drift = {
    width: Math.min(Math.max(created.width - requested.width, 0), MAX_SIZE_DRIFT),
    height: Math.min(Math.max(created.height - requested.height, 0), MAX_SIZE_DRIFT),
  };
  let timer: NodeJS.Timeout | null = null;
  const current = (): WindowBounds => {
    const bounds = window.getNormalBounds();
    return { ...bounds, width: bounds.width - drift.width, height: bounds.height - drift.height, maximized: window.isMaximized() };
  };
  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (!window.isDestroyed()) {
        save(current());
      }
    }, WINDOW_SAVE_DELAY_MS);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    save(current());
  });
}

/**
 * The first close asks in the window whether closing should hide it to the tray or quit, and the answer becomes the
 * setting. With the setting on the window goes to the tray. Without it, closing while a game runs would also end the
 * game for everyone, so the user decides. Returns what takes the interface's answer to the first question.
 */
function guardWindowClose(
  window: BrowserWindow,
  games: GameRunner,
  settings: Pick<SettingsStore, 'get' | 'chooseCloseToTray'>,
  onHidden: () => void,
): (answer: WindowCloseAnswer) => Promise<void> {
  let askingAboutGame = false;
  let closeQuestionOpen = false;
  // The player chose to quit on the first question; the window closes even if the answer could not be saved.
  let closeConfirmed = false;
  const gameIdle = (): boolean => games.getState().phase === 'idle';
  // Windows ends the session whatever the launcher does; a window kept in the tray would only delay it.
  window.on('session-end', () => {
    quitting = true;
  });

  const hide = (): void => {
    window.hide();
    onHidden();
  };

  const askAboutGame = (): void => {
    if (askingAboutGame) {
      return;
    }
    askingAboutGame = true;
    // The question must not block this process: the game's traffic runs through it (ice/tfafIceAdapter.ts).
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        title: 'TFAF',
        message: t('app.closeDuringGame.message'),
        detail: t('app.closeDuringGame.detail'),
        buttons: [t('app.closeDuringGame.minimize'), t('app.closeDuringGame.quit'), t('common.cancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        askingAboutGame = false;
        if (window.isDestroyed()) {
          return;
        }
        if (response === 0) {
          window.minimize();
        } else if (response === 1) {
          quitting = true;
          void games.shutdown(GAME_SHUTDOWN_GRACE_MS).finally(() => window.close());
        }
      });
  };

  // Closing from the taskbar works on a minimized window too, and the question must be seen.
  const askCloseToTray = (): void => {
    closeQuestionOpen = true;
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
    window.webContents.send(IPC.windowCloseQuestion, null);
  };

  window.on('close', (event) => {
    if (closeConfirmed) {
      return;
    }
    const { closeToTray, closeToTrayChosen } = settings.get();
    const page = window.webContents;
    const interfaceReady = !page.isCrashed() && !page.isLoading();
    const action = windowCloseAction({ quitting, closeToTray, closeToTrayChosen, interfaceReady, gameIdle: gameIdle() });
    if (action === 'close') {
      return;
    }
    event.preventDefault();
    if (action === 'hide') {
      hide();
    } else if (action === 'askCloseToTray') {
      askCloseToTray();
    } else {
      askAboutGame();
    }
  });

  return async (answer) => {
    // Cancelling leaves the window open, and the next close asks again.
    if (!closeQuestionOpen || window.isDestroyed()) {
      return;
    }
    closeQuestionOpen = false;
    if (answer === 'cancel') {
      return;
    }
    const closeToTray = answer === 'tray';
    await settings.chooseCloseToTray(closeToTray).catch((error: unknown) => console.warn('Close action could not be saved', describeError(error)));
    if (window.isDestroyed()) {
      return;
    }
    const next = windowCloseAction({ quitting, closeToTray, closeToTrayChosen: true, interfaceReady: true, gameIdle: gameIdle() });
    if (next === 'hide') {
      hide();
    } else if (next === 'askAboutGame') {
      askAboutGame();
    } else {
      closeConfirmed = true;
      window.close();
    }
  };
}

function showAfterSplash(window: BrowserWindow, splash: BrowserWindow, sessionRestored: Promise<void>, maximized: boolean): void {
  const windowReady = new Promise<void>((resolve) => window.once('ready-to-show', () => resolve()));
  const sessionSettled = Promise.race([sessionRestored, delay(SESSION_WAIT_MS)]);
  void Promise.race([Promise.all([windowReady, sessionSettled]), delay(SPLASH_MAX_MS)]).then(() => {
    if (!window.isDestroyed()) {
      if (maximized) {
        window.maximize();
      }
      window.show();
      console.info(`Main window shown ${Math.round(performance.now())} ms after start`);
    }
    if (!splash.isDestroyed()) {
      splash.destroy();
    }
  });
}

async function start(): Promise<void> {
  startFileLog(app.getPath('logs'));
  // Windows shows notifications under this id; the installer gives its shortcut the same one (electron-builder appId).
  app.setAppUserModelId('com.tergride.tfaf');
  console.info(`TFAF ${app.getVersion()} starting`);
  const splash = createSplash();
  // Copying the login code is the only browser permission the UI needs.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write'),
  );

  const userAgent = `tfaf-launcher/${app.getVersion()}`;
  const unitDatabases = new UnitDatabases(path.join(app.getPath('userData'), 'unit-databases'), userAgent);
  protocol.handle(UNIT_DATABASE_SCHEME, (request) => unitDatabases.handle(request));
  const settings = await SettingsStore.load();
  protocol.handle(MAP_PREVIEW_SCHEME, (request) => serveLocalPreview(settings.mapsDirectory, request));
  setLocale(resolveLocale(settings.get().language, app.getLocale()));
  // A leftover game session must never keep the launcher closed: its outcome goes to the bell once that exists, and a
  // session that cannot be completed yet keeps the preferences locked until a later game start retries it.
  const prefsRecovery: Pick<LobbyNotice, 'style' | 'text'> | null = settings.pathsStatus().portable
    ? await recoverPortablePrefs(settings.get().gamePrefsPath).then(
        (warning) => (warning ? { style: 'warning' as const, text: warning } : null),
        (error: unknown) => ({ style: 'error' as const, text: describeError(error) }),
      )
    : null;
  if (prefsRecovery) {
    console.warn('Portable game settings recovery', prefsRecovery.text);
  }
  void Promise.all([
    removeInstallLeftovers(settings.mapsDirectory),
    removeInstallLeftovers(settings.modsDirectory),
    removeInstallLeftovers(path.join(settings.get().dataPath, 'runtime')),
    removeStaleTempDownloads(),
  ]);
  const logs = new LogCleaner({ directory: () => settings.logsDirectory, prefs: () => settings.get().logCleanup });
  logs.cleanAutomatically();
  const auth = new AuthService(settings, new TokenStore(), userAgent);
  const api = new FafApi(auth, userAgent);
  const featuredMods = new FeaturedModCatalog(api);
  const notifications = new NotificationCenter({
    onChanged: (items) => send(IPC.notificationsChanged, items),
    onAdded: (notification) => send(IPC.notificationsAdded, notification),
  });
  const sounds = new SoundPlayer(settings, (sound) => send(IPC.soundPlay, sound));
  const navigate = (target: NavigationTarget): void => send(IPC.navigate, target);
  // Notices of the services become notifications titled by where they come from. One already in the list is not
  // added again: the server repeats some notices, such as the unofficial client warning, on every login.
  const noticeFrom =
    (source: 'server' | 'game' | 'chat' | 'matchmaker') =>
    (notice: Pick<LobbyNotice, 'style' | 'text' | 'transient'>): void => {
      const title = t(`notifications.sources.${source}`);
      if (!notifications.list().some((item) => item.title === title && item.body === notice.text)) {
        notifications.add({ severity: notice.style, title, body: notice.text, transient: notice.transient });
      }
    };
  if (prefsRecovery) {
    noticeFrom('game')(prefsRecovery);
  }

  // The taskbar button shows the progress of a game start or of the downloads.
  const runningTasks = new Map<string, TaskProgress>();
  let gameState: GameSessionState | null = null;
  let shownProgress = '';
  const updateTaskbar = (): void => {
    const progress = taskbarProgress([...runningTasks.values()], gameState);
    const key = `${progress.mode}:${progress.fraction.toFixed(2)}`;
    if (key !== shownProgress && mainWindow && !mainWindow.isDestroyed()) {
      shownProgress = key;
      mainWindow.setProgressBar(progress.mode === 'none' ? -1 : progress.fraction, { mode: progress.mode });
    }
  };
  const tasks = new TaskReporter((task) => {
    send(IPC.taskProgress, task);
    if (task.state === 'running') {
      runningTasks.set(task.id, task);
    } else {
      runningTasks.delete(task.id);
    }
    updateTaskbar();
  });
  const lobby = new LobbyService(
    api,
    auth,
    featuredMods,
    app.getVersion(),
    {
      onState: (state) => send(IPC.lobbyStateChanged, state),
      onGames: (update) => send(IPC.lobbyGamesChanged, update),
      onNotice: (notice) => {
        noticeFrom('server')(notice);
        if (notice.style === 'error') {
          sounds.play('notification');
        }
      },
    },
    (mapFolderName) => existingLocalPreviewUrl(settings.mapsDirectory, mapFolderName),
  );

  const manifests = new ManifestStore(path.join(app.getPath('userData'), 'vault-manifests'));
  const runtime = new RuntimeComponents(settings, tasks, userAgent);
  const generator = new MapGenerator(runtime, settings, tasks, userAgent);
  const stoneMap = new StoneMapService({
    settings,
    tasks,
    builds: new StoneMapBuilds(() => runtime.runtimeDirectory, tasks, userAgent),
    developmentExecutable: developmentExecutable(app.isPackaged),
    onState: (state) => send(IPC.stoneMapStateChanged, state),
    onJob: (job) => send(IPC.stoneMapJobChanged, job),
  });
  const maps = new MapService(api, auth, settings, tasks, userAgent, manifests, generator, stoneMap);
  const mods = new ModService(api, settings, tasks, userAgent, manifests);
  const leagues = new LeagueService(api, auth);
  const notifier = new DesktopNotifier(() => mainWindow, settings);
  const updater = new GameUpdater(api, featuredMods, auth, settings, tasks, userAgent, app.getVersion());
  // Set when the session ended during a game: the game still reports its results through the lobby connection.
  let stopLobbyAfterGame = false;
  let matchmaker: MatchmakerService | null = null;
  let discord: DiscordPresence | null = null;
  let invites: GameInvites | null = null;
  const userData = app.getPath('userData');
  const [lobbyMemory, presets, notes, joinPasswords] = await Promise.all([
    LobbyMemory.load(path.join(userData, 'lobby-memory.json')),
    GamePresetStore.load(path.join(userData, 'game-presets.json')),
    PlayerNotesStore.load(path.join(userData, 'player-notes.json')),
    JoinPasswordStore.load(path.join(userData, 'join-passwords.json')),
  ]);
  const games: GameRunner = new GameRunner(
    {
      lobbyMemory,
      api,
      settings,
      lobby,
      maps,
      stoneMap,
      mods,
      updater,
      tasks,
      launcherVersion: app.getVersion(),
      createAdapter: () => (settings.get().iceAdapter === 'tfaf' ? new TfafIceAdapter() : new JavaIceAdapter(runtime)),
      createLobbyAdapter: () => new TfafIceAdapter(),
      adapterPreparation: () =>
        settings.get().iceAdapter === 'java'
          ? async () => {
              await runtime.ensureJavaIceAdapter();
            }
          : null,
      leagueDivision: (playerId, leaderboard) => leagues.activeDivision(playerId, leaderboard),
      // The chat is created after the games, which it asks in turn about the game we host.
      tfafChat: {
        tfafVersion: (login) => chat.tfafVersion(login),
        lookupTfaf: (login) => chat.lookupTfaf(login),
        queryLobby: (host, gameId) => chat.queryLobby(host, gameId),
      },
    },
    {
      onState: (state) => {
        const changed = sessionChanged(gameState, state);
        const ended = gameState !== null && gameState.phase !== 'idle' && state.phase === 'idle';
        gameState = state;
        loadSaver.update();
        if (changed || !loadSaver.holding) {
          send(IPC.gameStateChanged, state);
        }
        updateTaskbar();
        appTray?.refresh();
        if (changed) {
          matchmaker?.refresh();
          discord?.update();
        }
        if (state.phase === 'idle') {
          appUpdates.afterGame();
        }
        if (ended) {
          logs.cleanAutomatically();
        }
        if (state.phase === 'idle' && stopLobbyAfterGame) {
          stopLobbyAfterGame = false;
          lobby.stop();
        }
      },
      onNotice: noticeFrom('game'),
      onGameFull: (title, pid) => notifyGameFull({ notifications, notifier, sounds }, title, pid),
      onGameEnded: (gameId, title) => {
        if (settings.get().notifications.afterGameReview) {
          notifyGameEnded({ notifications }, title, () => navigate({ view: 'replay', gameId }));
        }
      },
      onGameFailed: (error, logFile) => {
        notifyGameFailed({ notifications, notifier, sounds }, error, logFile).catch((cause: unknown) =>
          console.warn('Game failure could not be reported', describeError(cause)),
        );
      },
      onFilesDiffer: () => sounds.play('filesDiffer'),
      // The saved form follows the newer versions, so the next game is hosted with them as well.
      onHostContentUpdated: (chosen, latest) => {
        const draft = presets.get().lastDraft;
        if (draft?.mapFolderName === chosen.mapFolderName) {
          const modUids = draft.modUids.map((uid) => latest.modUids[chosen.modUids.indexOf(uid)] ?? uid);
          presets
            .saveDraft({ ...draft, mapFolderName: latest.mapFolderName, modUids })
            .catch((error: unknown) => console.warn('Game draft could not be updated', describeError(error)));
        }
      },
    },
  );

  let announcedUpdate: string | null = null;
  const appUpdates = new AppUpdates(
    (state) => {
      send(IPC.appUpdateStateChanged, state);
      appTray?.refresh();
      if (state.status === 'ready' && state.version && state.version !== announcedUpdate) {
        announcedUpdate = state.version;
        notifications.add({
          severity: 'info',
          title: t('notifications.update.title', { version: state.version }),
          body: t('notifications.update.body'),
          actions: [{ label: t('notifications.update.restart'), run: () => appUpdates.install() }],
          onClick: () => navigate({ view: 'about' }),
        });
      }
    },
    () => games.getState().phase !== 'idle',
    () => settings.get().betaUpdates,
  );
  const chat: ChatService = new ChatService(
    { api, auth, lobby, settings, games, userAgent, launcherVersion: app.getVersion(), notifier, sounds },
    {
      onState: (state) => send(IPC.chatStateChanged, state),
      onChannel: (data) => send(IPC.chatChannelChanged, data),
      onFocusRequested: (channel) => send(IPC.chatFocusRequested, channel),
      onNotice: (text) => noticeFrom('chat')({ style: 'warning', text, transient: true }),
      onGameInvite: (sender, gameId, password) => invites?.receive(sender, gameId, password) ?? 'unavailable',
    },
  );
  invites = new GameInvites({ lobby, games, chat, notifications, notifier, sounds, navigate });
  matchmaker = new MatchmakerService(
    { api, lobby, settings, games, maps, generator, updater, tasks, chat, notifier, notifications, sounds },
    {
      onState: (state) => {
        send(IPC.matchmakerStateChanged, state);
        discord?.update();
        appTray?.refresh();
      },
      onFocusRequested: () => send(IPC.matchmakerFocusRequested, null),
      onNotice: noticeFrom('matchmaker'),
    },
  );
  watchFriendActivity({ lobby, settings, notifications, notifier, sounds, games, chat, navigate });
  const friends = new FriendList({
    lobby,
    api,
    server: () => auth.getServer().id,
    onState: (state) => send(IPC.friendsStateChanged, state),
  });
  // The title bar shows the avatar we wear. After a login the lobby forgets us and learns us again at once; the short
  // wait keeps the avatar from blinking out.
  let sentAvatar = 'null';
  let avatarTimer: NodeJS.Timeout | null = null;
  const sendCurrentAvatar = (): void => {
    avatarTimer ??= setTimeout(() => {
      avatarTimer = null;
      const avatar = JSON.stringify(lobby.getSelf()?.avatar ?? null);
      if (avatar !== sentAvatar) {
        sentAvatar = avatar;
        send(IPC.avatarsCurrentChanged, lobby.getSelf()?.avatar ?? null);
      }
    }, 250);
  };
  lobby.onPlayersChanged((playerIds) => {
    const selfId = lobby.getSelf()?.id;
    if (playerIds === null || (selfId !== undefined && playerIds.has(selfId))) {
      sendCurrentAvatar();
    }
  });
  lobby.onStateChanged(sendCurrentAvatar);
  const loadSaver = new GameLoadSaver({
    enabled: () => settings.get().reduceGameLoad,
    playing: () => games.getState().current?.launched === true,
    focused: () => mainWindow?.isFocused() === true,
    interfaceProcesses: () =>
      app
        .getAppMetrics()
        .filter((metric) => metric.type === 'Tab' || metric.type === 'GPU')
        .map((metric) => metric.pid),
    setPaused: (paused) => {
      lobby.setUpdatesPaused(paused);
      chat.setUpdatesPaused(paused);
      matchmaker?.setUpdatesPaused(paused);
      if (!paused) {
        send(IPC.gameStateChanged, games.getState());
      }
    },
  });
  const replays = new ReplayService(api, auth, settings, featuredMods, lobby, games, tasks, userAgent);
  const liveReplays = new LiveReplayTracker({
    lobby,
    watchLive: (gameId) => replays.watchLive(gameId),
    gameBusy: () => games.getState().phase !== 'idle',
    notifications,
    notifier,
    sounds,
    onChange: (tracking) => send(IPC.replaysTrackingChanged, tracking),
  });
  const playPendingReplay = (): void => {
    const file = pendingReplayFile;
    if (!file || auth.getState().status !== 'signedIn') {
      return;
    }
    pendingReplayFile = null;
    void (async () => {
      try {
        if (!(await isExistingFile(file))) {
          throw new Error(t('notifications.replayFile.missing', { file }));
        }
        await replays.watchPath(file);
      } catch (error) {
        notifications.add({ severity: 'error', title: t('notifications.replayFile.failed'), body: describeError(error), transient: true });
      }
    })();
  };
  openReplayFile = (file) => {
    pendingReplayFile = file;
    playPendingReplay();
  };

  const bringToFront = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  };
  const discordJoins = new DiscordJoins({
    lobby,
    games,
    askPassword: (gameId) => navigate({ view: 'joinPassword', gameId }),
    failed: (text) => noticeFrom('game')({ style: 'error', text, transient: true }),
  });
  discord = new DiscordPresence(DISCORD_APP_ID, {
    settings,
    gameState: () => games.getState(),
    rawGame: (gameId) => lobby.getRawGame(gameId),
    matchmakerState: () => matchmaker?.getState() ?? null,
    joinAccess: () => games.inviteAccess(),
    join: (access) => {
      bringToFront();
      discordJoins.request(access);
    },
    setLaunchable: (launchable) => setDiscordLaunch(DISCORD_APP_ID, launchable),
  });
  lobby.onGameChanged((gameId) => {
    if (gameId === games.getState().gameId) {
      discord?.update();
    }
  });
  discord.update();

  // The tray menu is drawn by Electron in Windows' app colors; the launcher has only a dark interface.
  nativeTheme.themeSource = 'dark';
  const tray = new AppTray({
    iconPath: TRAY_ICON,
    window: () => mainWindow,
    showWindow: bringToFront,
    navigate,
    settings,
    authState: () => auth.getState(),
    logout: () => auth.logout(),
    gameState: () => games.getState(),
    updateState: () => appUpdates.getState(),
    installUpdate: () => appUpdates.install(),
    matchmakerState: () => matchmaker?.getState() ?? null,
    openFolder: (folder) => openAppFolder(settings, folder),
    quit: () => app.quit(),
  });
  appTray = tray;
  // Every quit (the tray or account menu, an update install) ends a running game or a TFAF room first, then quits for real.
  app.on('before-quit', (event) => {
    if (quitting) {
      return;
    }
    quitting = true;
    const gameRunning = games.getState().phase !== 'idle';
    if (gameRunning || stoneMap.getState().phase !== 'stopped') {
      event.preventDefault();
      void Promise.allSettled([gameRunning ? games.shutdown(GAME_SHUTDOWN_GRACE_MS) : null, stoneMap.stop()]).finally(() => app.quit());
    }
  });

  // The main window, created below, takes the answer to its close question.
  let answerClose = async (_answer: WindowCloseAnswer): Promise<void> => undefined;
  registerIpc(
    {
      settings,
      auth,
      maps,
      mapView: new MapViewService(settings),
      mods,
      lobby,
      games,
      updater,
      appUpdates,
      appReleases: new AppReleases(userAgent, () => settings.get().betaUpdates),
      presets,
      featuredMods,
      news: new NewsService(auth, userAgent),
      leagues,
      tournaments: new TournamentService(userAgent),
      tutorials: new TutorialService(api, games),
      unitDatabases,
      tasks,
      replays,
      liveReplays,
      coop: new CoopService(api, mods, games),
      chat,
      matchmaker,
      runtime,
      generator,
      stoneMap,
      notifications,
      clans: new ClanService(api),
      notes,
      joinPasswords,
      invites,
      friends,
      profiles: new ProfileService(api, lobby),
      reports: new ReportService(api, () => auth.getUser()?.id ?? null),
      reviews: new ReviewService(api, () => auth.getUser()?.id ?? null),
      discord,
      loadSaver,
      api,
      logs,
      tray,
      windowClose: { answer: (answer) => answerClose(answer) },
      gameOptions: new GameOptionsService({
        settings,
        games,
        isForgedAllianceRunning,
        pickExportFile: async (defaultName) => {
          const options: Electron.SaveDialogOptions = {
            title: t('main.gameOptions.exportDialog'),
            defaultPath: path.join(app.getPath('documents'), defaultName),
            filters: [{ name: t('main.gameOptions.fileFilter'), extensions: ['json'] }],
          };
          const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
          return result.canceled ? null : (result.filePath ?? null);
        },
        pickImportFile: async () => {
          const options: Electron.OpenDialogOptions = {
            title: t('main.gameOptions.importDialog'),
            defaultPath: app.getPath('documents'),
            properties: ['openFile'],
            filters: [{ name: t('main.gameOptions.fileFilter'), extensions: ['json'] }],
          };
          const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
      }),
      uploads: new UploadService({
        api,
        tasks,
        pickFolder: async (kind) => {
          const options: Electron.OpenDialogOptions = {
            title: t(kind === 'map' ? 'main.ipc.dialogs.uploadMap' : 'main.ipc.dialogs.uploadMod'),
            defaultPath: kind === 'map' ? settings.mapsDirectory : settings.modsDirectory,
            properties: ['openDirectory'],
          };
          const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        previewDataUrl: ({ width, height, bgra }) => {
          const image = nativeImage.createFromBitmap(bgra, { width, height });
          return image.isEmpty() ? null : image.toDataURL();
        },
      }),
    },
    () => mainWindow,
  );
  auth.onStateChanged((state) => {
    send(IPC.authStateChanged, state);
    // With a remembered session the lobby login starts together with the token refresh, not after the profile request.
    if (state.status === 'signedIn' || state.status === 'restoring') {
      stopLobbyAfterGame = false;
      lobby.start();
      // The chat token is asked for with the session, so the chat waits until it is restored.
      if (state.status === 'signedIn') {
        chat.start();
        playPendingReplay();
      }
      return;
    }
    chat.stop();
    if (games.getState().phase !== 'idle') {
      stopLobbyAfterGame = true;
    } else {
      lobby.stop();
    }
  });
  powerMonitor.on('resume', () => lobby.onSystemResume());

  const savedWindow = settings.get().window;
  mainWindow = createWindow(settings.get().interfaceScale, savedWindow, (bounds) => {
    settings.setWindowBounds(bounds).catch((error: unknown) => console.warn('Window position could not be saved', describeError(error)));
  });
  answerClose = guardWindowClose(mainWindow, games, settings, () => tray.windowHidden());
  mainWindow.on('focus', () => loadSaver.update());
  mainWindow.on('blur', () => loadSaver.update());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  showAfterSplash(mainWindow, splash, auth.restore(), savedWindow?.maximized === true);
  void appUpdates.start().catch((error: unknown) => console.error('Update service could not start', error));
}

// An installed app has no console, so failures that nothing caught go to the launcher log instead of being lost.
process.on('uncaughtException', (error) => console.error('Uncaught exception', error));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection', reason));

// Windows' "show animations" switch would reach the pages as prefers-reduced-motion; the launcher has its own setting
// for its animations instead (Settings.animations).
app.commandLine.appendSwitch('force-prefers-no-reduced-motion');

// The frameless window has its own title bar and keyboard handlers; skip Electron's default menu before ready.
Menu.setApplicationMenu(null);

// The pages of the unit databases run from the launcher's copy as if from their own site, so they need a real origin.
protocol.registerSchemesAsPrivileged([
  { scheme: UNIT_DATABASE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: MAP_PREVIEW_SCHEME, privileges: { standard: true, secure: true } },
]);

// Configure portable storage before Electron creates any profile, session, log or lock files.
let storageReady = false;
try {
  configureStorage();
  storageReady = true;
} catch (error) {
  dialog.showErrorBox(t('app.startupFailed'), describeError(error));
  app.quit();
}

if (!storageReady || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      // The window may be hidden in the tray.
      mainWindow.show();
      mainWindow.focus();
    }
    const file = replayFileArgument(argv.slice(1));
    if (file && openReplayFile) {
      openReplayFile(file);
    } else if (file) {
      pendingReplayFile = file;
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => appTray?.destroy());
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error('Startup failed', error);
      dialog.showErrorBox(t('app.startupFailed'), error instanceof Error ? error.message : String(error));
      app.quit();
    });
}
