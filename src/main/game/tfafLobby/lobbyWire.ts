// The messages of a TFAF lobby between launchers, as JSON text (reliableMessages.ts). They come from other players, so
// everything is checked here, and anything out of shape is dropped.

import {
  isStoneMapFolder,
  isTfafLobbyFeaturedMod,
  LOBBY_AUTO_TEAMS,
  LOBBY_LIMITS,
  LOBBY_RESET_PARTS,
  type LobbyAbortReason,
  type LobbyAction,
  type LobbyAutoTeams,
  type LobbyChatLine,
  type LobbyFilesState,
  type LobbyLaunch,
  type LobbyLaunchArmy,
  type LobbyLaunchObserver,
  type LobbyMap,
  type LobbyMember,
  type LobbyOccupant,
  type LobbyOptionValue,
  type LobbyPreset,
  type LobbyRoom,
  type LobbySimMod,
  type LobbySlot,
  type LobbySpot,
} from '../../../shared/contract.ts';
import { isRestrictionKey } from '../../../shared/tfafLobby.ts';
import { asObject, asString } from '../../api/jsonApi.ts';
import { parseStoneMapRecipe } from '../../stoneMap/stoneMapRecipe.ts';
import { isSafeFolderName } from '../../vault/fsUtil.ts';

export type LobbyWireMessage =
  // From a player to the host. The host answers every `act` with `done`, applied or not.
  | { t: 'act'; id: number; action: LobbyAction }
  | { t: 'status'; files: LobbyFilesState; connected: number[] }
  | { t: 'say'; text: string }
  | { t: 'startFailed'; id: number }
  // From one player straight to another, past the host.
  | { t: 'whisper'; text: string }
  // From the host to the players.
  | { t: 'done'; id: number }
  | { t: 'room'; room: LobbyRoom }
  | { t: 'chat'; line: LobbyChatLine }
  | { t: 'start'; id: number; launch: LobbyLaunch }
  | { t: 'hostReady'; id: number }
  | { t: 'abort'; id: number; reason: LobbyAbortReason; login: string | null }
  | { t: 'kicked'; reason: string | null };

const MAX_LOGIN_LENGTH = 64;
const MAX_TITLE_LENGTH = 128;
const MAX_RATING = 100_000;
const MAX_AI_RATINGS = 64;
const MAX_NAME_LENGTH = 128;
const MAX_ID = 2 ** 31;
const FILES_STATES: readonly LobbyFilesState[] = ['preparing', 'ready', 'failed'];
const ABORT_REASONS: readonly LobbyAbortReason[] = ['hostCancelled', 'gameClosed', 'timeout', 'gameFailed'];
// Maps and mods name their options as they like.
const OPTION_KEY = /^[\x20-\x7e]+$/;
// The server takes a title in ASCII, as the create-game form does.
const GAME_TITLE = /^[\x20-\x7e]+$/;
const UID = /^[A-Za-z0-9_.-]{1,64}$/;
const FACTION_KEY = /^[A-Za-z0-9_]{1,32}$/;
const DIGEST = /^[0-9a-f]{64}$/;
// The scenario path, the title and the rules of a room are longer than a lobby option.
const MAX_LAUNCH_TEXT = 1024;
const MAX_LAUNCH_OPTIONS = LOBBY_LIMITS.maxOptions + 32;
const MAX_FACTIONS = 16;
// Teams a start deals out are renumbered from 2, one for each player at most.
const MAX_LAUNCH_TEAM = LOBBY_LIMITS.maxSlots + 1;

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function text(value: unknown, maxLength: number): string | null {
  const string = asString(value);
  return string !== null && string.length <= maxLength ? string : null;
}

function name(value: unknown, maxLength: number): string | null {
  const string = text(value, maxLength);
  return string ? string : null;
}

function list<T>(value: unknown, maxLength: number, parse: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > maxLength) {
    return null;
  }
  const items: T[] = [];
  for (const entry of value) {
    const item = parse(entry);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return items;
}

const playerId = (value: unknown): number | null => integer(value, 0, MAX_ID);
const spotNumber = (value: unknown): number | null => integer(value, 1, LOBBY_LIMITS.maxSlots);

