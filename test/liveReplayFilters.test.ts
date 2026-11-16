import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activePlayers, matchesLiveFilters, NO_LIVE_FILTERS, parseLiveFilters } from '../src/renderer/src/lib/liveReplayFilters.ts';
import type { LiveGame, LobbyGamePlayer, LobbyGameTeam } from '../src/shared/contract.ts';

function player(login: string, friend = false): LobbyGamePlayer {
  return { id: login.length, login, clan: null, country: null, rating: null, friend, avatar: null };
}

function liveGame(overrides: Partial<LiveGame> & { teams: LobbyGameTeam[] }): LiveGame {
  return {
    id: 1,
    gameType: 'custom',
    title: 'Test',
    host: 'alpha',
    mapFolderName: 'scmp_001',
    mapPreviewUrl: null,
    mapPreviewLargeUrl: null,
    featuredMod: 'faf',
    featuredModName: 'FAF',
    simMods: [],
    numPlayers: 2,
    maxPlayers: 8,
    passwordProtected: false,
    friendsOnly: false,
    ratingType: null,
    ratingMin: null,
    ratingMax: null,
    enforceRatingRange: false,
    hostedAt: null,
    averageRating: null,
    quality: null,
    generatedMap: false,
    tfafLobby: false,
    launchedAt: null,
    ...overrides,
  };
}

const duel = liveGame({
  teams: [
    { team: 2, players: [player('alpha')] },
    { team: 3, players: [player('beta', true)] },
  ],
});
const againstAi = liveGame({
  featuredMod: 'nomads',
  simMods: [{ uid: 'mod', name: 'Mod' }],
  generatedMap: true,
  teams: [
    { team: 1, players: [player('gamma')] },
    { team: -1, players: [player('watcher')] },
  ],
});

function shown(filters: Partial<typeof NO_LIVE_FILTERS>): string[] {
  return [duel, againstAi]
    .filter((game) => matchesLiveFilters(game, { ...NO_LIVE_FILTERS, ...filters }))
    .map((game) => game.featuredMod);
}

describe('live game filters', () => {
  it('counts the players without the observers', () => {
    assert.equal(activePlayers(duel), 2);
    assert.equal(activePlayers(againstAi), 1);
  });

  it('narrows the running games by each filter', () => {
    assert.deepEqual(shown({}), ['faf', 'nomads']);
    assert.deepEqual(shown({ featuredMod: 'nomads' }), ['nomads']);
    assert.deepEqual(shown({ withFriends: true }), ['faf']);
    assert.deepEqual(shown({ hideModded: true }), ['faf']);
    assert.deepEqual(shown({ generatedOnly: true }), ['nomads']);
    assert.deepEqual(shown({ hideSingle: true }), ['faf']);
    assert.deepEqual(shown({ withFriends: true, generatedOnly: true }), []);
  });

  it('reads stored filters, leaving damaged ones off', () => {
    assert.deepEqual(parseLiveFilters({ featuredMod: 'faf', withFriends: true, hideSingle: 'yes' }), {
      ...NO_LIVE_FILTERS,
      featuredMod: 'faf',
      withFriends: true,
    });
    assert.deepEqual(parseLiveFilters(null), NO_LIVE_FILTERS);
  });
});
