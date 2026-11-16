// Reviews of maps, mods and games (`mapVersionReview`, `modVersionReview`, `gameReview` of the API), read and written
// as the official client's ReviewService does.

import type { ReviewInput, ReviewKind, ReviewTarget, VaultReview } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asNumber, asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { t } from '../i18n.ts';
import { toVersion } from './apiMappers.ts';

const REVIEW_TYPES: Record<ReviewKind, string> = {
  map: 'mapVersionReview',
  mod: 'modVersionReview',
  game: 'gameReview',
};

/** The resource whose `reviews` relationship takes a new review. */
const SUBJECT_TYPES: Record<ReviewKind, string> = {
  map: 'mapVersion',
  mod: 'modVersion',
  game: 'game',
};

function toReview(resource: Resource, selfId: number | null, version: { id: number; name: string | null } | null): VaultReview | null {
  const score = asNumber(resource.score);
  if (score === null) {
    return null;
  }
  const player = asObject(resource.player);
  return {
    id: resource.id,
    text: asString(resource.text) ?? '',
    score,
    author: asString(player?.login),
    own: selfId !== null && String(selfId) === asString(player?.id),
    versionId: version?.id ?? null,
    version: version?.name ?? null,
    updatedAt: asString(resource.updateTime) ?? asString(resource.createTime),
  };
}

/** The signed-in player's reviews first, then the newest. */
function sortReviews(reviews: VaultReview[]): VaultReview[] {
  return reviews.sort((a, b) => Number(b.own) - Number(a.own) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

/** Map or mod versions with their reviews and the reviewers included, as `/data/map/{id}/versions` answers. */
export function parseVersionReviews(document: unknown, selfId: number | null): VaultReview[] {
  const reviews = resolveDocument(document).items.flatMap((version) => {
    const versionId = Number(version.id);
    const name = toVersion(version.version);
    const list = Array.isArray(version.reviews) ? version.reviews : [];
    return list.flatMap((review) => {
      const parsed = asObject(review) ? toReview(review as Resource, selfId, { id: versionId, name }) : null;
      return parsed ? [parsed] : [];
    });
  });
  return sortReviews(reviews);
}

/** A game's reviews with the reviewers included. */
export function parseGameReviews(document: unknown, selfId: number | null): VaultReview[] {
  return sortReviews(
    resolveDocument(document).items.flatMap((resource) => {
      const review = toReview(resource, selfId, null);
      return review ? [review] : [];
    }),
  );
}

/** The document that creates a review (`POST`) or changes one (`PATCH`, with its id). */
export function reviewDocument(kind: ReviewKind, review: ReviewInput, playerId: number, reviewId: string | null): unknown {
  const attributes = { text: review.text, score: review.score };
  return reviewId === null
    ? {
        data: {
          type: REVIEW_TYPES[kind],
          attributes,
          relationships: { player: { data: { type: 'player', id: String(playerId) } } },
        },
      }
    : { data: { type: REVIEW_TYPES[kind], id: reviewId, attributes } };
}

export class ReviewService {
  private readonly api: FafApi;
  private readonly selfId: () => number | null;

  constructor(api: FafApi, selfId: () => number | null) {
    this.api = api;
    this.selfId = selfId;
  }

  async list(target: ReviewTarget): Promise<VaultReview[]> {
    if (target.kind === 'game') {
      const document = await this.api.getAll(`/data/game/${target.id}/reviews`, { include: 'player' });
      return parseGameReviews(document, this.selfId());
    }
    const document = await this.api.getAll(`/data/${target.kind}/${target.id}/versions`, { include: 'reviews,reviews.player' });
    return parseVersionReviews(document, this.selfId());
  }

  async save(target: ReviewTarget, reviewId: string | null, review: ReviewInput): Promise<void> {
    const playerId = this.requireSelf();
    if (reviewId !== null) {
      await this.api.patch(`/data/${REVIEW_TYPES[target.kind]}/${reviewId}`, reviewDocument(target.kind, review, playerId, reviewId));
      return;
    }
    const subjectId = target.kind === 'game' ? target.id : target.versionId;
    if (subjectId === null) {
      throw new Error(t('main.validation.invalidRequest'));
    }
    await this.api.post(`/data/${SUBJECT_TYPES[target.kind]}/${subjectId}/reviews`, reviewDocument(target.kind, review, playerId, null));
  }

  async delete(kind: ReviewKind, reviewId: string): Promise<void> {
    this.requireSelf();
    await this.api.delete(`/data/${REVIEW_TYPES[kind]}/${reviewId}`);
  }

  private requireSelf(): number {
    const id = this.selfId();
    if (id === null) {
      throw new Error(t('main.reviews.signedOut'));
    }
    return id;
  }
}
