// Rules of the TFAF lobby that both sides need: the renderer explains why Start is off, the main process enforces it.

import type { GameFilesReport } from './contract/game.ts';
import { LOBBY_LIMITS, type LobbyAction, type LobbyMember, type LobbyOptionValue, type LobbyRoom, type LobbySlot, type LobbyStartBlocker, NO_TEAM } from './contract/tfafLobby.ts';
import { matchQuality, type SkillRating } from './trueskill.ts';

/** The shortest time between two spot changes of one member. */
export const SPOT_CHANGE_INTERVAL_MS = 1000;

/** The key a launcher remembers the random faction by. */
export const RANDOM_FACTION = 'random';

/** The number of the random faction: the one after the factions of the featured mod, as in the game's lobby. */
export function randomFaction(factions: readonly string[]): number {
  return factions.length + 1;
}

export function factionKey(factions: readonly string[], faction: number): string | null {
  return faction === randomFaction(factions) ? RANDOM_FACTION : (factions[faction - 1] ?? null);
}

export function factionNumber(factions: readonly string[], key: string): number | null {
  if (key === RANDOM_FACTION) {
    return randomFaction(factions);
  }
  const index = factions.indexOf(key);
  return index < 0 ? null : index + 1;
}

/**
 * The factions a seat may take on the room's map: those the map allows on the position, or all of them, and the
 * random one when there are two or more to choose from.
 */
export function spotFactions(
  room: { readonly factions: readonly string[]; readonly map: { readonly spots: readonly { readonly factions?: readonly string[] }[] } },
  spot: number,
): number[] {
  const allowed = room.map.spots[spot - 1]?.factions;
  const numbers = (allowed ? allowed.map((key) => factionNumber(room.factions, key)).filter((number) => number !== null) : []).filter(
    (number) => number !== randomFaction(room.factions),
  );
  const choices = numbers.length > 0 ? numbers : room.factions.map((_, index) => index + 1);
  return choices.length > 1 ? [...choices, randomFaction(room.factions)] : choices;
}

/** Players start where the room seats them; every other `TeamSpawn` deals the positions out when the game starts. */
export function isFixedSpawn(options: Readonly<Record<string, LobbyOptionValue>>): boolean {
  return (options.TeamSpawn ?? 'fixed') === 'fixed';
}

/**
 * The game's "game quality": only for two sides of rated players on positions that stay. The players without a team
 * each stand alone.
 */
export function roomQuality(room: LobbyRoom): number | null {
  if (!isFixedSpawn(room.options)) {
    return null;
  }
  const sides = new Map<number, SkillRating[]>();
  const alone: SkillRating[][] = [];
  for (const slot of room.slots) {
    if (slot.occupant === null) {
      continue;
    }
    const id = slotPlayerId(slot);
    const member = room.members.find((candidate) => candidate.id === id);
    if (member?.mean == null || member.deviation == null) {
      return null;
    }
    const rating = { mean: member.mean, deviation: member.deviation };
    if (slot.team === NO_TEAM) {
      alone.push([rating]);
    } else {
      sides.set(slot.team, [...(sides.get(slot.team) ?? []), rating]);
    }
  }
  const all = [...sides.values(), ...alone];
  return all.length === 2 ? matchQuality(all) : null;
}

/** The simulation pastes a restriction into a category expression, so a key has to be one word. */
export function isRestrictionKey(key: string): boolean {
  return key.length <= LOBBY_LIMITS.maxRestrictionLength && /^\w+$/.test(key);
}

export function slotPlayerId(slot: LobbySlot): number | null {
  return slot.occupant?.kind === 'player' ? slot.occupant.playerId : null;
}

/** Actions that move someone between the start positions and the observers. */
export function isSpotChange(action: LobbyAction): boolean {
  return action.type === 'takeSpot' || action.type === 'observe' || action.type === 'swapSpots';
}

/** Members who take part: seated players and observers alike must be connected and hold the files. */
function others(room: LobbyRoom): LobbyMember[] {
  return room.members.filter((member) => member.id !== room.hostId);
}

function connectedToAll(room: LobbyRoom, member: LobbyMember): boolean {
  return room.members
    .filter((other) => other.id !== member.id)
    .every((other) => member.connected.includes(other.id) && other.connected.includes(member.id));
}

/**
 * What keeps the host from starting. `files` is the comparison with the host's files; a part a player has not reported
 * yet counts as unknown, not as different, since the player's own check is what `LobbyMember.files` tells.
 * `unsupported`: the code of the host's game TFAF has not been checked against.
 */
export function startBlockers(room: LobbyRoom, files: GameFilesReport | null, unsupported: readonly string[] = []): LobbyStartBlocker[] {
  const blockers: LobbyStartBlocker[] = [];
  if (unsupported.length > 0) {
    blockers.push({ kind: 'unsupportedGame', changes: [...unsupported] });
  }
  const seated = room.slots.some((slot) => slot.occupant !== null);
  if (!seated) {
    blockers.push({ kind: 'noPlayers' });
  }
  const logins = (members: LobbyMember[]): string[] => members.map((member) => member.login);
  const unready = others(room).filter((member) => !member.ready);
  if (unready.length > 0) {
    blockers.push({ kind: 'notReady', logins: logins(unready) });
  }
  const unprepared = room.members.filter((member) => member.files !== 'ready');
  if (unprepared.length > 0) {
    blockers.push({ kind: 'files', logins: logins(unprepared) });
  }
  const differing = (files?.players ?? []).filter(
    (player) => player.gameFiles === 'different' || player.map === 'different' || player.mods === 'different',
  );
  if (differing.length > 0) {
    blockers.push({ kind: 'filesDiffer', logins: differing.map((player) => player.login) });
  }
  const unconnected = room.members.filter((member) => !connectedToAll(room, member));
  if (unconnected.length > 0) {
    blockers.push({ kind: 'connection', logins: logins(unconnected) });
  }
  return blockers;
}
