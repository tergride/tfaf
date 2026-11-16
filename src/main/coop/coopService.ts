// Coop missions, like CoopController and CoopService of the official client: campaigns from the API, the fastest
// finishes of each mission and hosting a mission.

import type {
  CoopCampaignType,
  CoopFaction,
  CoopHostRequest,
  CoopMission,
  CoopResult,
  CoopScenario,
} from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asBoolean, asNumber, asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { rsqlAnd, rsqlEquals } from '../api/rsql.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import { t } from '../i18n.ts';
import { htmlToText, httpsUrlOrNull } from '../info/html.ts';
import { isSafeFolderName } from '../vault/fsUtil.ts';
import type { ModService } from '../vault/modService.ts';

const COOP_FEATURED_MOD = 'coop';
const SCENARIOS_CACHE_MS = 30 * 60 * 1000;
const LEADERBOARD_CACHE_MS = 5 * 60 * 1000;
// Results come fastest first, so the start of the list holds the best finish of every group worth showing.
const LEADERBOARD_SIZE = 100;

const CAMPAIGN_TYPES: Record<string, CoopCampaignType> = { SC: 'sc', SCFA: 'scfa', CUSTOM: 'custom' };
const FACTIONS: Record<string, CoopFaction> = {
  UEF: 'uef',
  AEON: 'aeon',
  CYBRAN: 'cybran',
  SERAPHIM: 'seraphim',
  CUSTOM: 'custom',
};

interface Ordered {
  id: string;
  order: number;
}

function byOrder(a: Ordered, b: Ordered): number {
  return a.order - b.order || Number(a.id) - Number(b.id);
}

function toMission(resource: Resource): (CoopMission & Ordered) | null {
  const name = asString(resource.name);
  const folderName = asString(resource.folderName);
  if (!name || !folderName || !isSafeFolderName(folderName)) {
    return null;
  }
  return {
    id: resource.id,
    name,
    description: htmlToText(asString(resource.description) ?? ''),
    version: asNumber(resource.version),
    folderName,
    previewUrl: httpsUrlOrNull(resource.thumbnailUrlSmall),
    previewLargeUrl: httpsUrlOrNull(resource.thumbnailUrlLarge),
    order: asNumber(resource.order) ?? 0,
  };
}

/** Campaigns with their missions, both in their intended order; campaigns without playable missions are left out. */
export function parseCoopScenarios(document: unknown): CoopScenario[] {
  return resolveDocument(document)
    .items.map((scenario) => {
      const missions = (Array.isArray(scenario.maps) ? scenario.maps : [])
        .map((mission) => (asObject(mission) ? toMission(mission as Resource) : null))
        .filter((mission) => mission !== null)
        .sort(byOrder)
        .map(({ order: _order, ...mission }) => mission);
      return {
        id: scenario.id,
        order: asNumber(scenario.order) ?? 0,
        name: asString(scenario.name) ?? '',
        description: htmlToText(asString(scenario.description) ?? ''),
        type: CAMPAIGN_TYPES[asString(scenario.type) ?? ''] ?? null,
        faction: FACTIONS[asString(scenario.faction) ?? ''] ?? null,
        missions,
      };
    })
    .filter((scenario) => scenario.name && scenario.missions.length > 0)
    .sort(byOrder)
    .map(({ order: _order, ...scenario }) => scenario);
}

/**
 * Results sorted by time, keeping the fastest finish of each group of players, as the official client does. Results
 * whose players are unknown are never merged.
 */
export function parseCoopLeaderboard(document: unknown, limit = LEADERBOARD_SIZE): CoopResult[] {
  const seen = new Set<string>();
  const results: CoopResult[] = [];
  for (const item of resolveDocument(document).items) {
    const game = asObject(item.game);
    const replayId = Number(asString(game?.id));
    const durationSeconds = asNumber(item.duration);
    if (!Number.isSafeInteger(replayId) || replayId <= 0 || durationSeconds === null) {
      continue;
    }
    const players = (Array.isArray(game?.playerStats) ? game.playerStats : [])
      .map((stats) => asString(asObject(asObject(stats)?.player)?.login))
      .filter((login) => login !== null);
    const group = players.length > 0 ? players.map((login) => login.toLowerCase()).sort().join('\n') : `#${item.id}`;
    if (seen.has(group)) {
      continue;
    }
    seen.add(group);
    results.push({
      rank: results.length + 1,
      players,
      durationSeconds,
      secondaryObjectives: asBoolean(item.secondaryObjectives),
      endedAt: asString(game?.endTime),
      replayId,
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

export class CoopService {
  private readonly api: FafApi;
  private readonly mods: ModService;
  private readonly games: GameRunner;

  constructor(api: FafApi, mods: ModService, games: GameRunner) {
    this.api = api;
    this.mods = mods;
    this.games = games;
  }

  async scenarios(): Promise<CoopScenario[]> {
    return parseCoopScenarios(
      await this.api.getCached('/data/coopScenario', { include: 'maps', 'page[size]': '1000' }, SCENARIOS_CACHE_MS),
    );
  }

  async leaderboard(missionId: string, playerCount: number): Promise<CoopResult[]> {
    const filters = [rsqlEquals('mission', Number(missionId))];
    if (playerCount > 0) {
      filters.push(rsqlEquals('playerCount', playerCount));
    }
    const params = { filter: rsqlAnd(filters), sort: 'duration', include: 'game.playerStats.player' };
    return parseCoopLeaderboard(await this.api.getAll('/data/coopResult', params, LEADERBOARD_CACHE_MS));
  }

  async host(request: CoopHostRequest): Promise<void> {
    const mission = (await this.scenarios())
      .flatMap((scenario) => scenario.missions)
      .find((candidate) => candidate.id === request.missionId);
    if (!mission) {
      throw new Error(t('main.coop.missionNotFound'));
    }
    // The official client hosts a mission without mods of its own, so whatever mods are active stay active.
    const activeMods = (await this.mods.installed()).filter((mod) => mod.active).map((mod) => mod.uid);
    await this.games.host({
      title: request.title,
      password: request.password,
      featuredMod: COOP_FEATURED_MOD,
      mapFolderName: mission.folderName,
      modUids: activeMods,
      friendsOnly: false,
      ratingMin: null,
      ratingMax: null,
      enforceRatingRange: false,
      modIsolation: false,
      lobbyMode: 'faf',
    });
  }
}
