import { app } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppUpdateState } from '../shared/contract.ts';
import { compareVersions, isPrerelease } from '../shared/versions.ts';
import { describeError } from './errors.ts';
import { t } from './i18n.ts';
import { portableStorage } from './storage.ts';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Updates of the launcher itself through electron-updater. electron-builder ships app-update.yml only in builds made
 * with an update feed (see electron-builder.config.mjs); without it the updater stays disabled.
 *
 * Betas are GitHub pre-releases, which the updater considers only with `allowPrerelease`. A player on a beta who stops
 * taking betas goes back to the latest release through `allowDowngrade`; otherwise versions only go up.
 */
export class AppUpdates {
  private state: AppUpdateState;
  private readonly onState: (state: AppUpdateState) => void;
  private readonly gameRunning: () => boolean;
  private readonly betas: () => boolean;
  private postponed = false;
  private updater: AppUpdater | null = null;

  /** `betas`: whether the player takes beta versions (Settings.betaUpdates). */
  constructor(onState: (state: AppUpdateState) => void, gameRunning: () => boolean, betas: () => boolean) {
    this.onState = onState;
    this.gameRunning = gameRunning;
    this.betas = betas;
    const disabledReason = portableStorage()
      ? 'portable'
      : !app.isPackaged || !existsSync(path.join(process.resourcesPath, 'app-update.yml')) ? 'unavailable' : null;
    this.state = {
      currentVersion: app.getVersion(),
      status: disabledReason === null ? 'idle' : 'disabled',
      disabledReason,
      version: null,
      progress: null,
      error: null,
    };
  }

  async start(): Promise<void> {
    if (this.state.status === 'disabled') {
      return;
    }
    // Portable copies must not even initialize the Windows installer updater or its external cache.
    const { default: updaterModule } = await import('electron-updater');
    const { autoUpdater } = updaterModule;
    this.updater = autoUpdater;
    autoUpdater.logger = null;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.update({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => this.update({ status: 'downloading', version: info.version, progress: 0 }));
    autoUpdater.on('update-not-available', () => this.update({ status: 'idle', version: null, progress: null }));
    autoUpdater.on('download-progress', (progress) => this.update({ progress: progress.percent / 100 }));
    autoUpdater.on('update-downloaded', (info) => {
      // The player turned betas on or off while this version was downloading: it must not install on quit, and the
      // next check looks for the version their choice asks for.
      if (!this.wanted(info.version)) {
        autoUpdater.autoInstallOnAppQuit = false;
        this.update({ status: 'idle', version: null, progress: null });
        this.checkOnSchedule();
        return;
      }
      autoUpdater.autoInstallOnAppQuit = true;
      this.update({ status: 'ready', version: info.version, progress: null });
    });
    autoUpdater.on('error', (error) => this.update({ status: 'error', progress: null, error: describeError(error) }));
    void this.check();
    setInterval(() => this.checkOnSchedule(), CHECK_INTERVAL_MS).unref();
  }

  getState(): AppUpdateState {
    return this.state;
  }

  /** The game that postponed a check is over. */
  afterGame(): void {
    if (this.postponed) {
      this.postponed = false;
      void this.check();
    }
  }

  /** A check that finds an update downloads it at once, which has no place next to a running game. */
  private checkOnSchedule(): void {
    if (this.gameRunning()) {
      this.postponed = true;
    } else {
      void this.check();
    }
  }

  /**
   * The player turned betas on or off: a version that waits to be installed stays only if it still matches their
   * choice, and the next check runs at once.
   */
  betasChanged(): void {
    if (!this.updater) {
      return;
    }
    if (this.state.status === 'ready' && this.state.version && !this.wanted(this.state.version)) {
      this.updater.autoInstallOnAppQuit = false;
      this.update({ status: 'idle', version: null, progress: null });
    }
    void this.check();
  }

  async check(): Promise<void> {
    if (this.state.status !== 'idle' && this.state.status !== 'error') {
      return;
    }
    const updater = this.updater;
    if (!updater) {
      return;
    }
    const betas = this.betas();
    // electron-updater turns pre-releases on by itself while a beta runs; the player's choice decides instead.
    updater.allowPrerelease = betas;
    updater.allowDowngrade = !betas && isPrerelease(this.state.currentVersion);
    try {
      await updater.checkForUpdates();
    } catch {
      // Reported through the error event.
    }
  }

  install(): void {
    if (this.state.status !== 'ready') {
      throw new Error(t('main.appUpdates.notDownloaded'));
    }
    // Silent install, then start the new version.
    this.updater?.quitAndInstall(true, true);
  }

  /** No beta while betas are off, and no going back from the installed version while they are on. */
  private wanted(version: string): boolean {
    return this.betas() ? compareVersions(version, this.state.currentVersion) > 0 : !isPrerelease(version);
  }

  private update(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }
}
