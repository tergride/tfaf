import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { LobbyAdapter } from '../src/main/game/iceAdapter.ts';
import { GameVault } from '../src/main/game/gameVault.ts';
import { isLobbyServerTitle, lobbyServerPassword, lobbyServerTitle, lobbyTitle } from '../src/main/game/tfafLobby/lobbyAccess.ts';
import { readLobbyMap } from '../src/main/game/tfafLobby/lobbyMapInfo.ts';
import { addMember, applyAction, applyPreset, createRoom, type NewMember, presetOf, removeMember, setMap, setMods, updateMember } from '../src/main/game/tfafLobby/lobbyRoom.ts';
import { parseLobbyAction, parseLobbyMessage, serializeLobbyMessage } from '../src/main/game/tfafLobby/lobbyWire.ts';
import { type DataFrame, MAX_FRAGMENT_BYTES, ReliableMessages } from '../src/main/game/tfafLobby/reliableMessages.ts';
import { roomMessages, serverDifference } from '../src/main/game/tfafLobby/serverSync.ts';
import { TfafLobbySession, type TfafLobbySessionDependencies } from '../src/main/game/tfafLobby/tfafLobbySession.ts';
import { launchDigest, resolveLaunch } from '../src/main/game/tfafLobby/launchConfig.ts';
import type { LaunchCatalog } from '../src/main/gameOptions/launchCatalog.ts';
import { loadLobbyCatalog, readBannedMods, readMapOptionKeys } from '../src/main/gameOptions/lobbyCatalog.ts';
import { GameFileSystem } from '../src/main/mapView/gameFileSystem.ts';
import type { Settings } from '../src/shared/contract.ts';
import { groupLobbyAis } from '../src/renderer/src/lib/lobbyAis.ts';
import { searchLobbyOptions } from '../src/renderer/src/lib/lobbyOptions.ts';
import type { LobbyAiType, LobbyLaunch, LobbyMap, LobbyOptionGroup, LobbyRoom, GamePeer, GameFilesReport } from '../src/shared/contract.ts';
import { slotPlayerId, SPOT_CHANGE_INTERVAL_MS, startBlockers } from '../src/shared/tfafLobby.ts';
import { buildZip } from './helpers/zipBuilder.ts';

const HOST: NewMember = { id: 1, login: 'alpha', clan: null, country: 'RU', rating: 1200 };
const GUEST: NewMember = { id: 2, login: 'beta', clan: 'TF', country: null, rating: null };
const THIRD: NewMember = { id: 3, login: 'gamma', clan: null, country: null, rating: 800 };
const START_TIMEOUT_MS = 3 * 60 * 1000;
const FAF_FACTIONS = ['uef', 'aeon', 'cybran', 'seraphim'];
const FACTION = { uef: 1, aeon: 2, cybran: 3, seraphim: 4, random: 5 } as const;

function map(spots: number, folderName = 'theta.v0001'): LobbyMap {
  return {
    folderName,
    name: 'Theta',
    scenario: `/maps/${folderName}/theta_scenario.lua`,
    spots: Array.from({ length: spots }, (_, index) => ({ x: index / spots, y: 0.5 })),
    adaptive: false,
  };
}

function newRoom(spots = 2): LobbyRoom {
  return createRoom({ host: HOST, title: 'Friday', featuredMod: 'faf', factions: FAF_FACTIONS, map: map(spots), simMods: [] });
}

function filesReady(room: LobbyRoom, ...ids: number[]): LobbyRoom {
  return ids.reduce(
    (current, id) => updateMember(current, id, { files: 'ready', connected: ids.filter((other) => other !== id) }),
    room,
  );
}

