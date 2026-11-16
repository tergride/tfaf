// The rules of a TFAF lobby room on the host: who sits where and what each player may change. Rooms are immutable: a
// change returns a new room with a higher revision, and a refused one returns the same room.

import {
  LOBBY_LIMITS,
  type LobbyAction,
  type LobbyAutoTeams,
  type LobbyMap,
  type LobbyMember,
  type LobbyOccupant,
  type LobbyOptionValue,
  type LobbyPreset,
  type LobbyResetPart,
  type LobbyRoom,
  type LobbySimMod,
  type LobbySlot,
  LOCKED_LOBBY_OPTIONS,
  NO_TEAM,
} from '../../../shared/contract.ts';
import { factionNumber, isFixedSpawn, randomFaction, slotPlayerId, spotFactions } from '../../../shared/tfafLobby.ts';
import { type BalanceRating, balancedTeams } from './lobbyBalance.ts';

export type NewMember = Pick<LobbyMember, 'id' | 'login' | 'clan' | 'country' | 'rating'> & Partial<Pick<LobbyMember, 'games' | 'mean' | 'deviation'>>;

/** What the host chose last time, for a room that starts the same way. */
export interface RoomMemory {
  options: Record<string, LobbyOptionValue>;
  autoTeams: LobbyAutoTeams;
  /** A faction key, or `random`. */
  faction: string | null;
  color: number | null;
}

export interface NewRoom {
  host: NewMember;
  title: string;
  featuredMod: string;
  /** The faction keys of the featured mod (factionCatalog.ts). */
  factions: string[];
  map: LobbyMap;
  simMods: LobbySimMod[];
  memory?: RoomMemory;
}

// 1 is no team, so the first two teams are 2 and 3.
const FIRST_TEAM = 2;
const SECOND_TEAM = 3;

function emptySlot(spot: number, factions: readonly string[]): LobbySlot {
  return { spot, occupant: null, team: NO_TEAM, faction: randomFaction(factions), color: 0, closed: false, spawnMex: false };
}

function slotsFor(map: LobbyMap, factions: readonly string[]): LobbySlot[] {
  return Array.from({ length: Math.min(map.spots.length, LOBBY_LIMITS.maxSlots) }, (_, index) => emptySlot(index + 1, factions));
}

function freeColor(slots: readonly LobbySlot[]): number {
  const taken = new Set(slots.filter((slot) => slot.occupant !== null).map((slot) => slot.color));
  for (let color = 1; color <= LOBBY_LIMITS.colors; color++) {
    if (!taken.has(color)) {
      return color;
    }
  }
  return 1;
}

function seat(slots: readonly LobbySlot[], spot: number, occupant: LobbyOccupant, kept?: Pick<LobbySlot, 'team' | 'faction' | 'color'>): LobbySlot[] {
  const color = kept?.color || freeColor(slots);
  return slots.map((slot) =>
    slot.spot === spot
      ? { ...slot, occupant, closed: false, spawnMex: false, team: kept?.team ?? slot.team, faction: kept?.faction ?? slot.faction, color }
      : slot,
  );
}

function freeSpot(slots: readonly LobbySlot[]): number | null {
  return slots.find((slot) => slot.occupant === null && !slot.closed)?.spot ?? null;
}

/** The team a start position gives its player while automatic teams are on; the midlines are those of the map preview. */
function autoTeam(room: LobbyRoom, spot: number): number | null {
  const position = room.map.spots[spot - 1];
  switch (room.autoTeams) {
    case 'tvsb':
      return position && position.y < 0.5 ? FIRST_TEAM : SECOND_TEAM;
    case 'lvsr':
      return position && position.x < 0.5 ? FIRST_TEAM : SECOND_TEAM;
    case 'pvsi':
      return spot % 2 === 1 ? FIRST_TEAM : SECOND_TEAM;
    case 'manual':
      return room.manualTeams[spot - 1] ?? NO_TEAM;
    default:
      return null;
  }
}

function withAutoTeams(room: LobbyRoom): LobbyRoom {
  return room.autoTeams === 'none' ? room : { ...room, slots: room.slots.map((slot) => ({ ...slot, team: autoTeam(room, slot.spot) ?? slot.team })) };
}

