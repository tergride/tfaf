// The game's options as its options dialog shows them, and the changes a new value makes, including the ones the
// dialog's scripts make to other options (`update` functions in options.lua, which the launcher cannot run).

import type { GameOption, GameOptionControl, GameOptionSection, GameOptionValue } from '../../shared/contract.ts';
import { t } from '../i18n.ts';
import { LuaTable, type LuaValue, luaString, luaTable } from '../lua/luaParser.ts';
import { arrayOf, type GameFiles, type OptionDefinition } from './gameFiles.ts';

interface OptionState {
  text: string;
  value: GameOptionValue;
}

/** An option with the defaults and states of this computer: the game keeps the ones it detects in options_overrides. */
interface ResolvedOption {
  key: string;
  title: string;
  value: GameOptionValue;
  /** A toggle's states, or null for a slider. */
  states: OptionState[] | null;
  slider: { min: number; max: number; step: number } | null;
}

type ResolvedItem = ResolvedOption | { header: string };

export interface ResolvedSection {
  id: string;
  title: string;
  items: ResolvedItem[];
}

const ON = '<LOC _On>';
const OFF = '<LOC _Off>';
const LANGUAGE_OPTION = 'selectedlanguage';
const DEFAULT_LANGUAGE = 'US';

export function resolveOptions(files: GameFiles, prefs: ReadonlyMap<string, LuaValue>, profile: LuaTable): ResolvedSection[] {
  const overrides = luaTable(prefs.get('options_overrides') ?? null);
  const current = luaTable(profile.get('options'));
  return files.optionSections.map((section) => ({
    id: section.id,
    title: section.title,
    items: section.items
      .map((item) => ('header' in item ? item : resolveOption(item, overrides, current)))
      .filter((item) => item !== null),
  }));
}

function resolveOption(definition: OptionDefinition, overrides: LuaTable | null, current: LuaTable | null): ResolvedOption | null {
  // Like optionsLogic.GetOptionsData: a default or custom data in options_overrides replaces the script's.
  const override = luaTable(overrides?.get(definition.key) ?? null);
  const overriddenDefault = override?.get('default') ?? null;
  let fallback = overriddenDefault !== null && overriddenDefault !== false ? overriddenDefault : definition.default;
  const custom = luaTable(override?.get('custom') ?? null) ?? definition.custom;
  if (definition.key === LANGUAGE_OPTION && fallback === null) {
    // userInit.lua starts from the language the game last used, which it keeps in options_overrides.
    fallback = (luaString(overrides?.get('language') ?? null) || DEFAULT_LANGUAGE).toUpperCase();
  }
  const value = optionValue(current?.get(definition.key) ?? null) ?? optionValue(fallback);
  if (value === null) {
    return null;
  }

  if (definition.type === 'slider') {
    const min = custom?.get('min');
    const max = custom?.get('max');
    const inc = custom?.get('inc');
    if (typeof min !== 'number' || typeof max !== 'number' || min >= max) {
      return null;
    }
    const step = typeof inc === 'number' && inc > 0 ? inc : 0;
    return { key: definition.key, title: definition.title, value, states: null, slider: { min, max, step } };
  }

  let states = arrayOf(custom?.get('states') ?? null)
    .map(luaTable)
    .map((state) => ({ text: luaString(state?.get('text') ?? null) ?? '', value: optionValue(state?.get('key') ?? null) }))
    .filter((state): state is OptionState => state.value !== null);
  if (states.length === 0 && typeof value === 'boolean') {
    // States the script builds with a call, like the main menu movie's; these are the ones it builds without /nomovie.
    states = [
      { text: OFF, value: false },
      { text: ON, value: true },
    ];
  }
  if (states.length === 0) {
    return null;
  }
  return { key: definition.key, title: definition.title, value, states, slider: null };
}

function optionValue(value: LuaValue): GameOptionValue | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

/** The game keeps numbers as 32-bit floats, so a stored 2.0999999046326 is the state 2.1. */
export function sameOptionValue(a: GameOptionValue, b: GameOptionValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.fround(a) === Math.fround(b);
  }
  return a === b;
}