describe('lobby room', () => {
  it('tells players on 0.10.0 to isolate their mods', () => {
    assert.equal(newRoom().modIsolation, true);
  });

  it('asks everyone again when a preset changes the mods', () => {
    let room = applyAction(addMember(newRoom(), GUEST), 2, { type: 'setReady', ready: true });
    const preset = presetOf(room, 'p', 'Saved');
    room = applyPreset(room, preset, [{ uid: 'sim', name: 'Sim' }], []);
    assert.equal(room.members.find((member) => member.id === 2)?.ready, false);
    assert.equal(room.members.find((member) => member.id === 2)?.files, 'preparing');
  });

  it('holds a ready player where they are, and a swap asks them again', () => {
    const room = applyAction(addMember(newRoom(3), GUEST), 2, { type: 'setReady', ready: true });
    assert.equal(applyAction(room, 2, { type: 'takeSpot', spot: 3 }), room);
    assert.equal(applyAction(room, 2, { type: 'observe' }), room);
    assert.equal(applyAction(room, 2, { type: 'setFaction', spot: 2, faction: 1 }), room);
    assert.equal(applyAction(room, 2, { type: 'setTeam', spot: 2, team: 3 }), room);
    assert.equal(applyAction(room, 2, { type: 'setColor', spot: 2, color: 7 }), room);
    const swapped = applyAction(room, 1, { type: 'swapSpots', from: 2, to: 3 });
    assert.equal(swapped.members.find((member) => member.id === 2)?.ready, false);
  });

  it('lets the host change a room as a whole', () => {
    let room = applyAction(addMember(newRoom(4), GUEST), 1, { type: 'closeSpot', spot: 3, closed: true });
    room = applyAction(room, 1, { type: 'fillAi', personality: 'easy', name: 'AI: Easy' });
    assert.deepEqual(room.slots.map((slot) => slot.occupant?.kind ?? null), ['player', 'player', null, 'ai']);
    room = applyAction(room, 1, { type: 'clearAi' });
    assert.equal(room.slots[3]?.occupant, null);
    room = applyAction(room, 1, { type: 'closeEmptySpots' });
    assert.deepEqual(room.slots.map((slot) => slot.closed), [false, false, true, true]);
    room = applyAction(room, 1, { type: 'closeEmptySpots' });
    assert.deepEqual(room.slots.map((slot) => slot.closed), [false, false, false, false]);
    assert.equal(applyAction(room, 2, { type: 'fillAi', personality: 'easy', name: 'AI' }), room);
  });

  it('shares the seated out into teams, those left over without one', () => {
    let room = addMember(addMember(newRoom(4), GUEST), THIRD);
    room = applyAction(room, 1, { type: 'splitTeams', teams: 2 });
    assert.deepEqual(room.slots.slice(0, 3).map((slot) => slot.team), [2, 3, 1]);
    room = applyAction(room, 1, { type: 'splitTeams', teams: 0 });
    assert.deepEqual(room.slots.slice(0, 3).map((slot) => slot.team), [1, 1, 1]);
  });

  it('gives teams by position while automatic teams are on', () => {
    const corners = { ...map(4), spots: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }] };
    let room = addMember(createRoom({ host: HOST, title: 'Friday', featuredMod: 'faf', factions: FAF_FACTIONS, map: corners, simMods: [] }), GUEST);
    room = applyAction(room, 1, { type: 'setAutoTeams', mode: 'tvsb' });
    assert.deepEqual(room.slots.map((slot) => slot.team), [2, 2, 3, 3]);
    room = applyAction(room, 1, { type: 'setAutoTeams', mode: 'lvsr' });
    assert.deepEqual(room.slots.map((slot) => slot.team), [2, 3, 2, 3]);
    assert.equal(applyAction(room, 1, { type: 'setTeam', spot: 1, team: 5 }), room);
    room = applyAction(room, 1, { type: 'setAutoTeams', mode: 'pvsi' });
    assert.deepEqual(room.slots.map((slot) => slot.team), [2, 3, 2, 3]);
    const moved = applyAction(room, 2, { type: 'takeSpot', spot: 3 });
    assert.equal(moved.slots[2]?.team, 2);
  });

  it('cycles a position through the teams with teams set by hand', () => {
    let room = applyAction(newRoom(2), 1, { type: 'setAutoTeams', mode: 'manual' });
    assert.equal(room.slots[1]?.team, 1);
    room = applyAction(room, 1, { type: 'cycleManualTeam', spot: 2 });
    assert.equal(room.slots[1]?.team, 2);
    for (let step = 0; step < 5; step++) {
      room = applyAction(room, 1, { type: 'cycleManualTeam', spot: 2 });
    }
    assert.equal(room.slots[1]?.team, 7);
    room = applyAction(room, 1, { type: 'cycleManualTeam', spot: 2 });
    assert.equal(room.slots[1]?.team, 2);
  });

  it('balances two teams and asks the players again', () => {
    const rated = (member: NewMember, mean: number): NewMember => ({ ...member, mean, deviation: 100 });
    let room = createRoom({ host: rated(HOST, 2000), title: 'Friday', featuredMod: 'faf', factions: FAF_FACTIONS, map: map(4), simMods: [] });
    room = addMember(addMember(room, rated(GUEST, 1900)), rated(THIRD, 500));
    room = addMember(room, rated({ id: 4, login: 'delta', clan: null, country: null, rating: null }, 400));
    room = applyAction(room, 2, { type: 'setReady', ready: true });
    const balanced = applyAction(room, 1, { type: 'autobalance', aiRatings: {} });
    const teamOf = (id: number): number | undefined => balanced.slots.find((slot) => slotPlayerId(slot) === id)?.team;
    assert.equal(teamOf(1) === teamOf(2), false);
    assert.equal(teamOf(3) === teamOf(4), false);
    assert.deepEqual(balanced.slots.map((slot) => slot.team).sort((a, b) => a - b), [2, 2, 3, 3]);
    assert.equal(balanced.members.find((member) => member.id === 2)?.ready, false);
  });

  it('leaves the odd player out of a balance, without a team on fixed positions', () => {
    const room = addMember(addMember(newRoom(4), GUEST), THIRD);
    const balanced = applyAction(room, 1, { type: 'autobalance', aiRatings: {} });
    assert.equal(balanced.slots[2]?.team, 1);
    assert.equal(slotPlayerId(balanced.slots[2]), 3);
    assert.deepEqual(balanced.slots.slice(0, 2).map((slot) => slot.team).sort((a, b) => a - b), [2, 3]);
  });

  it('counts an AI by the rating the catalog gives it', () => {
    let room = addMember(newRoom(4), { ...GUEST, mean: 1500, deviation: 0 });
    room = applyAction(room, 1, { type: 'addAi', spot: 3, personality: 'strong', name: 'Strong' });
    room = applyAction(room, 1, { type: 'addAi', spot: 4, personality: 'weak', name: 'Weak' });
    const balanced = applyAction(room, 1, { type: 'autobalance', aiRatings: { strong: 2000, weak: 0 } });
    const teamOf = (found: (slot: (typeof balanced.slots)[number]) => boolean): number | undefined => balanced.slots.find(found)?.team;
    assert.equal(teamOf((slot) => slotPlayerId(slot) === 2) === teamOf((slot) => slot.occupant?.kind === 'ai' && slot.occupant.personality === 'strong'), false);
  });

  it('closes a position with its mass points only on an adaptive map', () => {
    const plain = applyAction(newRoom(2), 1, { type: 'closeSpot', spot: 2, closed: true, spawnMex: true });
    assert.equal(plain.slots[1]?.spawnMex, false);
    const adaptive = createRoom({ host: HOST, title: 'Friday', featuredMod: 'faf', factions: FAF_FACTIONS, map: { ...map(2), adaptive: true }, simMods: [] });
    const closed = applyAction(adaptive, 1, { type: 'closeSpot', spot: 2, closed: true, spawnMex: true });
    assert.equal(closed.slots[1]?.spawnMex, true);
    assert.equal(applyAction(closed, 1, { type: 'closeSpot', spot: 2, closed: false }).slots[1]?.spawnMex, false);
  });

  it('takes an AI away from the position the host frees or closes, but never a player', () => {
    const withAi = applyAction(addMember(newRoom(3), GUEST), 1, { type: 'addAi', spot: 3, personality: 'easy', name: 'AI: Easy' });
    const freed = applyAction(withAi, 1, { type: 'closeSpot', spot: 3, closed: false });
    assert.deepEqual([freed.slots[2]?.occupant, freed.slots[2]?.closed], [null, false]);
    const closed = applyAction(withAi, 1, { type: 'closeSpot', spot: 3, closed: true });
    assert.deepEqual([closed.slots[2]?.occupant, closed.slots[2]?.closed], [null, true]);
    assert.equal(applyAction(withAi, 1, { type: 'closeSpot', spot: 2, closed: true }), withAi);
  });

  it('takes a map option away with its map', () => {
    const room = applyAction(applyAction(newRoom(), 1, { type: 'setOption', key: 'lava', value: 1 }), 1, { type: 'setOption', key: 'Share', value: 'FullShare' });
    const moved = setMap(room, map(2, 'other.v0001'), ['lava']);
    assert.equal(moved.options.lava, undefined);
    assert.equal(moved.options.Share, 'FullShare');
  });

  it('keeps the options that make a room what it is', () => {
    const room = newRoom();
    assert.equal(room.options.RandomMap, 'Off');
    assert.equal(applyAction(room, 1, { type: 'setOption', key: 'RandomMap', value: 'All' }), room);
    const reset = applyAction(applyAction(room, 1, { type: 'setOption', key: 'Share', value: 'FullShare' }), 1, { type: 'resetOptions' });
    assert.deepEqual(reset.options, { Unranked: 'Yes', RandomMap: 'Off' });
  });

  it('resets only the options or only the restrictions, and asks everyone to confirm again', () => {
    let room = applyAction(addMember(newRoom(), GUEST), 2, { type: 'setReady', ready: true });
    room = applyAction(applyAction(room, 1, { type: 'setOption', key: 'Share', value: 'FullShare' }), 1, { type: 'setRestrictions', restrictions: ['T4'] });
    room = applyAction(room, 1, { type: 'setAutoTeams', mode: 'pvsi' });
    const options = applyAction(room, 1, { type: 'resetOptions', part: 'options' });
    assert.deepEqual([options.options, options.restrictions, options.autoTeams], [{ Unranked: 'Yes', RandomMap: 'Off' }, ['T4'], 'pvsi']);
    assert.equal(options.members.find((member) => member.id === 2)?.ready, false);
    const restrictions = applyAction(room, 1, { type: 'resetOptions', part: 'restrictions' });
    assert.deepEqual([restrictions.options.Share, restrictions.restrictions], ['FullShare', []]);
    assert.equal(applyAction(room, 2, { type: 'resetOptions', part: 'restrictions' }), room);
  });

  it('starts as the host left off', () => {
    const memory = { options: { Share: 'FullShare' }, autoTeams: 'pvsi' as const, faction: 'aeon', color: 7 };
    const room = createRoom({ host: HOST, title: 'Friday', featuredMod: 'faf', factions: FAF_FACTIONS, map: map(2), simMods: [], memory });
    assert.equal(room.options.Share, 'FullShare');
    assert.equal(room.options.Unranked, 'Yes');
    assert.equal(room.autoTeams, 'pvsi');
    assert.equal(room.slots[0]?.faction, 2);
    assert.equal(room.slots[0]?.color, 7);
    assert.equal(room.slots[0]?.team, 2);
  });

  it('keeps only the options, the forbidden units and the mods in a preset', () => {
    let room = applyAction(addMember(newRoom(4), GUEST), 1, { type: 'addAi', spot: 4, personality: 'easy', name: 'AI' });
    room = applyAction(applyAction(room, 1, { type: 'closeSpot', spot: 3, closed: true }), 1, { type: 'setRestrictions', restrictions: ['T4'] });
    room = applyAction(applyAction(room, 1, { type: 'setRules', rules: 'No rush' }), 1, { type: 'setOption', key: 'Share', value: 'FullShare' });
    room = applyAction(setMods(room, [{ uid: 'sim', name: 'Sim' }]), 1, { type: 'setOption', key: 'lava', value: 1 });
    assert.deepEqual(presetOf(room, 'p', 'Friday night', ['lava']), {
      id: 'p',
      name: 'Friday night',
      simMods: [{ uid: 'sim', name: 'Sim' }],
      options: { Share: 'FullShare' },
      restrictions: ['T4'],
    });
  });

  it('brings saved settings back and leaves the map, the positions and the rules as they are', () => {
    const saved = presetOf(applyAction(applyAction(newRoom(), 1, { type: 'setOption', key: 'Share', value: 'FullShare' }), 1, { type: 'setRestrictions', restrictions: ['T4'] }), 'p', 'Saved');
    let room = applyAction(addMember(newRoom(4), GUEST), 1, { type: 'addAi', spot: 4, personality: 'easy', name: 'AI' });
    room = applyAction(applyAction(room, 1, { type: 'closeSpot', spot: 3, closed: true }), 1, { type: 'setRules', rules: 'No rush' });
    room = applyAction(applyAction(room, 1, { type: 'setAutoTeams', mode: 'pvsi' }), 1, { type: 'setOption', key: 'lava', value: 1 });
    room = applyAction(room, 1, { type: 'setOption', key: 'UnitCap', value: '500' });
    const loaded = applyPreset(room, saved, [{ uid: 'sim', name: 'Sim' }], ['lava']);
    assert.deepEqual(loaded.options, { Share: 'FullShare', lava: 1, Unranked: 'Yes', RandomMap: 'Off' });
    assert.deepEqual(loaded.restrictions, ['T4']);
    assert.deepEqual(loaded.simMods, [{ uid: 'sim', name: 'Sim' }]);
    assert.equal(loaded.map, room.map);
    assert.equal(loaded.rules, 'No rush');
    assert.equal(loaded.autoTeams, 'pvsi');
    assert.equal(loaded.slots[2]?.closed, true);
    assert.equal(loaded.slots[3]?.occupant?.kind, 'ai');
    assert.equal(slotPlayerId(loaded.slots[1]!), 2);
  });

  it('lets only the host forbid units', () => {
    const room = addMember(newRoom(), GUEST);
    assert.equal(applyAction(room, 2, { type: 'setRestrictions', restrictions: ['T4'] }), room);
    assert.deepEqual(applyAction(room, 1, { type: 'setRestrictions', restrictions: ['T4', 'uel0401', 'T4'] }).restrictions, ['T4', 'uel0401']);
  });

  it('seats the host, then players, then lets the rest watch', () => {
    let room = newRoom(2);
    assert.equal(slotPlayerId(room.slots[0]!), 1);
    room = addMember(room, GUEST);
    assert.equal(slotPlayerId(room.slots[1]!), 2);
    assert.notEqual(room.slots[0]!.color, room.slots[1]!.color);
    room = addMember(room, THIRD);
    assert.deepEqual(room.observers, [3]);
    assert.equal(addMember(room, THIRD), room);
  });

  it('opens a closed position for an AI put on it', () => {
    const closed = applyAction(newRoom(3), 1, { type: 'closeSpot', spot: 3, closed: true });
    const slot = applyAction(closed, 1, { type: 'addAi', spot: 3, personality: 'tm28', name: 'TM28 AI' }).slots[2]!;
    assert.equal(slot.closed, false);
    assert.equal(slot.occupant?.kind, 'ai');
  });

  it('always plays unrated and does not let the host change that', () => {
    const room = newRoom();
    assert.equal(room.options.Unranked, 'Yes');
    assert.equal(applyAction(room, 1, { type: 'setOption', key: 'Unranked', value: 'No' }), room);
    assert.equal(applyAction(room, 1, { type: 'setOption', key: 'Unranked', value: null }), room);
  });

  it('numbers the factions of the featured mod and keeps a seat to those the map allows on its position', () => {
    const nomads = createRoom({
      host: HOST,
      title: 'Friday',
      featuredMod: 'nomads',
      factions: [...FAF_FACTIONS, 'nomads'],
      map: { ...map(2), spots: [{ x: 0.2, y: 0.5, factions: ['nomads'] }, { x: 0.8, y: 0.5, factions: ['uef', 'nomads'] }] },
      simMods: [],
      memory: { options: {}, autoTeams: 'none', faction: 'nomads', color: null },
    });
    assert.equal(nomads.slots[0]!.faction, 5);
    assert.equal(nomads.slots[1]!.faction, 6);
    const room = addMember(nomads, GUEST);
    assert.equal(applyAction(room, 2, { type: 'setFaction', spot: 2, faction: FACTION.aeon }), room);
    assert.equal(applyAction(room, 2, { type: 'setFaction', spot: 2, faction: 6 }).slots[1]!.faction, 6);
    // One faction on a position leaves nothing to draw at random.
    assert.equal(applyAction(room, 1, { type: 'setFaction', spot: 1, faction: 6 }), room);
  });

  it('lets a player change only their own slot and the host every occupied one', () => {
    const room = addMember(newRoom(), GUEST);
    assert.equal(applyAction(room, 2, { type: 'setFaction', spot: 1, faction: FACTION.aeon }), room);
    assert.equal(applyAction(room, 2, { type: 'setFaction', spot: 2, faction: FACTION.aeon }).slots[1]!.faction, FACTION.aeon);
    assert.equal(applyAction(room, 1, { type: 'setTeam', spot: 2, team: 3 }).slots[1]!.team, 3);
    assert.equal(applyAction(room, 2, { type: 'setTeam', spot: 2, team: 99 }), room);
  });

  it('keeps host actions from players and refuses a colour someone has', () => {
    const room = addMember(newRoom(3), GUEST);
    assert.equal(applyAction(room, 2, { type: 'addAi', spot: 3, personality: 'easy', name: 'AI: Easy' }), room);
    assert.equal(applyAction(room, 2, { type: 'setOption', key: 'Share', value: 'FullShare' }), room);
    assert.equal(applyAction(room, 2, { type: 'setColor', spot: 2, color: room.slots[0]!.color }), room);
    const withAi = applyAction(room, 1, { type: 'addAi', spot: 3, personality: 'easy', name: 'AI: Easy' });
    assert.deepEqual(withAi.slots[2]!.occupant, { kind: 'ai', personality: 'easy', name: 'AI: Easy' });
    assert.equal(applyAction(withAi, 1, { type: 'clearSpot', spot: 3 }).slots[2]!.occupant, null);
  });

  it('puts another AI in the place of an AI, and only there', () => {
    let room = addMember(newRoom(3), GUEST);
    room = applyAction(room, 1, { type: 'addAi', spot: 3, personality: 'easy', name: 'AI: Easy' });
    room = applyAction(room, 1, { type: 'setTeam', spot: 3, team: 3 });
    room = applyAction(room, 1, { type: 'setFaction', spot: 3, faction: FACTION.cybran });
    const action = { type: 'addAi', spot: 3, personality: 'tm28', name: 'TM28 AI' } as const;
    assert.deepEqual(applyAction(room, 1, action).slots[2], { ...room.slots[2]!, occupant: { kind: 'ai', personality: 'tm28', name: 'TM28 AI' } });
    assert.equal(applyAction(room, 2, action), room);
    assert.equal(applyAction(room, 1, { ...action, spot: 2 }), room);
  });

  it('moves a player between spots with their faction and colour, and to the observers', () => {
    let room = applyAction(addMember(newRoom(3), GUEST), 2, { type: 'setFaction', spot: 2, faction: FACTION.cybran });
    const color = room.slots[1]!.color;
    room = applyAction(room, 2, { type: 'takeSpot', spot: 3 });
    assert.equal(room.slots[1]!.occupant, null);
    assert.equal(slotPlayerId(room.slots[2]!), 2);
    assert.equal(room.slots[2]!.faction, FACTION.cybran);
    assert.equal(room.slots[2]!.color, color);
    room = applyAction(room, 2, { type: 'observe' });
    assert.deepEqual(room.observers, [2]);
    assert.equal(room.slots[2]!.occupant, null);
    room = applyAction(room, 2, { type: 'takeSpot', spot: 2 });
    assert.deepEqual(room.observers, []);
  });

  it('swaps two occupied spots', () => {
    const room = applyAction(addMember(newRoom(), GUEST), 1, { type: 'swapSpots', from: 1, to: 2 });
    assert.equal(slotPlayerId(room.slots[0]!), 2);
    assert.equal(slotPlayerId(room.slots[1]!), 1);
  });

  it('keeps players on a smaller map and asks everyone to confirm the new one', () => {
    let room = addMember(newRoom(4), GUEST);
    room = applyAction(room, 2, { type: 'takeSpot', spot: 4 });
    room = applyAction(room, 2, { type: 'setReady', ready: true });
    room = applyAction(room, 1, { type: 'addAi', spot: 3, personality: 'easy', name: 'AI: Easy' });
    room = setMap(room, map(2, 'small.v0001'));
    assert.equal(room.slots.length, 2);
    assert.equal(slotPlayerId(room.slots[1]!), 2);
    assert.equal(room.members.find((member) => member.id === 2)?.ready, false);
    assert.equal(setMods(applyAction(room, 2, { type: 'setReady', ready: true }), []).members[1]?.ready, false);
  });

  it('frees the spot of a player who left and forgets them everywhere', () => {
    let room = filesReady(addMember(newRoom(), GUEST), 1, 2);
    room = removeMember(room, 2);
    assert.equal(room.slots[1]!.occupant, null);
    assert.deepEqual(room.members.map((member) => member.id), [1]);
    assert.deepEqual(room.members[0]?.connected, []);
  });

  it('accepts nothing once the room is starting', () => {
    const room: LobbyRoom = { ...addMember(newRoom(), GUEST), phase: 'starting' };
    assert.equal(applyAction(room, 2, { type: 'setReady', ready: true }), room);
  });
});

