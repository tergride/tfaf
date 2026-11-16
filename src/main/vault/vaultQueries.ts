// Filter and sort of the map and mod vault listings for the JSON:API of FAF.

import type { MapQuery, ModQuery } from '../../shared/contract.ts';
import { rsqlAnd, rsqlContains, rsqlEquals, rsqlIn, rsqlOr, sortParam } from '../api/rsql.ts';
import { t } from '../i18n.ts';

export interface VaultListParams {
  filter: string;
  sort: string;
}

export function mapListParams(query: MapQuery, userId: number | null): VaultListParams {
  const filters = ['latestVersion.hidden==false'];
  if (query.name) {
    filters.push(rsqlContains('displayName', query.name));
  }
  if (query.author) {
    filters.push(rsqlContains('author.login', query.author));
  }
  if (query.players) {
    filters.push(rsqlIn('latestVersion.maxPlayers', query.players));
  }
  if (query.sizes) {
    filters.push(rsqlOr([rsqlIn('latestVersion.width', query.sizes), rsqlIn('latestVersion.height', query.sizes)]));
  }
  if (query.onlyRanked) {
    filters.push(rsqlEquals('latestVersion.ranked', true));
  }
  if (query.onlyRecommended) {
    filters.push(rsqlEquals('recommended', true));
  }
  if (query.onlyOwn) {
    if (userId === null) {
      throw new Error(t('main.auth.signInRequired'));
    }
    filters.push(rsqlEquals('author.id', userId));
  }
  return { filter: rsqlAnd(filters), sort: sortParam(query.sortField, query.sortOrder) };
}

export function modListParams(query: ModQuery): VaultListParams {
  const filters = ['latestVersion.hidden==false'];
  if (query.name) {
    filters.push(rsqlContains('displayName', query.name));
  }
  if (query.author) {
    filters.push(rsqlContains('author', query.author));
  }
  if (query.type) {
    filters.push(rsqlEquals('latestVersion.type', query.type));
  }
  if (query.onlyRanked) {
    filters.push(rsqlEquals('latestVersion.ranked', true));
  }
  if (query.onlyRecommended) {
    filters.push(rsqlEquals('recommended', true));
  }
  return { filter: rsqlAnd(filters), sort: sortParam(query.sortField, query.sortOrder) };
}