export function optionSections(sections: ResolvedSection[], localize: (text: string) => string, tips: ReadonlyMap<string, string>): GameOptionSection[] {
  return sections.map((section) => {
    const groups: GameOptionSection['groups'] = [{ title: null, options: [] }];
    for (const item of section.items) {
      if ('header' in item) {
        groups.push({ title: localize(item.header), options: [] });
      } else {
        groups.at(-1)!.options.push(viewOf(item, localize, tips));
      }
    }
    return { id: section.id, title: localize(section.title), groups: groups.filter((group) => group.options.length > 0) };
  });
}

function viewOf(option: ResolvedOption, localize: (text: string) => string, tips: ReadonlyMap<string, string>): GameOption {
  const tip = tips.get(option.key);
  // The value as the matching state has it, so the interface can compare values exactly.
  const state = option.states?.find((candidate) => sameOptionValue(candidate.value, option.value));
  return {
    key: option.key,
    title: localize(option.title),
    description: tip ? localize(tip) || null : null,
    control: controlOf(option, localize),
    value: state?.value ?? option.value,
  };
}

function controlOf(option: ResolvedOption, localize: (text: string) => string): GameOptionControl {
  if (option.slider) {
    return { kind: 'slider', ...option.slider };
  }
  const states = option.states!;
  // Some states add the English text after the tag, `<LOC _On>On`.
  const on = states.find((state) => state.text.startsWith(ON));
  const off = states.find((state) => state.text.startsWith(OFF));
  if (states.length === 2 && on && off) {
    return { kind: 'switch', on: on.value, off: off.value };
  }
  const choices = states.map((state) => ({ value: state.value, label: localize(state.text) }));
  // A value the game no longer offers, e.g. a display mode of another monitor, stays visible as it is.
  if (!states.some((state) => sameOptionValue(state.value, option.value))) {
    choices.unshift({ value: option.value, label: String(option.value) });
  }
  return { kind: 'choice', choices };
}

const FIDELITY_PRESET = 'fidelity_presets';
const CUSTOM_FIDELITY = 4;
type PresetValue = number | 'antialiasingMedium' | 'antialiasingHigh';

// What choosing a graphics preset sets, as in the `update` of fidelity_presets in options.lua. Changing any of these
// options by hand makes the preset Custom.
const FIDELITY_PRESETS: Record<number, Record<string, PresetValue>> = {
  0: { fidelity: 0, shadow_quality: 0, texture_level: 2, antialiasing: 0, level_of_detail: 0, bloom_render: 0, render_skydome: 0 },
  1: { fidelity: 1, shadow_quality: 1, texture_level: 1, antialiasing: 0, level_of_detail: 1, bloom_render: 0, render_skydome: 1 },
  2: { fidelity: 2, shadow_quality: 2, texture_level: 0, antialiasing: 'antialiasingMedium', level_of_detail: 2, bloom_render: 0, render_skydome: 1 },
  3: { fidelity: 2, shadow_quality: 3, texture_level: 0, antialiasing: 'antialiasingHigh', level_of_detail: 2, bloom_render: 0, render_skydome: 1 },
};
const FIDELITY_OPTIONS = new Set(Object.keys(FIDELITY_PRESETS[0]!));

/**
 * The options a new value changes, the chosen one first. Throws for an option the game does not have and for a value
 * it does not offer.
 */
export function optionChanges(sections: ResolvedSection[], key: string, value: GameOptionValue): Map<string, GameOptionValue> {
  const options = new Map<string, ResolvedOption>();
  for (const section of sections) {
    for (const item of section.items) {
      if (!('header' in item)) {
        options.set(item.key, item);
      }
    }
  }
  const option = options.get(key);
  if (!option) {
    throw new Error(t('main.gameOptions.unknownOption', { key }));
  }
  const changes = new Map<string, GameOptionValue>([[key, acceptedValue(option, value)]]);
  const setIfOffered = (target: string, next: GameOptionValue): void => {
    const linked = options.get(target);
    const state = linked?.states?.find((candidate) => sameOptionValue(candidate.value, next));
    if (linked && (state || linked.slider)) {
      changes.set(target, state?.value ?? next);
    }
  };

  const chosen = changes.get(key)!;
  if (key === FIDELITY_PRESET && typeof chosen === 'number') {
    for (const [target, presetValue] of Object.entries(FIDELITY_PRESETS[chosen] ?? {})) {
      setIfOffered(target, typeof presetValue === 'number' ? presetValue : antialiasing(options.get('antialiasing'), presetValue));
    }
  } else if (FIDELITY_OPTIONS.has(key)) {
    setIfOffered(FIDELITY_PRESET, CUSTOM_FIDELITY);
  } else if (key === 'frametime') {
    // A frame time limit only works without vertical sync, and turning the sync on brings the default limit back.
    setIfOffered('vsync', 0);
  } else if (key === 'vsync' && chosen === 1) {
    setIfOffered('frametime', 8);
  }
  return changes;
}