function parseOptionValue(value: unknown): LobbyOptionValue | null {
  if (typeof value === 'string') {
    return value.length <= LOBBY_LIMITS.maxOptionTextLength ? value : null;
  }
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function optionKey(value: unknown): string | null {
  const key = text(value, LOBBY_LIMITS.maxOptionKeyLength);
  return key && OPTION_KEY.test(key) ? key : null;
}

export function parseAutoTeams(value: unknown): LobbyAutoTeams | null {
  return LOBBY_AUTO_TEAMS.find((mode) => mode === value) ?? null;
}

function parseRating(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_RATING ? value : null;
}

function parseAiRatings(input: unknown): Record<string, number> | null {
  const raw = asObject(input);
  if (!raw || Object.keys(raw).length > MAX_AI_RATINGS) {
    return null;
  }
  const ratings: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const rating = parseRating(value);
    if (rating === null || key.length > MAX_NAME_LENGTH) {
      return null;
    }
    ratings[key] = rating;
  }
  return ratings;
}

function parseRestrictions(value: unknown): string[] | null {
  return list(value, LOBBY_LIMITS.maxRestrictions, (entry) => {
    const key = asString(entry);
    return key !== null && isRestrictionKey(key) ? key : null;
  });
}

/** An action from the renderer or from a player; null for anything else. */
export function parseLobbyAction(input: unknown): LobbyAction | null {
  const raw = asObject(input);
  if (!raw) {
    return null;
  }
  const spot = spotNumber(raw.spot);
  switch (raw.type) {
    case 'setReady':
      return typeof raw.ready === 'boolean' ? { type: 'setReady', ready: raw.ready } : null;
    case 'takeSpot':
      return spot === null ? null : { type: 'takeSpot', spot };
    case 'observe':
      return { type: 'observe' };
    case 'setFaction':
    case 'setTeam':
    case 'setColor': {
      const field = raw.type === 'setFaction' ? 'faction' : raw.type === 'setTeam' ? 'team' : 'color';
      const value = integer(raw[field], 0, LOBBY_LIMITS.colors);
      if (spot === null || value === null) {
        return null;
      }
      return raw.type === 'setFaction'
        ? { type: 'setFaction', spot, faction: value }
        : raw.type === 'setTeam'
          ? { type: 'setTeam', spot, team: value }
          : { type: 'setColor', spot, color: value };
    }
    case 'setMap': {
      const folderName = name(raw.folderName, 255);
      return folderName && isSafeFolderName(folderName) ? { type: 'setMap', folderName } : null;
    }
    case 'setMods': {
      const modUids = list(raw.modUids, 256, (uid) => {
        const value = asString(uid);
        return value && UID.test(value) ? value : null;
      });
      return modUids ? { type: 'setMods', modUids } : null;
    }
    case 'setOption': {
      const key = optionKey(raw.key);
      const value = raw.value === null ? null : parseOptionValue(raw.value);
      return key === null || (value === null && raw.value !== null) ? null : { type: 'setOption', key, value };
    }
    case 'setRestrictions': {
      const restrictions = parseRestrictions(raw.restrictions);
      return restrictions ? { type: 'setRestrictions', restrictions } : null;
    }
    case 'resetOptions': {
      if (raw.part === undefined) {
        return { type: 'resetOptions' };
      }
      const part = LOBBY_RESET_PARTS.find((candidate) => candidate === raw.part);
      return part ? { type: 'resetOptions', part } : null;
    }
    case 'clearAi':
    case 'closeEmptySpots':
      return { type: raw.type };
    case 'setTitle': {
      const title = asString(raw.title)?.trim();
      return title && title.length <= LOBBY_LIMITS.maxTitleLength && GAME_TITLE.test(title) ? { type: 'setTitle', title } : null;
    }
    case 'setRules': {
      const rules = text(raw.rules, LOBBY_LIMITS.maxRulesLength);
      return rules === null ? null : { type: 'setRules', rules };
    }
    case 'fillAi': {
      const personality = name(raw.personality, MAX_NAME_LENGTH);
      const aiName = name(raw.name, MAX_NAME_LENGTH);
      return !personality || !aiName ? null : { type: 'fillAi', personality, name: aiName };
    }
    case 'addAi': {
      const personality = name(raw.personality, MAX_NAME_LENGTH);
      const aiName = name(raw.name, MAX_NAME_LENGTH);
      return spot === null || !personality || !aiName ? null : { type: 'addAi', spot, personality, name: aiName };
    }
    case 'clearSpot':
      return spot === null ? null : { type: 'clearSpot', spot };
    case 'closeSpot':
      return spot === null || typeof raw.closed !== 'boolean' ? null : { type: 'closeSpot', spot, closed: raw.closed, spawnMex: raw.spawnMex === true };
    case 'swapSpots': {
      const from = spotNumber(raw.from);
      const to = spotNumber(raw.to);
      return from === null || to === null ? null : { type: 'swapSpots', from, to };
    }
    case 'splitTeams': {
      const teams = integer(raw.teams, 0, LOBBY_LIMITS.maxTeam - 1);
      return teams === null ? null : { type: 'splitTeams', teams };
    }
    case 'setAutoTeams': {
      const mode = parseAutoTeams(raw.mode);
      return mode ? { type: 'setAutoTeams', mode } : null;
    }
    case 'cycleManualTeam':
      return spot === null ? null : { type: 'cycleManualTeam', spot };
    case 'autobalance': {
      const aiRatings = parseAiRatings(raw.aiRatings);
      return aiRatings ? { type: 'autobalance', aiRatings } : null;
    }
    case 'kick': {
      const id = playerId(raw.playerId);
      const reason = raw.reason === undefined ? undefined : text(raw.reason, LOBBY_LIMITS.maxKickReasonLength);
      return id === null || reason === null ? null : { type: 'kick', playerId: id, ...(reason ? { reason } : {}) };
    }
    default:
      return null;
  }
}

