// What the launcher needs from the game's own scripts to show its options and key bindings: the options dialog
// (options.lua), tooltips, key actions, key map presets and key names from lua.nx2, and the translations from loc.nx2.
// Game scripts are read with the lenient parser, which skips their functions without running them.

import path from 'node:path';
import type { KeyPreset } from '../../shared/contract.ts';
import type { Locale } from '../../shared/i18n/index.ts';
import { t } from '../i18n.ts';
import { LuaFunction, LuaTable, type LuaValue, luaString, luaTable, parseLua } from '../lua/luaParser.ts';
import { readZipEntries, readZipFiles } from '../vault/zip.ts';
import type { GameScripts } from './gamePackages.ts';

const LUA_FILES = {
  options: 'lua/options/options.lua',
  tooltips: 'lua/ui/help/tooltips.lua',
  keyActions: 'lua/keymap/keyactions.lua',
  debugKeyActions: 'lua/keymap/debugKeyActions.lua',
  keyDescriptions: 'lua/keymap/keydescriptions.lua',
  keyCategories: 'lua/keymap/keycategories.lua',
  keyNames: 'lua/keymap/keyNames.lua',
  properKeyNames: 'lua/keymap/properKeyNames.lua',
} as const;

/** Key map files of the presets, as the game's key dialog names them in UserKeyMapName. */
export const PRESET_FILES: Record<KeyPreset, string> = {
  default: 'defaultKeyMap.lua',
  hotbuild: 'hotbuildKeyMap.lua',
  alternative: 'alternativeKeyMap.lua',
};

/** Languages of the game's strings_db.lua the interface languages read. */
const LOC_LANGUAGES: Record<Locale, string> = { ru: 'RU', en: 'US' };
const BASE_LANGUAGE = 'US';
const STRINGS_DB = /^loc\/([^/]+)\/strings_db\.lua$/i;
const MAX_STRINGS_BYTES = 32 * 1024 ** 2;

export interface OptionDefinition {
  key: string;
  /** Texts are kept as the game has them, `<LOC id>default`, and translated when shown. */
  title: string;
  type: 'toggle' | 'slider';
  default: LuaValue;
  custom: LuaTable | null;
}

export type OptionItem = OptionDefinition | { header: string };

export interface OptionSectionDefinition {
  id: string;
  title: string;
  items: OptionItem[];
}

/** Key → action maps of a preset: its regular and its debug bindings. */
export interface KeyMapPreset {
  keys: Map<string, string>;
  debug: Map<string, string>;
}

export interface GameFiles {
  optionSections: OptionSectionDefinition[];
  /** The game's tooltip text of an option, by option key. */
  optionTips: Map<string, string>;
  /** Key actions of the game and their categories as the scripts write them, debug actions included. */
  keyActions: Map<string, string | null>;
  keyDescriptions: Map<string, string>;
  /** By lower-case category, which is how the key dialog groups actions. */
  keyCategoryTitles: Map<string, string>;
  /** Lower-case categories in the order of the key dialog. */
  keyCategoryOrder: string[];
  /** Key names by Windows virtual key code in upper-case hex. */
  keyNames: Map<string, string>;
  /** Display names of keys by key name. */
  keyTitles: Map<string, string>;
  presets: Record<KeyPreset, KeyMapPreset>;
  /** Translated strings of strings_db.lua by language. */
  strings: Map<string, Map<string, string>>;
}

// options.lua builds the music volume in a function, so that it can be replaced when the game runs with /nomusic. The
// lenient parser does not run it; this is the item the function returns otherwise.
const COMPUTED_ITEMS: Record<string, OptionDefinition[]> = {
  sound: [{ key: 'music_volume', title: '<LOC OPTIONS_0027>Music Volume', type: 'slider', default: 100, custom: sliderRange(0, 100, 1) }],
};

function sliderRange(min: number, max: number, inc: number): LuaTable {
  const custom = new LuaTable();
  custom.set('min', min);
  custom.set('max', max);
  custom.set('inc', inc);
  return custom;
}

export function gameFilesPaths(dataPath: string): { lua: string; loc: string; etc: string } {
  return {
    lua: path.join(dataPath, 'gamedata', 'lua.nx2'),
    loc: path.join(dataPath, 'gamedata', 'loc.nx2'),
    etc: path.join(dataPath, 'gamedata', 'etc.nx2'),
  };
}

