// What a TFAF lobby can choose from, read from the same files as the game's own lobby of the room's featured mod: the
// options of lobbyOptions.lua, those of the map and of AI mods, the AI types and the colours. Game scripts come with
// their hooks (gamePackages.ts) and are read with the lenient parser; the AI list of aitypes.lua sits inside a
// function, so its entries are picked out of the text.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  LobbyAiType,
  LobbyCatalog,
  LobbyOption,
  LobbyOptionChoice,
  LobbyOptionGroup,
  LobbyOptionGroupId,
  LobbyOptionValue,
} from '../../shared/contract.ts';
import { LOCKED_LOBBY_OPTIONS } from '../../shared/contract.ts';
import type { Locale } from '../../shared/i18n/index.ts';
import { type LuaValue, luaPath, luaString, luaTable, parseLua } from '../lua/luaParser.ts';
import { readLobbyFactions } from './factionCatalog.ts';
import { arrayOf, loadPackageStrings, localizer } from './gameFiles.ts';
import { type GameScripts, requiredScript } from './gamePackages.ts';
import { readRestrictionPresets, RESTRICTIONS_FILE } from './unitCatalog.ts';

const OPTIONS_FILE = 'lua/ui/lobby/lobbyOptions.lua';
const AI_FILE = 'lua/ui/lobby/aitypes.lua';
const COLORS_FILE = 'lua/GameColors.lua';
const BLACKLIST_FILE = 'etc/faf/blacklist.lua';
const BUILT_IN_AI = /key\s*=\s*['"]([^'"]+)['"]\s*,\s*name\s*=\s*"([^"]*)"\s*(?:,\s*rating\s*=\s*(\d+))?/g;
const MOD_AI_FOLDER = path.join('lua', 'AI', 'CustomAIs_v2');
const MOD_INFO_FILE = 'mod_info.lua';
const MOD_OPTIONS_FILE = path.join('lua', 'AI', 'LobbyOptions', 'lobbyoptions.lua');
const SCENARIO_SUFFIX = '_scenario.lua';
const MAP_OPTIONS_SUFFIX = '_options.lua';
// Teams are chosen in the room, so the game's automatic teams stay off.
const ROOM_OPTIONS = new Set(['AutoTeams', ...Object.keys(LOCKED_LOBBY_OPTIONS)]);

function optionValue(value: LuaValue): LobbyOptionValue | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

function readChoice(entry: LuaValue, localize: (text: string) => string): LobbyOptionChoice | null {
  const table = luaTable(entry);
  if (!table) {
    // Some options list their values as plain text.
    const value = optionValue(entry);
    return value === null ? null : { value, label: localize(String(value)), help: '' };
  }
  const value = optionValue(table.get('key'));
  if (value === null) {
    return null;
  }
  return { value, label: localize(luaString(table.get('text')) ?? String(value)), help: localize(luaString(table.get('help')) ?? '') };
}

function readOption(entry: LuaValue, localize: (text: string) => string): LobbyOption | null {
  const table = luaTable(entry);
  const key = luaString(table?.get('key') ?? null);
  const values = arrayOf(table?.get('values') ?? null);
  if (!table || !key || ROOM_OPTIONS.has(key) || values.length === 0) {
    return null;
  }
  const choices = values.map((value) => readChoice(value, localize)).filter((choice) => choice !== null);
  const index = table.get('default');
  // The default is a position in the values, from 1.
  const defaultChoice = (typeof index === 'number' ? choices[index - 1] : null) ?? choices[0];
  if (!defaultChoice) {
    return null;
  }
  return {
    key,
    label: localize(luaString(table.get('label')) ?? key),
    help: localize(luaString(table.get('help')) ?? ''),
    defaultValue: defaultChoice.value,
    choices,
  };
}

function readOptions(value: LuaValue, localize: (text: string) => string): LobbyOption[] {
  return arrayOf(value)
    .map((entry) => readOption(entry, localize))
    .filter((option) => option !== null);
}

function group(id: LobbyOptionGroupId, options: LobbyOption[]): LobbyOptionGroup[] {
  return options.length > 0 ? [{ id, options }] : [];
}

/**
 * One entry per key, where it comes first. AI mods repeat options of the game to offer more values (M28AI and TM28AI:
 * unit caps up to 10000, AIx multipliers up to 10). The game's lobby drops a mod's repeat of an AI option and shows a
 * repeat of any other option twice; here the first entry keeps its label and default and gets the repeat's new values.
 */
function mergeRepeatedOptions(groups: readonly LobbyOptionGroup[]): LobbyOptionGroup[] {
  const firsts = new Map<string, LobbyOption>();
  return groups.flatMap(({ id, options }) =>
    group(
      id,
      options.flatMap((option) => {
        const first = firsts.get(option.key);
        if (!first) {
          const kept = { ...option, choices: [...option.choices] };
          firsts.set(option.key, kept);
          return [kept];
        }
        first.choices.push(...option.choices.filter((choice) => !first.choices.some((known) => known.value === choice.value)));
        return [];
      }),
    ),
  );
}

function aiType(key: string, name: string, rating: number, mod: string | null): LobbyAiType {
  // The game's AI brains switch the cheats on by `string.find(personality, 'cheat')`, whichever list the AI is in.
  return { key, name, rating, cheat: key.includes('cheat'), mod };
}

function readBuiltInAis(source: string, localize: (text: string) => string): LobbyAiType[] {
  return [...source.matchAll(BUILT_IN_AI)].map(([, key, name, rating]) => aiType(key!, localize(name!), Number(rating ?? 0), null));
}

