// What a TFAF lobby can forbid, read from the files the game's Unit Manager reads: the presets of UnitsRestrictions.lua
// and the unit blueprints of the game and of the room's sim mods. What counts as a unit, how a category expression is
// read and how units are grouped follow UnitsAnalyzer.lua and UnitsManager.lua. The presets stay the game's to apply:
// a room passes their keys on, and this file only shows what they will forbid.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LobbyPresetGroup, LobbyRestrictionPreset, LobbyUnit, LobbyUnitCatalog, LobbyUnitGroup, MapTexture } from '../../shared/contract.ts';
import type { Locale } from '../../shared/i18n/index.ts';
import { isRestrictionKey } from '../../shared/tfafLobby.ts';
import { mapLimited } from '../concurrency.ts';
import { type LuaTable, type LuaValue, luaPath, luaString, luaTable, parseLua } from '../lua/luaParser.ts';
import { readDds } from '../mapView/ddsReader.ts';
import { readBlueprintTable } from '../mapView/propBlueprint.ts';
import { arrayOf, loadPackageStrings, localizer } from './gameFiles.ts';
import { type GameScripts, requiredScript } from './gamePackages.ts';

export const RESTRICTIONS_FILE = 'lua/ui/lobby/UnitsRestrictions.lua';
const ANALYZER_FILE = 'lua/ui/lobby/UnitsAnalyzer.lua';
const PRESET_CALL = /CreatePreset\(\s*"(\w+)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g;
const BLUEPRINT_SUFFIX = '_unit.bp';
const ICON_SUFFIX = '_icon.dds';
const BLUEPRINT_ID = /([^/\\]+)_[a-z]+\.bp$/i;
const MAX_FILE_BYTES = 1024 ** 2;
const READ_LIMIT = 16;
const FACTIONS = ['AEON', 'UEF', 'CYBRAN', 'SERAPHIM', 'NOMADS'];
const UNKNOWN_FACTION = 'UNKNOWN';
// The game only leaves gaps between its groups of presets. Each is known here by the preset it opens with, so a group
// the game adds or moves goes without a name rather than under someone else's.
const PRESET_GROUPS: Readonly<Record<string, LobbyPresetGroup>> = {
  T1: 'tech',
  HOVER: 'types',
  T1_AIR_SPAM: 'typesByTech',
  SHIELD_AIR: 'intel',
  SNIPES_AIR: 'weapons',
  TMLDEF: 'strategic',
  T3_AIR_BOMBERS: 'heavy',
  FABS: 'economy',
  ENGIDRONES: 'support',
  TELE: 'upgrades',
  SERAPHIM: 'factions',
};
const GROUP_ORDER: readonly LobbyUnitGroup[] = ['naval', 'air', 'land', 'construction', 'economy', 'support', 'defense', 'scu', 'acu'];

interface Categorized {
  id: string;
  categories: ReadonlySet<string>;
}

type CategoryMatcher = (unit: Categorized) => boolean;

/**
 * Reads a restriction the way the game does: operators work strictly from left to right, `*` binding no tighter than
 * `+`, and a word names a category or, in any case, a unit id.
 */
export function categoryMatcher(expression: string): CategoryMatcher {
  const tokens = expression.match(/[()*+-]|[^\s()*+-]+/g) ?? [];
  let position = 0;

  const operand = (): CategoryMatcher => {
    const token = tokens[position++];
    if (token === '(') {
      const inner = sequence();
      position++;
      return inner;
    }
    const id = token?.toLowerCase();
    return (unit) => token !== undefined && (unit.id === id || unit.categories.has(token));
  };

  const sequence = (): CategoryMatcher => {
    let matches = operand();
    while (position < tokens.length && tokens[position] !== ')') {
      const operator = tokens[position++];
      const left = matches;
      const right = operand();
      matches =
        operator === '*'
          ? (unit) => left(unit) && right(unit)
          : operator === '-'
            ? (unit) => left(unit) && !right(unit)
            : (unit) => left(unit) || right(unit);
    }
    return matches;
  };

  return sequence();
}

// The grouping of UnitsAnalyzer.GetUnitsGroups, for showing units only. A unit it lists twice stands in the first
// group that wants it here.
const TECH4_ARTILLERY = '(EXPERIMENTAL * STRATEGIC * ARTILLERY - FACTORY)';
const CRAB_EGGS = 'xrl0002 + xrl0003 + xrl0004 + xrl0005 + drlk005';
const FACTORIES = `((FACTORY * STRUCTURE) + ${CRAB_EGGS})`;
const ENGINEERS = '(ENGINEER - COMMAND - SUBCOMMANDER - UPGRADE)';
const DRONES = '(POD - UPGRADE)';
const DEFENSES = '(ANTINAVY + DIRECTFIRE + ARTILLERY + ANTIAIR + MINE + ORBITALSYSTEM + SATELLITE + NUKE)';
const IS_ACU = categoryMatcher('COMMAND + UPGRADE - SUBCOMMANDER - CIVILIAN');
const IS_SCU = categoryMatcher('SUBCOMMANDER + UPGRADE - COMMAND - CIVILIAN');
const IS_CONSTRUCTION = categoryMatcher(`(${FACTORIES} + ${ENGINEERS} + ENGINEERSTATION + ${DRONES} - DEFENSE)`);
const IS_NOT_MOBILE = categoryMatcher('UPGRADE + COMMAND + SUBCOMMANDER + STRUCTURE + CIVILIAN');
const IS_AIR = categoryMatcher('(AIR - POD - SATELLITE)');
const IS_LAND = categoryMatcher(`(LAND - ENGINEER - POD - ${TECH4_ARTILLERY})`);
const IS_NAVAL = categoryMatcher('(NAVAL - MOBILESONAR)');
const IS_ECONOMY = categoryMatcher('(STRUCTURE * ECONOMIC)');
const IS_SUPPORT = categoryMatcher(`(WALL + HEAVYWALL + INTELLIGENCE + SHIELD + AIRSTAGINGPLATFORM - ECONOMIC - ${DEFENSES})`);

function unitGroup(unit: Categorized): LobbyUnitGroup {
  if (IS_ACU(unit)) {
    return 'acu';
  }
  if (IS_SCU(unit)) {
    return 'scu';
  }
  if (IS_CONSTRUCTION(unit)) {
    return 'construction';
  }
  if (!IS_NOT_MOBILE(unit)) {
    if (IS_AIR(unit)) {
      return 'air';
    }
    if (IS_LAND(unit)) {
      return 'land';
    }
    if (IS_NAVAL(unit)) {
      return 'naval';
    }
  }
  if (IS_ECONOMY(unit)) {
    return 'economy';
  }
  return IS_SUPPORT(unit) ? 'support' : 'defense';
}

// The first category that tells two units apart decides, as in UnitsManager.CompareUnitsOrder.
const BY_TECH = ['TECH1', 'TECH2', 'TECH3', 'EXPERIMENTAL', 'ORBITALSYSTEM', 'SATELLITE', 'SCOUT', 'DIRECTFIRE', 'BOMBER', 'ANTIAIR', 'GROUNDATTACK', 'TRANSPORTATION', 'ANTINAVY', 'SUBMERSIBLE', 'INDIRECTFIRE', 'ARTILLERY', 'BOT'];
const BY_WEAPON = ['SCOUT', 'MINE', 'DIRECTFIRE', 'ANTIAIR', 'GROUNDATTACK', 'TRANSPORTATION', 'ANTINAVY', 'BOMBER', 'INDIRECTFIRE', 'ARTILLERY', 'TECH1', 'TECH2', 'TECH3', 'EXPERIMENTAL', 'SUBMERSIBLE', 'TACTICALMISSILEPLATFORM', 'ANTIMISSILE', 'NUKE', 'BOMB'];
const BY_ENGINEERING = ['GATE', 'SORTCONSTRUCTION', 'NAVAL', 'ORBITAL', 'AIR', 'LAND', 'ENGINEERSTATION', 'ENGINEER', 'TECH1', 'TECH2', 'TECH3', 'RESEARCH', 'SUPPORTFACTORY', 'POD'];
const BY_ECONOMY = ['HYDROCARBON', 'ENERGYSTORAGE', 'ENERGYPRODUCTION', 'MASSSTORAGE', 'MASSEXTRACTION', 'MASSFABRICATION', 'EXPERIMENTAL'];
const BY_SUPPORT = ['SONAR', 'RADAR', 'OMNI', 'OPTICS', 'COUNTERINTELLIGENCE', 'SHIELD', 'WALL', 'STEALTH', 'STEALTHFIELD', 'HEAVYWALL', 'AIRSTAGINGPLATFORM'];
const BY_COMMANDER = ['TECH3', 'ISPREENHANCEDUNIT', 'UPGRADE LEFT', 'UPGRADE RIGHT', 'UPGRADE BACK'];
const SORT_CATEGORIES: Record<LobbyUnitGroup, readonly string[]> = {
  naval: BY_TECH,
  air: BY_TECH,
  land: BY_TECH,
  construction: BY_ENGINEERING,
  economy: BY_ECONOMY,
  support: BY_SUPPORT,
  defense: BY_WEAPON,
  scu: BY_COMMANDER,
  acu: BY_COMMANDER,
};

function compareBy(categories: readonly string[], first: Categorized, second: Categorized): number {
  for (const category of categories) {
    const firstHas = first.categories.has(category);
    if (firstHas !== second.categories.has(category)) {
      return firstHas ? -1 : 1;
    }
  }
  return 0;
}

interface CatalogEntry extends Categorized, Omit<LobbyUnit, 'icon'> {
  iconPath: string;
}

function compareEntries(first: CatalogEntry, second: CatalogEntry): number {
  return (
    GROUP_ORDER.indexOf(first.group) - GROUP_ORDER.indexOf(second.group) ||
    compareBy(SORT_CATEGORIES[first.group], first, second) ||
    first.id.localeCompare(second.id)
  );
}

export interface PresetDefinition extends LobbyRestrictionPreset {
  icon: string;
  matches: CategoryMatcher;
  /** Upgrade names the preset forbids. */
  enhancements: readonly string[];
}

/** The game's presets in its order. `lua` is the text of UnitsRestrictions.lua; the presets are made in a function, so they are picked out of the text. */
export function readRestrictionPresets(lua: string, localize: (text: string) => string): PresetDefinition[] {
  const script = parseLua(lua, { lenient: true });
  const calls = new Map([...lua.matchAll(PRESET_CALL)].map(([, key, help, name, icon]) => [key!, { help: help!, name: name!, icon: icon! }]));
  const expressions = script.get('Expressions') ?? null;
  const enhancements = script.get('Enhancements') ?? null;
  const presets: PresetDefinition[] = [];
  let group: LobbyPresetGroup = 'other';
  for (const entry of arrayOf(script.get('presetsOrder') ?? null)) {
    const key = luaString(entry);
    const call = key ? calls.get(key) : undefined;
    if (!key || !call) {
      // An empty key is the game's gap between two columns.
      group = 'other';
      continue;
    }
    group = PRESET_GROUPS[key] ?? group;
    const expression = luaString(luaPath(expressions, key));
    presets.push({
      key,
      name: localize(call.name),
      help: localize(call.help),
      group,
      icon: call.icon,
      matches: expression ? categoryMatcher(expression) : () => false,
      enhancements: arrayOf(luaPath(enhancements, key))
        .map(luaString)
        .filter((name) => name !== null),
    });
  }
  return presets;
}

interface UnitFilter {
  allowed: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
}

function readUnitFilter(lua: string): UnitFilter {
  const script = parseLua(lua, { lenient: true });
  const keys = (name: string): ReadonlySet<string> => new Set(luaTable(script.get(name) ?? null)?.keys().map(String));
  return { allowed: keys('CategoriesAllowed'), skipped: keys('CategoriesSkipped') };
}

function isValidUnit({ allowed, skipped }: UnitFilter, id: string, categories: ReadonlySet<string>): boolean {
  if (id.length <= 4 || skipped.has(id)) {
    return false;
  }
  const list = [...categories];
  return list.some((category) => allowed.has(category)) || !list.some((category) => skipped.has(category));
}

function factionOf(categories: ReadonlySet<string>): string {
  return FACTIONS.find((faction) => categories.has(faction)) ?? UNKNOWN_FACTION;
}

function techOf(categories: ReadonlySet<string>): LobbyUnit['tech'] {
  if (categories.has('TECH1')) {
    return 'T1';
  }
  if (categories.has('TECH2')) {
    return 'T2';
  }
  if (categories.has('TECH3')) {
    return 'T3';
  }
  return categories.has('EXPERIMENTAL') ? 'T4' : null;
}

function text(value: LuaValue | undefined): string | null {
  const string = luaString(value ?? null);
  return string ? string : null;
}

function unitIconPath(id: string): string {
  return `/textures/ui/common/icons/units/${id}${ICON_SUFFIX}`;
}

function unitEntry(id: string, categories: ReadonlySet<string>, names: { name: string; description: string }, modded: boolean): CatalogEntry {
  const unit = { id, categories };
  return { ...unit, ...names, faction: factionOf(categories), group: unitGroup(unit), tech: techOf(categories), upgrade: false, modded, iconPath: unitIconPath(id) };
}

/** The units `HandleUnitWithBuildPresets` makes of a blueprint: support commanders that leave the gate upgraded. */
function presetUnits(blueprint: LuaTable, id: string, categories: ReadonlySet<string>, localize: (text: string) => string, base: { name: string; description: string }, modded: boolean): CatalogEntry[] {
  const presets = luaTable(blueprint.get('EnhancementPresets'));
  return (presets?.keys() ?? []).flatMap((key) => {
    const preset = luaTable(presets?.get(key) ?? null);
    if (!preset) {
      return [];
    }
    const name = String(key);
    const own = new Set(categories);
    own.delete('USEBUILDPRESETS');
    own.add('ISPREENHANCEDUNIT').add(`${name.toUpperCase()}PRESET`);
    for (const enhancement of arrayOf(preset.get('Enhancements'))) {
      const enhancementName = luaString(enhancement);
      if (enhancementName) {
        own.add(enhancementName);
      }
    }
    return [
      unitEntry(`${id}_${name}`.toLowerCase(), own, {
        name: localize(text(preset.get('UnitName')) ?? '') || base.name,
        description: localize(text(preset.get('Description')) ?? '') || base.description,
      }, modded),
    ];
  });
}

function enhancementIcon(faction: string, icon: string): string {
  return `/textures/ui/common/game/${faction}-enhancements/${icon.endsWith('.dds') ? icon : `${icon}_btn_up.dds`}`;
}

/** The upgrades of a commander, which the game names without the `Remove` entries that undo them. */
function upgradeEntries(blueprint: LuaTable, categories: ReadonlySet<string>, localize: (text: string) => string, modded: boolean): CatalogEntry[] {
  const enhancements = luaTable(blueprint.get('Enhancements'));
  const faction = factionOf(categories);
  const commander = categories.has('COMMAND') ? 'COMMAND' : categories.has('SUBCOMMANDER') ? 'SUBCOMMANDER' : null;
  return (enhancements?.keys() ?? []).flatMap((key) => {
    const id = String(key);
    const enhancement = luaTable(enhancements?.get(key) ?? null);
    if (!enhancement || id === 'Slots' || id.includes('Remove') || !isRestrictionKey(id)) {
      return [];
    }
    const slot = text(enhancement.get('Slot'))?.toUpperCase();
    const side = slot === 'LCH' ? 'LEFT' : slot === 'RCH' ? 'RIGHT' : slot;
    const own = new Set(['UPGRADE', faction, id, ...(commander ? [commander] : []), ...(side ? [`UPGRADE ${side}`] : [])]);
    const icon = text(enhancement.get('Icon'));
    return [
      {
        id,
        categories: own,
        name: localize(text(enhancement.get('Name')) ?? '') || id,
        description: '',
        faction,
        group: unitGroup({ id, categories: own }),
        tech: null,
        upgrade: true,
        modded,
        iconPath: enhancementIcon(faction.toLowerCase(), icon ?? id),
      },
    ];
  });
}

function blueprintEntries(file: string, source: string, filter: UnitFilter, localize: (text: string) => string, modded: boolean): CatalogEntry[] {
  const blueprint = readBlueprintTable(source, 'UnitBlueprint');
  const id = text(blueprint?.get('BlueprintId')) ?? BLUEPRINT_ID.exec(file)?.[1]?.toLowerCase();
  // A blueprint that merges into another changes a unit already listed.
  if (!blueprint || !id || blueprint.get('Merge') === true || !isRestrictionKey(id)) {
    return [];
  }
  const categories = new Set(arrayOf(blueprint.get('Categories')).map(luaString).filter((category) => category !== null));
  // Nobody builds a unit of no faction: such units are what a mod like an AI keeps for itself.
  if (!isValidUnit(filter, id, categories) || factionOf(categories) === UNKNOWN_FACTION) {
    return [];
  }
  const description = localize(text(blueprint.get('Description')) ?? '');
  // Some translations leave a unit's name empty.
  const names = { name: localize(text(luaPath(blueprint, 'General', 'UnitName')) ?? '') || description || id, description };
  const upgrades = upgradeEntries(blueprint, categories, localize, modded);
  const presets = presetUnits(blueprint, id, categories, localize, names, modded);
  // A commander cannot be forbidden: the game starts every player with one.
  return [...(categories.has('COMMAND') ? [] : [unitEntry(id, categories, names, modded)]), ...presets, ...upgrades];
}

interface ModFiles {
  blueprints: string[];
  /** Icon files by lower-case name. */
  icons: Map<string, string>;
}

async function readModFiles(modFolders: readonly string[]): Promise<ModFiles> {
  const files: ModFiles = { blueprints: [], icons: new Map() };
  for (const folder of modFolders) {
    for (const file of await readdir(folder, { recursive: true }).catch(() => [])) {
      const name = path.basename(file).toLowerCase();
      if (name.endsWith(BLUEPRINT_SUFFIX)) {
        files.blueprints.push(path.join(folder, file));
      } else if (name.endsWith(ICON_SUFFIX)) {
        files.icons.set(name, path.join(folder, file));
      }
    }
  }
  return files;
}

async function readModEntries(blueprints: readonly string[], filter: UnitFilter, localize: (text: string) => string): Promise<CatalogEntry[]> {
  const entries = await mapLimited(blueprints, READ_LIMIT, async (file) => {
    try {
      return blueprintEntries(file, await readFile(file, 'utf8'), filter, localize, true);
    } catch (error) {
      console.warn(`Unit blueprint ${file} could not be read: ${String(error)}`);
      return [];
    }
  });
  return entries.flat();
}

function iconTexture(data: Buffer | null): MapTexture | null {
  const texture = data ? readDds(data) : null;
  return texture && { ...texture, levels: texture.levels.slice(0, 1) };
}

export interface UnitCatalogSource {
  locale: Locale;
  /** The packages of the room's featured mod. */
  files: GameScripts;
  /** The folders of the room's sim mods. */
  modFolders: readonly string[];
}

export async function loadUnitCatalog({ locale, files, modFolders }: UnitCatalogSource): Promise<LobbyUnitCatalog> {
  const [restrictions, analyzer, strings] = await Promise.all([
    requiredScript(files, RESTRICTIONS_FILE),
    requiredScript(files, ANALYZER_FILE),
    loadPackageStrings(files),
  ]);
  const localize = localizer({ strings }, locale);
  const presets = readRestrictionPresets(restrictions, localize);
  const filter = readUnitFilter(analyzer);

  const blueprints = await files.list('/units', BLUEPRINT_SUFFIX);
  const gameEntries = await mapLimited(blueprints, READ_LIMIT, async (file) => {
    const data = await files.read(file, MAX_FILE_BYTES);
    return data ? blueprintEntries(file, data.toString('utf8'), filter, localize, false) : [];
  });
  const modFiles = await readModFiles(modFolders);
  const entries = [...gameEntries.flat(), ...(await readModEntries(modFiles.blueprints, filter, localize))];

  // A mod's unit replaces the game's. An upgrade stands once per commander type, whichever commanders have it.
  const unique = new Map(entries.map((entry) => [entry.upgrade ? `${entry.faction} ${entry.group} ${entry.id}` : entry.id, entry]));
  const ordered = [...unique.values()].sort(compareEntries);

  const iconCache = new Map<string, Promise<MapTexture | null>>();
  const icon = (gamePath: string): Promise<MapTexture | null> => {
    let texture = iconCache.get(gamePath);
    if (!texture) {
      const modIcon = modFiles.icons.get(path.posix.basename(gamePath).toLowerCase());
      texture = modIcon ? readFile(modIcon).then(iconTexture, () => null) : files.read(gamePath, MAX_FILE_BYTES).then(iconTexture);
      iconCache.set(gamePath, texture);
    }
    return texture;
  };

  const units = await mapLimited(ordered, READ_LIMIT, async ({ iconPath, categories: _categories, ...unit }): Promise<LobbyUnit> => ({ ...unit, icon: await icon(iconPath) }));
  const upgradeIds = new Set(ordered.filter((entry) => entry.upgrade).map((entry) => entry.id));
  const unitEntries = ordered.filter((entry) => !entry.upgrade);
  const covers = Object.fromEntries(
    presets.map((preset) => [
      preset.key,
      [...new Set([...unitEntries.filter(preset.matches).map((entry) => entry.id), ...preset.enhancements.filter((name) => upgradeIds.has(name))])],
    ]),
  );
  const presetIcons = await mapLimited(presets, READ_LIMIT, async (preset): Promise<[string, MapTexture | null]> => [preset.key, await icon(preset.icon)]);
  return { units, covers, presetIcons: Object.fromEntries(presetIcons) };
}