export async function loadGameFiles(luaArchive: string, locArchive: string): Promise<GameFiles> {
  const presetPaths = Object.values(PRESET_FILES).map((file) => `lua/keymap/${file}`);
  const lua = await readZipFiles(luaArchive, [...Object.values(LUA_FILES), ...presetPaths]);
  const script = (name: string, globals: Iterable<[string, LuaValue]> = []): Map<string, LuaValue> => {
    const data = lua.get(name);
    if (!data) {
      throw new Error(t('main.gameOptions.gameFileMissing', { file: name }));
    }
    return parseLua(data.toString('utf8'), { lenient: true, globals });
  };

  const languages = await locLanguages(locArchive);
  const strings = await readStrings(locArchive, languages);

  // userInit.lua lists the installed languages for the language option the same way.
  const installed = new LuaTable();
  [...languages.keys()].sort().forEach((language, index) => {
    const state = new LuaTable();
    state.set('text', language);
    state.set('key', language);
    installed.set(index + 1, state);
  });
  const options = script(LUA_FILES.options, [['__installedlanguages', installed]]);
  const scriptGlobals: [string, LuaValue][] = [['table', tableLibrary()]];
  const categories = script(LUA_FILES.keyCategories);

  return {
    optionSections: readOptionSections(options),
    optionTips: readOptionTips(script(LUA_FILES.tooltips).get('Tooltips') ?? null),
    keyActions: new Map([
      ...readKeyActions(script(LUA_FILES.keyActions, scriptGlobals).get('keyActions') ?? null),
      ...readKeyActions(script(LUA_FILES.debugKeyActions, scriptGlobals).get('debugKeyActions') ?? null),
    ]),
    keyDescriptions: stringMap(script(LUA_FILES.keyDescriptions).get('keyDescriptions') ?? null),
    keyCategoryTitles: new Map(
      [...stringMap(categories.get('keyCategories') ?? null)].map(([category, title]) => [category.toLowerCase(), title]),
    ),
    keyCategoryOrder: arrayOf(categories.get('keyCategoryOrder') ?? null)
      .map(luaString)
      .filter((category) => category !== null)
      .map((category) => category.toLowerCase()),
    keyNames: new Map([...stringMap(script(LUA_FILES.keyNames).get('keyNames') ?? null)].map(([code, name]) => [code.toUpperCase(), name])),
    keyTitles: stringMap(script(LUA_FILES.properKeyNames).get('properKeyNames') ?? null),
    presets: {
      default: readPreset(script(`lua/keymap/${PRESET_FILES.default}`)),
      hotbuild: readPreset(script(`lua/keymap/${PRESET_FILES.hotbuild}`)),
      alternative: readPreset(script(`lua/keymap/${PRESET_FILES.alternative}`)),
    },
    strings,
  };
}

async function locLanguages(locArchive: string): Promise<Map<string, string>> {
  const languages = new Map<string, string>();
  for (const entry of await readZipEntries(locArchive)) {
    const match = STRINGS_DB.exec(entry.name);
    if (match) {
      languages.set(match[1]!.toUpperCase(), entry.name);
    }
  }
  return languages;
}

function wantedLanguages(languages: ReadonlyMap<string, string>): string[] {
  return [...new Set([BASE_LANGUAGE, ...Object.values(LOC_LANGUAGES)])].filter((language) => languages.has(language));
}

function stringsByLanguage(files: readonly (readonly [string, Buffer | null | undefined])[]): GameFiles['strings'] {
  const strings = new Map<string, Map<string, string>>();
  for (const [language, data] of files) {
    if (data) {
      strings.set(language, stringsOf(parseLua(data.toString('utf8'), { lenient: true })));
    }
  }
  return strings;
}

async function readStrings(locArchive: string, languages: ReadonlyMap<string, string>): Promise<GameFiles['strings']> {
  const wanted = wantedLanguages(languages);
  const loc = await readZipFiles(locArchive, wanted.map((language) => languages.get(language)!));
  return stringsByLanguage(wanted.map((language) => [language, loc.get(languages.get(language)!)]));
}

/** The translated strings of a featured mod's packages, for what needs nothing else of `loadGameFiles`. */
export async function loadPackageStrings(files: Pick<GameScripts, 'list' | 'read'>): Promise<GameFiles['strings']> {
  const languages = new Map<string, string>();
  for (const file of await files.list('/loc', '/strings_db.lua')) {
    const match = STRINGS_DB.exec(file.slice(1));
    if (match) {
      languages.set(match[1]!.toUpperCase(), file);
    }
  }
  const wanted = wantedLanguages(languages);
  return stringsByLanguage(await Promise.all(wanted.map(async (language) => [language, await files.read(languages.get(language)!, MAX_STRINGS_BYTES)] as const)));
}