function parseFactionKeys(value: unknown): string[] | null {
  return list(value, MAX_FACTIONS, (entry) => {
    const key = asString(entry);
    return key !== null && FACTION_KEY.test(key) ? key : null;
  });
}

function parseSpot(input: unknown): LobbySpot | null {
  const raw = asObject(input);
  const x = raw?.x;
  const y = raw?.y;
  const factions = raw?.factions === undefined ? undefined : parseFactionKeys(raw.factions);
  if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || x > 1 || y < 0 || y > 1 || factions === null) {
    return null;
  }
  return factions ? { x, y, factions } : { x, y };
}

function parseMap(input: unknown): LobbyMap | null {
  const raw = asObject(input);
  const folderName = name(raw?.folderName, 255);
  const mapName = text(raw?.name, MAX_NAME_LENGTH);
  const scenario = name(raw?.scenario, 600);
  const spots = list(raw?.spots, LOBBY_LIMITS.maxSlots, parseSpot);
  if (!folderName || !isSafeFolderName(folderName) || mapName === null || !spots || !scenario) {
    return null;
  }
  // The scenario must lie directly in the map's folder, as a game path.
  const [empty, maps, folder, file, ...rest] = scenario.split('/');
  const valid =
    empty === '' &&
    maps?.toLowerCase() === 'maps' &&
    folder?.toLowerCase() === folderName.toLowerCase() &&
    file !== undefined &&
    isSafeFolderName(file) &&
    file.toLowerCase().endsWith('_scenario.lua') &&
    rest.length === 0;
  if (!valid) {
    return null;
  }
  // A recipe that does not check out is left out: the player then needs the map like any map outside the vault.
  const recipe = isStoneMapFolder(folderName) ? parseStoneMapRecipe(raw?.recipe) : null;
  return { folderName, name: mapName, scenario, spots, adaptive: raw?.adaptive === true, ...(recipe ? { recipe } : {}) };
}

function parseSimMod(input: unknown): LobbySimMod | null {
  const raw = asObject(input);
  const uid = asString(raw?.uid);
  const modName = text(raw?.name, MAX_NAME_LENGTH);
  return uid && UID.test(uid) && modName !== null ? { uid, name: modName } : null;
}

function parseOccupant(input: unknown): LobbyOccupant | null {
  const raw = asObject(input);
  if (raw?.kind === 'player') {
    const id = playerId(raw.playerId);
    return id === null ? null : { kind: 'player', playerId: id };
  }
  const personality = name(raw?.personality, MAX_NAME_LENGTH);
  const aiName = name(raw?.name, MAX_NAME_LENGTH);
  return raw?.kind === 'ai' && personality && aiName ? { kind: 'ai', personality, name: aiName } : null;
}

