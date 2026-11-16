// The match a start of a TFAF lobby plays, settled by the host's launcher the way the game's lobby settles it when it
// launches (lobby.lua `TryLaunch`): random factions, start positions dealt out by `TeamSpawn`, the names of AIs, the
// default of every option and what the score screen and the simulation read. Every game then plays the same match
// out (roomLaunchScript.ts), and every launcher can show it before the games load.

import { createHash, randomInt } from 'node:crypto';
import type { LobbyLaunch, LobbyLaunchArmy, LobbyOptionValue, LobbyRoom, LobbySlot } from '../../../shared/contract.ts';
import { LOCKED_LOBBY_OPTIONS, NO_TEAM } from '../../../shared/contract.ts';
import { isFixedSpawn } from '../../../shared/tfafLobby.ts';
import type { AiRating, LaunchCatalog } from '../../gameOptions/launchCatalog.ts';
import { lobbyServerTitle } from './lobbyAccess.ts';
import { applyAction } from './lobbyRoom.ts';
import { dealStartSpots } from './launchSpawns.ts';

const MIN_AI_MAP = 256;
const MAX_AI_MAP = 4096;
// Ratings of players the host knows nothing about, as TrueSkill starts everyone.
const UNKNOWN_MEAN = 1500;
const UNKNOWN_DEVIATION = 500;

// randomInt takes a range below 2 ** 48.
const RANDOM_RANGE = 2 ** 47;

/** A number from 0 up to 1 from the system's source of randomness. */
export function secureRandom(): number {
  return randomInt(0, RANDOM_RANGE) / RANDOM_RANGE;
}

/** `tonumber(value) or 1.0`. */
function multiplierOption(value: LobbyOptionValue | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : 1;
}

/** `ComputeAIRating`: an AI's base rating, weighed by the map and its cheats. */
export function computeAiRating(ai: AiRating | undefined, options: Readonly<Record<string, LobbyOptionValue>>, mapSize: number | null): number {
  if (!ai || ai.rating === null || mapSize === null) {
    return 0;
  }
  const area = Math.min(MAX_AI_MAP, Math.max(MIN_AI_MAP, mapSize));
  const build = ai.buildMultiplier * (multiplierOption(options.BuildMult) - 1);
  const cheat = ai.cheatMultiplier * (multiplierOption(options.CheatMult) - 1);
  const omni = options.OmniCheat === 'on' ? ai.omniBonus : 0;
  let rating = (ai.mapMultiplier.get(area) ?? 1) * (ai.rating + build + cheat + omni);
  if (ai.negativeThreshold !== null && rating < ai.negativeThreshold) {
    rating = ai.negativeThreshold + (rating - ai.negativeThreshold) * 0.2;
  }
  return Math.floor(rating);
}

/** The options the match plays with: the game's defaults, what the room changed and what a room always plays with. */
function matchOptions(room: LobbyRoom, catalog: LaunchCatalog): Record<string, LobbyOptionValue> {
  const options: Record<string, LobbyOptionValue> = {
    ...catalog.defaults,
    ...room.options,
    // On fixed positions the room has settled the teams; the game's automatic teams measure its own map preview.
    AutoTeams: isFixedSpawn(room.options) ? 'none' : room.autoTeams,
    ScenarioFile: room.map.scenario,
    // The server knows the game by this title, and the game tells it the title of its options.
    Title: lobbyServerTitle(room.title),
    ...(room.rules ? { GameRules: room.rules } : {}),
    ...LOCKED_LOBBY_OPTIONS,
  };
  if (room.observers.length > 0) {
    options.AllowObservers = true;
  }
  return options;
}

/** Teams that fight each other: every player without a team counts as one, as `TryLaunch` counts them. */
function teamCount(slots: readonly LobbySlot[]): number {
  const teams = new Set<number>();
  let alone = 0;
  for (const slot of slots) {
    if (slot.occupant === null) {
      continue;
    }
    if (slot.team === NO_TEAM) {
      alone++;
    } else {
      teams.add(slot.team);
    }
  }
  return teams.size + alone;
}

/** The faction a seat plays: the room's choice, or a random one of those the map allows there. */
function resolvedFaction(slot: LobbySlot, room: LobbyRoom, factions: readonly string[], random: () => number): number {
  const allowed = room.map.spots[slot.spot - 1]?.factions?.filter((key) => factions.includes(key)) ?? [];
  const choices = allowed.length > 0 ? allowed : factions;
  const chosen = factions[slot.faction - 1];
  if (chosen !== undefined && choices.includes(chosen)) {
    return slot.faction;
  }
  return factions.indexOf(choices[Math.floor(random() * choices.length)]!) + 1;
}