describe('start blockers', () => {
  it('names what keeps the host from starting until nothing does', () => {
    let room = addMember(newRoom(), GUEST);
    assert.deepEqual(
      startBlockers(room, null).map((blocker) => blocker.kind),
      ['notReady', 'files', 'connection'],
    );
    room = filesReady(room, 1, 2);
    room = applyAction(room, 2, { type: 'setReady', ready: true });
    assert.deepEqual(startBlockers(room, null), []);

    const differing: GameFilesReport = {
      host: { playerId: 1, login: 'alpha', known: true },
      players: [{ playerId: 2, login: 'beta', gameFiles: 'same', map: 'different', mods: 'same', differentMods: [] }],
    };
    assert.deepEqual(startBlockers(room, differing), [{ kind: 'filesDiffer', logins: ['beta'] }]);
  });

  it('lets one player start alone against nobody', () => {
    assert.deepEqual(startBlockers(filesReady(newRoom(), 1), null), []);
  });
});

describe('reliable messages', () => {
  interface Link {
    a: ReliableMessages;
    b: ReliableMessages;
    atA: string[];
    atB: string[];
  }

  /** `drop` decides for every frame, in order of sending, whether the network loses it. */
  function link(drop: (count: number) => boolean): Link {
    let sent = 0;
    const through = (deliver: () => void): void => {
      if (!drop(++sent)) {
        queueMicrotask(deliver);
      }
    };
    const atA: string[] = [];
    const atB: string[] = [];
    const a: ReliableMessages = new ReliableMessages({
      sendData: (frame: DataFrame) => through(() => b.onData(frame)),
      sendAck: (id, index) => through(() => b.onAck(id, index)),
      onMessage: (text) => atA.push(text),
    });
    const b: ReliableMessages = new ReliableMessages({
      sendData: (frame: DataFrame) => through(() => a.onData(frame)),
      sendAck: (id, index) => through(() => a.onAck(id, index)),
      onMessage: (text) => atB.push(text),
    });
    return { a, b, atA, atB };
  }

  async function settled(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 4000;
    while (!check()) {
      assert.ok(Date.now() < deadline, 'timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('delivers a long message once, through lost frames and lost confirmations', async () => {
    const { a, b, atB } = link((count) => count % 3 === 0);
    const text = 'Ю'.repeat(MAX_FRAGMENT_BYTES * 2);
    try {
      assert.equal(a.send(text), true);
      await settled(() => atB.length > 0);
      assert.deepEqual(atB, [text]);
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.equal(atB.length, 1);
    } finally {
      a.close();
      b.close();
    }
  });

  it('lets a newer message of a kind replace one still on its way', async () => {
    let lost = true;
    const { a, b, atB } = link(() => lost);
    try {
      a.send('old', 'room');
      a.send('new', 'room');
      lost = false;
      await settled(() => atB.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.deepEqual(atB, ['new']);
    } finally {
      a.close();
      b.close();
    }
  });

  it('refuses a message too long to send', () => {
    const messages = new ReliableMessages({ sendData: () => {}, sendAck: () => {}, onMessage: () => {} });
    assert.equal(messages.send('x'.repeat(MAX_FRAGMENT_BYTES * 300)), false);
    messages.close();
  });
});

describe('lobby messages', () => {
  it('keep a room and an action as they were', () => {
    const room = applyAction(addMember(newRoom(), GUEST), 1, { type: 'setOption', key: 'Share', value: 'FullShare' });
    assert.deepEqual(parseLobbyMessage(serializeLobbyMessage({ t: 'room', room })), { t: 'room', room });
    const action = { type: 'addAi', spot: 2, personality: 'tm28', name: 'TM28 AI' } as const;
    assert.deepEqual(parseLobbyAction(action), action);
    assert.deepEqual(parseLobbyAction({ type: 'resetOptions', part: 'options' }), { type: 'resetOptions', part: 'options' });
    assert.deepEqual(parseLobbyAction({ type: 'resetOptions' }), { type: 'resetOptions' });
    assert.equal(parseLobbyAction({ type: 'resetOptions', part: 'everything' }), null);
    const restricted = applyAction(room, 1, { type: 'setRestrictions', restrictions: ['T4', 'url0301_ras', 'ResourceAllocation'] });
    assert.deepEqual(parseLobbyMessage(serializeLobbyMessage({ t: 'room', room: restricted })), { t: 'room', room: restricted });
  });

  it('keep the match of a start and refuse one of another featured mod or out of shape', () => {
    const launch = resolveLaunch(addMember(newRoom(), GUEST), LAUNCH_CATALOG);
    assert.deepEqual(parseLobbyMessage(serializeLobbyMessage({ t: 'start', id: 3, launch })), { t: 'start', id: 3, launch });
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'start', id: 3 })), null);
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'start', id: 3, launch: { ...launch, featuredMod: 'coop' } })), null);
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'start', id: 3, launch: { ...launch, digest: 'short' } })), null);
    const army = launch.armies[0]!;
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'start', id: 3, launch: { ...launch, armies: [{ ...army, ai: 'easy' }] } })), null);
  });

  it('keep the factions of a room and of its map, and refuse a room of a featured mod the lobby does not play', () => {
    const nomads = createRoom({
      host: HOST,
      title: 'Friday',
      featuredMod: 'nomads',
      factions: [...FAF_FACTIONS, 'nomads'],
      map: { ...map(2), spots: [{ x: 0.2, y: 0.5, factions: ['nomads', 'uef'] }, { x: 0.8, y: 0.5 }] },
      simMods: [],
    });
    assert.deepEqual(parseLobbyMessage(serializeLobbyMessage({ t: 'room', room: nomads })), { t: 'room', room: nomads });
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'room', room: { ...nomads, featuredMod: 'coop' } })), null);
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'room', room: { ...nomads, factions: [] } })), null);
  });

  it('read a room of an older host as one without what it does not know', () => {
    const { restrictions: _restrictions, rules: _rules, autoTeams: _autoTeams, manualTeams: _manualTeams, ...oldRoom } = addMember(newRoom(), GUEST);
    const parsed = parseLobbyMessage(JSON.stringify({ t: 'room', room: oldRoom }));
    assert.ok(parsed?.t === 'room');
    assert.deepEqual(parsed.room.restrictions, []);
    assert.equal(parsed.room.rules, '');
    assert.equal(parsed.room.autoTeams, 'none');
    assert.equal(parsed.room.members[1]?.games, null);
  });

  it('carry why a player was kicked, and a private message', () => {
    assert.deepEqual(parseLobbyMessage(serializeLobbyMessage({ t: 'kicked', reason: 'AFK' })), { t: 'kicked', reason: 'AFK' });
    assert.deepEqual(parseLobbyMessage('{"t":"kicked"}'), { t: 'kicked', reason: null });
    assert.deepEqual(parseLobbyMessage(serializeLobbyMessage({ t: 'whisper', text: 'hi' })), { t: 'whisper', text: 'hi' });
  });

  it('keep a restriction to one word, since the simulation pastes it into an expression', () => {
    assert.equal(parseLobbyAction({ type: 'setRestrictions', restrictions: ['T4) + (UEF'] }), null);
    assert.equal(parseLobbyAction({ type: 'setTitle', title: 'Кириллица' }), null);
    assert.equal(parseLobbyAction({ type: 'setAutoTeams', mode: 'sideways' }), null);
    assert.equal(parseLobbyAction({ type: 'splitTeams', teams: 99 }), null);
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'room', room: { ...newRoom(), restrictions: ['"'] } })), null);
  });

  it('drop what is out of shape', () => {
    assert.equal(parseLobbyMessage('not json'), null);
    assert.equal(parseLobbyMessage('{"t":"unknown"}'), null);
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'status', files: 'maybe', connected: [] })), null);
    assert.equal(parseLobbyAction({ type: 'setMap', folderName: '../outside' }), null);
    assert.equal(parseLobbyAction({ type: 'setFaction', spot: 99, faction: 1 }), null);
    assert.equal(parseLobbyAction({ type: 'setOption', key: 'a\nb', value: 1 }), null);
  });

  it('refuse a room whose scenario lies outside its map', () => {
    const room = newRoom();
    const outside = { ...room, map: { ...room.map, scenario: '/mods/evil/theta_scenario.lua' } };
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'room', room: outside })), null);
    const nested = { ...room, map: { ...room.map, scenario: `/maps/${room.map.folderName}/lua/theta_scenario.lua` } };
    assert.equal(parseLobbyMessage(JSON.stringify({ t: 'room', room: nested })), null);
  });
});

