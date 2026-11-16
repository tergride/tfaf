// Key maps of a profile as the game's key mapper (lua/keymap/keymapper.lua) and key dialog (lua/ui/dialogs/keybindings.lua)
// keep them. Until the player changes a binding the preset's maps apply; the first change copies them into UserKeyMap
// and UserDebugKeyMap of the profile.

import type { KeyAction, KeyActionCategory, KeyPreset } from '../../shared/contract.ts';
import { hasKeyModifiers, KEY_MODIFIERS, normalizeKeyBinding } from '../../shared/keyBindings.ts';
import { LuaTable, type LuaValue, luaString, luaTable } from '../lua/luaParser.ts';
import { type GameFiles, type KeyMapPreset, PRESET_FILES } from './gameFiles.ts';

/** Bound actions by key. */
export type KeyMap = Map<string, string>;

export interface ProfileKeyMaps {
  /** UserKeyMap: null while the profile uses the preset. */
  user: KeyMap | null;
  /** UserDebugKeyMap */
  debug: KeyMap | null;
}

export interface KeyMapContext {
  /** The preset of the profile (UserKeyMapName). */
  preset: KeyMapPreset;
  /** defaultKeyMap.lua, which SetUserKeyMapping consults whatever the preset is. */
  defaults: KeyMapPreset;
  /** Categories of the actions, as the scripts write them, by action. */
  actions: ReadonlyMap<string, string | null>;
}

const HOTBUILD_CATEGORIES = new Set(['hotbuilding', 'hotbuildingAlternative', 'hotbuildingExtra']);
const SHIFT_PREFIX = 'shift_';

/** GetCurrentKeyMap: the profile's bindings, or the preset's, together with the debug ones. */
export function currentKeyMap(maps: ProfileKeyMaps, context: KeyMapContext): KeyMap {
  if (maps.user) {
    return new Map([...maps.user, ...(maps.debug ?? context.preset.debug)]);
  }
  return new Map([...context.preset.keys, ...context.preset.debug]);
}

function userDebugKeyMap(maps: ProfileKeyMaps, context: KeyMapContext): KeyMap {
  return new Map(maps.debug ?? context.preset.debug);
}

/** The key as the map stores it, when the map has the same combination in any spelling. */
function findKey(map: KeyMap, key: string): string | null {
  const normalized = normalizeKeyBinding(key);
  for (const stored of map.keys()) {
    if (normalizeKeyBinding(stored) === normalized) {
      return stored;
    }
  }
  return null;
}

function keysOf(map: KeyMap, action: string): string[] {
  return [...map].filter(([, bound]) => bound === action).map(([key]) => key);
}

function deleteKey(map: KeyMap, key: string): void {
  const stored = findKey(map, key);
  if (stored !== null) {
    map.delete(stored);
  }
}

/**
 * ClearUserKeyMapping. The game removes the key from only one of the maps, but its copy of the current map keeps the
 * debug bindings, so a cleared debug key would stay bound; here it leaves both.
 */
function clearKey(maps: ProfileKeyMaps, context: KeyMapContext, key: string): ProfileKeyMaps {
  const user = currentKeyMap(maps, context);
  const debug = userDebugKeyMap(maps, context);
  deleteKey(user, key);
  deleteKey(debug, key);
  return { user, debug };
}

/** SetUserKeyMapping: binds the key instead of `oldKey`, in the map that already has the action. */
function setKey(maps: ProfileKeyMaps, context: KeyMapContext, key: string, oldKey: string | null, action: string): ProfileKeyMaps {
  const cleared = clearKey(maps, context, key);
  const user = cleared.user!;
  const debug = cleared.debug!;
  if (oldKey !== null) {
    deleteKey(user, oldKey);
    deleteKey(debug, oldKey);
  }
  const hasAction = (map: KeyMap): boolean => keysOf(map, action).length > 0;
  if (hasAction(user) || hasAction(context.defaults.keys)) {
    user.set(key, action);
  } else if (hasAction(debug) || hasAction(context.defaults.debug)) {
    debug.set(key, action);
  } else {
    user.set(key, action);
  }
  return { user, debug };
}

