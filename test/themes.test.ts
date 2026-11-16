import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { roomLaunchScript } from '../src/main/game/tfafLobby/roomLaunchScript.ts';
import type { LobbyLaunch } from '../src/shared/contract.ts';
import { BUILT_IN_THEMES, defaultCustomTheme, mergeCustomTheme, parseCustomTheme, resolveTheme, THEME_COLOR_KEYS, THEME_PALETTES } from '../src/shared/themes.ts';

const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

function tokens(selector: string, pattern: RegExp): string[] {
  const start = styles.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} is missing from styles.css`);
  const block = styles.slice(start, styles.indexOf('}', start));
  return [...block.matchAll(pattern)].map((match) => match[1]!).sort();
}

const shapes = (selector: string): string[] => tokens(selector, /(--shape-[a-z-]+):/g);

test('built-in palettes contain exactly the 23 editable colours', () => {
  assert.equal(THEME_COLOR_KEYS.length, 23);
  assert.equal(new Set(THEME_COLOR_KEYS).size, 23);
  for (const theme of BUILT_IN_THEMES) {
    assert.deepEqual(Object.keys(THEME_PALETTES[theme]).sort(), [...THEME_COLOR_KEYS].sort(), theme);
    assert.ok(parseCustomTheme({ controls: theme, colors: THEME_PALETTES[theme] }), theme);
  }
});

test('the initial CSS fallback matches the shared Command post palette', () => {
  const start = styles.indexOf("[data-theme='default'] {");
  const block = styles.slice(start, styles.indexOf('}', start));
  const fallback = Object.fromEntries([...block.matchAll(/--([a-z-]+): (#[0-9a-f]{6});/g)].map((match): [string, string] => [match[1]!, match[2]!]));
  assert.deepEqual(fallback, THEME_PALETTES.default);
});

// A theme tile in the settings wears its own theme: a contour token it forgets would come from the window's theme.
test('every theme sets every contour token of the default theme', () => {
  const contours = shapes("[data-theme='default']");
  assert.ok(contours.includes('--shape-tl'));
  for (const theme of BUILT_IN_THEMES.filter((name) => name !== 'default')) {
    assert.deepEqual(shapes(`[data-theme='${theme}']`), contours, theme);
  }
});

test('old and damaged custom settings recover each field independently', () => {
  const defaults = defaultCustomTheme();
  for (const stored of [undefined, null, [], 'invalid']) assert.deepEqual(mergeCustomTheme(stored), defaults);
  const recovered = mergeCustomTheme({ controls: 'cybran', colors: { primary: '#ABCDEF', foreground: '#123456', card: 'red' } });
  assert.equal(recovered.controls, 'cybran');
  assert.equal(recovered.colors.primary, '#abcdef');
  assert.equal(recovered.colors.foreground, '#123456');
  assert.equal(recovered.colors.card, defaults.colors.card);
  assert.equal(recovered.colors.ring, defaults.colors.ring);
  assert.equal(mergeCustomTheme({ controls: 'custom', colors: recovered.colors }).controls, 'default');
  recovered.colors.primary = '#000000';
  assert.equal(defaultCustomTheme().colors.primary, '#ff9a2e');
});

test('custom input requires a built-in control style and a complete opaque HEX palette', () => {
  const theme = defaultCustomTheme();
  for (const value of ['#fff', '#12345678', 'red', 'var(--primary)', '', null, 123]) {
    assert.equal(parseCustomTheme({ ...theme, colors: { ...theme.colors, primary: value } }), null, String(value));
  }
  assert.equal(parseCustomTheme({ ...theme, controls: 'custom' }), null);
  assert.equal(parseCustomTheme({ ...theme, colors: {} }), null);
  assert.equal(parseCustomTheme({ ...theme, colors: [] }), null);
  assert.equal(parseCustomTheme(null), null);
  assert.equal(parseCustomTheme({ ...theme, colors: { ...theme.colors, foreground: '#ABCDEF' } })?.colors.foreground, '#abcdef');
});

test('control style and palette resolve independently and built-in themes keep their own colours', () => {
  const customTheme = { controls: 'cybran' as const, colors: { ...THEME_PALETTES.aeon, foreground: '#ffffff' } };
  assert.deepEqual(resolveTheme({ theme: 'custom', customTheme }), customTheme);
  assert.deepEqual(resolveTheme({ theme: 'uef', customTheme }), { controls: 'uef', colors: THEME_PALETTES.uef });
});

test('the room launch script serializes the four resolved custom colours without running the game', () => {
  const launch: LobbyLaunch = {
    featuredMod: 'faf', factions: [], options: {}, restrictions: [], spawnMex: [], positionGroups: [],
    armies: [], observers: [], simMods: [], digest: 'theme-test',
  };
  const customTheme = defaultCustomTheme();
  Object.assign(customTheme.colors, { card: '#123456', foreground: '#654321', 'muted-foreground': '#abcdef', primary: '#fedcba' });
  const script = roomLaunchScript(launch, { colors: resolveTheme({ theme: 'custom', customTheme }).colors, logo: null });
  for (const [name, value] of Object.entries({ Background: 'ff123456', Title: 'ff654321', Text: 'ffabcdef', Accent: 'fffedcba' })) {
    assert.ok(script.includes(`["${name}"] = "${value}"`), name);
  }
});
