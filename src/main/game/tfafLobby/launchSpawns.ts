// How the game's lobby deals out start positions when a match launches (lobby.lua `AssignRandomStartSpots` and its
// `autobalance_*` helpers), for every `TeamSpawn` but fixed positions and the autobalance. Positions form teams; a
// player without a team stands alone. The players are spread over the teams at random or by rating, and every team,
// renumbered in a random order, becomes team 2, 3 and so on. The order of steps and the use of chance follow the
// game, so that the same rules give the same kind of result; the random numbers themselves are the launcher's.

import type { LobbyAutoTeams, LobbySpot } from '../../../shared/contract.ts';
import { NO_TEAM } from '../../../shared/contract.ts';
import { matchQuality } from '../../../shared/trueskill.ts';

/** The beta of the TrueSkill code of the game's lobby (lua/ui/lobby/trueskill.lua). */
const LOBBY_BETA = 250;
// The game gives every player without a team a team of their own, numbered from here.
const FIRST_SYNTHESIZED_TEAM = 9;
const RANDOM_TRIES = 100;
const RANDOM_KEPT = 3;
const FLEX_QUALITY = 0.95;

export interface SpawnPlayer {
  /** The position the room seated the player on. */
  spot: number;
  team: number;
  mean: number;
  deviation: number;
}

export interface SpawnInput {
  teamSpawn: string;
  /** The automatic teams the game plays with: always `none` on fixed positions. */
  autoTeams: LobbyAutoTeams;
  /** The map's positions in slot order. */
  spots: readonly LobbySpot[];
  closed: ReadonlySet<number>;
  /** With manual automatic teams, the team of each position in slot order. */
  manualTeams: readonly number[];
  players: readonly SpawnPlayer[];
  random: () => number;
}

export interface SpawnResult {
  /** By the position a player was seated on: where the player starts and in which team. */
  seats: Map<number, { spot: number; team: number }>;
  quality: number;
  /** `RandomPositionGroups`, by group in ascending order. */
  positionGroups: number[][];
}

interface Rated {
  pos: number;
  rating: number;
}

interface Placement {
  player: number;
  rating: number;
  team: number;
  slot: number;
}

/** Teams as the game's lobby passes them on after `table.shuffle`: an array of position lists, from team 1. */
type Teams = number[][];

/** A new array in random order, as `table.shuffle` makes one. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

/** `table.binsert`: keeps `list` ordered by `before` and puts an equal item after the ones it equals. */
function binsert<T>(list: T[], item: T, before: (a: T, b: T) => boolean): void {
  let start = 0;
  let stop = list.length - 1;
  let at = 0;
  while (start <= stop) {
    const mid = Math.floor((start + stop) / 2);
    if (before(item, list[mid]!)) {
      stop = mid - 1;
      at = mid;
    } else {
      start = mid + 1;
      at = mid + 1;
    }
  }
  list.splice(at, 0, item);
}

function bestWorst(players: readonly Rated[], teamsArg: Teams): Placement[] {
  const pool = [...players];
  const result: Placement[] = [];
  const teams = teamsArg.map((slots, index) => ({ team: index + 1, slots: [...slots], sum: 0 }));
  let best = true;
  while (pool.length > 0) {
    let placed = false;
    for (const team of teams) {
      const slot = team.slots.shift();
      if (slot === undefined) {
        continue;
      }
      const player = best ? pool.shift() : pool.pop();
      if (!player) {
        break;
      }
      placed = true;
      team.sum += player.rating;
      result.push({ player: player.pos, rating: player.rating, team: team.team, slot });
    }
    if (!placed) {
      break;
    }
    best = !best;
    if (best) {
      teams.sort((a, b) => a.sum - b.sum);
    }
  }
  return result;
}

