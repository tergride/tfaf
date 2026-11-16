import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAvatarList } from '../src/main/lobby/lobbyProtocol.ts';
import {
  historySince,
  parseAchievements,
  parseProfileRatings,
  parseRatingHistory,
  parseStatistics,
  PLAYER_EVENTS,
} from '../src/main/players/profileService.ts';
import { gameParticipants, parseReports, reportDocument } from '../src/main/players/reports.ts';

function journalPage(entries: { id: string; time: string; game: string; mean: number | null; deviation: number }[]): unknown {
  return {
    data: entries.map((entry) => ({
      type: 'leaderboardRatingJournal',
      id: entry.id,
      attributes: { meanAfter: entry.mean, deviationAfter: entry.deviation, meanBefore: 1000, deviationBefore: 100 },
      relationships: { gamePlayerStats: { data: { type: 'gamePlayerStats', id: `s${entry.id}` } } },
    })),
    included: entries.map((entry) => ({
      type: 'gamePlayerStats',
      id: `s${entry.id}`,
      attributes: { scoreTime: entry.time },
      relationships: { game: { data: { type: 'game', id: entry.game } } },
    })),
  };
}

describe('player profile', () => {
  it('lists ratings in the official order with displayed values', () => {
    const document = {
      data: [
        { type: 'leaderboardRating', id: '1', attributes: { mean: 1500, deviation: 100, totalGames: 20, wonGames: 11 }, relationships: { leaderboard: { data: { type: 'leaderboard', id: '2' } } } },
        { type: 'leaderboardRating', id: '2', attributes: { mean: 1200.9, deviation: 50, totalGames: 5, wonGames: 1 }, relationships: { leaderboard: { data: { type: 'leaderboard', id: '1' } } } },
      ],
      included: [
        { type: 'leaderboard', id: '1', attributes: { technicalName: 'global' } },
        { type: 'leaderboard', id: '2', attributes: { technicalName: 'ladder_1v1' } },
      ],
    };
    const ratings = parseProfileRatings(document);
    assert.deepEqual(
      ratings.map(({ leaderboardId, technicalName, rating, totalGames }) => ({ leaderboardId, technicalName, rating, totalGames })),
      [
        { leaderboardId: '1', technicalName: 'global', rating: 1050, totalGames: 5 },
        { leaderboardId: '2', technicalName: 'ladder_1v1', rating: 1200, totalGames: 20 },
      ],
    );
    assert.equal(ratings[1]?.name, '1v1');
  });

  it('joins the pages of the rating history in time order', () => {
    const points = parseRatingHistory([
      journalPage([{ id: '2', time: '2026-03-02T10:00:00Z', game: '22', mean: 1600, deviation: 100 }]),
      journalPage([
        { id: '1', time: '2026-03-01T10:00:00Z', game: '11', mean: 1500, deviation: 100 },
        // A game still being rated has no rating after it yet.
        { id: '3', time: '2026-03-03T10:00:00Z', game: '33', mean: null, deviation: 90 },
      ]),
    ]);
    assert.deepEqual(points, [
      { time: '2026-03-01T10:00:00Z', rating: 1200, gameId: 11 },
      { time: '2026-03-02T10:00:00Z', rating: 1300, gameId: 22 },
      { time: '2026-03-03T10:00:00Z', rating: 730, gameId: 33 },
    ]);
  });

  it('starts the history periods at midnight UTC', () => {
    const now = new Date('2026-03-31T15:20:00Z');
    assert.equal(historySince('all', now), null);
    assert.equal(historySince('month', now), '2026-02-28T00:00:00.000Z');
    assert.equal(historySince('year', now), '2025-03-31T00:00:00.000Z');
    assert.equal(historySince('month', new Date('2026-01-15T01:00:00Z')), '2025-12-15T00:00:00.000Z');
  });

  it('keeps hidden achievements unnamed until they are unlocked', () => {
    const definitions = {
      data: [
        { type: 'achievement', id: 'b', attributes: { name: 'Second', description: 'B', order: 2, initialState: 'HIDDEN', type: 'STANDARD', revealedIconUrl: 'https://content.faforever.com/b.png' } },
        { type: 'achievement', id: 'a', attributes: { name: 'First', description: 'A', order: 1, initialState: 'REVEALED', type: 'INCREMENTAL', totalSteps: 10, unlockedIconUrl: 'https://content.faforever.com/a.png', revealedIconUrl: 'https://evil.example/a.png' } },
        { type: 'achievement', id: 'c', attributes: { name: 'Third', description: 'C', order: 3, initialState: 'HIDDEN', type: 'STANDARD', unlockedIconUrl: 'https://content.faforever.com/c.png' } },
      ],
    };
    const progress = {
      data: [
        { type: 'playerAchievement', id: '1', attributes: { state: 'REVEALED', currentSteps: 4 }, relationships: { achievement: { data: { type: 'achievement', id: 'a' } } } },
        { type: 'playerAchievement', id: '2', attributes: { state: 'UNLOCKED', updateTime: '2026-01-01T00:00:00Z' }, relationships: { achievement: { data: { type: 'achievement', id: 'c' } } } },
      ],
    };
    const achievements = parseAchievements(definitions, progress);
    assert.deepEqual(
      achievements.map(({ id, name, state, iconUrl, currentSteps, totalSteps, unlockedAt }) => ({ id, name, state, iconUrl, currentSteps, totalSteps, unlockedAt })),
      [
        // The revealed icon is not on a FAF content host, so it is not shown.
        { id: 'a', name: 'First', state: 'revealed', iconUrl: null, currentSteps: 4, totalSteps: 10, unlockedAt: null },
        { id: 'b', name: '', state: 'hidden', iconUrl: null, currentSteps: null, totalSteps: null, unlockedAt: null },
        { id: 'c', name: 'Third', state: 'unlocked', iconUrl: 'https://content.faforever.com/c.png', currentSteps: null, totalSteps: null, unlockedAt: '2026-01-01T00:00:00Z' },
      ],
    );
  });

  it('turns player events into statistics', () => {
    const event = (id: string, count: number) => ({
      type: 'playerEvent',
      id: `${id}-row`,
      attributes: { currentCount: count },
      relationships: { event: { data: { type: 'event', id } } },
    });
    const statistics = parseStatistics({
      data: [
        event(PLAYER_EVENTS.factions.aeon.plays, 10),
        event(PLAYER_EVENTS.factions.aeon.wins, 6),
        event(PLAYER_EVENTS.built.air, 500),
        event(PLAYER_EVENTS.lostAcus, 3),
        event(PLAYER_EVENTS.secondsPlayed, 7200),
      ],
    });
    assert.deepEqual(statistics.factions.find((entry) => entry.faction === 'aeon'), { faction: 'aeon', games: 10, wins: 6 });
    assert.deepEqual(statistics.factions.find((entry) => entry.faction === 'uef'), { faction: 'uef', games: 0, wins: 0 });
    assert.equal(statistics.built.air, 500);
    assert.equal(statistics.lost.acus, 3);
    assert.equal(statistics.secondsPlayed, 7200);
  });

  it('reads the avatar list and drops avatars off the FAF hosts', () => {
    const avatars = parseAvatarList({
      command: 'avatar',
      avatarlist: [
        { url: 'https://content.faforever.com/faf/avatars/a.png', tooltip: 'Alpha' },
        { url: 'https://example.com/b.png', tooltip: 'Beta' },
        { url: 'https://content.faforever.com/faf/avatars/c.png' },
      ],
    });
    assert.deepEqual(avatars, [
      { url: 'https://content.faforever.com/faf/avatars/a.png', tooltip: 'Alpha' },
      { url: 'https://content.faforever.com/faf/avatars/c.png', tooltip: '' },
    ]);
  });
});

