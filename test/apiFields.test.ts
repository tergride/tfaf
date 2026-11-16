import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FafApi } from '../src/main/api/fafApi.ts';
import { ProfileService } from '../src/main/players/profileService.ts';
import { ReportService } from '../src/main/players/reports.ts';
import { ReviewService } from '../src/main/vault/reviews.ts';

interface RawResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

interface RawDocument {
  data: RawResource[];
  included?: RawResource[];
}

const OTHER_PLAYER: RawResource = { type: 'player', id: '8', attributes: { login: 'Other' } };
const reviewOf = (type: string): RawResource => ({
  type,
  id: '5',
  attributes: { text: 'Nice', score: 4, updateTime: '2026-10-01T00:00:00Z' },
  relationships: { player: { data: { type: 'player', id: '8' } } },
});

const DOCUMENTS: Record<string, RawDocument> = {
  '/data/map/1/versions': {
    data: [{ type: 'mapVersion', id: '10', attributes: { version: 14 }, relationships: { reviews: { data: [{ type: 'mapVersionReview', id: '5' }] } } }],
    included: [reviewOf('mapVersionReview'), OTHER_PLAYER],
  },
  '/data/game/2/reviews': { data: [reviewOf('gameReview')], included: [OTHER_PLAYER] },
  '/data/moderationReport': {
    data: [
      {
        type: 'moderationReport',
        id: '3',
        attributes: { createTime: '2026-10-01T00:00:00Z', reportDescription: 'Griefing', reportStatus: 'PROCESSING' },
        relationships: { reportedUsers: { data: [{ type: 'player', id: '8' }] } },
      },
    ],
    included: [OTHER_PLAYER],
  },
  '/data/player': { data: [{ type: 'player', id: '7', attributes: { login: 'Me' } }] },
  '/data/leaderboardRating': {
    data: [
      {
        type: 'leaderboardRating',
        id: '4',
        attributes: { mean: 1500, deviation: 100, totalGames: 20, wonGames: 11 },
        relationships: { leaderboard: { data: { type: 'leaderboard', id: '1' } } },
      },
    ],
    included: [{ type: 'leaderboard', id: '1', attributes: { technicalName: 'global' } }],
  },
};

/** As the API answers: `fields[type]` leaves only the id of every type it does not name, the requested one included. */
function answer(path: string, params: Record<string, string> = {}): RawDocument {
  const document = DOCUMENTS[path] ?? { data: [] };
  const named = Object.keys(params).flatMap((name) => /^fields\[(.+)\]$/.exec(name)?.[1] ?? []);
  if (named.length === 0) {
    return document;
  }
  const narrow = ({ type, id, ...fields }: RawResource): RawResource => (named.includes(type) ? { type, id, ...fields } : { type, id });
  return { data: document.data.map(narrow), included: document.included?.map(narrow) ?? [] };
}

const api = {
  get: async (path: string, params?: Record<string, string>) => answer(path, params),
  getCached: async (path: string, params: Record<string, string>) => answer(path, params),
  getAll: async (path: string, params: Record<string, string>) => answer(path, params),
} as unknown as FafApi;

describe('what the services read after the API narrowed its answer', () => {
  it('map reviews, with the version they are about', async () => {
    const [review] = await new ReviewService(api, () => 7).list({ kind: 'map', id: 1, versionId: 10 });
    assert.deepEqual(review, {
      id: '5',
      text: 'Nice',
      score: 4,
      author: 'Other',
      own: false,
      versionId: 10,
      version: '14',
      updatedAt: '2026-10-01T00:00:00Z',
    });
  });

  it('game reviews', async () => {
    const [review] = await new ReviewService(api, () => 7).list({ kind: 'game', id: 2, versionId: null });
    assert.equal(review?.score, 4);
    assert.equal(review?.author, 'Other');
  });

  it('own reports', async () => {
    const [report] = await new ReportService(api, () => 7).list();
    assert.equal(report?.description, 'Griefing');
    assert.deepEqual(report?.reported, ['Other']);
  });

  it('the ratings of a profile', async () => {
    const lobby = { getPlayer: () => null, getPlayerGame: () => null };
    const profile = await new ProfileService(api, lobby).get(7);
    assert.deepEqual(
      profile.ratings.map(({ technicalName, rating, totalGames }) => ({ technicalName, rating, totalGames })),
      [{ technicalName: 'global', rating: 1200, totalGames: 20 }],
    );
  });
});