function readAiList(value: LuaValue, localize: (text: string) => string, mod: string): LobbyAiType[] {
  return arrayOf(value).flatMap((entry) => {
    const key = luaString(luaTable(entry)?.get('key') ?? null);
    const name = luaString(luaTable(entry)?.get('name') ?? null);
    const rating = luaTable(entry)?.get('rating');
    return key ? [aiType(key, localize(name ?? key), typeof rating === 'number' ? rating : 0, mod)] : [];
  });
}

async function readModName(modFolder: string): Promise<string> {
  const source = await readFile(path.join(modFolder, MOD_INFO_FILE), 'utf8').catch(() => null);
  const name = source === null ? null : luaString(parseLua(source, { lenient: true }).get('name') ?? null);
  return name || path.basename(modFolder);
}

async function readModAis(modFolder: string, localize: (text: string) => string): Promise<LobbyAiType[]> {
  const folder = path.join(modFolder, MOD_AI_FOLDER);
  const files = (await readdir(folder).catch(() => [])).filter((name) => name.toLowerCase().endsWith('.lua'));
  const mod = files.length > 0 ? await readModName(modFolder) : '';
  const ais: LobbyAiType[] = [];
  for (const file of files) {
    const script = parseLua(await readFile(path.join(folder, file), 'utf8'), { lenient: true });
    const ai = script.get('AI') ?? null;
    ais.push(...readAiList(luaPath(ai, 'AIList'), localize, mod), ...readAiList(luaPath(ai, 'CheatAIList'), localize, mod));
  }
  return ais;
}

async function readLuaGlobal(file: string, name: string): Promise<LuaValue> {
  const source = await readFile(file, 'utf8').catch(() => null);
  return source === null ? null : (parseLua(source, { lenient: true }).get(name) ?? null);
}

async function mapOptionsFile(mapFolder: string): Promise<string | null> {
  const files = await readdir(mapFolder).catch(() => []);
  const scenario = files.find((file) => file.toLowerCase().endsWith(SCENARIO_SUFFIX));
  const wanted = scenario?.toLowerCase().replace(SCENARIO_SUFFIX, MAP_OPTIONS_SUFFIX);
  const found = files.find((file) => file.toLowerCase() === wanted);
  return found ? path.join(mapFolder, found) : null;
}

function readColors(gameColors: LuaValue): string[] {
  return arrayOf(luaPath(gameColors, 'PlayerColors'))
    .map(luaString)
    .filter((color) => color !== null)
    .map((color) => `#${color.slice(-6).toLowerCase()}`);
}

/** The keys of a map's own options, which mean nothing on another map. */
export async function readMapOptionKeys(mapFolder: string): Promise<string[]> {
  const file = await mapOptionsFile(mapFolder);
  const options = file ? arrayOf(await readLuaGlobal(file, 'options')) : [];
  return options.map((option) => luaString(luaTable(option)?.get('key') ?? null)).filter((key) => key !== null);
}

/** Mods the game's lobby refuses, in lower case. */
export async function readBannedMods(files: Pick<GameScripts, 'script'>): Promise<string[]> {
  const text = await files.script(BLACKLIST_FILE).catch(() => null);
  const list = text ? luaTable(parseLua(text, { lenient: true }).get('Blacklist') ?? null) : null;
  return (list?.keys() ?? []).map((uid) => String(uid).toLowerCase());
}

export interface LobbyCatalogSource {
  /** The packages of the room's featured mod. */
  files: GameScripts;
  locale: Locale;
  /** The room's map, when the player has it. */
  mapFolder: string | null;
  /** The folders of the room's sim mods. */
  modFolders: string[];
  /** Their uids, which a custom faction may require. */
  simModUids: readonly string[];
}

export async function loadLobbyCatalog({ files, locale, mapFolder, modFolders, simModUids }: LobbyCatalogSource): Promise<LobbyCatalog> {
  const [optionsScript, aiScript, colorsScript, restrictions, strings] = await Promise.all([
    requiredScript(files, OPTIONS_FILE),
    requiredScript(files, AI_FILE),
    requiredScript(files, COLORS_FILE),
    files.script(RESTRICTIONS_FILE),
    loadPackageStrings(files),
  ]);
  const localize = localizer({ strings }, locale);
  const options = parseLua(optionsScript, { lenient: true });

  const modOptions: LobbyOption[] = [];
  const ais = readBuiltInAis(aiScript, localize);
  for (const folder of modFolders) {
    modOptions.push(...readOptions(await readLuaGlobal(path.join(folder, MOD_OPTIONS_FILE), 'AIOpts'), localize));
    ais.push(...(await readModAis(folder, localize)));
  }
  const mapOptions = mapFolder ? await mapOptionsFile(mapFolder) : null;

  return {
    factions: await readLobbyFactions(files, simModUids, localize),
    groups: mergeRepeatedOptions([
      ...group('team', readOptions(options.get('teamOptions') ?? null, localize)),
      ...group('game', readOptions(options.get('globalOpts') ?? null, localize)),
      ...group('ai', readOptions(options.get('AIOpts') ?? null, localize)),
      ...group('map', mapOptions ? readOptions(await readLuaGlobal(mapOptions, 'options'), localize) : []),
      ...group('mods', modOptions),
    ]),
    ais: [...new Map(ais.map((ai) => [ai.key, ai])).values()],
    colors: readColors(parseLua(colorsScript, { lenient: true }).get('GameColors') ?? null),
    restrictionPresets: readRestrictionPresets(restrictions ?? '', localize).map((preset) => ({ key: preset.key, name: preset.name, help: preset.help, group: preset.group })),
    bannedMods: await readBannedMods(files),
  };
}