function revised(room: LobbyRoom, change: Partial<LobbyRoom>): LobbyRoom {
  return withAutoTeams({ ...room, ...change, revision: room.revision + 1 });
}

function memberOf(info: NewMember, hostId: number): LobbyMember {
  return { games: null, mean: null, deviation: null, ...info, ready: info.id === hostId, files: 'preparing', connected: [] };
}

export function createRoom({ host, title, featuredMod, factions, map, simMods, memory }: NewRoom): LobbyRoom {
  const slots = slotsFor(map, factions);
  const spot = slots[0]?.spot ?? null;
  const remembered = memory?.faction ? factionNumber(factions, memory.faction) : null;
  const kept = { team: NO_TEAM, faction: remembered ?? randomFaction(factions), color: memory?.color ?? 0 };
  return withAutoTeams({
    revision: 1,
    hostId: host.id,
    title,
    featuredMod,
    factions,
    phase: 'open',
    map,
    simMods,
    modIsolation: true,
    options: { ...memory?.options, ...LOCKED_LOBBY_OPTIONS },
    restrictions: [],
    rules: '',
    autoTeams: memory?.autoTeams ?? 'none',
    manualTeams: [],
    slots: spot === null ? slots : seat(slots, spot, { kind: 'player', playerId: host.id }, kept),
    members: [memberOf(host, host.id)],
    observers: spot === null ? [host.id] : [],
  });
}

/** A player who came in sits at the first free start position, or watches when none is left. */
export function addMember(room: LobbyRoom, info: NewMember): LobbyRoom {
  if (room.members.some((member) => member.id === info.id)) {
    return room;
  }
  const members = [...room.members, memberOf(info, room.hostId)];
  const spot = freeSpot(room.slots);
  return spot === null
    ? revised(room, { members, observers: [...room.observers, info.id] })
    : revised(room, { members, slots: seat(room.slots, spot, { kind: 'player', playerId: info.id }) });
}

export function removeMember(room: LobbyRoom, id: number): LobbyRoom {
  if (!room.members.some((member) => member.id === id)) {
    return room;
  }
  return revised(room, {
    members: room.members.filter((member) => member.id !== id).map((member) => ({ ...member, connected: member.connected.filter((peer) => peer !== id) })),
    slots: room.slots.map((slot) => (slotPlayerId(slot) === id ? { ...slot, occupant: null } : slot)),
    observers: room.observers.filter((observer) => observer !== id),
  });
}

/** What a player's launcher reports about itself. */
export function updateMember(room: LobbyRoom, id: number, status: Pick<LobbyMember, 'files' | 'connected'>): LobbyRoom {
  const member = room.members.find((candidate) => candidate.id === id);
  if (!member) {
    return room;
  }
  const connected = [...new Set(status.connected)].filter((peer) => peer !== id).sort((a, b) => a - b);
  if (member.files === status.files && member.connected.join() === connected.join()) {
    return room;
  }
  return revised(room, { members: room.members.map((candidate) => (candidate.id === id ? { ...candidate, files: status.files, connected } : candidate)) });
}

/** Everyone looks again before saying they are ready; the host is ready by pressing Start. */
function unready(room: LobbyRoom, ids?: readonly (number | null)[]): LobbyMember[] {
  return room.members.map((member) => (member.id !== room.hostId && (!ids || ids.includes(member.id)) ? { ...member, ready: false } : member));
}

/** The room's files changed: nobody counts as prepared until their launcher says so. */
function notReady(room: LobbyRoom): LobbyMember[] {
  return room.members.map((member) => (member.id === room.hostId ? member : { ...member, ready: false, files: 'preparing' }));
}

/**
 * Another map: players keep their start positions while the map has them, and everyone confirms the new map.
 * `staleOptions` are the options of the old map, which mean nothing on the new one.
 */
