import { app } from 'electron';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATE_FORMATS,
  type DiscordPrefs,
  GENERATION_TYPES,
  type GeneratorPrefs,
  ICE_ADAPTER_KINDS,
  INTERFACE_SCALES,
  LANGUAGES,
  MATCHMAKER_FACTIONS,
  type MatchmakerPrefs,
  type MatchmakerVeto,
  type NotificationPrefs,
  type PathsStatus,
  type ServerId,
  type Settings,
  type SettingsPatch,
  SOUND_IDS,
  type SoundPrefs,
  THEMES,
  TIME_FORMATS,
  TOAST_POSITIONS,
  TOAST_SECONDS,
  type WindowBounds,
} from '../shared/contract.ts';
import {
  closestSpawnCount,
  GENERATOR_DENSITY_MAX,
  GENERATOR_MAP_SIZES,
  GENERATOR_TEAM_COUNTS,
  isGeneratorOptionName,
  isGeneratorSeedText,
  MAX_GENERATOR_OPTIONS,
} from '../shared/mapGenerator.ts';
import { defaultChatPrefs, mergeChatPrefs } from './chat/chatPrefs.ts';
import { defaultCustomTheme, mergeCustomTheme } from '../shared/themes.ts';
import { isPrerelease } from '../shared/versions.ts';
import { parseWindowBounds } from './appWindow.ts';
import { detectGamePath, isValidGamePath } from './gameLocator.ts';
import { defaultLogCleanupPrefs, mergeLogCleanupPrefs } from './logCleanup.ts';
import { parseWatchedReplays, withWatchedReplay } from './replays/watchedReplays.ts';
import { isServerId } from './servers.ts';
import { portableStorage } from './storage.ts';
import { decodePortablePaths, defaultDataDirectory, encodePortablePaths } from './storagePaths.ts';
import { t } from './i18n.ts';

function localAppDataPath(): string {
  return process.env.LOCALAPPDATA ?? path.join(app.getPath('home'), 'AppData', 'Local');
}

function defaultSettings(): Settings {
  const localAppData = localAppDataPath();
  const portable = portableStorage();
  return {
    server: 'prod',
    rememberMe: true,
    gamePath: null,
    vaultPath: portable?.vaultDirectory ?? path.join(app.getPath('documents'), 'My Games', 'Gas Powered Games', 'Supreme Commander Forged Alliance'),
    gamePrefsPath: portable?.prefsFile ?? path.join(localAppData, 'Gas Powered Games', 'Supreme Commander Forged Alliance', 'Game.prefs'),
    dataPath: portable?.dataDirectory ?? path.join(process.env.ProgramData ?? path.join(path.parse(app.getPath('home')).root, 'ProgramData'), 'TFAF'),
    updateContentOnHost: true,
    iceAdapter: 'tfaf',
    chatNotifications: true,
    soundVolume: 100,
    theme: 'default',
    customTheme: defaultCustomTheme(),
    animations: true,
    reduceGameLoad: false,
    // A beta installed by hand keeps getting betas until the player says otherwise.
    betaUpdates: isPrerelease(app.getVersion()),
    closeToTray: true,
    closeToTrayChosen: false,
    confirmQuit: true,
    trayHintShown: false,
    interfaceScale: 100,
    chat: defaultChatPrefs(),
    matchmaker: { factions: [...MATCHMAKER_FACTIONS], unselectedQueues: [], vetoes: [] },
    language: 'system',
    dateFormat: 'auto',
    timeFormat: 'auto',
    // On like in the official client (NotificationPrefs).
    notifications: {
      toasts: true,
      toastPosition: 'bottomRight',
      toastSeconds: 5,
      desktop: true,
      friendOnline: true,
      friendOffline: true,
      friendJoinedGame: true,
      friendStartedPlaying: true,
      afterGameReview: true,
      whatsNew: true,
    },
    sounds: Object.fromEntries(SOUND_IDS.map((sound) => [sound, true])) as SoundPrefs,
    // As the official client starts (GeneratorPrefs): 6 spawns in 2 teams on 10 km, everything else random.
    generator: {
      generationType: 'casual',
      numTeams: 2,
      spawnCount: 6,
      mapSize: 512,
      symmetries: [],
      fixedSeed: false,
      seed: '',
      customStyle: false,
      styles: [],
      terrainStyles: [],
      textureStyles: [],
      resourceStyles: [],
      propStyles: [],
      resourceDensity: [0, GENERATOR_DENSITY_MAX],
      reclaimDensity: [0, GENERATOR_DENSITY_MAX],
    },
    watchedReplays: [],
    window: null,
    preferredTurnIds: [],
    // On like in the official client, which shows the game in Discord unless switched off.
    discord: { showStatus: true, allowJoin: true },
    logCleanup: defaultLogCleanupPrefs(),
  };
}