function parseSlot(input: unknown): LobbySlot | null {
  const raw = asObject(input);
  const spot = spotNumber(raw?.spot);
  const occupant = raw?.occupant === null ? null : parseOccupant(raw?.occupant);
  const team = integer(raw?.team, 0, LOBBY_LIMITS.maxTeam);
  const faction = integer(raw?.faction, 0, 16);
  const color = integer(raw?.color, 0, LOBBY_LIMITS.colors);
  if (!raw || spot === null || team === null || faction === null || color === null || typeof raw.closed !== 'boolean') {
    return null;
  }
  return occupant === null && raw.occupant !== null ? null : { spot, occupant, team, faction, color, closed: raw.closed, spawnMex: raw.spawnMex === true };
}

function parseMember(input: unknown): LobbyMember | null {
  const raw = asObject(input);
  const id = playerId(raw?.id);
  const login = name(raw?.login, MAX_LOGIN_LENGTH);
  const clan = raw?.clan === null ? null : text(raw?.clan, MAX_LOGIN_LENGTH);
  const country = raw?.country === null ? null : text(raw?.country, MAX_LOGIN_LENGTH);
  const rating = raw?.rating === null ? null : integer(raw?.rating, -100_000, 100_000);
  const files = FILES_STATES.find((state) => state === raw?.files);
  const connected = list(raw?.connected, LOBBY_LIMITS.maxSlots * 2, playerId);
  if (!raw || id === null || !login || typeof raw.ready !== 'boolean' || !files || !connected) {
    return null;
  }
  if ((clan === null && raw.clan !== null) || (country === null && raw.country !== null) || (rating === null && raw.rating !== null)) {
    return null;
  }
  // A host on 0.11.0 or older does not send these.
  const games = raw.games == null ? null : integer(raw.games, 0, MAX_ID);
  const mean = raw.mean == null ? null : parseRating(raw.mean);
  const deviation = raw.deviation == null ? null : parseRating(raw.deviation);
  if ((games === null && raw.games != null) || (mean === null && raw.mean != null) || (deviation === null && raw.deviation != null)) {
    return null;
  }
  return { id, login, clan, country, rating, games, mean, deviation, ready: raw.ready, files, connected };
}

export function parseOptions(input: unknown): Record<string, LobbyOptionValue> | null {
  const raw = asObject(input);
  if (!raw || Object.keys(raw).length > LOBBY_LIMITS.maxOptions) {
    return null;
  }
  const options: Record<string, LobbyOptionValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseOptionValue(value);
    if (optionKey(key) === null || parsed === null) {
      return null;
    }
    options[key] = parsed;
  }
  return options;
}

function parseTeams(value: unknown): number[] | null {
  return list(value, LOBBY_LIMITS.maxSlots, (team) => integer(team, 0, LOBBY_LIMITS.maxTeam));
}

/** A preset from the launcher's own file; null for one that does not fit any more. */
export function parseLobbyPreset(input: unknown): LobbyPreset | null {
  const raw = asObject(input);
  const id = name(raw?.id, 64);
  const presetName = name(raw?.name, LOBBY_LIMITS.maxPresetName);
  const simMods = list(raw?.simMods, LOBBY_LIMITS.maxSimMods, parseSimMod);
  const options = parseOptions(raw?.options);
  const restrictions = parseRestrictions(raw?.restrictions);
  return id && presetName && simMods && options && restrictions ? { id, name: presetName, simMods, options, restrictions } : null;
}