export function setMap(room: LobbyRoom, map: LobbyMap, staleOptions: readonly string[] = []): LobbyRoom {
  let slots = slotsFor(map, room.factions);
  const observers = [...room.observers];
  const displaced: LobbySlot[] = [];
  for (const slot of room.slots) {
    if (slot.occupant === null) {
      continue;
    }
    if (slots.some((target) => target.spot === slot.spot)) {
      slots = seat(slots, slot.spot, slot.occupant, slot);
    } else if (slot.occupant.kind === 'player') {
      displaced.push(slot);
    }
  }
  for (const slot of displaced) {
    const spot = freeSpot(slots);
    if (spot === null) {
      observers.push(slotPlayerId(slot)!);
    } else {
      slots = seat(slots, spot, slot.occupant!, slot);
    }
  }
  const options = Object.fromEntries(Object.entries(room.options).filter(([key]) => !staleOptions.includes(key)));
  return revised(room, { map, slots, observers, options, manualTeams: [], members: notReady(room) });
}

export function setMods(room: LobbyRoom, simMods: LobbySimMod[]): LobbyRoom {
  return revised(room, { simMods, members: notReady(room) });
}

export function setPhase(room: LobbyRoom, phase: LobbyRoom['phase']): LobbyRoom {
  return room.phase === phase ? room : revised(room, { phase });
}

/** A faction the map allows on the position. */
function validFaction(room: LobbyRoom, spot: number, faction: number): boolean {
  return spotFactions(room, spot).includes(faction);
}

function validTeam(team: number): boolean {
  return Number.isInteger(team) && team >= NO_TEAM && team <= LOBBY_LIMITS.maxTeam;
}

function validColor(color: number, slots: readonly LobbySlot[], spot: number): boolean {
  return (
    Number.isInteger(color) &&
    color >= 1 &&
    color <= LOBBY_LIMITS.colors &&
    !slots.some((slot) => slot.spot !== spot && slot.occupant !== null && slot.color === color)
  );
}

function withSlot(room: LobbyRoom, spot: number, change: Partial<LobbySlot>): LobbyRoom {
  return revised(room, { slots: room.slots.map((slot) => (slot.spot === spot ? { ...slot, ...change } : slot)) });
}

/** The host changes every occupied slot, a player only their own. */
function changeableSlot(room: LobbyRoom, actorId: number, spot: number): LobbySlot | null {
  const slot = room.slots.find((candidate) => candidate.spot === spot);
  if (!slot?.occupant) {
    return null;
  }
  return actorId === room.hostId || slotPlayerId(slot) === actorId ? slot : null;
}

function takeSpot(room: LobbyRoom, actorId: number, spot: number): LobbyRoom {
  const target = room.slots.find((slot) => slot.spot === spot);
  if (!target || target.occupant !== null || target.closed) {
    return room;
  }
  const current = room.slots.find((slot) => slotPlayerId(slot) === actorId);
  const left = room.slots.map((slot) => (slot === current ? { ...slot, occupant: null } : slot));
  return revised(room, {
    slots: seat(left, spot, { kind: 'player', playerId: actorId }, current),
    observers: room.observers.filter((observer) => observer !== actorId),
  });
}

function observe(room: LobbyRoom, playerId: number): LobbyRoom {
  if (room.observers.includes(playerId)) {
    return room;
  }
  return revised(room, {
    slots: room.slots.map((slot) => (slotPlayerId(slot) === playerId ? { ...slot, occupant: null } : slot)),
    observers: [...room.observers, playerId],
  });
}

function setOption(room: LobbyRoom, key: string, value: LobbyOptionValue | null): LobbyRoom {
  if (Object.hasOwn(LOCKED_LOBBY_OPTIONS, key)) {
    return room;
  }
  const options = { ...room.options };
  if (value === null) {
    delete options[key];
  } else {
    options[key] = value;
  }
  return Object.keys(options).length > LOBBY_LIMITS.maxOptions ? room : revised(room, { options });
}

/** A swap asks both players to look again, as in the game's lobby. */
function swapSpots(room: LobbyRoom, from: number, to: number): LobbyRoom {
  const first = room.slots.find((slot) => slot.spot === from);
  const second = room.slots.find((slot) => slot.spot === to);
  if (!first || !second || from === to || first.closed || second.closed || (first.occupant === null && second.occupant === null)) {
    return room;
  }
  const seatedAs = (slot: LobbySlot, source: LobbySlot): LobbySlot => ({
    ...slot,
    occupant: source.occupant,
    team: source.team,
    faction: source.faction,
    color: source.color,
  });
  return revised(room, {
    slots: room.slots.map((slot) => (slot.spot === from ? seatedAs(slot, second) : slot.spot === to ? seatedAs(slot, first) : slot)),
    members: unready(room, [slotPlayerId(first), slotPlayerId(second)]),
  });
}

