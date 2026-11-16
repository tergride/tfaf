import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FriendActivity, type FriendEvent } from '../src/main/lobby/friendActivity.ts';
import {
  gameHasPlayer,
  isListedGame,
  joinFailureReason,
  lobbyMatchQuality,
  type LobbyPlayer,
  parseGameInfo,
  parseLobbyMessage,
  parsePlayer,
  parsePlayerInfo,
  parseSessionId,
  repeatsJoinFailure,
  serializeLobbyMessage,
  stripHtml,
  toLobbyGame,
} from '../src/main/lobby/lobbyProtocol.ts';
import { t } from '../src/main/i18n.ts';
import { LineDecoder } from '../src/main/lineDecoder.ts';

const GAME = {
  command: 'game_info',
  visibility: 'public',
  password_protected: true,
  uid: 101,
  title: 'Setons 4v4',
  state: 'open',
  game_type: 'custom',
  featured_mod: 'faf',
  sim_mods: { 'uid-1': 'Ultra Shields' },
  mapname: 'SCMP_015',
  map_file_path: 'maps/scmp_015.zip',
  host: 'Alice',
  num_players: 2,
  max_players: 8,
  hosted_at: '2026-10-20T18:00:00+00:00',
  launched_at: null,
  rating_type: 'global',
  rating_min: 800,
  rating_max: null,
  enforce_rating_range: false,
  teams_ids: [
    { team_id: 2, player_ids: [1] },
    { team_id: 3, player_ids: [2] },
  ],
  teams: { '2': ['Alice'], '3': ['Bob'] },
};

function players(...list: LobbyPlayer[]): Map<number, LobbyPlayer> {
  return new Map(list.map((player) => [player.id, player]));
}

describe('LineDecoder', () => {
  it('joins messages split across frames and splits batched ones', () => {
    const decoder = new LineDecoder();
    assert.deepEqual(decoder.push('{"command":"ping"}\n{"comm'), ['{"command":"ping"}']);
    assert.deepEqual(decoder.push('and":"session","session":7}\n\n'), ['{"command":"session","session":7}']);
  });
});

describe('parseLobbyMessage', () => {
  it('accepts objects with a command only', () => {
    assert.equal(parseLobbyMessage('{"command":"welcome"}')?.command, 'welcome');
    assert.equal(parseLobbyMessage('{"no":"command"}'), null);
    assert.equal(parseLobbyMessage('not json'), null);
  });

  it('keeps a 64-bit session id exact through the login', () => {
    const reply = parseLobbyMessage('{"command":"session","request_id":"r1","session":8918262330878077809}');
    assert.ok(reply);
    const session = parseSessionId(reply);
    assert.equal(session, 8918262330878077809n);
    assert.equal(
      serializeLobbyMessage({ command: 'auth', session }),
      '{"command":"auth","session":8918262330878077809}',
    );
  });
});

describe('parsePlayer', () => {
  it('reads ratings per leaderboard', () => {
    const player = parsePlayer({
      id: 1,
      login: 'Alice',
      clan: 'TFAF',
      country: 'RU',
      ratings: { global: { rating: [1500, 100], number_of_games: 300 }, ladder_1v1: { rating: [1200, 80] } },
    });
    assert.deepEqual(player?.ratings.get('global'), { mean: 1500, deviation: 100 });
    assert.equal(player?.ratings.size, 2);
    assert.equal(parsePlayer({ login: 'no id' }), null);
  });

  it('keeps avatars hosted by FAF only', () => {
    const avatar = { url: 'https://content.faforever.com/faf/avatars/ICE_Test.png', tooltip: 'ICE Tester' };
    assert.deepEqual(parsePlayer({ id: 1, login: 'Alice', avatar })?.avatar, avatar);
    assert.deepEqual(parsePlayer({ id: 1, login: 'Alice', avatar: { url: avatar.url } })?.avatar, { url: avatar.url, tooltip: '' });
    assert.equal(parsePlayer({ id: 1, login: 'Alice', avatar: { url: 'https://example.com/a.png', tooltip: 'x' } })?.avatar, null);
    assert.equal(parsePlayer({ id: 1, login: 'Alice', avatar: { url: 'http://content.faforever.com/a.png' } })?.avatar, null);
    assert.equal(parsePlayer({ id: 1, login: 'Alice' })?.avatar, null);
  });
});

describe('parsePlayerInfo', () => {
  it('tells players who went offline from those online', () => {
    const update = parsePlayerInfo({
      command: 'player_info',
      players: [
        { id: 1, login: 'Alice', state: 'offline' },
        { id: 2, login: 'Bob' },
        { id: 3, login: 'Eve', state: 'unknown' },
        { login: 'no id', state: 'offline' },
      ],
    });
    assert.deepEqual(update.offlineIds, [1]);
    assert.deepEqual(
      update.online.map((player) => player.login),
      ['Bob', 'Eve'],
    );
  });
});

