// What the FAF server learns about a TFAF lobby. No game runs yet, so the host's launcher says what the game's lobby
// would (`lobby.lua`): the game list then shows the room's map, mods and players like those of any open game.

import type { LobbyLaunch, LobbyOptionValue, LobbyRoom, LobbySlot } from '../../../shared/contract.ts';
import { slotPlayerId } from '../../../shared/tfafLobby.ts';
import { lobbyServerTitle } from './lobbyAccess.ts';

export interface GameMessage {
  command: string;
  args: unknown[];
}

function optionMessages(room: LobbyRoom): GameMessage[] {
  const options: [string, LobbyOptionValue][] = [
    ['ScenarioFile', room.map.scenario],
    ['Slots', room.slots.filter((slot) => !slot.closed).length],
    ['Title', lobbyServerTitle(room.title)],
    ['GameRules', room.rules],
    // Whether there are any, as the game's lobby tells it; the list itself stays between the games.
    ['RestrictedCategories', room.restrictions.length > 0],
    ...Object.entries(room.options),
  ];
  return options.map(([key, value]) => ({ command: 'GameOption', args: [key, value] }));
}

function modMessages(room: LobbyRoom): GameMessage[] {
  const uids = room.simMods.map((mod) => mod.uid);
  return [
    { command: 'GameMods', args: ['activated', uids.length] },
    ...(uids.length > 0 ? [{ command: 'GameMods', args: ['uids', uids.join(' ')] }] : []),
  ];
}

function slotMessages(slot: LobbySlot, army: number): GameMessage[] {
  const occupant = slot.occupant;
  if (occupant === null) {
    return [];
  }
  const values: [string, number][] = [
    ['Faction', slot.faction],
    ['Color', slot.color],
    ['Team', slot.team],
    ['StartSpot', slot.spot],
    ['Army', army],
  ];
  return values.map(([key, value]) =>
    occupant.kind === 'player'
      ? { command: 'PlayerOption', args: [occupant.playerId, key, value] }
      : { command: 'AIOption', args: [occupant.name, key, value] },
  );
}

function slotsMessages(room: LobbyRoom): GameMessage[] {
  let army = 0;
  const messages: GameMessage[] = [];
  for (const slot of room.slots) {
    if (slot.occupant !== null) {
      army++;
      messages.push(...slotMessages(slot, army));
    }
  }
  // An observer has no army, the way the game's lobby reports one.
  room.observers.forEach((id, index) => {
    messages.push(
      { command: 'PlayerOption', args: [id, 'Team', -1] },
      { command: 'PlayerOption', args: [id, 'Army', -1] },
      { command: 'PlayerOption', args: [id, 'StartSpot', -(index + 1)] },
    );
  });
  return messages;
}

/**
 * What the server hears when a start begins: the match as it will be played, with the factions, positions and teams
 * the start settled and the armies numbered in the order of their positions, as `SendArmySettingsToServer` numbers them.
 */
export function launchMessages(launch: LobbyLaunch): GameMessage[] {
  const options: GameMessage[] = [
    ...Object.entries(launch.options).map(([key, value]) => ({ command: 'GameOption', args: [key, value] })),
    { command: 'GameOption', args: ['RestrictedCategories', launch.restrictions.length > 0] },
  ];
  const armies = launch.armies.flatMap((army, index) => {
    const values: [string, number][] = [
      ['Faction', army.faction],
      ['Color', army.color],
      ['Team', army.team],
      ['StartSpot', army.spot],
      ['Army', index + 1],
    ];
    return values.map(([key, value]): GameMessage =>
      army.playerId === null ? { command: 'AIOption', args: [army.lobbyName, key, value] } : { command: 'PlayerOption', args: [army.playerId, key, value] },
    );
  });
  return [...options, ...armies];
}

/** Every message that describes the room; `serverDifference` turns them into what changed. */
export function roomMessages(room: LobbyRoom): GameMessage[] {
  return [...optionMessages(room), ...modMessages(room), ...slotsMessages(room)];
}

function key(message: GameMessage): string {
  return JSON.stringify(message);
}

/** The server knows an AI by its name alone: one that another AI replaced stays there until its position is cleared. */
function aiLeft(slot: LobbySlot, next: LobbyRoom): boolean {
  const { occupant } = slot;
  return occupant?.kind === 'ai' && !next.slots.some((other) => other.occupant?.kind === 'ai' && other.occupant.name === occupant.name);
}

/**
 * What to send when the room changes, including `ClearSlot` for the positions someone left. An option that went back
 * to its default stays as it was on the server until the game itself sends every option at the start.
 */
export function serverDifference(previous: LobbyRoom | null, next: LobbyRoom): GameMessage[] {
  const known = new Set(previous ? roomMessages(previous).map(key) : []);
  const changed = roomMessages(next).filter((message) => !known.has(key(message)));
  const cleared = (previous?.slots ?? [])
    .filter((slot) => (slot.occupant !== null && next.slots.find((other) => other.spot === slot.spot)?.occupant === null) || aiLeft(slot, next))
    .filter((slot) => slotPlayerId(slot) === null || !next.members.some((member) => member.id === slotPlayerId(slot)))
    .map((slot): GameMessage => ({ command: 'ClearSlot', args: [slot.spot] }));
  return [...cleared, ...changed];
}
