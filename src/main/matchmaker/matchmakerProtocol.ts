// Matchmaker and party messages of the FAF lobby server (MatchmakerApi of faf-java-commons). Everything received is
// narrowed before use.

import { MATCHMAKER_FACTIONS, type MatchmakerFaction, type MatchmakerVeto } from '../../shared/contract.ts';
import { asNumber, asObject, asString } from '../api/jsonApi.ts';
import type { LobbyMessage } from '../lobby/lobbyProtocol.ts';

/** A queue as `matchmaker_info` reports it. */
export interface QueueInfo {
  name: string;
  teamSize: number;
  playersInQueue: number;
  /** When the queue next matches players; taken from the time left, so the computer's clock does not matter. */
  popAt: string | null;
}

export interface PartyInfo {
  owner: number;
  members: { playerId: number; factions: MatchmakerFaction[] }[];
}

const FACTIONS_BY_NUMBER: (MatchmakerFaction | null)[] = [null, 'uef', 'aeon', 'cybran', 'seraphim'];
const QUEUE_NAME = /^[\w-]{1,100}$/;

export function parseFactions(value: unknown): MatchmakerFaction[] {
  const factions = (Array.isArray(value) ? value : []).map((entry) =>
    typeof entry === 'number' ? FACTIONS_BY_NUMBER[entry] : MATCHMAKER_FACTIONS.find((faction) => faction === asString(entry)?.toLowerCase()),
  );
  return MATCHMAKER_FACTIONS.filter((faction) => factions.includes(faction));
}

function queueName(value: unknown): string | null {
  const name = asString(value);
  return name && QUEUE_NAME.test(name) ? name : null;
}

export function parseMatchmakerInfo(message: LobbyMessage, now = Date.now()): QueueInfo[] {
  return (Array.isArray(message.queues) ? message.queues : []).flatMap((entry): QueueInfo[] => {
    const raw = asObject(entry);
    const name = queueName(raw?.queue_name);
    if (!raw || !name) {
      return [];
    }
    const delta = asNumber(raw.queue_pop_time_delta);
    const popTime = asString(raw.queue_pop_time);
    const popAt =
      delta !== null && delta >= 0
        ? new Date(now + delta * 1000).toISOString()
        : popTime && !Number.isNaN(Date.parse(popTime))
          ? new Date(popTime).toISOString()
          : null;
    return [
      {
        name,
        teamSize: Math.max(1, asNumber(raw.team_size) ?? 1),
        playersInQueue: Math.max(0, asNumber(raw.num_players) ?? 0),
        popAt,
      },
    ];
  });
}

export function parseSearchInfo(message: LobbyMessage): { queue: string; searching: boolean } | null {
  const queue = queueName(message.queue_name);
  const state = asString(message.state);
  return queue && (state === 'start' || state === 'stop') ? { queue, searching: state === 'start' } : null;
}

export function parseMatchFound(message: LobbyMessage): string | null {
  return queueName(message.queue_name);
}

export function parsePartyInfo(message: LobbyMessage): PartyInfo | null {
  const owner = asNumber(message.owner);
  if (owner === null) {
    return null;
  }
  const members = (Array.isArray(message.members) ? message.members : []).flatMap((entry) => {
    const raw = asObject(entry);
    const playerId = asNumber(raw?.player);
    return playerId === null ? [] : [{ playerId, factions: parseFactions(raw?.factions) }];
  });
  return { owner, members };
}

export function parsePartyInvite(message: LobbyMessage): number | null {
  return asNumber(message.sender);
}

export function parseVetoesInfo(message: LobbyMessage): { vetoes: MatchmakerVeto[]; forced: boolean } {
  const vetoes = (Array.isArray(message.vetoes) ? message.vetoes : []).flatMap((entry): MatchmakerVeto[] => {
    const raw = asObject(entry);
    const bracketId = asNumber(raw?.matchmaker_queue_map_pool_id);
    const assignmentId = asNumber(raw?.map_pool_map_version_id);
    const tokens = asNumber(raw?.veto_tokens_applied);
    return bracketId !== null && assignmentId !== null && tokens !== null && tokens > 0
      ? [{ bracketId, assignmentId, tokens }]
      : [];
  });
  return { vetoes, forced: message.forced === true };
}

export function vetoesMessage(vetoes: MatchmakerVeto[]): LobbyMessage {
  return {
    command: 'set_player_vetoes',
    vetoes: vetoes.map((veto) => ({
      map_pool_map_version_id: veto.assignmentId,
      veto_tokens_applied: veto.tokens,
      matchmaker_queue_map_pool_id: veto.bracketId,
    })),
  };
}

/** The chat channel of a party, as the official client names it (ChatService.PARTY_CHANNEL_SUFFIX). */
export function partyChannelName(ownerLogin: string): string {
  return `#${ownerLogin}'sParty`;
}