describe('friend activity', () => {
  const alice = parsePlayer({ id: 1, login: 'Alice' })!;
  const bob = parsePlayer({ id: 2, login: 'Bob' })!;
  const friends = new Set([1]);
  const online = players(alice, bob);
  const [open] = parseGameInfo({ ...GAME, teams_ids: [{ team_id: 2, player_ids: [2] }] });
  const [joined] = parseGameInfo(GAME);
  const [started] = parseGameInfo({ ...GAME, state: 'playing' });

  function synced(): FriendActivity {
    const activity = new FriendActivity();
    activity.playersChanged([{ previous: undefined, next: alice }], friends);
    activity.gamesChanged([], true, online, friends);
    return activity;
  }

  function describeEvents(events: FriendEvent[]): string[] {
    return events.map((event) => `${event.type} ${event.player.login}${'game' in event ? ` ${event.game.id}` : ''}`);
  }

  it('announces nothing for the lists sent after login', () => {
    const activity = new FriendActivity();
    assert.deepEqual(activity.playersChanged([{ previous: undefined, next: alice }], friends), []);
    // A single game update before the full list cannot be told from what the client missed.
    assert.deepEqual(activity.gamesChanged([{ previous: undefined, next: joined! }], false, online, friends), []);
    assert.deepEqual(activity.gamesChanged([{ previous: undefined, next: joined! }], true, online, friends), []);
  });

  it('announces friends coming online and leaving, and nobody else', () => {
    const activity = synced();
    assert.deepEqual(
      describeEvents(
        activity.playersChanged(
          [
            { previous: undefined, next: alice },
            { previous: undefined, next: bob },
            { previous: alice, next: alice },
          ],
          friends,
        ),
      ),
      ['online Alice'],
    );
    assert.deepEqual(describeEvents(activity.playersChanged([{ previous: alice, next: null }], friends)), ['offline Alice']);
  });

  it('announces a friend joining an open game once and the start of their game once', () => {
    const activity = synced();
    assert.deepEqual(describeEvents(activity.gamesChanged([{ previous: open, next: joined! }], false, online, friends)), [
      'joinedGame Alice 101',
    ]);
    assert.deepEqual(activity.gamesChanged([{ previous: joined, next: joined! }], false, online, friends), []);
    assert.deepEqual(describeEvents(activity.gamesChanged([{ previous: joined, next: started! }], false, online, friends)), [
      'startedPlaying Alice 101',
    ]);
    assert.deepEqual(activity.gamesChanged([{ previous: started, next: started! }], false, online, friends), []);
    const [ladder] = parseGameInfo({ ...GAME, uid: 102, game_type: 'matchmaker' });
    assert.deepEqual(activity.gamesChanged([{ previous: undefined, next: ladder! }], false, online, friends), []);
  });

  it('does not repeat events after a reconnect', () => {
    const activity = synced();
    activity.gamesChanged([{ previous: open, next: joined! }], false, online, friends);
    activity.reset();
    assert.deepEqual(activity.playersChanged([{ previous: undefined, next: alice }], friends), []);
    assert.deepEqual(activity.gamesChanged([{ previous: undefined, next: joined! }], true, online, friends), []);
    assert.deepEqual(activity.playersChanged([{ previous: alice, next: alice }], friends), []);
  });
});

