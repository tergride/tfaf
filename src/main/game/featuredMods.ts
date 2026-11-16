import type { FeaturedModInfo } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asNumber, asString, resolveDocument } from '../api/jsonApi.ts';
import { t } from '../i18n.ts';

export interface FeaturedModFile {
  group: string;
  name: string;
  md5: string;
  version: number;
  url: string;
  hmacParameter: string | null;
  hmacToken: string | null;
}

interface FeaturedModEntry extends FeaturedModInfo {
  id: string;
  visible: boolean;
}

const CATALOG_TTL_MS = 30 * 60 * 1000;

/**
 * The list of featured mods changes a few times a year, yet the lobby, the create-game dialog and every game update
 * need it; one cached copy serves them all.
 */
export class FeaturedModCatalog {
  private readonly api: Pick<FafApi, 'get'>;
  private readonly now: () => number;
  private entries: FeaturedModEntry[] | null = null;
  private loadedAt = 0;
  private loading: Promise<FeaturedModEntry[]> | null = null;

  constructor(api: Pick<FafApi, 'get'>, now = Date.now) {
    this.api = api;
    this.now = now;
  }

  /** Featured mods that can be hosted, in the order of the official client's "create game" dialog. */
  async hostable(): Promise<FeaturedModInfo[]> {
    return (await this.load())
      .filter((mod) => mod.visible)
      .map(({ technicalName, displayName, description }) => ({ technicalName, displayName, description }));
  }

  async displayNames(): Promise<Map<string, string>> {
    return new Map((await this.load()).map((mod) => [mod.technicalName, mod.displayName]));
  }

  async idOf(technicalName: string): Promise<string> {
    const id = (await this.load()).find((mod) => mod.technicalName === technicalName)?.id;
    if (!id) {
      throw new Error(t('main.game.unknownFeaturedMod', { name: technicalName }));
    }
    return id;
  }

  private load(): Promise<FeaturedModEntry[]> {
    if (this.entries && this.now() - this.loadedAt < CATALOG_TTL_MS) {
      return Promise.resolve(this.entries);
    }
    this.loading ??= this.fetch()
      .then((entries) => {
        this.entries = entries;
        this.loadedAt = this.now();
        return entries;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async fetch(): Promise<FeaturedModEntry[]> {
    const document = resolveDocument(await this.api.get('/data/featuredMod', { sort: 'order', 'page[size]': '100' }));
    return document.items.flatMap((mod): FeaturedModEntry[] => {
      const technicalName = asString(mod.technicalName);
      if (!mod.id || !technicalName) {
        return [];
      }
      return [
        {
          id: mod.id,
          technicalName,
          displayName: asString(mod.displayName) ?? technicalName,
          description: asString(mod.description) ?? '',
          visible: mod.visible === true,
        },
      ];
    });
  }
}

/** Files of a featured mod at a version, or the latest; the input of SimpleHttpFeaturedModUpdaterTask. */
export async function fetchFeaturedModFiles(
  api: FafApi,
  featuredModId: string,
  version: number | null = null,
): Promise<FeaturedModFile[]> {
  const document = resolveDocument(
    await api.get(`/featuredMods/${encodeURIComponent(featuredModId)}/files/${version ?? 'latest'}`, {
      'page[size]': '10000',
      'page[number]': '1',
    }),
  );
  return document.items.flatMap((file): FeaturedModFile[] => {
    const group = asString(file.group);
    const name = asString(file.name);
    const md5 = asString(file.md5);
    const url = asString(file.cacheableUrl) ?? asString(file.url);
    const version = asNumber(file.version) ?? Number(asString(file.version));
    if (!group || !name || !md5 || !url || !Number.isInteger(version)) {
      return [];
    }
    return [
      {
        group,
        name,
        md5: md5.toLowerCase(),
        version,
        url,
        hmacParameter: asString(file.hmacParameter),
        hmacToken: asString(file.hmacToken),
      },
    ];
  });
}