const MAX_MATCHMAKER_ENTRIES = 500;

function isSoundVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function mergeMatchmakerPrefs(defaults: MatchmakerPrefs, stored: unknown): MatchmakerPrefs {
  if (typeof stored !== 'object' || stored === null) {
    return defaults;
  }
  const raw = stored as Record<string, unknown>;
  const factions = MATCHMAKER_FACTIONS.filter((faction) => Array.isArray(raw.factions) && raw.factions.includes(faction));
  const unselectedQueues = Array.isArray(raw.unselectedQueues)
    ? raw.unselectedQueues.filter((queue): queue is string => typeof queue === 'string' && queue.length <= 100)
    : [];
  const vetoes = (Array.isArray(raw.vetoes) ? raw.vetoes : []).flatMap((entry): MatchmakerVeto[] => {
    const veto = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    return isPositiveInteger(veto.bracketId) && isPositiveInteger(veto.assignmentId) && isPositiveInteger(veto.tokens)
      ? [{ bracketId: veto.bracketId, assignmentId: veto.assignmentId, tokens: veto.tokens }]
      : [];
  });
  return {
    factions: factions.length > 0 ? factions : defaults.factions,
    unselectedQueues: unselectedQueues.slice(0, MAX_MATCHMAKER_ENTRIES),
    vetoes: vetoes.slice(0, MAX_MATCHMAKER_ENTRIES),
  };
}

function mergeNotificationPrefs(defaults: NotificationPrefs, stored: unknown): NotificationPrefs {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const flag = (
    name: 'toasts' | 'desktop' | 'friendOnline' | 'friendOffline' | 'friendJoinedGame' | 'friendStartedPlaying' | 'afterGameReview' | 'whatsNew',
  ): boolean =>
    typeof raw[name] === 'boolean' ? raw[name] : defaults[name];
  return {
    toasts: flag('toasts'),
    toastPosition: TOAST_POSITIONS.find((position) => position === raw.toastPosition) ?? defaults.toastPosition,
    toastSeconds:
      typeof raw.toastSeconds === 'number' && TOAST_SECONDS.includes(raw.toastSeconds) ? raw.toastSeconds : defaults.toastSeconds,
    desktop: flag('desktop'),
    friendOnline: flag('friendOnline'),
    friendOffline: flag('friendOffline'),
    friendJoinedGame: flag('friendJoinedGame'),
    friendStartedPlaying: flag('friendStartedPlaying'),
    afterGameReview: flag('afterGameReview'),
    whatsNew: flag('whatsNew'),
  };
}

function mergeDiscordPrefs(defaults: DiscordPrefs, stored: unknown): DiscordPrefs {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  return {
    showStatus: typeof raw.showStatus === 'boolean' ? raw.showStatus : defaults.showStatus,
    allowJoin: typeof raw.allowJoin === 'boolean' ? raw.allowJoin : defaults.allowJoin,
  };
}

function mergeSoundPrefs(defaults: SoundPrefs, stored: unknown): SoundPrefs {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(
    SOUND_IDS.map((sound) => [sound, typeof raw[sound] === 'boolean' ? raw[sound] : defaults[sound]]),
  ) as SoundPrefs;
}