/**
 * The game picks from GetAntiAliasingOptions(): the middle mode for High and the last for Ultra. Those are the modes
 * the engine lists in options_overrides, without Off.
 */
function antialiasing(option: ResolvedOption | undefined, level: Exclude<PresetValue, number>): number {
  const modes = (option?.states ?? []).map((state) => state.value).filter((value) => typeof value === 'number' && value !== 0);
  if (modes.length === 0) {
    return 0;
  }
  const index = level === 'antialiasingHigh' ? modes.length - 1 : Math.ceil(modes.length / 2) - 1;
  return modes[index] as number;
}

function acceptedValue(option: ResolvedOption, value: GameOptionValue): GameOptionValue {
  if (option.slider) {
    const { min, max, step } = option.slider;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(t('main.gameOptions.invalidValue'));
    }
    if (step === 0) {
      return value;
    }
    // Rounded again so that fractional steps do not leave float noise like 0.30000000000000004 in the file.
    return Math.min(max, Math.round((min + Math.round((value - min) / step) * step) * 1e6) / 1e6);
  }
  const state = option.states?.find((candidate) => sameOptionValue(candidate.value, value));
  if (!state) {
    throw new Error(t('main.gameOptions.invalidValue'));
  }
  return state.value;
}

/** Every option of the game with its value in the profile, or its default where the profile has none. */
export function optionValues(sections: ResolvedSection[]): Map<string, GameOptionValue> {
  return new Map(sections.flatMap(optionsOf).map((option) => [option.key, option.value]));
}

/** How many options of each section a settings file has values for. */
export function optionCounts(sections: ResolvedSection[], values: ReadonlyMap<string, GameOptionValue>): Map<string, number> {
  return new Map(sections.map((section) => [section.id, optionsOf(section).filter((option) => values.has(option.key)).length]));
}

/**
 * The values of a settings file for the options of the chosen sections. Unlike a change by hand they are taken as they
 * are, without the changes the dialog makes to other options: the file already holds those. A value the game does not
 * offer here, such as a display mode of another monitor, is skipped.
 */
export function importedOptions(
  sections: ResolvedSection[],
  values: ReadonlyMap<string, GameOptionValue>,
  sectionIds: ReadonlySet<string>,
): { accepted: Map<string, GameOptionValue>; skippedTitles: string[] } {
  const accepted = new Map<string, GameOptionValue>();
  const skippedTitles: string[] = [];
  for (const section of sections.filter((candidate) => sectionIds.has(candidate.id))) {
    for (const option of optionsOf(section)) {
      const value = values.get(option.key);
      if (value === undefined) {
        continue;
      }
      try {
        accepted.set(option.key, acceptedValue(option, value));
      } catch {
        // The profile may already hold a value the game no longer offers; a file with the same one changes nothing.
        if (!sameOptionValue(value, option.value)) {
          skippedTitles.push(option.title);
        }
      }
    }
  }
  return { accepted, skippedTitles };
}

function optionsOf(section: ResolvedSection): ResolvedOption[] {
  return section.items.filter((item): item is ResolvedOption => !('header' in item));
}

/** The profile's options table, made when the game has not saved one yet. */
export function profileOptions(profile: LuaTable): LuaTable {
  let options = luaTable(profile.get('options'));
  if (!options) {
    options = new LuaTable();
    profile.set('options', options);
  }
  return options;
}
