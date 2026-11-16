import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { defaultCustomTheme, THEME_PALETTES } from '../src/shared/themes.ts';

// Settings need app.getPath; no Electron process, real profile, game detection or game launch is involved.
const root = await mkdtemp(path.join(tmpdir(), 'tfaf-theme-settings-'));
const electronSource = `
  const paths = { userData: ${JSON.stringify(root)}, home: ${JSON.stringify(root)}, documents: ${JSON.stringify(root)} };
  export const app = { getPath: (name) => paths[name], setPath: (name, value) => { paths[name] = value; }, getVersion: () => '0.16.0' };
`;
const electronUrl = `data:text/javascript,${encodeURIComponent(electronSource)}`;
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the tests' Electron stand-in loads through module.register
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    return specifier === 'electron' ? { url: ${JSON.stringify(electronUrl)}, shortCircuit: true } : next(specifier, context);
  }
`)}`, import.meta.url);

const { app } = await import('electron');
const { SettingsStore } = await import('../src/main/settings.ts');
const { InvalidInputError, parseSettingsPatch } = await import('../src/main/validation.ts');
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(root, 'profile-'));
  app.setPath('userData', folder);
  // An absolute test path suppresses auto-detection even though it contains no executable.
  await writeFile(path.join(folder, 'settings.json'), JSON.stringify({ gamePath: folder }));
});
after(() => rm(root, { recursive: true, force: true }));

test('a legacy profile receives a separate default custom configuration', async () => {
  const settings = (await SettingsStore.load()).get();
  assert.equal(settings.theme, 'default');
  assert.deepEqual(settings.customTheme, defaultCustomTheme());
});

test('IPC rejects malformed custom themes and normalizes valid complete palettes', () => {
  const theme = defaultCustomTheme();
  for (const customTheme of [null, [], { ...theme, controls: 'custom' }, { ...theme, colors: {} }, { ...theme, colors: { ...theme.colors, card: '#12345678' } }]) {
    assert.throws(() => parseSettingsPatch({ theme: 'custom', customTheme }), InvalidInputError);
  }
  const patch = parseSettingsPatch({ theme: 'custom', customTheme: { ...theme, colors: { ...theme.colors, foreground: '#ABCDEF' } } });
  assert.equal(patch.theme, 'custom');
  assert.equal(patch.customTheme?.colors.foreground, '#abcdef');
});

test('saved custom colours and controls survive theme switches and a profile reload', async () => {
  const store = await SettingsStore.load();
  const customTheme = { controls: 'cybran' as const, colors: { ...THEME_PALETTES.aeon, foreground: '#abcdef' } };
  await store.update(parseSettingsPatch({ theme: 'custom', customTheme }));
  await store.update({ theme: 'uef' });
  await store.update({ theme: 'custom' });
  const reloaded = (await SettingsStore.load()).get();
  assert.equal(reloaded.theme, 'custom');
  assert.deepEqual(reloaded.customTheme, customTheme);
  const disk = JSON.parse(await readFile(path.join(folder, 'settings.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(disk.customTheme, customTheme);
});

test('a damaged palette keeps valid fields while restoring only invalid ones', async () => {
  await writeFile(path.join(folder, 'settings.json'), JSON.stringify({
    gamePath: folder, theme: 'custom', customTheme: { controls: 'seraphim', colors: { primary: '#112233', foreground: '#fff' } },
  }));
  const settings = (await SettingsStore.load()).get();
  assert.equal(settings.theme, 'custom');
  assert.equal(settings.customTheme.controls, 'seraphim');
  assert.equal(settings.customTheme.colors.primary, '#112233');
  assert.equal(settings.customTheme.colors.foreground, THEME_PALETTES.default.foreground);
  assert.equal(Object.keys(settings.customTheme.colors).length, 23);
});

test('a failed theme save leaves memory and later window saves unchanged', async () => {
  const store = await SettingsStore.load();
  const before = store.get();
  const stored = await readFile(path.join(folder, 'settings.json'), 'utf8');
  const customTheme = { controls: 'cybran' as const, colors: { ...THEME_PALETTES.aeon } };
  // A directory at the temporary file path causes a deterministic failure without touching real settings.
  const blocked = path.join(folder, 'settings.json.tmp');
  await mkdir(blocked);
  await assert.rejects(store.update(parseSettingsPatch({ theme: 'custom', customTheme })));
  assert.deepEqual(store.get(), before);
  assert.equal(await readFile(path.join(folder, 'settings.json'), 'utf8'), stored);

  await rm(blocked, { recursive: true });
  const window = { x: 20, y: 30, width: 1280, height: 820, maximized: false };
  await store.setWindowBounds(window);
  const reloaded = (await SettingsStore.load()).get();
  assert.equal(reloaded.theme, before.theme);
  assert.deepEqual(reloaded.customTheme, before.customTheme);
  assert.deepEqual(reloaded.window, window);
});

test('the close-to-tray question counts as answered once the setting is chosen or switched by hand', async () => {
  const store = await SettingsStore.load();
  assert.equal(store.get().closeToTrayChosen, false);
  await store.update(parseSettingsPatch({ confirmQuit: false }));
  assert.equal(store.get().closeToTrayChosen, false);
  await store.update(parseSettingsPatch({ closeToTray: true }));
  assert.equal(store.get().closeToTrayChosen, true);
  assert.equal((await SettingsStore.load()).get().closeToTrayChosen, true);

  await writeFile(path.join(folder, 'settings.json'), JSON.stringify({ gamePath: folder }));
  const fresh = await SettingsStore.load();
  assert.equal(fresh.get().confirmQuit, true);
  await fresh.chooseCloseToTray(false);
  const reloaded = (await SettingsStore.load()).get();
  assert.equal(reloaded.closeToTray, false);
  assert.equal(reloaded.closeToTrayChosen, true);
  // Only the main process answers the question; the interface cannot set it.
  assert.deepEqual(parseSettingsPatch({ closeToTrayChosen: false }), {});
});

test('queued settings changes use the last committed state without losing independent edits', async () => {
  const store = await SettingsStore.load();
  const before = store.get();
  const changes = [
    store.update({ theme: 'aeon' }),
    store.update({ soundVolume: 35 }),
    store.addWatchedReplay(101),
    store.addWatchedReplay(102),
    store.setAutoJoinChannels(['#test']),
    store.setMatchmakerPrefs({ ...before.matchmaker, factions: ['aeon'] }),
    store.setServer('test'),
    store.setServer('prod'),
  ];
  const pending = store.get();
  await Promise.all(changes);
  assert.deepEqual(pending, before);

  const settings = store.get();
  assert.equal(settings.theme, 'aeon');
  assert.equal(settings.soundVolume, 35);
  assert.deepEqual(settings.watchedReplays, [101, 102]);
  assert.deepEqual(settings.chat.autoJoin.channels, ['#test']);
  assert.deepEqual(settings.matchmaker.factions, ['aeon']);
  assert.equal(settings.server, 'prod');
  assert.deepEqual((await SettingsStore.load()).get(), settings);
});