function average(players: readonly Rated[], teamsArg: Teams): Placement[] {
  const pool = [...players];
  const result: Placement[] = [];
  const teams = teamsArg.map((slots, index) => ({ team: index + 1, slots: [...slots], sum: 0 }));
  let maxSum = 0;
  while (pool.length > 0) {
    let first = true;
    let placed = false;
    for (const team of teams) {
      const slot = team.slots.shift();
      if (slot === undefined) {
        continue;
      }
      // The first player who keeps the team within the strongest one, or else the last.
      let pick = pool.findIndex((candidate) => first || team.sum + candidate.rating <= maxSum);
      if (pick < 0) {
        pick = pool.length - 1;
      }
      const [player] = pool.splice(pick, 1);
      if (!player) {
        break;
      }
      placed = true;
      team.sum += player.rating;
      maxSum = Math.max(maxSum, team.sum);
      result.push({ player: player.pos, rating: player.rating, team: team.team, slot });
      first = false;
    }
    if (!placed) {
      break;
    }
    teams.sort((a, b) => a.sum - b.sum);
  }
  return result;
}

function roundRobin(players: readonly Rated[], teamsArg: Teams): Placement[] {
  const pool = [...players];
  const slots = teamsArg.map((list) => [...list]);
  const result: Placement[] = [];
  const picks = teamsArg.map((_, index) => ({ team: index + 1, sum: index + 1 }));
  while (pool.length > 0) {
    let placed = false;
    for (const [index, pick] of picks.entries()) {
      const slot = slots[pick.team - 1]!.shift();
      if (slot === undefined) {
        continue;
      }
      const player = pool.shift();
      if (!player) {
        break;
      }
      placed = true;
      pick.sum += index + 1;
      result.push({ player: player.pos, rating: player.rating, team: pick.team, slot });
    }
    if (!placed) {
      break;
    }
    picks.sort((a, b) => b.sum - a.sum);
  }
  return result;
}

function randomly(players: readonly Rated[], teamsArg: Teams, random: () => number): Placement[] {
  const pool = shuffled(players, random);
  const result: Placement[] = [];
  const teams = teamsArg.map((slots, index) => ({ team: index + 1, slots: [...slots] }));
  while (pool.length > 0) {
    let placed = false;
    for (const team of teams) {
      const slot = team.slots.shift();
      if (slot === undefined) {
        continue;
      }
      const player = pool.shift();
      if (!player) {
        break;
      }
      placed = true;
      result.push({ player: player.pos, rating: player.rating, team: team.team, slot });
    }
    if (!placed) {
      break;
    }
  }
  return result;
}

/** `autobalance_quality`: the TrueSkill quality of the teams a placement makes, 0 with fewer than two. */
function quality(setup: readonly Placement[], bySpot: ReadonlyMap<number, SpawnPlayer>): number {
  const teams = new Map<number, { mean: number; deviation: number }[]>();
  for (const placement of setup) {
    const player = bySpot.get(placement.player)!;
    teams.set(placement.team, [...(teams.get(placement.team) ?? []), { mean: player.mean, deviation: player.deviation }]);
  }
  return teams.size > 1 ? (matchQuality([...teams.values()], LOBBY_BETA) ?? 0) : 0;
}

/** The mirrored spawn: the n-th strongest of every team takes the position the n-th strongest of the first team takes. */
function mirror(setup: Placement[]): void {
  const byTeam = new Map<number, { byNr: Placement[]; byRating: Placement[] }>();
  let masterTeam: number | null = null;
  for (const placement of setup) {
    let sorted = byTeam.get(placement.team);
    if (!sorted) {
      sorted = { byNr: [], byRating: [] };
      byTeam.set(placement.team, sorted);
    }
    masterTeam ??= placement.team;
    binsert(sorted.byNr, placement, (a, b) => a.slot < b.slot);
    binsert(sorted.byRating, placement, (a, b) => a.rating > b.rating);
  }
  const sizes = new Set([...byTeam.values()].map((sorted) => sorted.byNr.length));
  if (masterTeam === null || sizes.size !== 1) {
    // The game gives up mirroring when the teams differ in size.
    return;
  }
  const master = byTeam.get(masterTeam)!;
  const numbers = new Map(master.byNr.map((placement, index) => [placement.slot, index]));
  const masterOrder = master.byRating.map((placement) => numbers.get(placement.slot)!);
  for (const sorted of byTeam.values()) {
    const slots = masterOrder.map((index) => sorted.byNr[index]!.slot);
    slots.forEach((slot, index) => {
      sorted.byRating[index]!.slot = slot;
    });
  }
}