function parseRoom(input: unknown): LobbyRoom | null {
  const raw = asObject(input);
  const revision = integer(raw?.revision, 1, Number.MAX_SAFE_INTEGER);
  const hostId = playerId(raw?.hostId);
  const title = text(raw?.title, MAX_TITLE_LENGTH);
  const featuredMod = name(raw?.featuredMod, 64);
  const factions = parseFactionKeys(raw?.factions);
  const map = parseMap(raw?.map);
  const simMods = list(raw?.simMods, LOBBY_LIMITS.maxSimMods, parseSimMod);
  const options = parseOptions(raw?.options);
  // A host on 0.11.0 or older does not send them.
  const restrictions = raw?.restrictions === undefined ? [] : parseRestrictions(raw.restrictions);
  const rules = raw?.rules === undefined ? '' : text(raw.rules, LOBBY_LIMITS.maxRulesLength);
  const autoTeams = raw?.autoTeams === undefined ? 'none' : parseAutoTeams(raw.autoTeams);
  const manualTeams = raw?.manualTeams === undefined ? [] : parseTeams(raw.manualTeams);
  const slots = list(raw?.slots, LOBBY_LIMITS.maxSlots, parseSlot);
  const members = list(raw?.members, LOBBY_LIMITS.maxSlots * 2, parseMember);
  const observers = list(raw?.observers, LOBBY_LIMITS.maxSlots * 2, playerId);
  if (revision === null || hostId === null || title === null || !featuredMod || !isTfafLobbyFeaturedMod(featuredMod) || !factions || factions.length === 0) {
    return null;
  }
  if ((raw?.phase !== 'open' && raw?.phase !== 'starting') || !map || !simMods || !options || !restrictions || !slots || !members || !observers) {
    return null;
  }
  if (typeof raw.modIsolation !== 'boolean' || rules === null || !autoTeams || !manualTeams) {
    return null;
  }
  return {
    revision,
    hostId,
    title,
    featuredMod,
    factions,
    phase: raw.phase,
    map,
    simMods,
    modIsolation: raw.modIsolation,
    options,
    restrictions,
    rules,
    autoTeams,
    manualTeams,
    slots,
    members,
    observers,
  };
}

function parseLaunchOptions(input: unknown): Record<string, LobbyOptionValue> | null {
  const raw = asObject(input);
  if (!raw || Object.keys(raw).length > MAX_LAUNCH_OPTIONS) {
    return null;
  }
  const options: Record<string, LobbyOptionValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    const valid = typeof value === 'string' ? value.length <= MAX_LAUNCH_TEXT : typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    if (optionKey(key) === null || !valid) {
      return null;
    }
    options[key] = value as LobbyOptionValue;
  }
  return options;
}

function parseLaunchArmy(input: unknown): LobbyLaunchArmy | null {
  const raw = asObject(input);
  const spot = spotNumber(raw?.spot);
  const id = raw?.playerId === null ? null : playerId(raw?.playerId);
  const armyName = name(raw?.name, MAX_NAME_LENGTH);
  const lobbyName = name(raw?.lobbyName, MAX_NAME_LENGTH);
  const ai = raw?.ai === null ? null : name(raw?.ai, MAX_NAME_LENGTH);
  const faction = integer(raw?.faction, 1, MAX_FACTIONS);
  const team = integer(raw?.team, 0, MAX_LAUNCH_TEAM);
  const color = integer(raw?.color, 0, LOBBY_LIMITS.colors);
  const mean = parseRating(raw?.mean);
  const deviation = parseRating(raw?.deviation);
  const rating = parseRating(raw?.rating);
  const games = integer(raw?.games, 0, MAX_ID);
  const clan = text(raw?.clan, MAX_LOGIN_LENGTH);
  const country = raw?.country === null ? null : text(raw?.country, MAX_LOGIN_LENGTH);
  if (!raw || spot === null || (id === null && raw.playerId !== null) || !armyName || !lobbyName || (ai === null && raw.ai !== null)) {
    return null;
  }
  if ((id === null) === (ai === null) || faction === null || team === null || color === null || mean === null || deviation === null) {
    return null;
  }
  if (rating === null || games === null || clan === null || (country === null && raw.country !== null)) {
    return null;
  }
  return { spot, playerId: id, name: armyName, lobbyName, ai, faction, team, color, mean, deviation, rating, games, clan, country };
}

function parseLaunchObserver(input: unknown): LobbyLaunchObserver | null {
  const raw = asObject(input);
  const id = playerId(raw?.playerId);
  const observerName = name(raw?.name, MAX_LOGIN_LENGTH);
  return id !== null && observerName ? { playerId: id, name: observerName } : null;
}

