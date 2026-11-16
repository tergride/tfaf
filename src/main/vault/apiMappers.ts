import type { ModType, ReviewsSummary, VaultMap, VaultMod } from '../../shared/contract.ts';
import { asBoolean, asNumber, asObject, asString, type Resource } from '../api/jsonApi.ts';
import { removeLocalizationTag } from './scenarioReader.ts';

function toId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function toVersion(value: unknown): string | null {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : null;
}

export function toReviews(value: unknown): ReviewsSummary | null {
  const summary = asObject(value);
  if (!summary) {
    return null;
  }
  return {
    averageScore: asNumber(summary.averageScore) ?? 0,
    numReviews: asNumber(summary.reviews) ?? 0,
    lowerBound: asNumber(summary.lowerBound) ?? 0,
  };
}

/** Maps a `map` resource with included `latestVersion`, `author` and `reviewsSummary`. */
export function toVaultMap(resource: Resource): VaultMap | null {
  const version = asObject(resource.latestVersion);
  const mapId = toId(resource.id);
  const versionId = toId(version?.id);
  const folderName = asString(version?.folderName);
  if (!version || mapId === null || versionId === null || !folderName) {
    return null;
  }
  return {
    mapId,
    versionId,
    displayName: asString(resource.displayName) ?? folderName,
    folderName,
    description: removeLocalizationTag(asString(version.description) ?? ''),
    version: toVersion(version.version),
    maxPlayers: asNumber(version.maxPlayers) ?? 0,
    widthPx: asNumber(version.width),
    heightPx: asNumber(version.height),
    ranked: asBoolean(version.ranked),
    recommended: asBoolean(resource.recommended),
    gamesPlayed: asNumber(resource.gamesPlayed) ?? 0,
    author: asString(asObject(resource.author)?.login),
    createTime: asString(version.createTime),
    updateTime: asString(version.updateTime),
    thumbnailUrlSmall: asString(version.thumbnailUrlSmall),
    thumbnailUrlLarge: asString(version.thumbnailUrlLarge),
    reviews: toReviews(resource.reviewsSummary),
  };
}

/** Maps a `mod` resource with included `latestVersion`, `uploader` and `reviewsSummary`. */
export function toVaultMod(resource: Resource): VaultMod | null {
  const version = asObject(resource.latestVersion);
  const modId = toId(resource.id);
  const versionId = toId(version?.id);
  const uid = asString(version?.uid);
  if (!version || modId === null || versionId === null || !uid) {
    return null;
  }
  const type: ModType = version.type === 'UI' ? 'UI' : 'SIM';
  return {
    modId,
    versionId,
    uid,
    displayName: asString(resource.displayName) ?? uid,
    description: asString(version.description) ?? '',
    version: toVersion(version.version),
    type,
    ranked: asBoolean(version.ranked),
    recommended: asBoolean(resource.recommended),
    author: asString(resource.author),
    uploader: asString(asObject(resource.uploader)?.login),
    createTime: asString(version.createTime),
    updateTime: asString(version.updateTime),
    thumbnailUrl: asString(version.thumbnailUrl),
    reviews: toReviews(resource.reviewsSummary),
  };
}