function fillAi(room: LobbyRoom, personality: string, name: string): LobbyRoom {
  const free = room.slots.filter((slot) => slot.occupant === null && !slot.closed);
  if (free.length === 0) {
    return room;
  }
  return revised(room, { slots: free.reduce((slots, slot) => seat(slots, slot.spot, { kind: 'ai', personality, name }), room.slots) });
}

function clearAi(room: LobbyRoom): LobbyRoom {
  return room.slots.some((slot) => slot.occupant?.kind === 'ai')
    ? revised(room, { slots: room.slots.map((slot) => (slot.occupant?.kind === 'ai' ? { ...slot, occupant: null } : slot)) })
    : room;
}

function closeEmptySpots(room: LobbyRoom): LobbyRoom {
  const empty = room.slots.filter((slot) => slot.occupant === null && !slot.spawnMex);
  if (empty.length === 0) {
    return room;
  }
  const closing = empty.some((slot) => !slot.closed);
  return revised(room, { slots: room.slots.map((slot) => (empty.includes(slot) ? { ...slot, closed: closing } : slot)) });
}

/** The players in slot order into `teams` equal teams; those left over play without a team. */
function splitTeams(room: LobbyRoom, teams: number): LobbyRoom {
  const seated = room.slots.filter((slot) => slot.occupant !== null).length;
  const perTeam = teams > 0 ? Math.floor(seated / teams) : 0;
  let team = FIRST_TEAM;
  let onTeam = 0;
  const slots = room.slots.map((slot) => {
    if (slot.occupant === null) {
      return slot;
    }
    if (team > teams + 1) {
      return { ...slot, team: NO_TEAM };
    }
    const placed = { ...slot, team };
    onTeam++;
    if (onTeam >= perTeam) {
      team++;
      onTeam = 0;
    }
    return placed;
  });
  return revised(room, { slots, autoTeams: 'none', manualTeams: [] });
}

function setAutoTeams(room: LobbyRoom, mode: LobbyAutoTeams): LobbyRoom {
  if (room.autoTeams === mode) {
    return room;
  }
  return revised(room, { autoTeams: mode, manualTeams: mode === 'manual' ? room.slots.map((slot) => slot.team) : [] });
}

function cycleManualTeam(room: LobbyRoom, spot: number): LobbyRoom {
  const target = room.slots.find((slot) => slot.spot === spot);
  if (room.autoTeams !== 'manual' || !target || target.closed) {
    return room;
  }
  const team = room.manualTeams[spot - 1] ?? NO_TEAM;
  const next = team >= LOBBY_LIMITS.maxManualTeam ? FIRST_TEAM : team + 1;
  return revised(room, { manualTeams: room.slots.map((slot) => (slot.spot === spot ? next : (room.manualTeams[slot.spot - 1] ?? NO_TEAM))) });
}

/** Whoever does not fit into two equal teams: the last seated player, when their number is odd. */
function leftOver(seated: readonly LobbySlot[]): LobbySlot | null {
  return seated.length % 2 === 1 ? seated[seated.length - 1]! : null;
}

/**
 * Two equal teams of about the same strength, on the positions they already hold or, with automatic teams, on those of
 * the two sides. Positions that cannot hold two equal teams fall back to manual teams, as in the game's lobby.
 */
