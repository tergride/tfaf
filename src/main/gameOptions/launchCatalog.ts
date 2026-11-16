// What the host's launcher needs of the game's scripts to settle a start of a TFAF lobby the way the game's lobby
// would (lobby.lua `TryLaunch`): the factions by their numbers, the names an AI gets, how an AI is rated and the
// default of every option. Scripts come from the packages of the room's featured mod, with their hooks.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LobbyOptionValue } from '../../shared/contract.ts';
import { findLuaDefinition } from '../lua/luaChunks.ts';
import { LuaFunction, LuaTable, type LuaValue, luaPath, luaString, luaTable, parseLua } from '../lua/luaParser.ts';
import { readFactions } from './factionCatalog.ts';
import { arrayOf } from './gameFiles.ts';
import { type GameScripts, requiredScript } from './gamePackages.ts';
import { loadLobbyCatalog } from './lobbyCatalog.ts';

const AI_TYPES_FILE = 'lua/ui/lobby/aitypes.lua';
const AI_NAMES_FILE = 'lua/ui/lobby/aiNames.lua';
const MOD_AI_FOLDER = path.join('lua', 'AI', 'CustomAIs_v2');
const SCENARIO_SUFFIX = '_scenario.lua';

/** The fields of an AI type that `ComputeAIRating` reads. */
export interface AiRating {
  rating: number | null;
  cheatMultiplier: number;
  buildMultiplier: number;
  omniBonus: number;
  negativeThreshold: number | null;
  /** By the longer side of the map. */
  mapMultiplier: ReadonlyMap<number, number>;
}

export interface LaunchCatalog {
  /** Faction keys by number, from 1: the four of the game, then the custom ones of the featured mod. */
  factions: string[];
  /** By faction key. */
  aiNames: ReadonlyMap<string, readonly string[]>;
  /** By AI type. */
  aiRatings: ReadonlyMap<string, AiRating>;
  /** Every option the room's lobby offers, with the game's default. */
  defaults: Record<string, LobbyOptionValue>;
  /** The longer side of the map (`ScenarioInfo.size`); null when the map cannot be read. */
  mapSize: number | null;
}

export interface LaunchCatalogSource {
  files: GameScripts;
  mapFolder: string | null;
  /** The folders of the room's sim mods. */
  modFolders: readonly string[];
  /** Their uids, which a custom faction may require. */
  simModUids: readonly string[];
}