function sideTeam(spot: LobbySpot | undefined, axis: 'x' | 'y'): number {
  return spot && spot[axis] < 0.5 ? NO_TEAM + 1 : NO_TEAM + 2;
}

/** Where everyone starts; null when the room's positions stay as they are (fixed positions, autobalance). */
export function dealStartSpots({ teamSpawn, autoTeams, spots, closed, manualTeams, players, random }: SpawnInput): SpawnResult | null {
  if (teamSpawn === 'fixed' || teamSpawn === 'penguin_autobalance') {
    return null;
  }
  const bySpot = new Map(players.map((player) => [player.spot, player]));
  const groups = new Map<number, number[]>();
  const teamSpots = new Map<number, number[]>();
  let synthesized = FIRST_SYNTHESIZED_TEAM;
  for (let spot = 1; spot <= spots.length; spot++) {
    if (closed.has(spot)) {
      continue;
    }
    let team: number | null;
    let group: number | null = null;
    switch (autoTeams) {
      case 'lvsr':
        team = sideTeam(spots[spot - 1], 'x');
        break;
      case 'tvsb':
        team = sideTeam(spots[spot - 1], 'y');
        break;
      case 'pvsi':
        team = spot % 2 === 1 ? NO_TEAM + 1 : NO_TEAM + 2;
        break;
      case 'manual':
        team = manualTeams[spot - 1] ?? NO_TEAM;
        break;
      default:
        team = bySpot.get(spot)?.team ?? null;
        group = 1;
    }
    group ??= team!;
    groups.set(group, [...(groups.get(group) ?? []), spot]);
    if (team !== null) {
      if (team === NO_TEAM) {
        team = synthesized++;
      }
      teamSpots.set(team, [...(teamSpots.get(team) ?? []), spot]);
    }
  }
  const positionGroups = [...groups.entries()].sort(([a], [b]) => a - b).map(([, list]) => list);

  const teams: Teams = shuffled(
    [...teamSpots.values()].map((list) => shuffled(list, random)),
    random,
  );
  let ratings: Rated[] = [];
  for (let spot = 1; spot <= spots.length; spot++) {
    const player = bySpot.get(spot);
    if (player) {
      ratings.push({ pos: spot, rating: player.mean - player.deviation * 3 });
    }
  }

  let chosen: { setup: Placement[]; quality: number };
  if (teamSpawn === 'random' || teamSpawn === 'random_reveal') {
    const setup = randomly(ratings, teams, random);
    chosen = { setup, quality: quality(setup, bySpot) };
  } else {
    // A random order among players of the same rating.
    ratings = shuffled(ratings, random).sort((a, b) => b.rating - a.rating);
    const setups: { setup: Placement[]; quality: number }[] = [];
    const better = (a: { quality: number }, b: { quality: number }): boolean => a.quality > b.quality;
    for (const balance of [roundRobin, bestWorst, average]) {
      const setup = balance(ratings, teams);
      binsert(setups, { setup, quality: quality(setup, bySpot) }, better);
    }
    const flex = teamSpawn === 'balanced_flex' || teamSpawn === 'balanced_flex_reveal';
    const threshold = flex ? FLEX_QUALITY : 1;
    let kept = 0;
    for (let attempt = 0; attempt < RANDOM_TRIES; attempt++) {
      const setup = randomly(ratings, teams, random);
      const value = quality(setup, bySpot);
      if (value > setups[0]!.quality * threshold) {
        binsert(setups, { setup, quality: value }, better);
        kept++;
        if (kept >= RANDOM_KEPT) {
          break;
        }
      }
    }
    chosen = (flex ? shuffled(setups, random) : setups)[0]!;
  }

  if (teamSpawn.includes('mirrored')) {
    mirror(chosen.setup);
  }
  const seats = new Map<number, { spot: number; team: number }>();
  for (const placement of chosen.setup) {
    seats.set(placement.player, { spot: placement.slot, team: placement.team + 1 });
  }
  return { seats, quality: chosen.quality, positionGroups };
}