function autobalance(room: LobbyRoom, aiRatings: Readonly<Record<string, number>>): LobbyRoom {
  const seated = room.slots.filter((slot) => slot.occupant !== null);
  if (seated.length < 2) {
    return room;
  }
  const options = isFixedSpawn(room.options) || room.options.TeamSpawn === 'penguin_autobalance' ? room.options : { ...room.options, TeamSpawn: 'fixed' };
  const extra = leftOver(seated);
  const balanced = seated.filter((slot) => slot !== extra);
  const teamSize = balanced.length / 2;
  const spotsOf = (slots: readonly LobbySlot[], team: number): number[] => slots.filter((slot) => slot.team === team).map((slot) => slot.spot);

  let autoTeams = room.autoTeams === 'manual' ? 'none' : room.autoTeams;
  let firstSpots: number[] = [];
  let secondSpots: number[] = [];
  if (autoTeams !== 'none') {
    const open = room.slots.filter((slot) => !slot.closed);
    firstSpots = spotsOf(open, FIRST_TEAM);
    secondSpots = spotsOf(open, SECOND_TEAM);
    autoTeams = firstSpots.length < teamSize || secondSpots.length < teamSize ? 'none' : autoTeams;
  }
  if (autoTeams === 'none') {
    firstSpots = spotsOf(balanced, FIRST_TEAM);
    secondSpots = spotsOf(balanced, SECOND_TEAM);
    if (firstSpots.length !== teamSize || secondSpots.length !== teamSize) {
      firstSpots = balanced.filter((_, index) => index % 2 === 0).map((slot) => slot.spot);
      secondSpots = balanced.filter((_, index) => index % 2 === 1).map((slot) => slot.spot);
    }
  }

  const ratings = balanced.map((slot): BalanceRating => {
    if (slot.occupant?.kind === 'ai') {
      return { mean: aiRatings[slot.occupant.personality] ?? 0, deviation: 0 };
    }
    const member = room.members.find((candidate) => candidate.id === slotPlayerId(slot));
    return { mean: member?.mean ?? 0, deviation: member?.deviation ?? 0 };
  });
  const [firstTeam, secondTeam] = balancedTeams(ratings);
  const placed = new Map<number, { source: LobbySlot; team: number }>();
  firstTeam.forEach((index, order) => placed.set(firstSpots[order]!, { source: balanced[index]!, team: FIRST_TEAM }));
  secondTeam.forEach((index, order) => placed.set(secondSpots[order]!, { source: balanced[index]!, team: SECOND_TEAM }));

  const keepsSeat = extra !== null && room.autoTeams === 'none' && isFixedSpawn(options);
  const slots = room.slots.map((slot): LobbySlot => {
    const seating = placed.get(slot.spot);
    if (seating) {
      const { occupant, faction, color } = seating.source;
      return { ...slot, occupant, faction, color, team: seating.team };
    }
    if (slot === extra && keepsSeat) {
      return { ...slot, team: NO_TEAM };
    }
    return { ...slot, occupant: null };
  });
  const watcher = !keepsSeat && extra ? slotPlayerId(extra) : null;
  return revised(room, {
    options,
    autoTeams,
    manualTeams: [],
    slots,
    observers: watcher === null ? room.observers : [...room.observers, watcher],
    members: unready(room),
  });
}

/** An AI leaves the position it stood on, whichever state the host gives it. */
function closeSpot(room: LobbyRoom, spot: number, closed: boolean, spawnMex: boolean): LobbyRoom {
  const slot = room.slots.find((candidate) => candidate.spot === spot);
  const mex = closed && spawnMex && room.map.adaptive;
  if (slot?.occupant?.kind === 'ai') {
    return withSlot(room, spot, { occupant: null, closed, spawnMex: mex });
  }
  return slot && slot.occupant === null && (slot.closed !== closed || slot.spawnMex !== mex) ? withSlot(room, spot, { closed, spawnMex: mex }) : room;
}

/** A reset of any part asks everyone to look again, like a new map. */
function resetOptions(room: LobbyRoom, part: LobbyResetPart | undefined): LobbyRoom {
  const members = unready(room);
  switch (part) {
    case 'options':
      return revised(room, { options: { ...LOCKED_LOBBY_OPTIONS }, members });
    case 'restrictions':
      return revised(room, { restrictions: [], members });
    default:
      return revised(room, { options: { ...LOCKED_LOBBY_OPTIONS }, restrictions: [], autoTeams: 'none', manualTeams: [], members });
  }
}