describe('what the server hears', () => {
  it('describes the room the way the game lobby does and always asks for an unrated game', () => {
    const room = applyAction(addMember(newRoom(), GUEST), 1, { type: 'setTeam', spot: 2, team: 3 });
    const messages = roomMessages(room);
    assert.ok(messages.some(({ command, args }) => command === 'GameOption' && args[0] === 'Unranked' && args[1] === 'Yes'));
    assert.ok(messages.some(({ command, args }) => command === 'GameOption' && args[0] === 'ScenarioFile' && args[1] === room.map.scenario));
    assert.ok(messages.some(({ command, args }) => command === 'PlayerOption' && args[0] === 2 && args[1] === 'Team' && args[2] === 3));
    assert.ok(messages.some(({ command, args }) => command === 'PlayerOption' && args[0] === 2 && args[1] === 'Army' && args[2] === 2));
  });

  it('keeps the mark of a TFAF lobby in a new title', () => {
    const before = newRoom();
    const after = applyAction(before, 1, { type: 'setTitle', title: 'Saturday' });
    assert.deepEqual(serverDifference(before, after), [{ command: 'GameOption', args: ['Title', '[TFAF] Saturday'] }]);
  });

  it('tells whether units are forbidden, not which, as the game lobby does', () => {
    const before = newRoom();
    const after = applyAction(before, 1, { type: 'setRestrictions', restrictions: ['T4'] });
    assert.deepEqual(serverDifference(before, after), [{ command: 'GameOption', args: ['RestrictedCategories', true] }]);
  });

  it('sends only what changed and clears the slot of a player who left', () => {
    const before = addMember(newRoom(), GUEST);
    const after = applyAction(before, 1, { type: 'setOption', key: 'Share', value: 'FullShare' });
    assert.deepEqual(serverDifference(before, after), [{ command: 'GameOption', args: ['Share', 'FullShare'] }]);
    assert.ok(serverDifference(after, removeMember(after, 2)).some(({ command, args }) => command === 'ClearSlot' && args[0] === 2));
  });

  it('takes a replaced AI off the server, but not an AI that moved', () => {
    const before = applyAction(newRoom(4), 1, { type: 'addAi', spot: 3, personality: 'easy', name: 'AI: Easy' });
    const replaced = applyAction(before, 1, { type: 'addAi', spot: 3, personality: 'tm28', name: 'TM28 AI' });
    const messages = serverDifference(before, replaced);
    assert.deepEqual(messages[0], { command: 'ClearSlot', args: [3] });
    assert.ok(messages.some(({ command, args }) => command === 'AIOption' && args[0] === 'TM28 AI' && args[1] === 'StartSpot' && args[2] === 3));

    const two = applyAction(before, 1, { type: 'addAi', spot: 4, personality: 'tm28', name: 'TM28 AI' });
    const swapped = applyAction(two, 1, { type: 'swapSpots', from: 3, to: 4 });
    assert.ok(!serverDifference(two, swapped).some(({ command }) => command === 'ClearSlot'));
  });

  it('lists the mods of the room as the game does', () => {
    const room = setMods(newRoom(), [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }]);
    assert.deepEqual(
      roomMessages(room).filter(({ command }) => command === 'GameMods'),
      [
        { command: 'GameMods', args: ['activated', 2] },
        { command: 'GameMods', args: ['uids', 'a b'] },
      ],
    );
  });
});

