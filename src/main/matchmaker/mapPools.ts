// Matchmaker queues and their map pools from the FAF API (MatchmakerQueue, MapPoolAssignment), and the rules of map
// vetoes as the official client applies them (TeamMatchmakingMapListController, TeamMatchmakingMapTileController).

import type { MapPoolBracket, MapPoolMap, MatchmakerVeto } from '../../shared/contract.ts';
import { asNumber, asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import { t } from '../i18n.ts';
import { httpsUrlOrNull } from '../info/html.ts';
import { isGeneratedMap } from '../lobby/lobbyProtocol.ts';

/** A queue as the API describes it. */
export interface QueueDefinition {
  id: number;
  name: string;
  teamSize: number;
  leaderboard: string | null;
}

// Queue names of the official client (teammatchmaking.queue.<technicalName>).
const QUEUE_TITLES: Record<string, string> = {
  ladder1v1: '1v1',
  tmm2v2: '2v2',
  tmm3v3: '3v3',
  tmm4v4_full_share: '4v4 Full Share',
  tmm4v4_share_until_death: '4v4 No Share',
};

export function queueTitle(name: string, teamSize: number): string {
  return QUEUE_TITLES[name] ?? `${teamSize}v${teamSize} (${name})`;
}

function toId(value: unknown): number | null {
  const id = typeof value === 'string' ? Number(value) : asNumber(value);
  return id !== null && Number.isInteger(id) && id > 0 ? id : null;
}

export function parseQueueDefinitions(document: unknown): QueueDefinition[] {
  return resolveDocument(document).items.flatMap((resource): QueueDefinition[] => {
    const id = toId(resource.id);
    const name = asString(resource.technicalName);
    if (id === null || !name) {
      return [];
    }
    return [
      {
        id,
        name,
        teamSize: Math.max(1, asNumber(resource.teamSize) ?? 1),
        leaderboard: asString(asObject(resource.leaderboard)?.technicalName),
      },
    ];
  });
}

function toPoolMap(resource: Resource): MapPoolMap | null {
  const assignmentId = toId(resource.id);
  if (assignmentId === null) {
    return null;
  }
  const params = asObject(resource.mapParams);
  if (params && asString(params.type) === 'neroxis') {
    return {
      assignmentId,
      folderName: null,
      displayName: t('main.matchmaker.generatedMap'),
      widthPx: null,
      heightPx: null,
      maxPlayers: asNumber(params.spawns),
      previewUrl: null,
      previewLargeUrl: null,
      generated: { size: asNumber(params.size), spawns: asNumber(params.spawns), version: asString(params.version) },
      vetoTokens: 0,
    };
  }
  const version = asObject(resource.mapVersion);
  const folderName = asString(version?.folderName);
  if (!version || !folderName) {
    return null;
  }
  return {
    assignmentId,
    folderName,
    displayName: asString(asObject(version.map)?.displayName) ?? folderName,
    widthPx: asNumber(version.width),
    heightPx: asNumber(version.height),
    maxPlayers: asNumber(version.maxPlayers),
    previewUrl: isGeneratedMap(folderName) ? null : httpsUrlOrNull(version.thumbnailUrlSmall),
    previewLargeUrl: isGeneratedMap(folderName) ? null : httpsUrlOrNull(version.thumbnailUrlLarge),
    generated: null,
    vetoTokens: 0,
  };
}

const bySize = (a: MapPoolMap, b: MapPoolMap): number =>
  Number(a.generated !== null) - Number(b.generated !== null) ||
  (a.widthPx ?? a.generated?.size ?? 0) - (b.widthPx ?? b.generated?.size ?? 0) ||
  a.displayName.localeCompare(b.displayName);

/** Map pool assignments with `mapPool.matchmakerQueueMapPool` and `mapVersion.map`, grouped into rating brackets. */
export function parseMapPool(document: unknown): MapPoolBracket[] {
  const brackets = new Map<number, MapPoolBracket>();
  for (const resource of resolveDocument(document).items) {
    const bracket = asObject(asObject(resource.mapPool)?.matchmakerQueueMapPool);
    const bracketId = toId(bracket?.id);
    const map = toPoolMap(resource);
    if (!bracket || bracketId === null || !map) {
      continue;
    }
    let entry = brackets.get(bracketId);
    if (!entry) {
      entry = {
        id: bracketId,
        minRating: asNumber(bracket.minRating),
        maxRating: asNumber(bracket.maxRating),
        vetoTokensPerPlayer: Math.max(0, asNumber(bracket.vetoTokensPerPlayer) ?? 0),
        maxTokensPerMap: Math.max(0, asNumber(bracket.maxTokensPerMap) ?? 0),
        maps: [],
      };
      brackets.set(bracketId, entry);
    }
    entry.maps.push(map);
  }
  return [...brackets.values()]
    .map((bracket) => ({ ...bracket, maps: bracket.maps.sort(bySize) }))
    .sort((a, b) => (a.minRating ?? -Infinity) - (b.minRating ?? -Infinity));
}

/** The bracket of a rating: its lower bound below the rating and its upper bound above. */
export function bracketForRating(brackets: MapPoolBracket[], rating: number | null): MapPoolBracket | null {
  if (rating === null) {
    return null;
  }
  return (
    brackets.find(
      (bracket) => (bracket.minRating === null || bracket.minRating < rating) && (bracket.maxRating === null || bracket.maxRating > rating),
    ) ?? null
  );
}

export function withVetoes(brackets: MapPoolBracket[], vetoes: MatchmakerVeto[]): MapPoolBracket[] {
  const tokens = new Map(vetoes.map((veto) => [`${veto.bracketId}:${veto.assignmentId}`, veto.tokens]));
  return brackets.map((bracket) => ({
    ...bracket,
    maps: bracket.maps.map((map) => ({ ...map, vetoTokens: tokens.get(`${bracket.id}:${map.assignmentId}`) ?? 0 })),
  }));
}

/** Why the tokens cannot go on the map; null when they can. */
export function vetoProblem(bracket: MapPoolBracket, vetoes: MatchmakerVeto[], assignmentId: number, tokens: number): string | null {
  if (!bracket.maps.some((map) => map.assignmentId === assignmentId)) {
    return t('main.matchmaker.veto.notInPool');
  }
  if (!Number.isInteger(tokens) || tokens < 0) {
    return t('main.matchmaker.veto.invalidCount');
  }
  if (bracket.maxTokensPerMap > 0 && tokens > bracket.maxTokensPerMap) {
    return t('main.matchmaker.veto.perMapLimit', { max: bracket.maxTokensPerMap });
  }
  const others = vetoes
    .filter((veto) => veto.bracketId === bracket.id && veto.assignmentId !== assignmentId)
    .reduce((sum, veto) => sum + veto.tokens, 0);
  if (others + tokens > bracket.vetoTokensPerPlayer) {
    return t('main.matchmaker.veto.bracketLimit', { max: bracket.vetoTokensPerPlayer });
  }
  return null;
}

/** The vetoes with the tokens of one map replaced; a map without tokens drops out. */
export function applyVeto(vetoes: MatchmakerVeto[], bracketId: number, assignmentId: number, tokens: number): MatchmakerVeto[] {
  const others = vetoes.filter((veto) => veto.bracketId !== bracketId || veto.assignmentId !== assignmentId);
  return tokens > 0 ? [...others, { bracketId, assignmentId, tokens }] : others;
}
