import type { ClanInfo } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { rsqlEquals } from '../api/rsql.ts';

// Clans change rarely; the player menu asks again at most once an hour.
const CLAN_CACHE_MS = 60 * 60 * 1000;

export function toClanInfo(resource: Resource): ClanInfo | null {
  const tag = asString(resource.tag);
  const name = asString(resource.name);
  if (!tag || !name) {
    return null;
  }
  const website = asString(resource.websiteUrl)?.trim() ?? '';
  let websiteUrl: string | null;
  try {
    websiteUrl = website && new URL(website).protocol === 'https:' ? website : null;
  } catch {
    websiteUrl = null;
  }
  return { tag, name, websiteUrl, leader: asString(asObject(resource.leader)?.login) };
}

/** Clans by tag for the chat's player menu: the clan's website and its leader to write to. */
export class ClanService {
  private readonly api: FafApi;

  constructor(api: FafApi) {
    this.api = api;
  }

  async byTag(tag: string): Promise<ClanInfo | null> {
    const document = resolveDocument(
      await this.api.getCached('/data/clan', { filter: rsqlEquals('tag', tag), include: 'leader' }, CLAN_CACHE_MS),
    );
    return document.items.map(toClanInfo).find((clan) => clan?.tag.toLowerCase() === tag.toLowerCase()) ?? null;
  }
}