/** `AssignAINames`: a name of the AI's faction nobody else has, before its type. */
function nameAis(armies: LobbyLaunchArmy[], catalog: LaunchCatalog, random: () => number): void {
  const taken = new Map<string, Set<number>>();
  for (const army of armies) {
    if (army.ai === null) {
      continue;
    }
    const key = catalog.factions[army.faction - 1] ?? '';
    const names = catalog.aiNames.get(key) ?? [];
    const used = taken.get(key) ?? new Set<number>();
    taken.set(key, used);
    const free = names.map((_, index) => index).filter((index) => !used.has(index));
    if (free.length === 0) {
      continue;
    }
    const pick = free[Math.floor(random() * free.length)]!;
    used.add(pick);
    army.name = `${names[pick]!} (${army.name})`;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** sha256 of the launch without its digest, the same in every launcher for the same launch. */
export function launchDigest(launch: Omit<LobbyLaunch, 'digest'>): string {
  const { digest: _digest, ...rest } = launch as LobbyLaunch;
  return createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex');
}

/** Settles the match of the room's start. `random` is there for tests. */
export function resolveLaunch(room: LobbyRoom, catalog: LaunchCatalog, random: () => number = secureRandom): LobbyLaunch {
  let options = matchOptions(room, catalog);
  if (options.TeamSpawn === 'penguin_autobalance') {
    const aiRatings = Object.fromEntries([...catalog.aiRatings].map(([key, ai]) => [key, ai.rating ?? 0]));
    room = applyAction({ ...room, phase: 'open' }, room.hostId, { type: 'autobalance', aiRatings });
    options = matchOptions(room, catalog);
  }
  if (options.Victory !== 'sandbox' && teamCount(room.slots) < 2) {
    options.Victory = 'sandbox';
  }

  const armies: LobbyLaunchArmy[] = [];
  for (const slot of room.slots) {
    const occupant = slot.occupant;
    if (occupant === null) {
      continue;
    }
    const faction = resolvedFaction(slot, room, catalog.factions, random);
    const seat = { spot: slot.spot, faction, team: slot.team, color: slot.color };
    if (occupant.kind === 'ai') {
      const rating = computeAiRating(catalog.aiRatings.get(occupant.personality), options, catalog.mapSize);
      armies.push({
        ...seat,
        playerId: null,
        name: occupant.name,
        lobbyName: occupant.name,
        ai: occupant.personality,
        mean: rating,
        deviation: 0,
        rating,
        games: 0,
        clan: '',
        country: null,
      });
      continue;
    }
    const member = room.members.find((candidate) => candidate.id === occupant.playerId);
    const login = member?.login ?? String(occupant.playerId);
    armies.push({
      ...seat,
      playerId: occupant.playerId,
      name: login,
      lobbyName: login,
      ai: null,
      mean: member?.mean ?? UNKNOWN_MEAN,
      deviation: member?.deviation ?? UNKNOWN_DEVIATION,
      rating: member?.rating ?? 0,
      games: member?.games ?? 0,
      clan: member?.clan ?? '',
      country: member?.country ?? null,
    });
  }

  const dealt = dealStartSpots({
    teamSpawn: String(options.TeamSpawn ?? 'fixed'),
    autoTeams: isFixedSpawn(room.options) ? 'none' : room.autoTeams,
    spots: room.map.spots,
    closed: new Set(room.slots.filter((slot) => slot.closed).map((slot) => slot.spot)),
    manualTeams: room.manualTeams,
    players: armies.map(({ spot, team, mean, deviation }) => ({ spot, team, mean, deviation })),
    random,
  });
  if (dealt) {
    options.Quality = dealt.quality;
    for (const army of armies) {
      const seat = dealt.seats.get(army.spot);
      if (seat) {
        army.spot = seat.spot;
        army.team = seat.team;
      }
    }
    armies.sort((a, b) => a.spot - b.spot);
  }
  nameAis(armies, catalog, random);

  const launch: Omit<LobbyLaunch, 'digest'> = {
    featuredMod: room.featuredMod,
    factions: [...catalog.factions],
    options,
    restrictions: [...room.restrictions],
    spawnMex: room.map.adaptive ? room.slots.filter((slot) => slot.closed && slot.spawnMex).map((slot) => slot.spot) : null,
    positionGroups: dealt?.positionGroups ?? null,
    armies,
    observers: room.observers.map((playerId) => ({ playerId, name: room.members.find((member) => member.id === playerId)?.login ?? String(playerId) })),
    simMods: room.simMods.map((mod) => mod.uid),
  };
  return { ...launch, digest: launchDigest(launch) };
}