type GeneratorChoice = 'symmetries' | 'styles' | 'terrainStyles' | 'textureStyles' | 'resourceStyles' | 'propStyles';

function isDensity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= GENERATOR_DENSITY_MAX;
}

function mergeGeneratorPrefs(defaults: GeneratorPrefs, stored: unknown): GeneratorPrefs {
  const raw = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const flag = (name: 'fixedSeed' | 'customStyle'): boolean => (typeof raw[name] === 'boolean' ? raw[name] : defaults[name]);
  const choices = (name: GeneratorChoice): string[] => {
    const value = raw[name];
    return Array.isArray(value) ? [...new Set(value.filter(isGeneratorOptionName))].slice(0, MAX_GENERATOR_OPTIONS) : defaults[name];
  };
  const range = (name: 'resourceDensity' | 'reclaimDensity'): [number, number] => {
    const value: unknown[] = Array.isArray(raw[name]) ? raw[name] : [];
    const [low, high] = value;
    return isDensity(low) && isDensity(high) && low <= high ? [low, high] : defaults[name];
  };
  const numTeams =
    typeof raw.numTeams === 'number' && GENERATOR_TEAM_COUNTS.includes(raw.numTeams) ? raw.numTeams : defaults.numTeams;
  const spawnCount = typeof raw.spawnCount === 'number' ? raw.spawnCount : defaults.spawnCount;
  return {
    generationType: GENERATION_TYPES.find((type) => type === raw.generationType) ?? defaults.generationType,
    numTeams,
    spawnCount: closestSpawnCount(spawnCount, numTeams),
    mapSize: typeof raw.mapSize === 'number' && GENERATOR_MAP_SIZES.includes(raw.mapSize) ? raw.mapSize : defaults.mapSize,
    symmetries: choices('symmetries'),
    fixedSeed: flag('fixedSeed'),
    seed: isGeneratorSeedText(raw.seed) ? raw.seed : defaults.seed,
    customStyle: flag('customStyle'),
    styles: choices('styles'),
    terrainStyles: choices('terrainStyles'),
    textureStyles: choices('textureStyles'),
    resourceStyles: choices('resourceStyles'),
    propStyles: choices('propStyles'),
    resourceDensity: range('resourceDensity'),
    reclaimDensity: range('reclaimDensity'),
  };
}

// Forged Alliance cannot load files from paths with non-ASCII characters.
export function isAsciiPath(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

const MAX_PATH_LENGTH = 1024;

export function isAcceptablePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH && path.isAbsolute(value);
}