/** The match of a start as the host's launcher settled it; its digest is checked by the session. */
export function parseLaunch(input: unknown): LobbyLaunch | null {
  const raw = asObject(input);
  const featuredMod = name(raw?.featuredMod, 64);
  const factions = parseFactionKeys(raw?.factions);
  const options = parseLaunchOptions(raw?.options);
  const restrictions = parseRestrictions(raw?.restrictions);
  const spawnMex = raw?.spawnMex === null ? null : list(raw?.spawnMex, LOBBY_LIMITS.maxSlots, spotNumber);
  const positionGroups =
    raw?.positionGroups === null ? null : list(raw?.positionGroups, LOBBY_LIMITS.maxSlots, (group) => list(group, LOBBY_LIMITS.maxSlots, spotNumber));
  const armies = list(raw?.armies, LOBBY_LIMITS.maxSlots, parseLaunchArmy);
  const observers = list(raw?.observers, LOBBY_LIMITS.maxSlots * 2, parseLaunchObserver);
  const simMods = list(raw?.simMods, LOBBY_LIMITS.maxSimMods, (entry) => {
    const uid = asString(entry);
    return uid !== null && UID.test(uid) ? uid : null;
  });
  const digest = asString(raw?.digest);
  if (!raw || !featuredMod || !isTfafLobbyFeaturedMod(featuredMod) || !factions || !options || !restrictions || !armies || !observers || !simMods) {
    return null;
  }
  if ((spawnMex === null && raw.spawnMex !== null) || (positionGroups === null && raw.positionGroups !== null) || !digest || !DIGEST.test(digest)) {
    return null;
  }
  return { featuredMod, factions, options, restrictions, spawnMex, positionGroups, armies, observers, simMods, digest };
}

function parseChatLine(input: unknown): LobbyChatLine | null {
  const raw = asObject(input);
  const id = integer(raw?.id, 0, Number.MAX_SAFE_INTEGER);
  const senderId = raw?.senderId === null ? null : playerId(raw?.senderId);
  const login = text(raw?.login, MAX_LOGIN_LENGTH);
  const lineText = name(raw?.text, LOBBY_LIMITS.maxChatLength);
  const at = text(raw?.at, 40);
  if (id === null || (senderId === null && raw?.senderId !== null) || login === null || !lineText || !at || Number.isNaN(Date.parse(at))) {
    return null;
  }
  return { id, senderId, login, text: lineText, at };
}

export function serializeLobbyMessage(message: LobbyWireMessage): string {
  return JSON.stringify(message);
}

/** Null for anything but a well-formed message. */
export function parseLobbyMessage(input: string): LobbyWireMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  const raw = asObject(value);
  const id = integer(raw?.id, 0, Number.MAX_SAFE_INTEGER);
  switch (raw?.t) {
    case 'act': {
      const action = parseLobbyAction(raw.action);
      return action && id !== null ? { t: 'act', id, action } : null;
    }
    case 'status': {
      const files = FILES_STATES.find((state) => state === raw.files);
      const connected = list(raw.connected, LOBBY_LIMITS.maxSlots * 2, playerId);
      return files && connected ? { t: 'status', files, connected } : null;
    }
    case 'say':
    case 'whisper': {
      const said = name(raw.text, LOBBY_LIMITS.maxChatLength);
      return said ? { t: raw.t, text: said } : null;
    }
    case 'room': {
      const room = parseRoom(raw.room);
      return room ? { t: 'room', room } : null;
    }
    case 'chat': {
      const line = parseChatLine(raw.line);
      return line ? { t: 'chat', line } : null;
    }
    case 'start': {
      const launch = parseLaunch(raw.launch);
      return id !== null && launch ? { t: 'start', id, launch } : null;
    }
    case 'done':
    case 'hostReady':
    case 'startFailed':
      return id === null ? null : { t: raw.t, id };
    case 'abort': {
      const reason = ABORT_REASONS.find((candidate) => candidate === raw.reason);
      const login = raw.login === null ? null : text(raw.login, MAX_LOGIN_LENGTH);
      return id === null || !reason || (login === null && raw.login !== null) ? null : { t: 'abort', id, reason, login };
    }
    case 'kicked':
      return { t: 'kicked', reason: text(raw.reason, LOBBY_LIMITS.maxKickReasonLength) || null };
    default:
      return null;
  }
}
