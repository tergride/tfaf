import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppNotification, LiveReplayTracking } from '../src/shared/contract.ts';
import { CancelledError } from '../src/main/errors.ts';
import type { RawGame } from '../src/main/lobby/lobbyProtocol.ts';
import type { NotificationSpec } from '../src/main/notifications.ts';
import { LiveReplayTracker, type TrackerClock } from '../src/main/replays/liveReplayTracker.ts';

const START = Date.parse('2026-10-24T12:00:00Z');
const MINUTE = 60_000;

class FakeClock implements TrackerClock {
  time = START;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(timer: unknown): void {
    this.timers.delete(timer as number);
  }

  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= this.time) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }

  get pending(): number {
    return this.timers.size;
  }
}

/** A running game that started `minutesAgo` before the test's start. */
function game(id: number, minutesAgo: number, state = 'playing'): RawGame {
  return { id, title: `Game ${id}`, state, launchedAt: new Date(START - minutesAgo * MINUTE).toISOString() } as RawGame;
}

function setup(options: { busy?: boolean; watchError?: Error } = {}) {
  const clock = new FakeClock();
  const games = new Map<number, RawGame>();
  const gameListeners = new Set<(gameId: number) => void>();
  const notifications: NotificationSpec[] = [];
  const desktop: string[] = [];
  const sounds: string[] = [];
  const watched: number[] = [];
  const changes: (LiveReplayTracking | null)[] = [];
  const tracker = new LiveReplayTracker({
    lobby: {
      getRawGame: (gameId) => games.get(gameId) ?? null,
      onGameChanged: (listener) => {
        gameListeners.add(listener);
        return () => gameListeners.delete(listener);
      },
    },
    watchLive: async (gameId) => {
      watched.push(gameId);
      if (options.watchError) {
        throw options.watchError;
      }
    },
    gameBusy: () => options.busy === true,
    notifications: {
      add: (spec) => {
        notifications.push(spec);
        return {} as AppNotification;
      },
    },
    notifier: {
      show: (notice) => {
        desktop.push(notice.title);
        return true;
      },
    },
    sounds: { play: (sound) => sounds.push(sound) },
    onChange: (tracking) => changes.push(tracking),
    clock,
  });
  const endGame = (gameId: number): void => {
    games.delete(gameId);
    gameListeners.forEach((listener) => listener(gameId));
  };
  return { clock, games, tracker, notifications, desktop, sounds, watched, changes, endGame };
}

describe('live replay tracker', () => {
  it('tells when the game can be watched, with a button that starts it', async () => {
    const { clock, games, tracker, notifications, desktop, sounds, watched, changes } = setup();
    games.set(7, game(7, 1));
    const tracking = tracker.track(7, 'notify');
    assert.deepEqual(tracking, { gameId: 7, title: 'Game 7', action: 'notify', watchableAt: new Date(START + 4 * MINUTE).toISOString() });
    assert.deepEqual(changes, [tracking]);

    clock.advance(4 * MINUTE - 1);
    assert.equal(notifications.length, 0);
    assert.equal(tracker.get(), tracking);
    clock.advance(1);
    assert.equal(tracker.get(), null);
    assert.deepEqual(changes, [tracking, null]);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0]!.title, /Game 7/);
    assert.equal(notifications[0]!.transient, undefined, 'kept in the list until the user acts');
    assert.equal(desktop.length, 1);
    assert.deepEqual(sounds, ['notification']);
    assert.deepEqual(watched, [], 'nothing starts on its own');
    await notifications[0]!.actions?.[0]?.run();
    assert.deepEqual(watched, [7]);
  });

  it('starts the stream on its own when asked to, unless a game runs', () => {
    const idle = setup();
    idle.games.set(7, game(7, 2));
    idle.tracker.track(7, 'watch');
    idle.clock.advance(3 * MINUTE);
    assert.deepEqual(idle.watched, [7]);
    assert.equal(idle.notifications[0]?.transient, true);

    const busy = setup({ busy: true });
    busy.games.set(7, game(7, 2));
    busy.tracker.track(7, 'watch');
    busy.clock.advance(3 * MINUTE);
    assert.deepEqual(busy.watched, []);
    assert.equal(busy.notifications[0]?.actions?.length, 1, 'the user starts it once the game is closed');
  });

  it('reports a stream that could not start, but not one the user cancelled', async () => {
    const failed = setup({ watchError: new Error('no stream') });
    failed.games.set(7, game(7, 5));
    failed.tracker.track(7, 'watch');
    failed.clock.advance(0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      failed.notifications.map((spec) => spec.severity),
      ['info', 'error'],
    );
    assert.equal(failed.notifications[1]?.body, 'no stream');

    const cancelled = setup({ watchError: new CancelledError() });
    cancelled.games.set(7, game(7, 5));
    cancelled.tracker.track(7, 'watch');
    cancelled.clock.advance(0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelled.notifications.length, 1);
  });

  it('drops a game that ends before it can be watched', () => {
    const { clock, games, tracker, notifications, watched, changes, endGame } = setup();
    games.set(7, game(7, 1));
    games.set(8, game(8, 1));
    tracker.track(7, 'watch');
    endGame(8);
    assert.notEqual(tracker.get(), null, 'another game ending changes nothing');
    endGame(7);
    assert.equal(tracker.get(), null);
    assert.equal(changes.at(-1), null);
    assert.equal(clock.pending, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0]!.title, /Game 7/);
    clock.advance(10 * MINUTE);
    assert.deepEqual(watched, []);
  });

  it('notices a game gone from the list when the time comes', () => {
    const { clock, games, tracker, notifications, watched } = setup();
    games.set(7, game(7, 1));
    tracker.track(7, 'watch');
    games.delete(7);
    clock.advance(4 * MINUTE);
    assert.equal(tracker.get(), null);
    assert.deepEqual(watched, []);
    assert.equal(notifications.length, 1);
  });

  it('follows one game at a time and can be cancelled', () => {
    const { clock, games, tracker, notifications, changes } = setup();
    games.set(7, game(7, 1));
    games.set(8, game(8, 2));
    tracker.track(7, 'notify');
    tracker.track(8, 'notify');
    assert.equal(clock.pending, 1);
    assert.equal(tracker.get()?.gameId, 8);
    tracker.untrack();
    assert.equal(tracker.get(), null);
    assert.equal(changes.at(-1), null);
    assert.equal(clock.pending, 0);
    clock.advance(10 * MINUTE);
    assert.equal(notifications.length, 0);
  });

  it('refuses a game that is not running', () => {
    const { games, tracker, changes } = setup();
    games.set(9, game(9, 0, 'open'));
    assert.throws(() => tracker.track(9, 'notify'), /закончилась/);
    assert.throws(() => tracker.track(10, 'notify'), /закончилась/);
    assert.deepEqual(changes, []);
  });
});