function mergeStored(defaults: Settings, stored: unknown): Settings {
  if (typeof stored !== 'object' || stored === null) {
    return defaults;
  }
  const raw = stored as Record<string, unknown>;
  return {
    server: isServerId(raw.server) ? raw.server : defaults.server,
    rememberMe: typeof raw.rememberMe === 'boolean' ? raw.rememberMe : defaults.rememberMe,
    gamePath: isAcceptablePath(raw.gamePath) ? raw.gamePath : defaults.gamePath,
    vaultPath: isAcceptablePath(raw.vaultPath) ? raw.vaultPath : defaults.vaultPath,
    gamePrefsPath: isAcceptablePath(raw.gamePrefsPath) ? raw.gamePrefsPath : defaults.gamePrefsPath,
    dataPath: isAcceptablePath(raw.dataPath) ? raw.dataPath : defaults.dataPath,
    updateContentOnHost:
      typeof raw.updateContentOnHost === 'boolean' ? raw.updateContentOnHost : defaults.updateContentOnHost,
    iceAdapter: ICE_ADAPTER_KINDS.find((kind) => kind === raw.iceAdapter) ?? defaults.iceAdapter,
    chatNotifications: typeof raw.chatNotifications === 'boolean' ? raw.chatNotifications : defaults.chatNotifications,
    soundVolume: isSoundVolume(raw.soundVolume) ? raw.soundVolume : defaults.soundVolume,
    theme: THEMES.find((theme) => theme === raw.theme) ?? defaults.theme,
    customTheme: mergeCustomTheme(raw.customTheme, defaults.customTheme),
    animations: typeof raw.animations === 'boolean' ? raw.animations : defaults.animations,
    reduceGameLoad: typeof raw.reduceGameLoad === 'boolean' ? raw.reduceGameLoad : defaults.reduceGameLoad,
    betaUpdates: typeof raw.betaUpdates === 'boolean' ? raw.betaUpdates : defaults.betaUpdates,
    closeToTray: typeof raw.closeToTray === 'boolean' ? raw.closeToTray : defaults.closeToTray,
    closeToTrayChosen: typeof raw.closeToTrayChosen === 'boolean' ? raw.closeToTrayChosen : defaults.closeToTrayChosen,
    confirmQuit: typeof raw.confirmQuit === 'boolean' ? raw.confirmQuit : defaults.confirmQuit,
    trayHintShown: typeof raw.trayHintShown === 'boolean' ? raw.trayHintShown : defaults.trayHintShown,
    interfaceScale:
      typeof raw.interfaceScale === 'number' && INTERFACE_SCALES.includes(raw.interfaceScale)
        ? raw.interfaceScale
        : defaults.interfaceScale,
    chat: mergeChatPrefs(raw.chat, raw.chatChannels),
    matchmaker: mergeMatchmakerPrefs(defaults.matchmaker, raw.matchmaker),
    language: LANGUAGES.find((language) => language === raw.language) ?? defaults.language,
    dateFormat: DATE_FORMATS.find((format) => format === raw.dateFormat) ?? defaults.dateFormat,
    timeFormat: TIME_FORMATS.find((format) => format === raw.timeFormat) ?? defaults.timeFormat,
    notifications: mergeNotificationPrefs(defaults.notifications, raw.notifications),
    sounds: mergeSoundPrefs(defaults.sounds, raw.sounds),
    generator: mergeGeneratorPrefs(defaults.generator, raw.generator),
    watchedReplays: parseWatchedReplays(raw.watchedReplays),
    window: parseWindowBounds(raw.window),
    preferredTurnIds: Array.isArray(raw.preferredTurnIds)
      ? [...new Set(raw.preferredTurnIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100))].slice(0, 50)
      : defaults.preferredTurnIds,
    discord: mergeDiscordPrefs(defaults.discord, raw.discord),
    logCleanup: mergeLogCleanupPrefs(raw.logCleanup, defaults.logCleanup),
  };
}

export class SettingsStore {
  private settings: Settings;
  private readonly filePath: string;
  private writing: Promise<void> = Promise.resolve();

  private constructor(filePath: string, settings: Settings) {
    this.filePath = filePath;
    this.settings = settings;
  }

