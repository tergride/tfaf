import { describeError } from '../errors.ts';
import { isValidGamePath } from '../gameLocator.ts';
import type { SettingsStore } from '../settings.ts';
import type { GameUpdater } from './gameUpdater.ts';

// After a successful background update the files are only checked again on the next login after this pause.
const INTERVAL_MS = 30 * 60 * 1000;

/**
 * Keeps the files of a featured mod current after login, so hosting does not have to wait for downloads. The first
 * update of a launcher run hashes every file: games trust the hash cache, so this is what catches a damaged file.
 */
export class BackgroundUpdate {
  private readonly settings: Pick<SettingsStore, 'get'>;
  private readonly updater: Pick<GameUpdater, 'update'>;
  private readonly featuredMod: string;
  private last = 0;
  private verified = false;

  constructor(settings: Pick<SettingsStore, 'get'>, updater: Pick<GameUpdater, 'update'>, featuredMod: string) {
    this.settings = settings;
    this.updater = updater;
    this.featuredMod = featuredMod;
  }

  run(): void {
    if (!isValidGamePath(this.settings.get().gamePath) || Date.now() - this.last < INTERVAL_MS) {
      return;
    }
    this.updater.update(this.featuredMod, { verify: !this.verified }).then(
      () => {
        this.last = Date.now();
        this.verified = true;
      },
      (error: unknown) => console.warn('Background game update failed', describeError(error)),
    );
  }
}
