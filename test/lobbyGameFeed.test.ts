import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { LobbyGamesUpdate } from '../src/shared/contract.ts';
import { LobbyGameFeed } from '../src/main/lobby/lobbyGameFeed.ts';
import type { RawGame } from '../src/main/lobby/lobbyProtocol.ts';

function game(id: number, state = 'open'): RawGame {
  return {
    id,
    title: `Game ${id}`,
    host: 'host',
    state,
    gameType: 'custom',
    visibility: 'public',
    passwordProtected: false,
    featuredMod: 'faf',
    simMods: [],
    mapFolderName: 'scmp_009',
    numPlayers: 1,
    maxPlayers: 8,
    ratingType: 'global',
    ratingMin: null,
    ratingMax: null,
    enforceRatingRange: false,
    hostedAt: null,
    launchedAt: null,
    teamIds: [],
    teamLogins: [],
  };
}

function setup() {
  const games = new Map<number, RawGame>();
  const updates: LobbyGamesUpdate[] = [];
  const changed: number[] = [];
  let stale = 0;
  const feed = new LobbyGameFeed({
    games,
    context: () => ({
      players: new Map(),
      friends: new Set(),
      featuredModNames: new Map(),
      contentBaseUrl: 'https://content',
      localMapPreview: () => null,
    }),
    onGameChanged: (gameId) => changed.push(gameId),
    onUpdate: (update) => updates.push(update),
    onStale: () => stale++,
  });
  const ids = (update: LobbyGamesUpdate | undefined): number[] => (update?.upserts ?? []).map((item) => item.id);
  return { feed, games, updates, changed, ids, stale: () => stale };
}

describe('lobby game feed', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('sends the changes of a moment in one update and removes a game that is no longer listed', () => {
    const { feed, games, updates, changed, ids } = setup();
    games.set(1, game(1));
    games.set(2, game(2));
    feed.markDirty(1);
    feed.markDirty(2);
    assert.equal(updates.length, 0);
    mock.timers.tick(200);
    assert.deepEqual(changed, [1, 2]);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.reset, false);
    assert.deepEqual(ids(updates[0]), [1, 2]);

    games.set(1, game(1, 'playing'));
    feed.markDirty(1);
    mock.timers.tick(200);
    assert.deepEqual(updates[1], { reset: false, upserts: [], removals: [1] });
  });

  it('keeps the shown list over a reconnect and replaces it with the new one in one update', () => {
    const { feed, games, updates, ids } = setup();
    games.set(1, game(1));
    feed.snapshot();
    assert.equal(feed.showing, true);

    games.clear();
    feed.reset(false);
    feed.resyncSoon();
    games.set(2, game(2));
    feed.markDirty(2);
    mock.timers.tick(999);
    assert.equal(updates.length, 0);
    mock.timers.tick(1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.reset, true);
    assert.deepEqual(ids(updates[0]), [2]);
  });

  it('holds the list while paused, keeps telling the listeners and sends it whole on resume', () => {
    const { feed, games, updates, changed, ids } = setup();
    games.set(1, game(1));
    feed.snapshot();
    feed.setPaused(true);

    games.set(2, game(2));
    feed.markDirty(2);
    games.set(1, game(1, 'playing'));
    feed.markDirty(1);
    mock.timers.tick(200);
    assert.equal(updates.length, 0);
    assert.deepEqual(changed, [2, 1]);

    feed.setPaused(false);
    mock.timers.tick(200);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.reset, true);
    assert.deepEqual(ids(updates[0]), [2]);
  });

  it('has nothing to send after a pause in which nothing changed', () => {
    const { feed, games, updates } = setup();
    games.set(1, game(1));
    feed.snapshot();
    feed.setPaused(true);
    feed.setPaused(false);
    mock.timers.tick(1_000);
    assert.equal(updates.length, 0);
  });

  it('does not lose a resync that falls into a pause', () => {
    const { feed, games, updates, ids } = setup();
    games.set(1, game(1));
    feed.snapshot();
    feed.setPaused(true);
    feed.resyncSoon();
    mock.timers.tick(1_000);
    assert.equal(updates.length, 0);
    feed.setPaused(false);
    mock.timers.tick(200);
    assert.equal(updates[0]?.reset, true);
    assert.deepEqual(ids(updates[0]), [1]);
  });

  it('gives the data up only after a long outage', () => {
    const { feed, updates, stale } = setup();
    feed.markStale();
    mock.timers.tick(59_999);
    assert.equal(stale(), 0);
    mock.timers.tick(1);
    assert.equal(stale(), 1);

    feed.markStale();
    feed.reset(true);
    mock.timers.tick(60_000);
    assert.equal(stale(), 1);
    assert.deepEqual(updates, [{ reset: true, upserts: [], removals: [] }]);
  });
});
