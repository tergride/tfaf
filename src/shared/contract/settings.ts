import type { ServerId } from './app.ts';
import type { ChatPrefs } from './chat.ts';
import type { GeneratorPrefs } from './hostGame.ts';
import type { MatchmakerPrefs } from './matchmaker.ts';
import type { CustomTheme, Theme } from '../themes.ts';

export { BUILT_IN_THEMES, THEMES } from '../themes.ts';
export type { BuiltInTheme, CustomTheme, Theme, ThemeColor, ThemePalette } from '../themes.ts';

/** Network adapter between the game and the other players: the official one on Java or our own. */
export const ICE_ADAPTER_KINDS = ['java', 'tfaf'] as const;
export type IceAdapterKind = (typeof ICE_ADAPTER_KINDS)[number];

export interface Settings {
  server: ServerId;
  rememberMe: boolean;
  gamePath: string | null;
  vaultPath: string;
  gamePrefsPath: string;
  /** Patched game files, logs and downloaded runtimes (the official client uses C:\ProgramData\FAForever). */
  dataPath: string;
  /** Host with the latest vault versions of the chosen map and sim mods, like the official client does by default. */
  updateContentOnHost: boolean;
  iceAdapter: IceAdapterKind;
  /** Windows notifications for private messages and mentions while the launcher is in the background. */
  chatNotifications: boolean;
  /** Volume of the launcher's own sounds (a found match), 0–100; 0 mutes them. */
  soundVolume: number;
  theme: Theme;
  customTheme: CustomTheme;
  /** Interface animations: panels, dialogs and transitions. Windows' own animation setting does not apply. */
  animations: boolean;
  /** While a game plays, the launcher keeps to what the game needs (game/gameLoadSaver.ts). */
  reduceGameLoad: boolean;
  /** The launcher also updates to beta versions (pre-releases such as `0.17.0-beta.1`) and lists them. */
  betaUpdates: boolean;
  /** Closing the window hides it to the tray; the launcher then quits from the tray icon's menu or the account menu. */
  closeToTray: boolean;
  /**
   * The player answered what closing the window does, asked on the first close, or set closeToTray in the settings;
   * until then closing asks. Kept by the main process.
   */
  closeToTrayChosen: boolean;
  /** Quitting from the tray icon's menu or the account menu asks first; a running game gets its warning either way. */
  confirmQuit: boolean;
  /** The one-time tip that the launcher keeps running in the tray was shown. Kept by the main process. */
  trayHintShown: boolean;
  /** Size of the whole interface in percent, on top of Windows' display scaling; one of INTERFACE_SCALES. */
  interfaceScale: number;
  chat: ChatPrefs;
  /** What the matchmaker sends the server on every login, as the official client keeps it (MatchmakerPrefs). */
  matchmaker: MatchmakerPrefs;
  /** `system`: Russian when Windows (Chromium's locale) is Russian, English otherwise. */
  language: Language;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  notifications: NotificationPrefs;
  /** Which events play their sound; the volume is `soundVolume`. */
  sounds: SoundPrefs;
  /** The custom map form of the map generator as it was last left. */
  generator: GeneratorPrefs;
  /** Ids of the replays the user started watching, oldest first; up to WATCHED_REPLAYS_MAX. Kept by the main process. */
  watchedReplays: number[];
  /** Where the window was left; null until it was first moved or resized. Kept by the main process. */
  window: WindowBounds | null;
  /** TURN servers of the API to relay games through; empty, or none of them in a game, means all of them. */
  preferredTurnIds: string[];
  discord: DiscordPrefs;
  logCleanup: LogCleanupPrefs;
}

/** Removal of old `.log` files from `<dataPath>\logs`; logs of the last day are always kept. */
export interface LogCleanupPrefs {
  /** Applied by itself at start and after every game; off leaves only the cleanup by hand. */
  enabled: boolean;
  byAge: boolean;
  /** Logs last written longer ago are removed. */
  maxAgeDays: number;
  bySize: boolean;
  /** While the logs take more, the oldest are removed. */
  maxSizeMb: number;
}

export const LOG_CLEANUP_LIMITS = {
  maxAgeDays: { min: 1, max: 365 },
  maxSizeMb: { min: 50, max: 10_000 },
} as const;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface DiscordPrefs {
  /** The game or lobby shows as the Discord status (Rich Presence). */
  showStatus: boolean;
  /** Friends may join an open game or watch a running one from the Discord status. */
  allowJoin: boolean;
}

/** A TURN server the API offers for game connections (`/ice/server`). */
export interface TurnServer {
  id: string;
  region: string;
}

export const WATCHED_REPLAYS_MAX = 5000;

/** The launcher's sounds, played by the renderer: those of the official client (theme/sounds) and an alarm. */
export const SOUND_IDS = [
  'matchFound',
  'privateMessage',
  'mention',
  'friendOnline',
  'friendOffline',
  'friendJoinedGame',
  'friendStartedPlaying',
  'notification',
  'filesDiffer',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];
export type SoundPrefs = Record<SoundId, boolean>;

export const TOAST_POSITIONS = ['bottomRight', 'bottomLeft', 'topRight', 'topLeft'] as const;
export type ToastPosition = (typeof TOAST_POSITIONS)[number];
export const TOAST_SECONDS: readonly number[] = [3, 5, 8, 15];

export interface NotificationPrefs {
  /** Notifications pop up inside the window; the bell keeps them either way. */
  toasts: boolean;
  toastPosition: ToastPosition;
  /** How long a toast stays; errors stay until closed. One of TOAST_SECONDS. */
  toastSeconds: number;
  /** Windows notifications while the launcher window is in the background; off leaves the toasts and the bell. */
  desktop: boolean;
  friendOnline: boolean;
  friendOffline: boolean;
  friendJoinedGame: boolean;
  friendStartedPlaying: boolean;
  /** After an online game that ended normally, offer to review it, as the official client does. */
  afterGameReview: boolean;
  /** After an update, show what changed in the versions since the one last seen. */
  whatsNew: boolean;
}

export const LANGUAGES = ['system', 'ru', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** `auto` follows the interface language; the others are `DD.MM.YYYY`, `MM/DD/YYYY` and `YYYY-MM-DD`. */
export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'ymd'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const TIME_FORMATS = ['auto', 'h24', 'h12'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'rememberMe'
    | 'gamePath'
    | 'vaultPath'
    | 'gamePrefsPath'
    | 'dataPath'
    | 'updateContentOnHost'
    | 'iceAdapter'
    | 'chatNotifications'
    | 'chat'
    | 'soundVolume'
    | 'theme'
    | 'customTheme'
    | 'animations'
    | 'reduceGameLoad'
    | 'betaUpdates'
    | 'closeToTray'
    | 'confirmQuit'
    | 'interfaceScale'
    | 'language'
    | 'dateFormat'
    | 'timeFormat'
    | 'notifications'
    | 'sounds'
    | 'generator'
    | 'preferredTurnIds'
    | 'discord'
    | 'logCleanup'
  >
>;

export const INTERFACE_SCALES: readonly number[] = [80, 90, 100, 110, 125, 150];

export type PathField = 'gamePath' | 'vaultPath' | 'gamePrefsPath' | 'dataPath';

export interface PathsStatus {
  /** Determined at startup from the portable marker, not a mutable preference. */
  portable: boolean;
  gamePathValid: boolean;
  vaultPathAscii: boolean;
  dataPathAscii: boolean;
}