/** `table.combine`, which the key action scripts merge their groups with. */
function tableLibrary(): LuaTable {
  const library = new LuaTable();
  library.set(
    'combine',
    new LuaFunction((args) => {
      const combined = new LuaTable();
      for (const arg of args) {
        if (arg instanceof LuaTable) {
          for (const key of arg.keys()) {
            combined.set(key, arg.get(key));
          }
        }
      }
      return combined;
    }),
  );
  return library;
}

/** Items of a Lua array in order, skipping the holes a nil left. */
export function arrayOf(value: LuaValue): LuaValue[] {
  const table = luaTable(value);
  if (!table) {
    return [];
  }
  return table
    .keys()
    .filter((key): key is number => typeof key === 'number' && Number.isInteger(key) && key > 0)
    .sort((a, b) => a - b)
    .map((key) => table.get(key));
}

function stringMap(value: LuaValue): Map<string, string> {
  const table = luaTable(value);
  const map = new Map<string, string>();
  for (const key of table?.keys() ?? []) {
    const text = luaString(table!.get(key));
    if (text !== null) {
      map.set(String(key), text);
    }
  }
  return map;
}

function stringsOf(globals: Map<string, LuaValue>): Map<string, string> {
  const strings = new Map<string, string>();
  for (const [key, value] of globals) {
    if (typeof value === 'string') {
      strings.set(key, value);
    }
  }
  return strings;
}

function readOptionSections(globals: Map<string, LuaValue>): OptionSectionDefinition[] {
  const options = luaTable(globals.get('options') ?? null);
  const sections: OptionSectionDefinition[] = [];
  for (const id of arrayOf(globals.get('optionsOrder') ?? null).map(luaString)) {
    const section = luaTable(id === null ? null : (options?.get(id) ?? null));
    const items = luaTable(section?.get('items') ?? null);
    if (id === null || !section || !items) {
      continue;
    }
    const computed = [...(COMPUTED_ITEMS[id] ?? [])];
    const last = Math.max(0, ...items.keys().filter((key): key is number => typeof key === 'number'));
    const definitions: OptionItem[] = [];
    for (let index = 1; index <= last; index++) {
      const item = luaTable(items.get(index));
      // A hole is an item the script computes with a call.
      const definition = item ? readOptionItem(item) : (computed.shift() ?? null);
      if (definition) {
        definitions.push(definition);
      }
    }
    sections.push({ id, title: luaString(section.get('title')) ?? id, items: definitions });
  }
  return sections;
}

function readOptionItem(item: LuaTable): OptionItem | null {
  const type = item.get('type');
  if (type === 'header') {
    return { header: luaString(item.get('title')) ?? '' };
  }
  const key = luaString(item.get('key'));
  if ((type !== 'toggle' && type !== 'slider') || !key) {
    return null;
  }
  return { key, title: luaString(item.get('title')) ?? key, type, default: item.get('default'), custom: luaTable(item.get('custom')) };
}

const OPTION_TIP_PREFIX = 'options_';

function readOptionTips(value: LuaValue): Map<string, string> {
  const table = luaTable(value);
  const tips = new Map<string, string>();
  for (const key of table?.keys() ?? []) {
    if (typeof key === 'string' && key.startsWith(OPTION_TIP_PREFIX)) {
      const description = luaString(luaTable(table!.get(key))?.get('description') ?? null);
      if (description) {
        tips.set(key.slice(OPTION_TIP_PREFIX.length), description);
      }
    }
  }
  return tips;
}

function readKeyActions(value: LuaValue): Map<string, string | null> {
  const table = luaTable(value);
  const actions = new Map<string, string | null>();
  for (const key of table?.keys() ?? []) {
    const action = luaTable(table!.get(key));
    if (typeof key === 'string' && action) {
      actions.set(key, luaString(action.get('category')));
    }
  }
  return actions;
}

function readPreset(globals: Map<string, LuaValue>): KeyMapPreset {
  return { keys: stringMap(globals.get('defaultKeyMap') ?? null), debug: stringMap(globals.get('debugKeyMap') ?? null) };
}

// eslint-disable-next-line regexp/no-super-linear-backtracking -- anchored, and the game's strings are short
const LOC_TAG = /^<LOC\s*([^>]*)>/;

/** Translates texts as the game's LOC does: the string of the language, else the English one, else the text after the tag. */
export function localizer(files: Pick<GameFiles, 'strings'>, locale: Locale): (text: string) => string {
  const own = files.strings.get(LOC_LANGUAGES[locale]);
  const base = files.strings.get(BASE_LANGUAGE);
  return (text) => {
    const match = LOC_TAG.exec(text);
    if (!match) {
      return text;
    }
    const id = match[1]!;
    return own?.get(id) ?? base?.get(id) ?? text.slice(match[0].length);
  };
}