describe('lobby access', () => {
  it('marks the game on the server and gives every password, even none, a form only TFAF knows', () => {
    assert.equal(lobbyTitle(lobbyServerTitle('Friday')), 'Friday');
    assert.equal(isLobbyServerTitle('Friday'), false);
    assert.match(lobbyServerPassword(null), /^[0-9a-f]{32}$/);
    assert.equal(lobbyServerPassword(null), lobbyServerPassword(''));
    assert.notEqual(lobbyServerPassword('secret'), lobbyServerPassword(null));
  });
});

const LAUNCH_CATALOG: LaunchCatalog = {
  factions: ['uef', 'aeon', 'cybran', 'seraphim'],
  aiNames: new Map(),
  aiRatings: new Map(),
  defaults: { TeamSpawn: 'fixed' },
  mapSize: 512,
};

/** Two launchers on one table: their messages go through a queue that `flush` empties. */
class SessionTable {
  readonly queue: { from: number; to: number; text: string }[] = [];
  readonly launched: number[] = [];
  readonly closedGames: number[] = [];
  readonly released: number[] = [];
  readonly server: string[] = [];
  readonly left: number[] = [];
  readonly followed: string[] = [];
  readonly hostedMaps: string[] = [];
  readonly rememberedOptions: LobbyRoom['options'][] = [];
  readonly rememberedGames: string[] = [];
  readonly rememberedSeats: { faction?: string; color?: number }[] = [];
  seat: { faction: string | null; color: number | null } = { faction: null, color: null };
  fullRooms = 0;
  leaveReason: string | null = null;
  failLaunch = false;
  refuseStart = false;
  readonly launches: LobbyLaunch[] = [];
  readonly refused: string[] = [];

  session(self: NewMember, hostLogin: string, room: LobbyRoom | null): TfafLobbySession {
    const adapter = {
      sendLobbyMessage: (playerId: number, text: string) => {
        this.queue.push({ from: self.id, to: playerId, text });
        return true;
      },
      setHostedMap: (mapName: string) => this.hostedMaps.push(mapName),
      releaseGame: () => this.released.push(self.id),
    } as unknown as LobbyAdapter;
    const deps: TfafLobbySessionDependencies = {
      selfId: self.id,
      selfLogin: self.login,
      hostLogin,
      adapter,
      sendToServer: ({ command, args }) => this.server.push(`${command} ${args.join(' ')}`),
      memberInfo: (id) => [HOST, GUEST, THIRD].find((member) => member.id === id)!,
      loadMap: (folderName) => Promise.resolve(map(2, folderName)),
      loadMods: () => Promise.resolve([{ uid: 'sim', name: 'Sim' }]),
      mapOptionKeys: () => Promise.resolve([]),
      rememberOptions: (next) => this.rememberedOptions.push(next.options),
      rememberGame: (next) => this.rememberedGames.push(next.title),
      rememberSeat: (seat) => this.rememberedSeats.push(seat),
      rememberedSeat: this.seat,
      onRoomFull: () => this.fullRooms++,
      followFiles: (next) => this.followed.push(`${self.login} ${next.map.folderName}`),
      resolveLaunch: (next) => (this.refuseStart ? Promise.reject(new Error('no catalog')) : Promise.resolve(resolveLaunch(next, LAUNCH_CATALOG))),
      launchGame: (_next, launch) => {
        this.launched.push(self.id);
        this.launches.push(launch);
        return this.failLaunch ? Promise.reject(new Error('no game')) : Promise.resolve();
      },
      onStartRefused: (error) => this.refused.push(String(error)),
      closeGame: () => this.closedGames.push(self.id),
      leave: (reason) => {
        this.left.push(self.id);
        this.leaveReason = reason;
      },
      filesReport: () => null,
      mapPreview: () => null,
      onChange: () => {},
      log: () => {},
    };
    return new TfafLobbySession(deps, room);
  }
}