describe('moderation reports', () => {
  it('serializes a report with its players and game', () => {
    assert.deepEqual(reportDocument({ players: [5, 7], gameId: 123, incidentTime: '12:30', description: 'Teamkill' }, 1), {
      data: {
        type: 'moderationReport',
        attributes: { reportDescription: 'Teamkill', gameIncidentTimecode: '12:30' },
        relationships: {
          reporter: { data: { type: 'player', id: '1' } },
          reportedUsers: { data: [{ type: 'player', id: '5' }, { type: 'player', id: '7' }] },
          game: { data: { type: 'game', id: '123' } },
        },
      },
    });
    const withoutGame = reportDocument({ players: [5], gameId: null, incidentTime: '', description: 'Chat abuse' }, 1) as {
      data: { attributes: Record<string, unknown>; relationships: Record<string, unknown> };
    };
    assert.equal(withoutGame.data.attributes.gameIncidentTimecode, null);
    assert.equal('game' in withoutGame.data.relationships, false);
  });

  it('reads reports with their players and statuses', () => {
    const reports = parseReports({
      data: [
        {
          type: 'moderationReport',
          id: '9',
          attributes: { reportDescription: 'Old', reportStatus: 'COMPLETED', createTime: '2026-01-01T00:00:00Z', moderatorNotice: 'Banned' },
          relationships: { reportedUsers: { data: [{ type: 'player', id: '5' }] }, game: { data: null } },
        },
        {
          type: 'moderationReport',
          id: '10',
          attributes: { reportDescription: 'New', reportStatus: 'SOMETHING_NEW', createTime: '2026-02-01T00:00:00Z', gameIncidentTimecode: '3:00' },
          relationships: { reportedUsers: { data: [{ type: 'player', id: '6' }] }, game: { data: { type: 'game', id: '77' } } },
        },
      ],
      included: [
        { type: 'player', id: '5', attributes: { login: 'Five' } },
        { type: 'player', id: '6', attributes: { login: 'Six' } },
      ],
    });
    assert.deepEqual(
      reports.map(({ id, status, reported, gameId, incidentTime, moderatorNotice }) => ({ id, status, reported, gameId, incidentTime, moderatorNotice })),
      [
        { id: '10', status: 'awaiting', reported: ['Six'], gameId: 77, incidentTime: '3:00', moderatorNotice: null },
        { id: '9', status: 'completed', reported: ['Five'], gameId: null, incidentTime: null, moderatorNotice: 'Banned' },
      ],
    );
  });

  it('finds the players of a game', () => {
    const participants = gameParticipants({
      data: [{ type: 'game', id: '1', attributes: {}, relationships: { playerStats: { data: [{ type: 'gamePlayerStats', id: 'a' }, { type: 'gamePlayerStats', id: 'b' }] } } }],
      included: [
        { type: 'gamePlayerStats', id: 'a', attributes: {}, relationships: { player: { data: { type: 'player', id: '5' } } } },
        { type: 'gamePlayerStats', id: 'b', attributes: {}, relationships: { player: { data: { type: 'player', id: '6' } } } },
      ],
    });
    assert.deepEqual([...participants], [5, 6]);
  });
});