function numberOr(value: LuaValue, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function aiRating(entry: LuaValue): [string, AiRating] | null {
  const table = luaTable(entry);
  const key = luaString(table?.get('key') ?? null);
  if (!table || !key) {
    return null;
  }
  const multipliers = luaTable(table.get('ratingMapMultiplier'));
  const mapMultiplier = new Map<number, number>();
  for (const size of multipliers?.keys() ?? []) {
    const multiplier = multipliers!.get(size);
    if (typeof size === 'number' && typeof multiplier === 'number') {
      mapMultiplier.set(size, multiplier);
    }
  }
  const rating = table.get('rating');
  const threshold = table.get('ratingNegativeThreshold');
  return [
    key,
    {
      rating: typeof rating === 'number' ? rating : null,
      cheatMultiplier: numberOr(table.get('ratingCheatMultiplier'), 0),
      buildMultiplier: numberOr(table.get('ratingBuildMultiplier'), 0),
      omniBonus: numberOr(table.get('ratingOmniBonus'), 0),
      negativeThreshold: typeof threshold === 'number' ? threshold : null,
      mapMultiplier,
    },
  ];
}

/** `table.insert` and `table.merged`, which the AI scripts build their lists with. */
function tableLibrary(): LuaTable {
  const library = new LuaTable();
  library.set(
    'insert',
    new LuaFunction(([list, position, value]) => {
      const table = luaTable(list ?? null);
      if (table && value === undefined) {
        table.set(table.length + 1, position ?? null);
      } else if (table && typeof position === 'number') {
        for (let index = table.length; index >= position; index--) {
          table.set(index + 1, table.get(index));
        }
        table.set(position, value ?? null);
      }
      return null;
    }),
  );
  library.set(
    'merged',
    new LuaFunction((tables) => {
      const merged = new LuaTable();
      for (const table of tables.map((value) => luaTable(value))) {
        for (const key of table?.keys() ?? []) {
          merged.set(key, table!.get(key));
        }
      }
      return merged;
    }),
  );
  return library;
}

/** The game's AI types: the list `GetAItypes` builds before it looks for mods, which come from the room instead. */
export function readBuiltInAiRatings(aiTypes: string): Map<string, AiRating> {
  const body = findLuaDefinition(aiTypes, 'GetAItypes')?.body ?? '';
  const list = parseLua(body, { lenient: true, globals: [['table', tableLibrary()]] }).get('aitypes') ?? null;
  return new Map(arrayOf(list).map(aiRating).filter((entry) => entry !== null));
}

async function readModAiRatings(modFolder: string): Promise<[string, AiRating][]> {
  const folder = path.join(modFolder, MOD_AI_FOLDER);
  const files = await readdir(folder).catch(() => []);
  const ratings: [string, AiRating][] = [];
  for (const file of files.filter((name) => name.toLowerCase().endsWith('.lua'))) {
    const ai = parseLua(await readFile(path.join(folder, file), 'utf8'), { lenient: true }).get('AI') ?? null;
    for (const entry of [...arrayOf(luaPath(ai, 'AIList')), ...arrayOf(luaPath(ai, 'CheatAIList'))]) {
      const rating = aiRating(entry);
      if (rating) {
        ratings.push(rating);
      }
    }
  }
  return ratings;
}

/** The names of AIs by faction key, as aiNames.lua and the hooks of the featured mod leave them. */
export function readAiNames(aiNames: string): Map<string, string[]> {
  const names = luaTable(parseLua(aiNames, { lenient: true, globals: [['table', tableLibrary()]] }).get('ainames') ?? null);
  const byFaction = new Map<string, string[]>();
  for (const key of names?.keys() ?? []) {
    const list = arrayOf(names!.get(key))
      .map(luaString)
      .filter((name) => name !== null);
    if (typeof key === 'string' && list.length > 0) {
      byFaction.set(key, list);
    }
  }
  return byFaction;
}

/** The longer side of the map, which `ComputeAIRating` weighs an AI by. */
export async function readMapSize(mapFolder: string): Promise<number | null> {
  const files = await readdir(mapFolder).catch(() => []);
  const scenario = files.find((file) => file.toLowerCase().endsWith(SCENARIO_SUFFIX));
  if (!scenario) {
    return null;
  }
  const info = parseLua(await readFile(path.join(mapFolder, scenario), 'utf8'), { lenient: true }).get('ScenarioInfo') ?? null;
  const width = luaPath(info, 'size', 1);
  const height = luaPath(info, 'size', 2);
  return typeof width === 'number' && typeof height === 'number' ? Math.max(width, height) : null;
}

export async function loadLaunchCatalog({ files, mapFolder, modFolders, simModUids }: LaunchCatalogSource): Promise<LaunchCatalog> {
  const [lobby, aiTypes, aiNames, factions, mapSize] = await Promise.all([
    loadLobbyCatalog({ files, locale: 'en', mapFolder, modFolders: [...modFolders], simModUids }),
    requiredScript(files, AI_TYPES_FILE),
    requiredScript(files, AI_NAMES_FILE),
    readFactions(files, simModUids),
    mapFolder ? readMapSize(mapFolder) : null,
  ]);
  const aiRatings = readBuiltInAiRatings(aiTypes);
  for (const folder of modFolders) {
    for (const [key, rating] of await readModAiRatings(folder)) {
      aiRatings.set(key, rating);
    }
  }
  const defaults: Record<string, LobbyOptionValue> = {};
  for (const group of lobby.groups) {
    for (const option of group.options) {
      defaults[option.key] = option.defaultValue;
    }
  }
  return { factions, aiNames: readAiNames(aiNames), aiRatings, defaults, mapSize };
}
