// The game's own options and key bindings, kept in the current profile of Game.prefs. Their lists, names and tooltips
// come from the FAF game files (lua.nx2, loc.nx2) in the language of the interface.

/** A value of a game option as Game.prefs keeps it. */
export type GameOptionValue = string | number | boolean;

export interface GameOptionChoice {
  value: GameOptionValue;
  label: string;
}

export type GameOptionControl =
  /** Two states the game names On and Off. */
  | { kind: 'switch'; on: GameOptionValue; off: GameOptionValue }
  | { kind: 'choice'; choices: GameOptionChoice[] }
  /** `step` 0 is a smooth slider, as in the game. */
  | { kind: 'slider'; min: number; max: number; step: number };

export interface GameOption {
  key: string;
  title: string;
  /** The game's tooltip for the option. */
  description: string | null;
  control: GameOptionControl;
  value: GameOptionValue;
}

/** Options under one heading of the game's options dialog; options before the first heading have none. */
export interface GameOptionGroup {
  title: string | null;
  options: GameOption[];
}

export interface GameOptionSection {
  /** The game's key of the tab: `gameplay`, `ui`, `video` or `sound`. */
  id: string;
  title: string;
  groups: GameOptionGroup[];
}

export interface GameOptionsView {
  /** Name of the game profile the options belong to; null while Game.prefs has none, until the game first starts. */
  profile: string | null;
  sections: GameOptionSection[];
  /** Forged Alliance was running: it rewrites Game.prefs when it closes, so changes wait until then. */
  gameRunning: boolean;
}

/** Presets the game's key binding dialog resets to. */
export const KEY_PRESETS = ['default', 'hotbuild', 'alternative'] as const;
export type KeyPreset = (typeof KEY_PRESETS)[number];

export interface KeyAction {
  /** Name of the action in the game's key map, e.g. `attack`. */
  id: string;
  title: string;
  /** Bindings as the game writes them, e.g. `Ctrl-Shift-A`. */
  keys: string[];
  /** Shift and Alt variants of a hotbuild key that other actions use, so hotbuild cannot add them to this one. */
  blockedModifiers: string[];
}

export interface KeyActionCategory {
  /** The game's category in lower case, e.g. `orders`. */
  id: string;
  title: string;
  actions: KeyAction[];
}

/** The part of a settings file with the key bindings; the other parts are the game's option sections. */
export const KEY_BINDINGS_PART = 'keys';

export interface GameSettingsPart {
  /** An option section of the game (`gameplay`, `video`…) or KEY_BINDINGS_PART. */
  id: string;
  title: string;
  /** How many options of the section, or key bindings, the file has. */
  count: number;
}

/** A settings file picked for import, to choose what to take from it. */
export interface GameSettingsImportCandidate {
  /** Refers to the file read in the dialog: only such files are imported. */
  token: string;
  fileName: string;
  exportedAt: string | null;
  parts: GameSettingsPart[];
  /** The key binding layout in the file, when it has key bindings. */
  keyPreset: KeyPreset | null;
}

export interface GameSettingsImportResult {
  options: number;
  /** Key bindings taken from the file; null when they were not imported. */
  keyBindings: number | null;
  /** What does not fit this computer or this version of the game: option titles and bindings such as `Ctrl-Q: attack`. */
  skipped: string[];
}

export interface KeyBindingsView {
  /** Null while Game.prefs has no profile; there are no bindings to show then. */
  profile: string | null;
  preset: KeyPreset;
  /** The profile has its own key map instead of the preset's. */
  customized: boolean;
  categories: KeyActionCategory[];
  /** Key names of the game by Windows virtual key code in two upper-case hex digits (`41` is A). */
  keyCodes: Record<string, string>;
  /** How the game shows key names in the interface language, by key name. */
  keyLabels: Record<string, string>;
  gameRunning: boolean;
}