  static async load(): Promise<SettingsStore> {
    const filePath = path.join(app.getPath('userData'), 'settings.json');
    let stored: unknown = null;
    try {
      stored = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // The next save would overwrite the file, so the damaged one is kept for recovering the paths by hand.
        console.warn('Settings file is unreadable, falling back to defaults and keeping it as .corrupt', error);
        await copyFile(filePath, `${filePath}.corrupt`).catch(() => undefined);
      }
    }
    const portable = portableStorage();
    const defaults = defaultSettings();
    const hasStoredDataPath = typeof stored === 'object' && stored !== null &&
      isAcceptablePath((stored as Record<string, unknown>).dataPath);
    let needsSave = !portable && !hasStoredDataPath;
    if (needsSave) {
      defaults.dataPath = defaultDataDirectory(defaults.dataPath, path.join(localAppDataPath(), 'TFAF'));
    }
    const settings = mergeStored(defaults, portable ? decodePortablePaths(stored, portable.root) : stored);
    if (portable) {
      settings.gamePrefsPath = portable.prefsFile;
    }
    const store = new SettingsStore(filePath, settings);
    if (!settings.gamePath || (portable && !isValidGamePath(settings.gamePath))) {
      // A found game is remembered, so the registry and the disk are not searched again on every start.
      const detected = await detectGamePath();
      if (detected || settings.gamePath !== null) {
        settings.gamePath = detected;
        needsSave = true;
      }
    }
    if (needsSave) {
      // Persist a newly selected default so a later permission change never moves an existing profile's data.
      await store.save((current) => ({ ...current }));
    }
    return store;
  }

  get(): Settings {
    return { ...this.settings };
  }

  get mapsDirectory(): string {
    return path.join(this.settings.vaultPath, 'maps');
  }

  get modsDirectory(): string {
    return path.join(this.settings.vaultPath, 'mods');
  }

  get logsDirectory(): string {
    return path.join(this.settings.dataPath, 'logs');
  }

  get replaysDirectory(): string {
    return path.join(this.settings.dataPath, 'replays');
  }

  get cacheDirectory(): string {
    return path.join(this.settings.dataPath, 'cache');
  }

  pathsStatus(): PathsStatus {
    return {
      portable: portableStorage() !== null,
      gamePathValid: isValidGamePath(this.settings.gamePath),
      vaultPathAscii: isAsciiPath(this.settings.vaultPath),
      dataPathAscii: isAsciiPath(this.settings.dataPath),
    };
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const portable = portableStorage();
    if (portable && patch.gamePrefsPath !== undefined && patch.gamePrefsPath !== portable.prefsFile) {
      throw new Error(t('settings.portable.fixedPrefs'));
    }
    await this.save((settings) => ({
      ...settings,
      ...patch,
      // Turning the setting on or off by hand answers the question the first close of the window would ask.
      closeToTrayChosen: settings.closeToTrayChosen || patch.closeToTray !== undefined,
    }));
    return this.get();
  }

  /** The auto-join list follows the channels the user joins and leaves by hand. */
  async setAutoJoinChannels(channels: string[]): Promise<void> {
    await this.save((settings) => {
      const chat = settings.chat;
      return { ...settings, chat: mergeChatPrefs({ ...chat, autoJoin: { ...chat.autoJoin, channels } }, null) };
    });
  }

  async setMatchmakerPrefs(prefs: MatchmakerPrefs): Promise<void> {
    await this.save((settings) => ({ ...settings, matchmaker: mergeMatchmakerPrefs(settings.matchmaker, prefs) }));
  }

  async addWatchedReplay(replayId: number): Promise<void> {
    await this.save((settings) => ({ ...settings, watchedReplays: withWatchedReplay(settings.watchedReplays, replayId) }));
  }

  async setWindowBounds(window: WindowBounds): Promise<void> {
    await this.save((settings) => ({ ...settings, window }));
  }

  async chooseCloseToTray(closeToTray: boolean): Promise<void> {
    await this.save((settings) => ({ ...settings, closeToTray, closeToTrayChosen: true }));
  }

  async markTrayHintShown(): Promise<void> {
    await this.save((settings) => (settings.trayHintShown ? settings : { ...settings, trayHintShown: true }));
  }

  async setServer(server: ServerId): Promise<void> {
    await this.save((settings) => settings.server === server ? settings : { ...settings, server });
  }

  /** Queue the whole change and publish it only after the file is replaced, so failures cannot leak into later saves. */
  private save(change: (settings: Settings) => Settings): Promise<void> {
    const write = this.writing.then(async () => {
      const settings = change(this.settings);
      if (settings === this.settings) return;
      const portable = portableStorage();
      const content = JSON.stringify(portable ? encodePortablePaths(settings, portable.root) : settings, null, 2);
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, content, 'utf8');
      await rename(tempPath, this.filePath);
      this.settings = settings;
    });
    this.writing = write.catch(() => undefined);
    return write;
  }
}