/** The Shift variant of an order, which the key dialog binds to Shift and the same key (GetShiftAction). */
function shiftAction(action: string, context: KeyMapContext): string | null {
  const name = SHIFT_PREFIX + action;
  return context.actions.get(name) === 'orders' ? name : null;
}

/** Binds the key to the action instead of all of its keys, taking it from any other action. */
function replaceKeys(maps: ProfileKeyMaps, context: KeyMapContext, action: string, key: string): ProfileKeyMaps {
  const old = keysOf(currentKeyMap(maps, context), action);
  let next = maps;
  for (const extra of old.slice(1)) {
    next = clearKey(next, context, extra);
  }
  return setKey(next, context, key, old[0] ?? null, action);
}

/** What the key dialog does on OK, with the Shift variant of an order following its key. */
export function assignKey(maps: ProfileKeyMaps, context: KeyMapContext, action: string, key: string): ProfileKeyMaps {
  let next = replaceKeys(maps, context, action, key);
  const shift = shiftAction(action, context);
  if (shift && !hasKeyModifiers(key)) {
    next = replaceKeys(next, context, shift, `Shift-${key}`);
  }
  return next;
}

/** Removes one key of the action, and the Shift variant of an order that came with it. */
export function unbindKey(maps: ProfileKeyMaps, context: KeyMapContext, action: string, key: string): ProfileKeyMaps {
  const current = currentKeyMap(maps, context);
  const stored = findKey(current, key);
  if (stored === null || current.get(stored) !== action) {
    return maps;
  }
  let next = clearKey(maps, context, stored);
  const shift = shiftAction(action, context);
  const shiftKey = shift && !hasKeyModifiers(stored) ? findKey(current, `Shift-${stored}`) : null;
  if (shiftKey !== null && current.get(shiftKey) === shift) {
    next = clearKey(next, context, shiftKey);
  }
  return next;
}

/**
 * Hotbuild adds Shift and Alt to the keys of its actions on its own (GenerateHotbuildModifiers), but only for
 * combinations no other binding uses.
 */
function blockedModifiers(current: KeyMap, action: string, category: string | null, keys: string[]): string[] {
  if (category === null || !HOTBUILD_CATEGORIES.has(category)) {
    return [];
  }
  const blocked: string[] = [];
  for (const key of keys) {
    for (const modifier of ['Shift', 'Alt']) {
      const variant = `${modifier}-${key}`;
      const stored = findKey(current, variant);
      if (stored !== null && current.get(stored) !== action) {
        blocked.push(variant);
      }
    }
  }
  return blocked;
}

export function readProfileKeyMaps(profile: LuaTable): ProfileKeyMaps {
  return { user: keyMapOf(profile.get('UserKeyMap')), debug: keyMapOf(profile.get('UserDebugKeyMap')) };
}

function keyMapOf(value: LuaValue): KeyMap | null {
  const table = luaTable(value);
  if (!table) {
    return null;
  }
  const map: KeyMap = new Map();
  for (const key of table.keys()) {
    const action = luaString(table.get(key));
    if (action !== null) {
      map.set(String(key), action);
    }
  }
  return map;
}

export function writeProfileKeyMaps(profile: LuaTable, maps: ProfileKeyMaps): void {
  profile.set('UserKeyMap', maps.user ? tableOf(maps.user) : null);
  profile.set('UserDebugKeyMap', maps.debug ? tableOf(maps.debug) : null);
}

function tableOf(map: KeyMap): LuaTable {
  const table = new LuaTable();
  for (const [key, action] of map) {
    table.set(key, action);
  }
  return table;
}

/** The preset of UserKeyMapName, which holds a file name such as `hotbuildKeyMap.lua` or a path to it. */
export function presetOf(profile: LuaTable): KeyPreset {
  const file = (luaString(profile.get('UserKeyMapName')) ?? '').split('/').at(-1)!.toLowerCase();
  return (Object.keys(PRESET_FILES) as KeyPreset[]).find((preset) => PRESET_FILES[preset].toLowerCase() === file) ?? 'default';
}