describe('game_info', () => {
  it('parses single and batched messages', () => {
    assert.equal(parseGameInfo(GAME).length, 1);
    const batch = parseGameInfo({ command: 'game_info', games: [GAME, { ...GAME, uid: 102 }, { broken: true }] });
    assert.deepEqual(
      batch.map((game) => game.id),
      [101, 102],
    );
  });

  it('lists only open custom and coop games', () => {
    const [game] = parseGameInfo(GAME);
    const [coop] = parseGameInfo({ ...GAME, game_type: 'coop', featured_mod: 'coop' });
    assert.ok(game && isListedGame(game));
    assert.ok(coop && isListedGame(coop));
    const [playing] = parseGameInfo({ ...GAME, state: 'playing' });
    const [ladder] = parseGameInfo({ ...GAME, game_type: 'matchmaker' });
    assert.ok(playing && !isListedGame(playing));
    assert.ok(ladder && !isListedGame(ladder));
  });

  it('maps teams with ratings in the game leaderboard and the average rating', () => {
    const [raw] = parseGameInfo(GAME);
    assert.ok(raw);
    const alice = parsePlayer({ id: 1, login: 'Alice', country: 'RU', ratings: { global: { rating: [1500, 100] } } })!;
    const bob = parsePlayer({ id: 2, login: 'Bob', clan: 'XYZ', ratings: { global: { rating: [1000, 50.5] } } })!;
    const game = toLobbyGame(raw, {
      players: players(alice, bob),
      friends: new Set([2]),
      featuredModNames: new Map([['faf', 'FAF']]),
      contentBaseUrl: 'https://content.faforever.com',
      localMapPreview: () => assert.fail('only generated maps are looked up locally'),
    });

    assert.equal(game.featuredModName, 'FAF');
    assert.equal(game.mapPreviewUrl, 'https://content.faforever.com/maps/previews/small/scmp_015.png');
    assert.deepEqual(game.simMods, [{ uid: 'uid-1', name: 'Ultra Shields' }]);
    assert.deepEqual(
      game.teams.map((team) => [team.team, team.players.map((player) => [player.login, player.rating, player.friend])]),
      [
        [2, [['Alice', 1200, false]]],
        [3, [['Bob', 848, true]]],
      ],
    );
    assert.equal(game.averageRating, 1024);
    assert.equal(game.hostedAt, '2026-10-20T18:00:00.000Z');
    assert.ok(gameHasPlayer(raw, new Set([2])));
    assert.ok(!gameHasPlayer(raw, new Set([3])));
  });

  it('rates the match quality from the lobby ratings of the game leaderboard', () => {
    const rated = (id: number, mean: number): LobbyPlayer =>
      parsePlayer({ id, login: `P${id}`, ratings: { global: { rating: [mean, 100] } } })!;
    const lobby = players(rated(1, 1500), rated(2, 1500), rated(3, 1500));
    const [teams] = parseGameInfo(GAME);
    const quality = lobbyMatchQuality(teams!, lobby, 'global');
    assert.ok(quality !== null && quality > 0.6);
    // Team 1 is "no team": its players are sides of their own, observers below it do not count.
    const [ffa] = parseGameInfo({ ...GAME, teams_ids: [{ team_id: 1, player_ids: [1, 2, 3] }, { team_id: -1, player_ids: [4] }] });
    assert.ok((lobbyMatchQuality(ffa!, lobby, 'global') ?? 1) < quality);
    assert.equal(lobbyMatchQuality(teams!, lobby, 'ladder_1v1'), null, 'a player without a rating there');
    const [alone] = parseGameInfo({ ...GAME, teams_ids: [{ team_id: 2, player_ids: [1] }] });
    assert.equal(lobbyMatchQuality(alone!, lobby, 'global'), null);
  });

  it('shows a generated map by the picture in the maps folder, without one it has no preview', () => {
    const [raw] = parseGameInfo({ ...GAME, mapname: 'neroxis_map_generator_1.12.0_abcd' });
    const context = { players: new Map(), friends: new Set<number>(), featuredModNames: new Map(), contentBaseUrl: 'https://c' };
    const missing = toLobbyGame(raw!, { ...context, localMapPreview: () => null });
    assert.equal(missing.mapPreviewUrl, null);
    assert.equal(missing.mapPreviewLargeUrl, null);
    assert.equal(missing.teams[0]?.players[0]?.login, '#1');
    const generated = toLobbyGame(raw!, { ...context, localMapPreview: (name) => `local:${name}` });
    assert.equal(generated.mapPreviewUrl, 'local:neroxis_map_generator_1.12.0_abcd');
    assert.equal(generated.mapPreviewLargeUrl, 'local:neroxis_map_generator_1.12.0_abcd');
  });
});

describe('stripHtml', () => {
  it('removes markup from server notices', () => {
    assert.equal(
      stripHtml('You are using an unofficial client! Get it from <a href="https://faforever.com">here</a> &amp; enjoy'),
      'You are using an unofficial client! Get it from here & enjoy',
    );
  });
});

describe('game_join_failed', () => {
  it('translates the known reason codes and keeps an unknown reason as sent', () => {
    assert.equal(joinFailureReason('bad_password'), t('main.lobby.joinReasons.badPassword'));
    assert.equal(joinFailureReason('host_left_game'), t('main.lobby.joinReasons.hostLeftGame'));
    assert.equal(joinFailureReason('<b>banned</b>'), 'banned');
    assert.equal(joinFailureReason(undefined), t('main.lobby.joinRefused'));
  });

  it('recognises only the info notice that follows the refusal', () => {
    const notice = { command: 'notice', style: 'info', text: "Bad password (it's case sensitive)." };
    assert.equal(repeatsJoinFailure('game_join_failed', notice), true);
    assert.equal(repeatsJoinFailure('game_info', notice), false);
    assert.equal(repeatsJoinFailure('game_join_failed', { ...notice, style: 'error' }), false);
    assert.equal(repeatsJoinFailure('game_join_failed', { command: 'game_info' }), false);
  });
});
