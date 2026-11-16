import {
  LIVE_REPLAY_DELAY_SECONDS,
  type LiveReplayAction,
  type LiveReplayTracking,
} from '../../shared/contract.ts';
import type { DesktopNotifier } from '../desktopNotifier.ts';
import { CancelledError, describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { isLiveGame, type RawGame } from '../lobby/lobbyProtocol.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';
import type { NotificationCenter } from '../notifications.ts';
import type { SoundPlayer } from '../sounds.ts';

export interface TrackerClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

const SYSTEM_CLOCK: TrackerClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

export interface LiveReplayTrackerDependencies {
  lobby: Pick<LobbyService, 'getRawGame' | 'onGameChanged'>;
  /** Starts the live stream of a game, as the replays tab does. */
  watchLive(gameId: number): Promise<void>;
  /** A game or a replay runs already, so the stream cannot start on its own. */
  gameBusy(): boolean;
  notifications: Pick<NotificationCenter, 'add'>;
  notifier: Pick<DesktopNotifier, 'show'>;
  sounds: Pick<SoundPlayer, 'play'>;
  onChange(tracking: LiveReplayTracking | null): void;
  clock?: TrackerClock;
}

/**
 * Waits for one running game until the replay server gives it out, like LiveReplayService of the official client:
 * then it tells the user, with a button to watch, or starts the stream right away. A game that ends before that is
 * dropped with a notification.
 */
export class LiveReplayTracker {
  private readonly deps: LiveReplayTrackerDependencies;
  private readonly clock: TrackerClock;
  private tracking: LiveReplayTracking | null = null;
  private timer: unknown = null;

  constructor(deps: LiveReplayTrackerDependencies) {
    this.deps = deps;
    this.clock = deps.clock ?? SYSTEM_CLOCK;
    deps.lobby.onGameChanged((gameId) => {
      if (this.tracking?.gameId === gameId && !this.liveGame(gameId)) {
        this.ended();
      }
    });
  }

  get(): LiveReplayTracking | null {
    return this.tracking;
  }

  /** Replaces the game followed so far. */
  track(gameId: number, action: LiveReplayAction): LiveReplayTracking {
    const game = this.liveGame(gameId);
    if (!game) {
      throw new Error(t('main.replays.live.gameEnded'));
    }
    const launchedAt = game.launchedAt ? Date.parse(game.launchedAt) : Number.NaN;
    // Without a start time the server already has the game long enough, as watchLive assumes too.
    const watchableAt = Number.isFinite(launchedAt) ? launchedAt + LIVE_REPLAY_DELAY_SECONDS * 1000 : this.clock.now();
    this.cancelTimer();
    this.tracking = {
      gameId,
      title: game.title || t('main.replays.tracking.untitled', { id: gameId }),
      action,
      watchableAt: new Date(watchableAt).toISOString(),
    };
    this.timer = this.clock.setTimeout(() => this.fire(), Math.max(0, watchableAt - this.clock.now()));
    this.deps.onChange(this.tracking);
    return this.tracking;
  }

  untrack(): void {
    if (this.tracking) {
      this.clear();
    }
  }

  private liveGame(gameId: number): RawGame | null {
    const game = this.deps.lobby.getRawGame(gameId);
    return game && isLiveGame(game) ? game : null;
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clear(): void {
    this.cancelTimer();
    this.tracking = null;
    this.deps.onChange(null);
  }

  private fire(): void {
    this.timer = null;
    const tracking = this.tracking;
    if (!tracking) {
      return;
    }
    // A timer may fire a little before the wall clock gets there, and watchLive goes by the wall clock.
    const remaining = Date.parse(tracking.watchableAt) - this.clock.now();
    if (remaining > 0) {
      this.timer = this.clock.setTimeout(() => this.fire(), remaining);
      return;
    }
    if (!this.liveGame(tracking.gameId)) {
      this.ended();
      return;
    }
    this.clear();
    if (tracking.action === 'watch' && !this.deps.gameBusy()) {
      this.deps.notifications.add({
        severity: 'info',
        title: t('main.replays.tracking.available', { title: tracking.title }),
        body: t('main.replays.tracking.starting'),
        transient: true,
      });
      this.deps.watchLive(tracking.gameId).catch((error: unknown) => {
        if (!(error instanceof CancelledError)) {
          this.deps.notifications.add({
            severity: 'error',
            title: t('main.replays.tracking.failed', { title: tracking.title }),
            body: describeError(error),
          });
        }
      });
      return;
    }
    // A game running already would be interrupted, so the user decides when to watch.
    const title = t('main.replays.tracking.available', { title: tracking.title });
    const body = tracking.action === 'watch' ? t('main.replays.tracking.closeGameFirst') : t('main.replays.tracking.watchHint');
    this.deps.notifications.add({
      severity: 'info',
      title,
      body,
      actions: [{ label: t('main.replays.tracking.watch'), run: () => this.deps.watchLive(tracking.gameId) }],
    });
    this.deps.notifier.show({ title, body });
    this.deps.sounds.play('notification');
  }

  private ended(): void {
    const tracking = this.tracking;
    if (!tracking) {
      return;
    }
    this.clear();
    this.deps.notifications.add({
      severity: 'info',
      title: t('main.replays.tracking.ended', { title: tracking.title }),
      body: t('main.replays.tracking.endedBody'),
    });
  }
}
