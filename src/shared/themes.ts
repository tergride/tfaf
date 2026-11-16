/** Control contours and colour palettes are independent in the custom theme. */
export const BUILT_IN_THEMES = ['default', 'uef', 'aeon', 'cybran', 'seraphim'] as const;
export type BuiltInTheme = (typeof BUILT_IN_THEMES)[number];
export const THEMES = [...BUILT_IN_THEMES, 'custom'] as const;
export type Theme = (typeof THEMES)[number];

/** The order of the colour table and of the editor; every palette supplies every token. */
export const THEME_COLOR_GROUPS = [
  { id: 'backgrounds', colors: ['background', 'hull', 'card', 'popover', 'secondary', 'muted'] },
  { id: 'text', colors: ['foreground', 'card-foreground', 'popover-foreground', 'secondary-foreground', 'muted-foreground', 'faint'] },
  { id: 'accents', colors: ['primary', 'primary-foreground', 'accent', 'accent-foreground'] },
  { id: 'statuses', colors: ['info', 'success', 'warning', 'destructive'] },
  { id: 'borders', colors: ['border', 'input', 'ring'] },
] as const;
export type ThemeColor = (typeof THEME_COLOR_GROUPS)[number]['colors'][number];
export type ThemePalette = Record<ThemeColor, string>;
export const THEME_COLOR_KEYS: readonly ThemeColor[] = THEME_COLOR_GROUPS.flatMap((group) => [...group.colors]);

export interface CustomTheme {
  controls: BuiltInTheme;
  colors: ThemePalette;
}

/**
 * Colours of the emblem and faction skins. Text carries a tint of the theme's hue; in the warm Cybran and Seraphim the
 * tint is halved, or the text reads as yellowed.
 */
export const THEME_PALETTES: Readonly<Record<BuiltInTheme, Readonly<ThemePalette>>> = {
  default: {
    background: '#0b1017',
    foreground: '#e5ecf4',
    card: '#111923',
    'card-foreground': '#e5ecf4',
    popover: '#141d28',
    'popover-foreground': '#e5ecf4',
    primary: '#ff9a2e',
    'primary-foreground': '#1d1103',
    secondary: '#17212d',
    'secondary-foreground': '#e5ecf4',
    muted: '#17212d',
    'muted-foreground': '#a1afc2',
    accent: '#1e2a39',
    'accent-foreground': '#eef2f7',
    destructive: '#e5564b',
    border: '#273546',
    input: '#3a4d63',
    ring: '#4aa8ff',
    info: '#4aa8ff',
    success: '#5bcf93',
    warning: '#f2b44a',
    hull: '#070b10',
    faint: '#8696a9',
  },
  uef: {
    background: '#0a1117',
    foreground: '#e6ecf2',
    card: '#0f1a22',
    'card-foreground': '#e6ecf2',
    popover: '#121e27',
    'popover-foreground': '#e6ecf2',
    primary: '#71b1e9',
    'primary-foreground': '#071725',
    secondary: '#15222c',
    'secondary-foreground': '#e6ecf2',
    muted: '#15222c',
    'muted-foreground': '#a1b0be',
    accent: '#1b2b38',
    'accent-foreground': '#eef2f6',
    destructive: '#df695e',
    border: '#243645',
    input: '#374e62',
    ring: '#aed7f5',
    info: '#78cfcc',
    success: '#7ccd8e',
    warning: '#ebbc69',
    hull: '#060b10',
    faint: '#8697a5',
  },
  aeon: {
    background: '#0c110d',
    foreground: '#e8ede8',
    card: '#131b14',
    'card-foreground': '#e8ede8',
    popover: '#161f18',
    'popover-foreground': '#e8ede8',
    primary: '#96cd7b',
    'primary-foreground': '#0f1a09',
    secondary: '#19231b',
    'secondary-foreground': '#e8ede8',
    muted: '#19231b',
    'muted-foreground': '#a5b1a7',
    accent: '#212d23',
    'accent-foreground': '#eff2f0',
    destructive: '#e26c5f',
    border: '#2a382d',
    input: '#3f5142',
    ring: '#cfe4ae',
    info: '#7ec1e5',
    success: '#7bd4c3',
    warning: '#e6c36b',
    hull: '#080c09',
    faint: '#8b988d',
  },
  cybran: {
    background: '#140e0e',
    foreground: '#edeaea',
    card: '#1e1615',
    'card-foreground': '#edeaea',
    popover: '#221a19',
    'popover-foreground': '#edeaea',
    primary: '#dd6857',
    'primary-foreground': '#24100c',
    secondary: '#271e1d',
    'secondary-foreground': '#edeaea',
    muted: '#271e1d',
    'muted-foreground': '#b2acab',
    accent: '#322625',
    'accent-foreground': '#f4f1f0',
    destructive: '#cb77b4',
    border: '#3d302f',
    input: '#584645',
    ring: '#f4c0ae',
    info: '#7bc3e2',
    success: '#76cd9c',
    warning: '#e9bd68',
    hull: '#0d0909',
    faint: '#999392',
  },
  seraphim: {
    background: '#130f0a',
    foreground: '#edebe9',
    card: '#1d1710',
    'card-foreground': '#edebe9',
    popover: '#211b13',
    'popover-foreground': '#edebe9',
    primary: '#dfbd69',
    'primary-foreground': '#1d1503',
    secondary: '#261f16',
    'secondary-foreground': '#edebe9',
    muted: '#261f16',
    'muted-foreground': '#b1ada7',
    accent: '#30281d',
    'accent-foreground': '#f3f1ee',
    destructive: '#df7088',
    border: '#3c3226',
    input: '#554939',
    ring: '#cdc1f7',
    info: '#bbade9',
    success: '#8dcd8e',
    warning: '#eb9854',
    hull: '#0d0a07',
    faint: '#98948e',
  },
};

export function defaultCustomTheme(): CustomTheme {
  return { controls: 'default', colors: { ...THEME_PALETTES.default } };
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Lenient disk migration: recover each invalid field without discarding the other edits. */
export function mergeCustomTheme(stored: unknown, defaults: CustomTheme = defaultCustomTheme()): CustomTheme {
  const raw = record(stored);
  const colors = record(raw.colors);
  return {
    controls: BUILT_IN_THEMES.find((theme) => theme === raw.controls) ?? defaults.controls,
    colors: Object.fromEntries(THEME_COLOR_KEYS.map((key) => [
      key, isThemeColor(colors[key]) ? colors[key].toLowerCase() : defaults.colors[key],
    ])) as ThemePalette,
  };
}

/** Strict IPC input: a save is a complete configuration, never a partial palette. */
export function parseCustomTheme(input: unknown): CustomTheme | null {
  const raw = record(input);
  const colors = record(raw.colors);
  if (!BUILT_IN_THEMES.some((theme) => theme === raw.controls) || !THEME_COLOR_KEYS.every((key) => isThemeColor(colors[key]))) {
    return null;
  }
  return mergeCustomTheme(raw);
}

export function resolveTheme(settings: { theme: Theme; customTheme: CustomTheme }): { controls: BuiltInTheme; colors: Readonly<ThemePalette> } {
  return settings.theme === 'custom'
    ? settings.customTheme
    : { controls: settings.theme, colors: THEME_PALETTES[settings.theme] };
}

/** A complete local palette also isolates nested theme tiles and editor previews. */
export function themeStyle(colors: Readonly<ThemePalette>): Record<`--${ThemeColor}`, string> {
  return Object.fromEntries(THEME_COLOR_KEYS.map((key) => [`--${key}`, colors[key]])) as Record<`--${ThemeColor}`, string>;
}
