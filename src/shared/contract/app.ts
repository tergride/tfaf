import type { Locale } from '../i18n/index.ts';

export type ServerId = 'prod' | 'test';

export interface ServerInfo {
  id: ServerId;
  name: string;
}

/** Folders the user menu opens in Explorer; the main process knows their paths. */
export const APP_FOLDERS = ['data', 'gameLogs', 'launcherLogs', 'maps', 'mods', 'replays', 'gamePrefs'] as const;
export type AppFolder = (typeof APP_FOLDERS)[number];

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationAction {
  id: string;
  label: string;
}

export interface AppNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  actions: NotificationAction[];
  /** A click on the notification itself does something, see `notifications.act`. */
  clickable: boolean;
  /** Shown as a toast only, never kept in the bell's list (friends coming online). */
  transient: boolean;
}

/** Where the main process asks the interface to go, e.g. after a click on a notification or in the tray menu. */
export type NavigationTarget =
  | { view: 'chat'; channel: string }
  | { view: 'game'; gameId: number }
  /** The password dialog of an open game whose join needs one, e.g. a join from a friend's Discord status. */
  | { view: 'joinPassword'; gameId: number }
  /** The current game tab; the interface ignores it once the game is over. */
  | { view: 'current' }
  | { view: 'matchmaker' }
  /** A finished game in the replay vault, to review it. */
  | { view: 'replay'; gameId: number }
  /** The launcher's version, its update and the release notes. */
  | { view: 'about' };

export interface UserInfo {
  id: number;
  login: string;
}

export type AuthState =
  | { status: 'signedOut'; server: ServerId; error?: string }
  /** `error` and `retryAt` are set while the remembered session waits for the network to try again. */
  | { status: 'restoring'; server: ServerId; error?: string; retryAt?: number }
  | { status: 'awaitingApproval'; server: ServerId; userCode: string; verificationUri: string; expiresAt: number }
  | { status: 'signedIn'; server: ServerId; user: UserInfo };

export interface TaskProgress {
  id: string;
  title: string;
  /** 0..1, or null while the size is unknown. */
  progress: number | null;
  /** Current step, e.g. the file being downloaded with its size and speed. */
  detail?: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  /** The user may stop the task (downloads); `tasks.cancel` does nothing for the others. */
  cancellable: boolean;
  error?: string;
}

export type AppUpdateStatus = 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

/** Updates of the launcher itself; 'disabled' for builds without an update feed and during development. */
export interface AppUpdateState {
  currentVersion: string;
  status: AppUpdateStatus;
  /** Portable copies are updated manually, even when the build has an update feed. */
  disabledReason: 'portable' | 'unavailable' | null;
  /** Version that is being downloaded or is ready to install. */
  version: string | null;
  progress: number | null;
  error: string | null;
}

/** A line of release notes; the interface lays them out itself and never renders markdown or HTML. */
export interface ReleaseNoteBlock {
  kind: 'heading' | 'paragraph' | 'item' | 'subitem';
  text: string;
}

/** A version of the launcher with its notes in each interface language. */
export interface AppRelease {
  version: string;
  /** `YYYY-MM-DD`, or null when the changelog gives no date. */
  date: string | null;
  notes: Record<Locale, ReleaseNoteBlock[]>;
  /** The release page on GitHub; null for versions known only from the changelog in the build. */
  url: string | null;
}

export interface AppReleaseHistory {
  /** Newest first. */
  releases: AppRelease[];
  /** Why GitHub could not be read; the versions then come from the changelog in the build only. */
  error: string | null;
  /** All releases on GitHub, for a manual download; null for builds without the GitHub update feed. */
  releasesUrl: string | null;
}

/** The answers to the question the first close of the window asks: hide it to the tray, quit, or keep it open. */
export const WINDOW_CLOSE_ANSWERS = ['tray', 'quit', 'cancel'] as const;
export type WindowCloseAnswer = (typeof WINDOW_CLOSE_ANSWERS)[number];

/** State of the frameless main window that its own title bar shows. */
export interface WindowState {
  maximized: boolean;
  focused: boolean;
}
