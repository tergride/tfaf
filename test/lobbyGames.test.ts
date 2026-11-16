import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendsIn, friendsLabel } from '../src/renderer/src/lib/lobbyGames.ts';
import type { LobbyGame, LobbyGamePlayer } from '../src/shared/contract.ts';

function player(login: string, friend: boolean): LobbyGamePlayer {
  return { id: login.length, login, clan: null, country: null, rating: null, friend, avatar: null };
}

function game(host: string, players: LobbyGamePlayer[]): LobbyGame {
  return {
    id: 1,
    gameType: 'custom',
    title: 'Test',
    host,
    mapFolderName: 'scmp_001',
    mapPreviewUrl: null,
    mapPreviewLargeUrl: null,
    featuredMod: 'faf',
    featuredModName: 'FAF',
    simMods: [],
    numPlayers: players.length,
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
    teams: [{ team: 1, players }],
  };
}

describe('friends in lobby games', () => {
  it('puts a hosting friend first', () => {
    const hosted = game('Host', [player('Bob', true), player('Host', true), player('Eve', false)]);
    assert.deepEqual(
      friendsIn(hosted).map((friend) => friend.login),
      ['Host', 'Bob'],
    );
    assert.equal(friendsLabel(hosted), 'Хост — друг Host, ещё 1');
  });

  it('names the friends who wait in the lobby', () => {
    assert.equal(friendsLabel(game('Host', [player('Host', false), player('Bob', true)])), 'Друг: Bob');
    assert.equal(friendsLabel(game('Host', [player('Ann', true), player('Bob', true)])), 'Друзья: Ann, Bob');
    assert.equal(friendsLabel(game('Host', [player('Host', false)])), null);
  });
});