/** ResetUserKeyMapTo: the preset's bindings, until the player changes one. */
export function resetToPreset(profile: LuaTable, preset: KeyPreset): void {
  writeProfileKeys(profile, preset, { user: null, debug: null });
}

export function writeProfileKeys(profile: LuaTable, preset: KeyPreset, maps: ProfileKeyMaps): void {
  profile.set('UserKeyMapName', PRESET_FILES[preset]);
  writeProfileKeyMaps(profile, maps);
}

/** Bindings from a settings file that this game can use: known keys bound to actions it has. */
export function usableKeyMaps(
  maps: ProfileKeyMaps,
  keyNames: ReadonlySet<string>,
  actions: ReadonlyMap<string, string | null>,
): { maps: ProfileKeyMaps; skipped: string[] } {
  const skipped: string[] = [];
  const usable = (map: KeyMap | null): KeyMap | null => {
    if (!map) {
      return null;
    }
    const kept: KeyMap = new Map();
    for (const [key, action] of map) {
      if (isValidKeyBinding(key, keyNames) && actions.has(action)) {
        kept.set(key, action);
      } else {
        skipped.push(`${key}: ${action}`);
      }
    }
    return kept;
  };
  return { maps: { user: usable(maps.user), debug: usable(maps.debug) }, skipped };
}

/** GetKeyActions: actions mods added to the profile, then the game's, without names the key map cannot hold. */
export function profileKeyActions(files: GameFiles, profile: LuaTable): Map<string, string | null> {
  const actions = new Map<string, string | null>();
  const userActions = luaTable(profile.get('UserKeyActions'));
  for (const name of userActions?.keys() ?? []) {
    if (typeof name === 'string') {
      actions.set(name, luaString(luaTable(userActions!.get(name))?.get('category') ?? null));
    }
  }
  for (const [name, category] of files.keyActions) {
    actions.set(name, category);
  }
  for (const name of actions.keys()) {
    if (name.includes('-')) {
      actions.delete(name);
    }
  }
  return actions;
}

/** A binding the game can read: modifiers, each at most once, and then one key name it knows. */
export function isValidKeyBinding(binding: string, keyNames: ReadonlySet<string>): boolean {
  const parts = binding.split('-');
  const key = parts.pop()!;
  const modifiers = new Set(parts);
  return (
    keyNames.has(key) &&
    modifiers.size === parts.length &&
    parts.every((part) => (KEY_MODIFIERS as readonly string[]).includes(part) && part !== key)
  );
}

export interface KeyTexts {
  localize: (text: string) => string;
  /** Title of the Shift variant of an order. */
  shiftVariant: (title: string) => string;
  compare: (a: string, b: string) => number;
}

/** Actions grouped and ordered as in the game's key dialog (FormatData). */
export function keyActionCategories(files: GameFiles, actions: ReadonlyMap<string, string | null>, current: KeyMap, texts: KeyTexts): KeyActionCategory[] {
  const keysByAction = new Map<string, string[]>();
  for (const [key, action] of current) {
    keysByAction.set(action, [...(keysByAction.get(action) ?? []), key]);
  }
  const categories = new Map<string, KeyAction[]>();
  for (const [id, category] of actions) {
    const group = (category ?? 'none').toLowerCase();
    const keys = keysByAction.get(id) ?? [];
    const description = files.keyDescriptions.get(id);
    const title = texts.localize(description ?? `<LOC kb_${id}>${id}`);
    categories.set(group, [
      ...(categories.get(group) ?? []),
      {
        id,
        title: id.startsWith(SHIFT_PREFIX) ? texts.shiftVariant(title) : title,
        keys,
        blockedModifiers: blockedModifiers(current, id, category, keys),
      },
    ]);
  }
  const rank = (category: string): number => {
    const index = files.keyCategoryOrder.indexOf(category);
    return index < 0 ? files.keyCategoryOrder.length : index;
  };
  return [...categories]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([id, list]) => {
      const title = files.keyCategoryTitles.get(id);
      return {
        id,
        title: title ? texts.localize(title) : id,
        actions: list.sort((a, b) => texts.compare(a.title, b.title) || a.id.localeCompare(b.id)),
      };
    });
}
