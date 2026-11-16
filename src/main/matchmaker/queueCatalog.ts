import type { MapPoolBracket } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { rsqlEquals } from '../api/rsql.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import { parseMapPool, parseQueueDefinitions, type QueueDefinition } from './mapPools.ts';

const QUEUES_CACHE_MS = 10 * 60 * 1000;
// The official client keeps map pools for a minute (CacheNames.MATCHMAKER_POOLS).
const POOL_CACHE_MS = 60_000;

/** The matchmaker queues as the API describes them, and their map pools; the lobby server only names the queues. */
export class QueueCatalog {
  private readonly api: Pick<FafApi, 'getCached' | 'getAll'>;
  private readonly onLoaded: () => void;
  private definitions = new Map<string, QueueDefinition>();
  private loading: Promise<void> | null = null;
  /** The pools last shown, for checking vetoes. */
  private readonly pools = new Map<string, MapPoolBracket[]>();

  /** `onLoaded` runs when the queues have been read. */
  constructor(api: Pick<FafApi, 'getCached' | 'getAll'>, onLoaded: () => void) {
    this.api = api;
    this.onLoaded = onLoaded;
  }

  get(name: string): QueueDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /** The queue whose games are rated on the leaderboard. */
  byLeaderboard(leaderboard: string): QueueDefinition | undefined {
    return [...this.definitions.values()].find((definition) => definition.leaderboard === leaderboard);
  }

  load(): Promise<void> {
    this.loading ??= this.api
      .getCached('/data/matchmakerQueue', { include: 'leaderboard', 'page[size]': '100' }, QUEUES_CACHE_MS)
      .then(
        (document) => {
          this.definitions = new Map(parseQueueDefinitions(document).map((definition) => [definition.name, definition]));
          this.onLoaded();
        },
        (error: unknown) => console.warn('Matchmaker queues could not be loaded', describeError(error)),
      )
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  async pool(name: string): Promise<MapPoolBracket[]> {
    await this.load();
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(t('main.matchmaker.queueNotFound'));
    }
    const document = await this.api.getAll(
      '/data/mapPoolAssignment',
      {
        filter: rsqlEquals('mapPool.matchmakerQueueMapPool.matchmakerQueue.id', definition.id),
        include: 'mapPool.matchmakerQueueMapPool,mapVersion.map',
      },
      POOL_CACHE_MS,
    );
    const brackets = parseMapPool(document);
    this.pools.set(name, brackets);
    return brackets;
  }

  /** A bracket of a pool shown before, with its queue; null when no shown pool has it. */
  findBracket(bracketId: number): { queue: string; bracket: MapPoolBracket } | null {
    for (const [queue, brackets] of this.pools) {
      const bracket = brackets.find((candidate) => candidate.id === bracketId);
      if (bracket) {
        return { queue, bracket };
      }
    }
    return null;
  }
}
