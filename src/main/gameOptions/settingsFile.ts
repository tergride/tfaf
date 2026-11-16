// Files the game's options and key bindings are exported to: JSON, so that reading one never runs anything, and only
// data an import can check against the game files. Actions mods add to a profile (UserKeyActions) stay out: they hold
// console commands for the game, which a file from someone else must not bring in.

import { type GameOptionValue, KEY_PRESETS, type KeyPreset } from '../../shared/contract.ts';
import { t } from '../i18n.ts';
import type { KeyMap, ProfileKeyMaps } from './keyMaps.ts';

const FORMAT = 'tfaf-game-settings';
const VERSION = 1;
export const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_NAME_LENGTH = 100;
const MAX_VALUE_LENGTH = 200;
const MAX_DATE_LENGTH = 40;

export interface SettingsFileKeys {
  preset: KeyPreset;
  /** The profile's own bindings; both maps are null while it uses the preset. */
  maps: ProfileKeyMaps;
}

export interface SettingsFile {
  exportedAt: string | null;
  options: Map<string, GameOptionValue>;
  keys: SettingsFileKeys | null;
}

export function serializeSettingsFile(file: SettingsFile): string {
  const keys = file.keys && {
    preset: file.keys.preset,
    keyMap: file.keys.maps.user && Object.fromEntries(file.keys.maps.user),
    debugKeyMap: file.keys.maps.debug && Object.fromEntries(file.keys.maps.debug),
  };
  return `${JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: file.exportedAt, options: Object.fromEntries(file.options), keys }, null, 2)}\n`;
}

/** Reads a settings file; entries of a wrong type are dropped, and a file that is not one at all is refused. */
export function parseSettingsFile(text: string): SettingsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t('main.gameOptions.notSettingsFile'));
  }
  const root = record(raw);
  if (!root || root.format !== FORMAT || typeof root.version !== 'number') {
    throw new Error(t('main.gameOptions.notSettingsFile'));
  }
  if (root.version > VERSION) {
    throw new Error(t('main.gameOptions.newerSettingsFile'));
  }
  const options = new Map<string, GameOptionValue>();
  for (const [key, value] of entries(root.options)) {
    if (isName(key) && isOptionValue(value)) {
      options.set(key, value);
    }
  }
  const keys = parseKeys(root.keys);
  if (options.size === 0 && !keys) {
    throw new Error(t('main.gameOptions.notSettingsFile'));
  }
  const exportedAt = typeof root.exportedAt === 'string' && root.exportedAt.length <= MAX_DATE_LENGTH ? root.exportedAt : null;
  return { exportedAt, options, keys };
}

function parseKeys(value: unknown): SettingsFileKeys | null {
  const raw = record(value);
  const preset = KEY_PRESETS.find((candidate) => candidate === raw?.preset);
  if (!raw || !preset) {
    return null;
  }
  return { preset, maps: { user: keyMap(raw.keyMap), debug: keyMap(raw.debugKeyMap) } };
}

function keyMap(value: unknown): KeyMap | null {
  if (!record(value)) {
    return null;
  }
  const map: KeyMap = new Map();
  for (const [key, action] of entries(value)) {
    if (isName(key) && typeof action === 'string' && isName(action)) {
      map.set(key, action);
    }
  }
  return map;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function entries(value: unknown): [string, unknown][] {
  const object = record(value);
  return object ? Object.entries(object).slice(0, MAX_ENTRIES) : [];
}

function isName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isOptionValue(value: unknown): value is GameOptionValue {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length > 0 && value.length <= MAX_VALUE_LENGTH)
  );
}

/** The number of bindings the file brings: the profile's own ones, none when it keeps the preset. */
export function keyBindingCount(keys: SettingsFileKeys): number {
  return (keys.maps.user?.size ?? 0) + (keys.maps.debug?.size ?? 0);
}