describe('lobby session', () => {
  async function table(): Promise<{ desk: SessionTable; host: TfafLobbySession; guest: TfafLobbySession; flush: () => Promise<void> }> {
    const desk = new SessionTable();
    const host = desk.session(HOST, 'alpha', newRoom());
    const guest = desk.session(GUEST, 'alpha', null);
    const logins: Record<number, string> = { 1: 'alpha', 2: 'beta' };
    const flush = async (): Promise<void> => {
      // Timers of the session batch what it sends.
      await new Promise((resolve) => setTimeout(resolve, 150));
      while (desk.queue.length > 0) {
        const { from, to, text } = desk.queue.shift()!;
        (to === 1 ? host : guest).onLobbyMessage(from, logins[from]!, text);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      while (desk.queue.length > 0) {
        const { from, to, text } = desk.queue.shift()!;
        (to === 1 ? host : guest).onLobbyMessage(from, logins[from]!, text);
      }
    };
    host.announce();
    host.setFiles('ready');
    host.onPlayerKnown(2, 'beta');
    guest.onPlayerKnown(1, 'alpha');
    await flush();
    guest.setFiles('ready');
    host.setPeers([peer(2)]);
    guest.setPeers([peer(1)]);
    await flush();
    return { desk, host, guest, flush };
  }

  function peer(playerId: number): GamePeer {
    return { playerId, login: String(playerId), state: 'connected', route: 'direct', rttMs: 20, tfaf: true, duplication: false, loss: null };
  }

  it('shows the host\'s room to a player who joined and takes their wishes', async () => {
    const { host, guest, flush } = await table();
    assert.deepEqual(guest.currentRoom?.members.map((member) => member.login), ['alpha', 'beta']);
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    assert.equal(host.currentRoom?.members[1]?.ready, true);
    assert.equal(guest.currentRoom?.members[1]?.ready, true);
    assert.deepEqual(guest.view(null).startBlockers, []);
  });

  it('tells the server about the game the moment it opens', async () => {
    const { desk } = await table();
    assert.ok(desk.server.includes('GameOption Unranked Yes'));
    assert.ok(desk.server.some((message) => message.startsWith('PlayerOption 2 Army')));
  });

  it('lets a player follow the new map and report back', async () => {
    const { desk, host, guest, flush } = await table();
    await host.act({ type: 'setMap', folderName: 'other.v0002' });
    await flush();
    assert.ok(desk.followed.includes('beta other.v0002'));
    assert.deepEqual(desk.hostedMaps, ['other.v0002']);
    assert.equal(host.currentRoom?.members[1]?.files, 'preparing');
    guest.setFiles('ready');
    await flush();
    assert.equal(host.currentRoom?.members[1]?.files, 'ready');
  });

  it('takes the room only from the host', async () => {
    const { guest } = await table();
    const revision = guest.currentRoom!.revision;
    const forged = { ...guest.currentRoom!, revision: revision + 5, title: 'Forged' };
    guest.onLobbyMessage(3, 'gamma', serializeLobbyMessage({ t: 'room', room: forged }));
    assert.equal(guest.currentRoom?.title, 'Friday');
  });

  it('starts every game and releases the players after the host', async () => {
    const { desk, host, guest, flush } = await table();
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    await host.start();
    await flush();
    assert.deepEqual(desk.launched.sort((a, b) => a - b), [1, 2]);
    assert.equal(host.currentRoom?.phase, 'starting');
    assert.deepEqual(desk.released, []);
    host.onGameInLobby();
    assert.deepEqual(desk.released, [1]);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await flush();
    assert.deepEqual(desk.released, [1, 2]);
    host.onGameLaunched();
    guest.onGameLaunched();
    host.close();
    guest.close();
  });

  it('does not start while something blocks it', async () => {
    const { desk, host } = await table();
    await host.start();
    assert.deepEqual(desk.launched, []);
    assert.equal(host.currentRoom?.phase, 'open');
    host.close();
  });

  it('gives every game the host\'s match, tells the server, and shows it until the start ends', async () => {
    const { desk, host, guest, flush } = await table();
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    await host.start();
    await flush();
    assert.equal(desk.launches.length, 2);
    assert.equal(desk.launches[0]!.digest, desk.launches[1]!.digest);
    assert.equal(launchDigest(desk.launches[1]!), desk.launches[1]!.digest);
    assert.ok(desk.server.includes('PlayerOption 1 Army 1'));
    assert.ok(desk.server.includes('GameOption Unranked Yes'));
    assert.equal(guest.view(null).launch?.digest, desk.launches[0]!.digest);
    host.cancelStart();
    await flush();
    assert.equal(host.view(null).launch, null);
    assert.equal(guest.view(null).launch, null);
    host.close();
    guest.close();
  });

  it('does not start a player\'s game for a match changed on the way', async () => {
    const { desk, guest } = await table();
    const launch = resolveLaunch(guest.currentRoom!, LAUNCH_CATALOG);
    guest.onLobbyMessage(1, 'alpha', serializeLobbyMessage({ t: 'start', id: 7, launch: { ...launch, options: { ...launch.options, UnitCap: '9999' } } }));
    assert.deepEqual(desk.launched, []);
    guest.close();
  });

  it('keeps the room open and says why when the match cannot be settled, or the game is not supported', async () => {
    const { desk, host, guest, flush } = await table();
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    desk.refuseStart = true;
    await host.start();
    assert.deepEqual(desk.launched, []);
    assert.equal(host.currentRoom?.phase, 'open');
    assert.match(desk.refused[0]!, /no catalog/);
    desk.refuseStart = false;
    host.setUnsupportedCode(['lua/ui/lobby/lobby.lua: TryLaunch']);
    assert.deepEqual(host.view(null).startBlockers[0], { kind: 'unsupportedGame', changes: ['lua/ui/lobby/lobby.lua: TryLaunch'] });
    await host.start();
    assert.deepEqual(desk.launched, []);
    host.close();
    guest.close();
  });

  it('brings everyone back to the room when a player\'s game does not start', async () => {
    const { desk, host, guest, flush } = await table();
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    desk.failLaunch = true;
    await host.start();
    await flush();
    assert.equal(host.currentRoom?.phase, 'open');
    assert.equal(guest.currentRoom?.phase, 'open');
    assert.ok(desk.closedGames.includes(1));
    assert.equal(host.view(null).lastAbort?.reason, 'gameFailed');
    host.close();
    guest.close();
  });

  it('gives up a start that takes too long', async (t) => {
    const { desk, host, guest, flush } = await table();
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await host.start();
    t.mock.timers.tick(START_TIMEOUT_MS);
    assert.equal(host.currentRoom?.phase, 'open');
    assert.equal(host.view(null).lastAbort?.reason, 'timeout');
    assert.ok(desk.closedGames.includes(1));
    host.close();
    guest.close();
  });

  it('sends a private message straight to the player, past the host', async () => {
    const { host, guest, flush } = await table();
    await flush();
    guest.say('/w ALPHA hello there');
    await flush();
    const line = host.view(null).chat.at(-1);
    assert.equal(line?.text, 'hello there');
    assert.equal(line?.login, 'beta');
    assert.equal(line?.whisperTo, 'alpha');
    assert.equal(guest.view(null).chat.at(-1)?.whisperTo, 'alpha');
    guest.say('/w nobody hi');
    await flush();
    assert.equal(guest.view(null).chat.at(-1)?.senderId, null);
  });

  it('remembers the options of the room and tells when it fills up', async () => {
    const { desk, host, flush } = await table();
    await flush();
    await host.act({ type: 'setOption', key: 'Share', value: 'FullShare' });
    assert.equal(desk.rememberedOptions.at(-1)?.Share, 'FullShare');
    assert.equal(desk.fullRooms, 1);
  });

  it('remembers the seat a player chose and takes it up in the next room', async () => {
    const desk = new SessionTable();
    desk.seat = { faction: 'cybran', color: 7 };
    const host = desk.session(HOST, 'alpha', newRoom());
    const guest = desk.session(GUEST, 'alpha', null);
    host.onPlayerKnown(2, 'beta');
    guest.onPlayerKnown(1, 'alpha');
    const logins: Record<number, string> = { 1: 'alpha', 2: 'beta' };
    for (let round = 0; round < 6; round++) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      while (desk.queue.length > 0) {
        const { from, to, text } = desk.queue.shift()!;
        (to === 1 ? host : guest).onLobbyMessage(from, logins[from]!, text);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    const own = host.currentRoom?.slots.find((slot) => slotPlayerId(slot) === 2);
    assert.equal(own?.faction, 3);
    assert.equal(own?.color, 7);
    await guest.act({ type: 'setFaction', spot: own.spot, faction: 1 });
    assert.deepEqual(desk.rememberedSeats.at(-1), { faction: 'uef' });
  });

  it('tells a kicked player why', async () => {
    const { desk, host, flush } = await table();
    await flush();
    await host.act({ type: 'kick', playerId: 2, reason: 'AFK' });
    await flush();
    assert.equal(desk.leaveReason, 'AFK');
  });

  it('remembers the lobby of a game that starts', async () => {
    const { desk, host, guest, flush } = await table();
    await guest.act({ type: 'setReady', ready: true });
    await flush();
    await host.start();
    assert.deepEqual(desk.rememberedGames, ['Friday']);
    host.close();
    guest.close();
  });

  it('removes a kicked player and keeps them out', async () => {
    const { desk, host, guest, flush } = await table();
    await host.act({ type: 'kick', playerId: 2 });
    await flush();
    assert.deepEqual(desk.left, [2]);
    assert.deepEqual(host.currentRoom?.members.map((member) => member.id), [1]);
    host.onPlayerKnown(2, 'beta');
    assert.deepEqual(host.currentRoom?.members.map((member) => member.id), [1]);
    host.close();
    guest.close();
  });

  it('holds a player\'s next spot change until the host answered, then for the pause', async () => {
    const desk = new SessionTable();
    const host = desk.session(HOST, 'alpha', newRoom(4));
    const guest = desk.session(GUEST, 'alpha', null);
    host.onPlayerKnown(2, 'beta');
    guest.onPlayerKnown(1, 'alpha');
    const deliver = async (): Promise<void> => {
      while (desk.queue.length > 0) {
        const { from, to, text } = desk.queue.shift()!;
        (to === 1 ? host : guest).onLobbyMessage(from, from === 1 ? 'alpha' : 'beta', text);
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    await deliver();

    await guest.act({ type: 'takeSpot', spot: 3 });
    assert.equal(guest.view(null).spotChangeLocked, true);
    await guest.act({ type: 'takeSpot', spot: 4 });
    await deliver();
    assert.equal(slotPlayerId(host.currentRoom!.slots[2]!), 2);
    assert.equal(slotPlayerId(host.currentRoom!.slots[3]!), null);

    assert.equal(guest.view(null).spotChangeLocked, true);
    await guest.act({ type: 'takeSpot', spot: 4 });
    await deliver();
    assert.equal(slotPlayerId(host.currentRoom!.slots[3]!), null);

    await new Promise((resolve) => setTimeout(resolve, SPOT_CHANGE_INTERVAL_MS + 50));
    assert.equal(guest.view(null).spotChangeLocked, false);
    await guest.act({ type: 'takeSpot', spot: 4 });
    await deliver();
    assert.equal(slotPlayerId(host.currentRoom!.slots[3]!), 2);
    host.close();
    guest.close();
  });

  it('keeps the pause itself against a launcher that does not, and still answers', async () => {
    const desk = new SessionTable();
    const host = desk.session(HOST, 'alpha', newRoom(4));
    host.onPlayerKnown(2, 'beta');
    host.onLobbyMessage(2, 'beta', serializeLobbyMessage({ t: 'act', id: 1, action: { type: 'takeSpot', spot: 3 } }));
    host.onLobbyMessage(2, 'beta', serializeLobbyMessage({ t: 'act', id: 2, action: { type: 'takeSpot', spot: 4 } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(slotPlayerId(host.currentRoom!.slots[2]!), 2);
    assert.equal(slotPlayerId(host.currentRoom!.slots[3]!), null);
    const answers = desk.queue.flatMap(({ text }) => {
      const message = parseLobbyMessage(text);
      return message?.t === 'done' ? [message.id] : [];
    });
    assert.deepEqual(answers, [1, 2]);
    host.close();
  });

  it('makes the host pause only after a change that happened', async () => {
    const desk = new SessionTable();
    const room = applyAction(newRoom(3), 1, { type: 'closeSpot', spot: 3, closed: true });
    const host = desk.session(HOST, 'alpha', room);
    await host.act({ type: 'takeSpot', spot: 3 });
    assert.equal(host.view(null).spotChangeLocked, false);
    await host.act({ type: 'takeSpot', spot: 2 });
    assert.equal(host.view(null).spotChangeLocked, true);
    host.close();
  });

  it('relays chat through the host', async () => {
    const { host, guest, flush } = await table();
    guest.say('  hello  ');
    await flush();
    assert.deepEqual(host.view(null).chat.map((line) => `${line.login}: ${line.text}`), ['beta: hello']);
    assert.deepEqual(guest.view(null).chat.map((line) => line.text), ['hello']);
  });
});

describe('overrides of a game', () => {
  let session = '';
  const binDirectory = 'C:\\ProgramData\\TFAF\\bin';

  before(async () => {
    session = path.join(await mkdtemp(path.join(tmpdir(), 'tfaf-overrides-')), 'game-session');
  });
  after(() => rm(path.dirname(session), { recursive: true, force: true }));

  it('mounts them first, on the vault of the game, and leaves nothing behind', async () => {
    const vault = new GameVault();
    const initFile = await vault.prepare({
      directory: session,
      binDirectory,
      mapsDirectory: path.join(session, 'none'),
      modFolders: [],
      overrides: [{ path: 'lua/ui/lobby/lobby.lua', content: 'lobby' }],
    });
    const text = await readFile(initFile, 'utf8');
    assert.match(text, /custom_vault_path = ".*game-session\/vault"/);
    assert.match(text, /table\.insert\(path, 1, \{ dir = ".*overrides", mountpoint = "\/" \}\)/);
    assert.equal(await readFile(path.join(session, 'overrides', 'lua', 'ui', 'lobby', 'lobby.lua'), 'utf8'), 'lobby');
    await vault.release();
    await assert.rejects(readFile(initFile));
  });
});

describe('lobby map', () => {
  let folder = '';

  before(async () => {
    folder = path.join(await mkdtemp(path.join(tmpdir(), 'tfaf-lobby-map-')), 'theta.v0003');
    await mkdir(folder);
    await writeFile(
      path.join(folder, 'theta_scenario.lua'),
      `version = 3
ScenarioInfo = {
    name = "Theta Passage",
    size = {512, 256},
    Configurations = { ['standard'] = { teams = { { name = 'FFA', armies = {'ARMY_2', 'ARMY_1'} } } } },
}
`,
    );
    await writeFile(
      path.join(folder, 'theta_save.lua'),
      `Scenario = { MasterChain = { ['_MASTERCHAIN_'] = { Markers = {
    ['ARMY_1'] = { ['type'] = STRING('Blank Marker'), ['position'] = VECTOR3(256, 10, 128) },
    ['ARMY_2'] = { ['type'] = STRING('Blank Marker'), ['position'] = VECTOR3(128, 10, 64) },
} } } }
`,
    );
  });
  after(() => rm(path.dirname(folder), { recursive: true, force: true }));

  it('gives the start positions in slot order, in the square a preview centres the map in', async () => {
    assert.deepEqual(await readLobbyMap(folder), {
      folderName: 'theta.v0003',
      name: 'Theta Passage',
      scenario: '/maps/theta.v0003/theta_scenario.lua',
      spots: [
        { x: 0.25, y: 0.375 },
        { x: 0.5, y: 0.5 },
      ],
      adaptive: false,
    });
  });
});

describe('lobby option search', () => {
  const groups: LobbyOptionGroup[] = [
    {
      id: 'team',
      options: [{ key: 'TeamSpawn', label: 'Spawn', help: 'Where players start', defaultValue: 'fixed', choices: [{ value: 'fixed', label: 'Fixed', help: '' }] }],
    },
    {
      id: 'game',
      options: [
        { key: 'UnitCap', label: 'Unit cap', help: '', defaultValue: '1000', choices: [{ value: '1000', label: '1000', help: '' }] },
        { key: 'Share', label: 'Share conditions', help: '', defaultValue: 'FullShare', choices: [{ value: 'FullShare', label: 'Full share', help: '' }] },
      ],
    },
  ];

  it('finds options by name, description and values, and drops empty groups', () => {
    const found = (query: string) => searchLobbyOptions(groups, query).flatMap((group) => group.options.map((option) => option.key));
    assert.deepEqual(found('  UNIT '), ['UnitCap']);
    assert.deepEqual(found('players start'), ['TeamSpawn']);
    assert.deepEqual(found('full share'), ['Share']);
    assert.deepEqual(searchLobbyOptions(groups, 'nothing like this'), []);
  });

  it('leaves everything for an empty search', () => {
    assert.equal(searchLobbyOptions(groups, '  '), groups);
  });
});

describe('lobby AI picker', () => {
  const ai = (key: string, name: string, mod: string | null): LobbyAiType => ({ key, name, rating: 0, cheat: key.includes('cheat'), mod });
  const ais = [
    ai('easy', 'AI: Easy', null),
    ai('tm28ai', 'AI: TM28 Adaptive', 'TM28AI'),
    ai('rushcheat', 'Rush', null),
    ai('m28ai', 'AI: M28', 'M28AI'),
    ai('tm28aicheat', 'AIx: TM28 Adaptive', 'TM28AI'),
    ai('tm28aiair', 'AI: TM28 Air', 'TM28AI'),
  ];
  const found = (cheat: boolean, query: string) => groupLobbyAis(ais, cheat, query).map((group) => [group.mod, group.ais.map((entry) => entry.key)]);

  it('groups one kind of AI by its mod, the game first and the mods in the catalog order', () => {
    assert.deepEqual(found(false, ''), [
      [null, ['easy']],
      ['TM28AI', ['tm28ai', 'tm28aiair']],
      ['M28AI', ['m28ai']],
    ]);
    assert.deepEqual(found(true, ''), [
      [null, ['rushcheat']],
      ['TM28AI', ['tm28aicheat']],
    ]);
  });

  it('finds an AI by every word of a search in its name or mod, and drops empty groups', () => {
    assert.deepEqual(found(false, ' tm28  AIR '), [['TM28AI', ['tm28aiair']]]);
    assert.deepEqual(found(false, 'm28ai'), [
      ['TM28AI', ['tm28ai', 'tm28aiair']],
      ['M28AI', ['m28ai']],
    ]);
    assert.deepEqual(found(true, 'air'), []);
  });

  it('finds an AIx by its kind when its translated name does not say it', () => {
    assert.deepEqual(found(true, 'aix'), [
      [null, ['rushcheat']],
      ['TM28AI', ['tm28aicheat']],
    ]);
    assert.deepEqual(found(false, 'aix'), []);
  });
});

describe('lobby catalog', () => {
  let workDir = '';

  before(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'tfaf-lobby-catalog-'));
    const options = `
teamOptions = {
    { default = 1, label = "<LOC a_1>Spawn", help = "Where", key = 'TeamSpawn', values = { { text = "<LOC a_2>Fixed", help = "h", key = 'fixed' } } },
    { default = 1, label = "Teams", help = "", key = 'AutoTeams', values = { { text = "None", help = "", key = 'none' } } },
}
globalOpts = {
    { default = 2, label = "Unit cap", help = "", key = 'UnitCap', values = { '500', '1000' } },
    { default = 1, label = "Unrate", help = "", key = 'Unranked', values = { { text = "No", help = "", key = 'No' } } },
}
AIOpts = {}
`;
    const ai = `function GetAItypes()
    local aitypes = {
        {
            key = 'easy',
            name = "<LOC a_3>AI: Easy",

            rating = 200,
        },
    }
    table.insert(aitypes, { key = 'rushcheat', name = "AIx: Rush", rating = 450 })
    return aitypes
end
`;
    const colors = `GameColors = { PlayerColors = { "FFe80a0a", "ff901427" } }`;
    await writeFile(
      path.join(workDir, 'lua.nx2'),
      buildZip([
        { name: 'lua/ui/lobby/lobbyOptions.lua', content: options },
        { name: 'lua/ui/lobby/aitypes.lua', content: ai },
        { name: 'lua/GameColors.lua', content: colors },
      ]),
    );
    await writeFile(
      path.join(workDir, 'loc.nx2'),
      buildZip([
        { name: 'loc/US/strings_db.lua', content: 'a_1 = "Spawn"\na_2 = "Fixed"\na_3 = "AI: Easy"\n' },
        { name: 'loc/RU/strings_db.lua', content: 'a_1 = "Появление"\n' },
      ]),
    );
    await writeFile(path.join(workDir, 'etc.nx2'), buildZip([{ name: 'etc/faf/blacklist.lua', content: `local HARMFUL = "bad"\nBlacklist = {\n    ['AB-CD'] = HARMFUL,\n}\n` }]));
    const map = path.join(workDir, 'map');
    await mkdir(map);
    await writeFile(path.join(map, 'theta_scenario.lua'), 'ScenarioInfo = {}');
    await writeFile(path.join(map, 'theta_options.lua'), `options = { { default = 1, label = "Lava", help = "", key = 'lava', values = { { text = "On", help = "", key = 1 } } } }`);
    const mod = path.join(workDir, 'mod');
    await mkdir(path.join(mod, 'lua', 'AI', 'CustomAIs_v2'), { recursive: true });
    await writeFile(path.join(mod, 'lua', 'AI', 'CustomAIs_v2', 'tm28.lua'), `AI = { AIList = { { key = 'tm28', name = "TM28 AI" } }, CheatAIList = { { key = 'tm28cheat', name = "TM28 AIx" } } }`);
    await writeFile(path.join(mod, 'mod_info.lua'), `name = "TM28AI"\nuid = "tm28-uid"\n`);
    await mkdir(path.join(mod, 'lua', 'AI', 'LobbyOptions'), { recursive: true });
    await writeFile(
      path.join(mod, 'lua', 'AI', 'LobbyOptions', 'lobbyoptions.lua'),
      `AIOpts = {
    { default = 1, label = "Mod cap", help = "", key = 'UnitCap', values = { '1000', '5000' } },
    { default = 1, label = "Aggro", help = "", key = 'TM28Aggro', values = { { text = "High", help = "", key = 'high' } } },
}`,
    );
  });
  after(() => rm(workDir, { recursive: true, force: true }));

  const packages = (archives: string[]): GameFileSystem =>
    new GameFileSystem({ get: () => ({ dataPath: workDir, gamePath: null }) as Settings, mapsDirectory: workDir }, () => ({
      archives: archives.map((name) => path.join(workDir, name)),
      hooks: [],
    }));

  it('reads the options, AI types and colours of the game, the map and the mods', async () => {
    const catalog = await loadLobbyCatalog({
      files: packages(['lua.nx2', 'loc.nx2', 'etc.nx2']),
      locale: 'ru',
      mapFolder: path.join(workDir, 'map'),
      modFolders: [path.join(workDir, 'mod')],
      simModUids: [],
    });
    assert.deepEqual(catalog.groups.map((group) => group.id), ['team', 'game', 'map', 'mods']);
    const team = catalog.groups[0]!.options;
    assert.deepEqual(team.map((option) => option.key), ['TeamSpawn']);
    assert.equal(team[0]!.label, 'Появление');
    assert.equal(team[0]!.choices[0]!.label, 'Fixed');
    const game = catalog.groups[1]!.options;
    assert.deepEqual(game.map((option) => option.key), ['UnitCap']);
    assert.equal(game[0]!.defaultValue, '1000');
    // The mod's repeat of the unit cap adds its values to the game's entry instead of a second one.
    assert.deepEqual([game[0]!.label, game[0]!.choices.map((choice) => choice.value)], ['Unit cap', ['500', '1000', '5000']]);
    assert.deepEqual(catalog.groups[3]!.options.map((option) => option.key), ['TM28Aggro']);
    assert.equal(catalog.groups[2]!.options[0]!.defaultValue, 1);
    assert.deepEqual(catalog.ais.map(({ key }) => key), ['easy', 'rushcheat', 'tm28', 'tm28cheat']);
    assert.deepEqual(catalog.colors, ['#e80a0a', '#901427']);
    assert.deepEqual(catalog.restrictionPresets, []);
    assert.deepEqual(catalog.ais.map(({ rating }) => rating), [200, 450, 0, 0]);
    assert.deepEqual(catalog.ais.map(({ cheat, mod }) => [cheat, mod]), [
      [false, null],
      [true, null],
      [false, 'TM28AI'],
      [true, 'TM28AI'],
    ]);
    assert.deepEqual(catalog.bannedMods, ['ab-cd']);
  });

  it('names the options of a map and goes on without the list of banned mods', async () => {
    assert.deepEqual(await readMapOptionKeys(path.join(workDir, 'map')), ['lava']);
    assert.deepEqual(await readBannedMods(packages(['missing.nx2'])), []);
  });
});