function hostAction(room: LobbyRoom, action: LobbyAction): LobbyRoom {
  switch (action.type) {
    case 'setOption':
      return setOption(room, action.key, action.value);
    case 'setRestrictions':
      return revised(room, { restrictions: [...new Set(action.restrictions)] });
    case 'resetOptions':
      return resetOptions(room, action.part);
    case 'setTitle':
      return revised(room, { title: action.title });
    case 'setRules':
      return revised(room, { rules: action.rules });
    case 'addAi': {
      const slot = room.slots.find((candidate) => candidate.spot === action.spot);
      const ai: LobbyOccupant = { kind: 'ai', personality: action.personality, name: action.name };
      if (slot?.occupant?.kind === 'ai') {
        return withSlot(room, action.spot, { occupant: ai });
      }
      return slot && slot.occupant === null ? revised(room, { slots: seat(room.slots, action.spot, ai) }) : room;
    }
    case 'fillAi':
      return fillAi(room, action.personality, action.name);
    case 'clearAi':
      return clearAi(room);
    case 'clearSpot': {
      const slot = room.slots.find((candidate) => candidate.spot === action.spot);
      if (slot?.occupant?.kind === 'ai') {
        return withSlot(room, action.spot, { occupant: null });
      }
      return slot?.occupant?.kind === 'player' ? observe(room, slot.occupant.playerId) : room;
    }
    case 'closeSpot':
      return closeSpot(room, action.spot, action.closed, action.spawnMex === true);
    case 'closeEmptySpots':
      return closeEmptySpots(room);
    case 'swapSpots':
      return swapSpots(room, action.from, action.to);
    case 'splitTeams':
      return splitTeams(room, action.teams);
    case 'setAutoTeams':
      return setAutoTeams(room, action.mode);
    case 'cycleManualTeam':
      return cycleManualTeam(room, action.spot);
    case 'autobalance':
      return autobalance(room, action.aiRatings);
    default:
      return room;
  }
}

/** Someone who said they are ready stays as they are until they take it back, as in the game's lobby. */
function isHeldByReady(room: LobbyRoom, actorId: number): boolean {
  return actorId !== room.hostId && room.members.some((member) => member.id === actorId && member.ready);
}

/**
 * Applies what a member asked for; the host's launcher runs this for itself and for every player. A refused action
 * returns the same room. `setMap`, `setMods` and `kick` need more than the room and are the session's.
 */
export function applyAction(room: LobbyRoom, actorId: number, action: LobbyAction): LobbyRoom {
  if (room.phase !== 'open' || !room.members.some((member) => member.id === actorId)) {
    return room;
  }
  const held = isHeldByReady(room, actorId);
  switch (action.type) {
    case 'setReady':
      return revised(room, { members: room.members.map((member) => (member.id === actorId ? { ...member, ready: action.ready } : member)) });
    case 'takeSpot':
      return held ? room : takeSpot(room, actorId, action.spot);
    case 'observe':
      return held ? room : observe(room, actorId);
    case 'setFaction':
      return !held && validFaction(room, action.spot, action.faction) && changeableSlot(room, actorId, action.spot) ? withSlot(room, action.spot, { faction: action.faction }) : room;
    case 'setTeam':
      return !held && room.autoTeams === 'none' && validTeam(action.team) && changeableSlot(room, actorId, action.spot)
        ? withSlot(room, action.spot, { team: action.team })
        : room;
    case 'setColor':
      return !held && validColor(action.color, room.slots, action.spot) && changeableSlot(room, actorId, action.spot)
        ? withSlot(room, action.spot, { color: action.color })
        : room;
    default:
      return actorId === room.hostId ? hostAction(room, action) : room;
  }
}

/** The game settings of the room. `mapOptions` are the options of its map, which mean nothing on another one. */
export function presetOf(room: LobbyRoom, id: string, name: string, mapOptions: readonly string[] = []): LobbyPreset {
  const options = Object.fromEntries(Object.entries(room.options).filter(([key]) => !Object.hasOwn(LOCKED_LOBBY_OPTIONS, key) && !mapOptions.includes(key)));
  return { id, name, simMods: room.simMods, options, restrictions: room.restrictions };
}

/** Gives the room saved game settings; the map, its options and everything about the positions stay as they are. */
export function applyPreset(room: LobbyRoom, preset: LobbyPreset, simMods: LobbySimMod[], mapOptions: readonly string[]): LobbyRoom {
  const ownOptions = Object.fromEntries(Object.entries(room.options).filter(([key]) => mapOptions.includes(key)));
  return revised(setMods(room, simMods), {
    options: { ...preset.options, ...ownOptions, ...LOCKED_LOBBY_OPTIONS },
    restrictions: preset.restrictions,
  });
}
