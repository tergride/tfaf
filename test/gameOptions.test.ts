import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type GameFiles, gameFilesPaths, loadGameFiles, localizer } from '../src/main/gameOptions/gameFiles.ts';
import { type GameOptionsDeps, GameOptionsService } from '../src/main/gameOptions/gameOptionsService.ts';
import {
  assignKey,
  currentKeyMap,
  isValidKeyBinding,
  type KeyMapContext,
  keyActionCategories,
  presetOf,
  profileKeyActions,
  type ProfileKeyMaps,
  readProfileKeyMaps,
  resetToPreset,
  unbindKey,
  usableKeyMaps,
} from '../src/main/gameOptions/keyMaps.ts';
import {
  importedOptions,
  optionChanges,
  optionCounts,
  optionSections,
  optionValues,
  resolveOptions,
} from '../src/main/gameOptions/optionCatalog.ts';
import { readPrefsDocument, writePrefsDocument } from '../src/main/gameOptions/prefsDocument.ts';
import { parseSettingsFile, serializeSettingsFile } from '../src/main/gameOptions/settingsFile.ts';
import { LuaFunction, LuaTable, type LuaValue, parseLua } from '../src/main/lua/luaParser.ts';
import { luaEquals, LuaWriteError, serializeLuaGlobals } from '../src/main/lua/luaWriter.ts';
import { readGamePrefs, updateGamePrefs } from '../src/main/vault/gamePrefs.ts';
import { readZipFiles, ZipError } from '../src/main/vault/zip.ts';
import type { GameOption, GameOptionsView } from '../src/shared/contract.ts';
import { keyBinding, normalizeKeyBinding } from '../src/shared/keyBindings.ts';
import { buildZip } from './helpers/zipBuilder.ts';

// Trimmed copies of the FAF scripts, keeping what the launcher relies on: functions it must skip, a computed item,
// headers, overrides and key maps.
const OPTIONS_LUA = `
optionsOrder = { "video", "sound" }
local Prefs = import("/lua/user/prefs.lua")
local function getMusicVolumeOption()
    return { title = "<LOC OPTIONS_0027>Music Volume", key = 'music_volume', type = 'slider' }
end
options = {
    video = {
        title = "<LOC _Video>",
        key = 'video',
        items = {
            {
                title = "<LOC OPTIONS_0010>Primary Adapter",
                key = 'primary_adapter',
                type = 'toggle',
                default = '1024,768,60',
                set = function(key, value, startup)
                    if not startup then
                        ConExecute("SC_PrimaryAdapter " .. tostring(value))
                    end
                end,
                custom = { states = { { text = "<LOC OPTIONS_0070>Windowed", key = 'windowed' }, { text = "1024x768(60)", key = '1024,768,60' } } },
            },
            { title = '<LOC OPTIONS_QUALITY>Quality', type = 'header', default = '', key = '' },
            {
                title = "<LOC OPTIONS_001>Fidelity Presets",
                key = 'fidelity_presets',
                type = 'toggle',
                default = 4,
                update = function(control, value)
                    aaoptions = GetAntiAliasingOptions()
                    if 0 == value then logic.SetValue('fidelity', 0, true) end
                end,
                custom = { states = {
                    { text = "<LOC _Low>", key = 0 }, { text = "<LOC _Medium>", key = 1 }, { text = "<LOC _High>", key = 2 },
                    { text = "<LOC _Ultra>", key = 3 }, { text = "<LOC _Custom>", key = 4 },
                } },
            },
            { title = "<LOC OPTIONS_0018>Fidelity", key = 'fidelity', type = 'toggle', default = 1,
              custom = { states = { { text = "<LOC _Low>", key = 0 }, { text = "<LOC _Medium>", key = 1 }, { text = "<LOC _High>", key = 2 } } } },
            { title = "<LOC OPTIONS_0024>Shadow Fidelity", key = 'shadow_quality', type = 'toggle', default = 1,
              custom = { states = { { text = "<LOC _Off>", key = 0 }, { text = "<LOC _Low>", key = 1 }, { text = "<LOC _Medium>", key = 2 }, { text = "<LOC _High>", key = 3 } } } },
            { title = "<LOC OPTIONS_0015>Anti-Aliasing", key = 'antialiasing', type = 'toggle', default = 0,
              custom = { states = { { text = "<LOC OPTIONS_0029>Off", key = 0 }, { text = "2", key = 2 } } } },
            { title = "<LOC OPTIONS_0019>Texture Detail", key = 'texture_level', type = 'toggle', default = 1,
              custom = { states = { { text = "<LOC _Low>", key = 2 }, { text = "<LOC _Medium>", key = 1 }, { text = "<LOC _High>", key = 0 } } } },
            { title = "<LOC OPTIONS_0020>Level Of Detail", key = 'level_of_detail', type = 'toggle', default = 1,
              custom = { states = {
                  { text = "<LOC _Low>", key = 0 }, { text = "<LOC _Medium>", key = 1 }, { text = "<LOC _High>", key = 2 },
                  { text = "<LOC _Extreme>Extreme", key = 2.1 },
              } } },
            { title = "<LOC OPTIONS_0167>Render Bloom", key = 'bloom_render', type = 'toggle', default = 0,
              custom = { states = { { text = "<LOC _Off>", key = 0 }, { text = "<LOC _On>", key = 1 } } } },
            { title = "<LOC OPTIONS_0168>Render Sky", key = 'render_skydome', type = 'toggle', default = 1,
              custom = { states = { { text = "<LOC _Off>", key = 0 }, { text = "<LOC _On>", key = 1 } } } },
            { title = "<LOC OPTIONS_FRAMETIME>Frametime", key = 'frametime', type = 'slider', default = 8, custom = { min = 2, max = 16, inc = 1 } },
            { title = "<LOC OPTIONS_0148>Vertical Sync", key = 'vsync', type = 'toggle', default = 1,
              custom = { states = { { text = "<LOC _Off>", key = 0 }, { text = "<LOC _On>", key = 1 } } } },
            { title = "<LOC OPTIONS_0006>Language", key = 'selectedlanguage', type = 'toggle', default = __language,
              custom = { states = __installedlanguages } },
            { title = "Benchmark", key = 'run_benchmark', type = 'button', default = 0, custom = { text = 'Run' } },
        },
    },
    sound = {
        title = "<LOC _Sound>",
        key = 'sound',
        items = {
            { title = "<LOC OPTIONS_0026>FX Volume", key = 'fx_volume', type = 'slider', default = 100, custom = { min = 0, max = 100, inc = 1 } },
            getMusicVolumeOption(),
            { title = "<LOC OPTIONS_0207>Main Menu Background Movie", key = 'mainmenu_bgmovie', type = 'toggle', default = true,
              custom = { states = (function() if noMovieSwitchSet then return {} end end)() } },
        },
    },
}
`;

const TOOLTIPS_LUA = `Tooltips = {
    options_vsync = { title = "<LOC OPTIONS_0148>Vertical Sync", description = "<LOC OPTIONS_0150>Sync to vertical refresh of monitor" },
    attack = { title = "<LOC tooltipui0002>Attack", description = "" },
}`;

const KEY_ACTIONS_LUA = `
local keyActionsOrders = {
    ['attack'] = { action = 'StartCommandMode order RULEUCC_Attack', category = 'orders' },
    ['shift_attack'] = { action = 'StartCommandMode order RULEUCC_Attack', category = 'orders' },
    ['move'] = { action = 'StartCommandMode order RULEUCC_Move', category = 'orders' },
}
local keyActionsHotBuild = {
    ['build_t1_factory'] = { action = 'UI_Lua import("/lua/keymap/hotbuild.lua").buildAction("Land_Factory")', category = 'hotbuilding' },
}
local keyActionsUI = {
    ['toggle_score_screen'] = { action = 'UI_Lua import("/lua/ui/game/score.lua").ToggleScoreControl()', category = 'ui' },
}
keyActions = table.combine(keyActionsOrders, keyActionsHotBuild, keyActionsUI)
`;

const DEBUG_KEY_ACTIONS_LUA = `local keyActionsDebug = { ['show_fps'] = { action = 'ren_ShowFrameRate', category = 'debug' } }
debugKeyActions = table.combine(keyActionsDebug)`;

const KEY_DESCRIPTIONS_LUA = `keyDescriptions = {
    ['attack'] = '<LOC key_desc_0004>Attack',
    ['shift_attack'] = '<LOC key_desc_0004>Attack',
    ['move'] = 'Move',
    ['toggle_score_screen'] = '<LOC key_desc_0010>Toggle the score screen',
}`;

const KEY_CATEGORIES_LUA = `keyCategories = {
    ['orders'] = "<LOC keymap_category_0036>Orders",
    ['hotbuilding'] = "<LOC keymap_category_091>Hotbuilding",
    ['ui'] = "<LOC keymap_category_0000>UI",
}
keyCategoryOrder = { 'orders', 'hotbuilding', 'ui', 'debug' }`;

const KEY_NAMES_LUA = `keyNames = { ['10'] = 'Shift', ['11'] = 'Ctrl', ['12'] = 'Alt', ['41'] = 'A', ['46'] = 'F', ['4d'] = 'M', ['70'] = 'F1', ['71'] = 'F2' }`;
const PROPER_KEY_NAMES_LUA = `properKeyNames = { ['Ctrl'] = '<LOC properkeyname_0010>Ctrl', ['F1'] = 'F1' }`;
const DEFAULT_KEY_MAP_LUA = `defaultKeyMap = { ['A'] = 'attack', ['Shift-A'] = 'shift_attack', ['M'] = 'move', F2 = 'toggle_score_screen' }
debugKeyMap = { ['Ctrl-F1'] = 'show_fps' }`;
const HOTBUILD_KEY_MAP_LUA = `defaultKeyMap = { ['A'] = 'attack', ['F'] = 'build_t1_factory', ['Shift-F'] = 'move' }
debugKeyMap = { }`;
const ALTERNATIVE_KEY_MAP_LUA = `defaultKeyMap = { ['A'] = 'attack' }
debugKeyMap = { }`;

const US_STRINGS = `OPTIONS_0148="Vertical Sync"
OPTIONS_0150="Sync to vertical refresh of monitor"
key_desc_0004="Attack"
keymap_category_0036="Orders"
_On="On"
_Off="Off"
_Video="Video"`;
const RU_STRINGS = `OPTIONS_0148="Вертикальная синхронизация"
key_desc_0004="Атака"
keymap_category_0036="Приказы"
properkeyname_0010="Ctrl"
_On="Вкл."
_Off="Откл."`;

let directory: string;
/** A data folder like the launcher's, with the archives in gamedata. */
let dataPath: string;
let files: GameFiles;

function luaArchive(options = OPTIONS_LUA): Buffer {
  return buildZip([
    { name: 'lua/options/options.lua', content: options },
    { name: 'lua/ui/help/tooltips.lua', content: TOOLTIPS_LUA },
    { name: 'lua/keymap/keyactions.lua', content: KEY_ACTIONS_LUA },
    // The game's file system ignores case, and so does the launcher.
    { name: 'lua/keymap/debugkeyactions.lua', content: DEBUG_KEY_ACTIONS_LUA },
    { name: 'lua/keymap/keydescriptions.lua', content: KEY_DESCRIPTIONS_LUA },
    { name: 'lua/keymap/keycategories.lua', content: KEY_CATEGORIES_LUA },
    { name: 'lua/keymap/keyNames.lua', content: KEY_NAMES_LUA },
    { name: 'lua/keymap/properKeyNames.lua', content: PROPER_KEY_NAMES_LUA },
    { name: 'lua/keymap/defaultKeyMap.lua', content: DEFAULT_KEY_MAP_LUA },
    { name: 'lua/keymap/hotbuildKeyMap.lua', content: HOTBUILD_KEY_MAP_LUA },
    { name: 'lua/keymap/alternativeKeyMap.lua', content: ALTERNATIVE_KEY_MAP_LUA },
  ]);
}

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-game-options-'));
  dataPath = path.join(directory, 'data');
  const paths = gameFilesPaths(dataPath);
  await mkdir(path.dirname(paths.lua), { recursive: true });
  await writeFile(paths.lua, luaArchive());
  await writeFile(
    paths.loc,
    buildZip([
      { name: 'loc/US/strings_db.lua', content: US_STRINGS },
      { name: 'loc/RU/strings_db.lua', content: RU_STRINGS },
      { name: 'loc/DE/strings_db.lua', content: '' },
    ]),
  );
  files = await loadGameFiles(paths.lua, paths.loc);
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const PREFS = [
  'options_overrides = {',
  '    language = \'ru\',',
  '    antialiasing = {',
  '        default = 0,',
  "        custom = { states = { { text = '<LOC OPTIONS_0029>Off', key = 0 }, { text = '2', key = 64 }, { text = '4', key = 128 }, { text = '8Q', key = 256 } } }",
  '    }',
  '}',
  'profile = {',
  '    current = 1,',
  '    profiles = {',
  '        {',
  "            Name = 'Tester',",
  "            options = { level_of_detail = 2.0999999046326, primary_adapter = '2560,1440,144', vsync = 1 }",
  '        }',
  '    }',
  '}',
  "active_mods = { ['uid-a'] = true }",
  '',
].join('\r\n');

function optionsView(prefs = PREFS): GameOptionsView['sections'] {
  const document = readPrefsDocument(prefs);
  return optionSections(resolveOptions(files, document.globals, document.profile), localizer(files, 'ru'), files.optionTips);
}

function option(sections: GameOptionsView['sections'], key: string): GameOption {
  const found = sections.flatMap((section) => section.groups.flatMap((group) => group.options)).find((candidate) => candidate.key === key);
  assert.ok(found, `no option ${key}`);
  return found;
}

describe('game files', () => {
  it('reads the options dialog of options.lua without running it', () => {
    const [video, sound] = files.optionSections;
    assert.deepEqual(
      video!.items.map((item) => ('header' in item ? `# ${item.header}` : item.key)),
      [
        'primary_adapter',
        '# <LOC OPTIONS_QUALITY>Quality',
        'fidelity_presets',
        'fidelity',
        'shadow_quality',
        'antialiasing',
        'texture_level',
        'level_of_detail',
        'bloom_render',
        'render_skydome',
        'frametime',
        'vsync',
        'selectedlanguage',
      ],
    );
    // The music volume comes from a function call, which leaves a hole in its place.
    assert.deepEqual(
      sound!.items.map((item) => ('header' in item ? item.header : item.key)),
      ['fx_volume', 'music_volume', 'mainmenu_bgmovie'],
    );
    assert.equal(files.optionTips.get('vsync'), '<LOC OPTIONS_0150>Sync to vertical refresh of monitor');
  });

  it('reads key actions, presets and key names', () => {
    assert.deepEqual([...files.keyActions.keys()].sort(), ['attack', 'build_t1_factory', 'move', 'shift_attack', 'show_fps', 'toggle_score_screen']);
    assert.equal(files.keyActions.get('build_t1_factory'), 'hotbuilding');
    assert.equal(files.keyNames.get('4D'), 'M');
    assert.equal(files.presets.default.debug.get('Ctrl-F1'), 'show_fps');
    assert.equal(files.presets.hotbuild.keys.get('Shift-F'), 'move');
    assert.deepEqual(files.keyCategoryOrder, ['orders', 'hotbuilding', 'ui', 'debug']);
  });

  it('translates like LOC: the language, then English, then the text after the tag', () => {
    const localize = localizer(files, 'ru');
    assert.equal(localize('<LOC OPTIONS_0148>Vertical Sync'), 'Вертикальная синхронизация');
    assert.equal(localize('<LOC OPTIONS_0150>Sync'), 'Sync to vertical refresh of monitor');
    assert.equal(localize('<LOC missing>Fallback'), 'Fallback');
    assert.equal(localize('Plain'), 'Plain');
    assert.equal(localizer(files, 'en')('<LOC _On>'), 'On');
  });

  it('reads whole files from an archive and checks them', async () => {
    const archive = path.join(directory, 'broken.zip');
    await writeFile(archive, buildZip([{ name: 'a.lua', content: 'x = 1', crcOverride: 1 }, { name: 'b.lua', content: 'y = 2' }]));
    await assert.rejects(readZipFiles(archive, ['A.LUA']), ZipError);
    const read = await readZipFiles(archive, ['B.lua', 'missing.lua']);
    assert.deepEqual([...read.keys()], ['B.lua']);
    assert.equal(read.get('B.lua')!.toString('utf8'), 'y = 2');

    const stored = path.join(directory, 'stored.zip');
    await writeFile(stored, buildZip([{ name: 'big.lua', content: 'x'.repeat(100), method: 0 }, { name: 'empty.lua', content: '' }]));
    assert.equal((await readZipFiles(stored, ['big.lua', 'empty.lua'])).get('big.lua')!.length, 100);
    assert.equal((await readZipFiles(stored, ['empty.lua'])).get('empty.lua')!.length, 0);
    await assert.rejects(readZipFiles(stored, ['big.lua'], 99), ZipError);
  });
});

describe('game options', () => {
  it('shows the options with the overrides and values of the profile', () => {
    const sections = optionsView();
    assert.deepEqual(
      sections.map((section) => [section.id, section.title, section.groups.map((group) => group.title)]),
      [
        ['video', 'Video', [null, 'Quality']],
        ['sound', '', [null]],
      ],
    );
    const vsync = option(sections, 'vsync');
    assert.equal(vsync.title, 'Вертикальная синхронизация');
    assert.equal(vsync.description, 'Sync to vertical refresh of monitor');
    assert.deepEqual(vsync.control, { kind: 'switch', on: 1, off: 0 });
    // The engine's list of anti-aliasing modes replaces the script's example.
    const antialiasing = option(sections, 'antialiasing').control;
    assert.equal(antialiasing.kind === 'choice' && antialiasing.choices.map((choice) => choice.value).join(), '0,64,128,256');
    // The game stores 2.1 as a 32-bit float; it still matches its state, and the view gives the state's value.
    assert.equal(option(sections, 'level_of_detail').value, 2.1);
    assert.deepEqual(option(sections, 'mainmenu_bgmovie').control, { kind: 'switch', on: true, off: false });
    assert.deepEqual(option(sections, 'music_volume').control, { kind: 'slider', min: 0, max: 100, step: 1 });
    assert.deepEqual(option(sections, 'selectedlanguage').value, 'RU');
    const language = option(sections, 'selectedlanguage').control;
    assert.equal(language.kind === 'choice' && language.choices.map((choice) => choice.value).join(), 'DE,RU,US');
    assert.ok(!sections.some((section) => section.groups.some((group) => group.options.some((item) => item.key === 'run_benchmark'))));
  });

  it('keeps a value the game no longer offers visible', () => {
    const adapter = option(optionsView(), 'primary_adapter');
    assert.equal(adapter.value, '2560,1440,144');
    assert.deepEqual(adapter.control.kind === 'choice' && adapter.control.choices[0], { value: '2560,1440,144', label: '2560,1440,144' });
  });

  it('applies a graphics preset to the options it covers', () => {
    const document = readPrefsDocument(PREFS);
    const sections = resolveOptions(files, document.globals, document.profile);
    assert.deepEqual(Object.fromEntries(optionChanges(sections, 'fidelity_presets', 2)), {
      fidelity_presets: 2,
      fidelity: 2,
      shadow_quality: 2,
      texture_level: 0,
      antialiasing: 128,
      level_of_detail: 2,
      bloom_render: 0,
      render_skydome: 1,
    });
    assert.equal(optionChanges(sections, 'fidelity_presets', 3).get('antialiasing'), 256);
    assert.deepEqual(Object.fromEntries(optionChanges(sections, 'shadow_quality', 3)), { shadow_quality: 3, fidelity_presets: 4 });
  });

  it('keeps the frame time and vertical sync consistent', () => {
    const document = readPrefsDocument(PREFS);
    const sections = resolveOptions(files, document.globals, document.profile);
    assert.deepEqual(Object.fromEntries(optionChanges(sections, 'frametime', 5.4)), { frametime: 5, vsync: 0 });
    assert.deepEqual(Object.fromEntries(optionChanges(sections, 'vsync', 1)), { vsync: 1, frametime: 8 });
    assert.deepEqual(Object.fromEntries(optionChanges(sections, 'vsync', 0)), { vsync: 0 });
  });

  it('accepts only options and values the game has', () => {
    const document = readPrefsDocument(PREFS);
    const sections = resolveOptions(files, document.globals, document.profile);
    assert.throws(() => optionChanges(sections, 'no_such_option', 1));
    assert.throws(() => optionChanges(sections, 'vsync', 2));
    assert.throws(() => optionChanges(sections, 'frametime', 20));
    assert.throws(() => optionChanges(sections, 'frametime', 'fast'));
    assert.equal(optionChanges(sections, 'level_of_detail', 1).get('level_of_detail'), 1);
  });
});

describe('Game.prefs', () => {
  it('writes data in the format the game saves it', () => {
    const globals = parseLua("a = { 1, 'x', empty = { }, ['b-c'] = 'it\\'s \\\\ \\n', on = true }\nn = 2.5");
    assert.equal(
      serializeLuaGlobals(globals),
      "a = {\r\n    1,\r\n    'x',\r\n    empty = { },\r\n    ['b-c'] = 'it\\'s \\\\ \\n',\r\n    on = true\r\n}\r\nn = 2.5\r\n",
    );
    const latin1 = new Map([['name', 'Caf\u00e9 \u0001']]);
    assert.equal(parseLua(serializeLuaGlobals(latin1)).get('name'), 'Caf\u00e9 \u0001');
    assert.throws(() => serializeLuaGlobals(new Map([['name', '\u0416']])), LuaWriteError);
    assert.throws(() => serializeLuaGlobals(new Map([['f', new LuaFunction(() => null)]])), LuaWriteError);
  });

  it('reads back exactly what it writes', () => {
    // A fixed seed keeps the run repeatable while covering odd strings, keys and numbers.
    let seed = 20261026;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const below = (limit: number): number => Math.floor(random() * limit);
    const text = (): string => Array.from({ length: below(8) }, () => String.fromCharCode(below(256))).join('');
    const number = (): number => (below(2) ? below(1000) - 500 : (random() - 0.5) * 10 ** (below(30) - 10));
    const value = (depth: number): LuaValue => {
      switch (below(depth > 3 ? 4 : 5)) {
        case 0:
          return text();
        case 1:
          return number();
        case 2:
          return below(2) === 1;
        case 3:
          return below(10);
        default:
          return table(depth + 1);
      }
    };
    const table = (depth: number): LuaTable => {
      const result = new LuaTable();
      for (let index = 1; index <= below(5); index++) {
        result.set(index, value(depth));
      }
      for (let field = below(6); field > 0; field--) {
        const keys = [text(), `name_${below(9)}`, below(30) + 1, number(), below(2) === 1];
        result.set(keys[below(keys.length)]!, value(depth));
      }
      return result;
    };
    const asTable = (globals: ReadonlyMap<string, LuaValue>): LuaTable => {
      const result = new LuaTable();
      for (const [name, entry] of globals) {
        result.set(name, entry);
      }
      return result;
    };
    for (let round = 0; round < 200; round++) {
      const globals = new Map<string, LuaValue>([
        ['data', table(0)],
        ['label', text()],
        ['amount', number()],
      ]);
      const written = serializeLuaGlobals(globals);
      assert.ok(luaEquals(asTable(globals), asTable(parseLua(written))), written);
    }
  });

  it('changes the current profile and keeps the rest of the file', () => {
    const document = readPrefsDocument(PREFS);
    (document.profile.get('options') as LuaTable).set('vsync', 0);
    const written = writePrefsDocument(document, PREFS);
    assert.ok(written.includes('\r\n'));
    const again = readPrefsDocument(written);
    assert.equal((again.profile.get('options') as LuaTable).get('vsync'), 0);
    assert.equal((again.globals.get('active_mods') as LuaTable).get('uid-a'), true);
    assert.equal(writePrefsDocument(readPrefsDocument(PREFS.replaceAll('\r\n', '\n')), PREFS.replaceAll('\r\n', '\n')).includes('\r'), false);
  });

  it('needs a profile and data it can read', () => {
    assert.throws(() => readPrefsDocument(''), /профил/);
    assert.throws(() => readPrefsDocument('profile = { current = 2, profiles = { { } } }'), /профил/);
    assert.throws(() => readPrefsDocument('profile = function() end'), /TFAF.prefs/);
  });

  it('runs changes one after another and writes nothing when a change fails', async () => {
    const prefsPath = path.join(directory, 'Game.prefs');
    await writeFile(prefsPath, 'a = 1\n', 'latin1');
    await Promise.all([
      updateGamePrefs(prefsPath, (content) => `${content}b = 2\n`),
      updateGamePrefs(prefsPath, (content) => `${content}c = 3\n`),
      assert.rejects(
        updateGamePrefs(prefsPath, () => {
          throw new Error('refused');
        }),
      ),
    ]);
    assert.equal(await readGamePrefs(prefsPath), 'a = 1\nb = 2\nc = 3\n');
    assert.equal(await readFile(`${prefsPath}.tfaf-backup`, 'latin1'), 'a = 1\n');
  });
});

describe('key bindings', () => {
  const PROFILE = "profile = { current = 1, profiles = { { Name = 'Tester' } } }";

  function context(preset: 'default' | 'hotbuild' = 'default'): KeyMapContext {
    const document = readPrefsDocument(PROFILE);
    return { preset: files.presets[preset], defaults: files.presets.default, actions: profileKeyActions(files, document.profile) };
  }

  const PRESET: ProfileKeyMaps = { user: null, debug: null };

  function bindings(maps: ProfileKeyMaps, keyContext = context()): Record<string, string> {
    return Object.fromEntries(currentKeyMap(maps, keyContext));
  }

  it('copies the preset into the profile on the first change and takes the key from its action', () => {
    const maps = assignKey(PRESET, context(), 'move', 'A');
    assert.ok(maps.user);
    assert.deepEqual(bindings(maps), { 'Shift-A': 'shift_attack', A: 'move', F2: 'toggle_score_screen', 'Ctrl-F1': 'show_fps' });
  });

  it('moves the Shift variant of an order with its key', () => {
    const maps = assignKey(PRESET, context(), 'attack', 'M');
    assert.deepEqual(bindings(maps), { F2: 'toggle_score_screen', 'Ctrl-F1': 'show_fps', M: 'attack', 'Shift-M': 'shift_attack' });
    // A combination with a modifier has no Shift variant.
    assert.deepEqual(bindings(assignKey(PRESET, context(), 'attack', 'Ctrl-M')), {
      'Shift-A': 'shift_attack',
      M: 'move',
      F2: 'toggle_score_screen',
      'Ctrl-F1': 'show_fps',
      'Ctrl-M': 'attack',
    });
  });

  it('removes a key with the Shift variant that came with it', () => {
    const maps = unbindKey(PRESET, context(), 'attack', 'A');
    assert.deepEqual(bindings(maps), { M: 'move', F2: 'toggle_score_screen', 'Ctrl-F1': 'show_fps' });
    // A key of another action is left alone.
    assert.equal(unbindKey(PRESET, context(), 'attack', 'M'), PRESET);
  });

  it('removes a debug key from both maps of the profile', () => {
    const maps = unbindKey(PRESET, context(), 'show_fps', 'Ctrl-F1');
    assert.equal(maps.user!.has('Ctrl-F1'), false);
    assert.equal(maps.debug!.has('Ctrl-F1'), false);
  });

  it('reads and resets the preset of the profile', () => {
    const document = readPrefsDocument(PROFILE);
    assert.equal(presetOf(document.profile), 'default');
    document.profile.set('UserKeyMapName', '/lua/keymap/hotbuildkeymap.lua');
    assert.equal(presetOf(document.profile), 'hotbuild');
    document.profile.set('UserKeyMap', new LuaTable());
    resetToPreset(document.profile, 'alternative');
    assert.equal(document.profile.get('UserKeyMapName'), 'alternativeKeyMap.lua');
    assert.deepEqual(readProfileKeyMaps(document.profile), { user: null, debug: null });
  });

  it('groups the actions as the key dialog does and warns about blocked hotbuild modifiers', () => {
    const keyContext = context('hotbuild');
    const categories = keyActionCategories(files, keyContext.actions, currentKeyMap(PRESET, keyContext), {
      localize: localizer(files, 'ru'),
      shiftVariant: (title) => `${title} (Shift)`,
      compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    });
    assert.deepEqual(
      categories.map((category) => [category.id, category.title]),
      [
        ['orders', 'Приказы'],
        ['hotbuilding', 'Hotbuilding'],
        ['ui', 'UI'],
        ['debug', 'debug'],
      ],
    );
    assert.deepEqual(
      categories[0]!.actions.map((action) => [action.title, action.keys]),
      [
        ['Move', ['Shift-F']],
        ['Атака', ['A']],
        ['Атака (Shift)', []],
      ],
    );
    assert.deepEqual(categories[1]!.actions[0]!.blockedModifiers, ['Shift-F']);
  });

  it('spells combinations as the game does', () => {
    assert.equal(normalizeKeyBinding('Shift-Ctrl-A'), 'Ctrl-Shift-A');
    assert.equal(normalizeKeyBinding('Alt-Shift-Ctrl-X'), 'Ctrl-Shift-Alt-X');
    assert.equal(keyBinding('A', { ctrl: true, alt: true, shift: true }), 'Ctrl-Alt-Shift-A');
    assert.equal(keyBinding('Shift', { ctrl: false, alt: false, shift: true }), 'Shift');
    const names = new Set(files.keyNames.values());
    assert.equal(isValidKeyBinding('Ctrl-Shift-A', names), true);
    assert.equal(isValidKeyBinding('Shift', names), true);
    assert.equal(isValidKeyBinding('Ctrl-Ctrl-A', names), false);
    assert.equal(isValidKeyBinding('A-Ctrl', names), false);
    assert.equal(isValidKeyBinding('Ctrl-Q', names), false);
  });
});

describe('settings files', () => {
  function sections(prefs = PREFS) {
    const document = readPrefsDocument(prefs);
    return resolveOptions(files, document.globals, document.profile);
  }

  it('reads back what it exported', () => {
    const options = optionValues(sections());
    const maps: ProfileKeyMaps = { user: new Map([['Ctrl-A', 'attack']]), debug: null };
    const parsed = parseSettingsFile(
      serializeSettingsFile({ exportedAt: '2026-10-26T10:00:00.000Z', options, keys: { preset: 'hotbuild', maps } }),
    );
    assert.equal(parsed.exportedAt, '2026-10-26T10:00:00.000Z');
    assert.deepEqual(parsed.options, options);
    assert.deepEqual(parsed.keys, { preset: 'hotbuild', maps });
    assert.equal(parsed.options.get('level_of_detail'), 2.0999999046326);
  });

  it('refuses files that are not settings and drops entries of a wrong type', () => {
    assert.throws(() => parseSettingsFile('not json'), /не файл настроек/);
    assert.throws(() => parseSettingsFile('{"format":"other","version":1,"options":{"a":1}}'), /не файл настроек/);
    assert.throws(() => parseSettingsFile('{"format":"tfaf-game-settings","version":2,"options":{"a":1}}'), /более новой/);
    assert.throws(() => parseSettingsFile('{"format":"tfaf-game-settings","version":1}'), /не файл настроек/);
    const parsed = parseSettingsFile(
      JSON.stringify({
        format: 'tfaf-game-settings',
        version: 1,
        options: { vsync: 0, nested: { a: 1 }, empty: '', long: 'x'.repeat(300), ok: 'yes' },
        keys: { preset: 'hotbuild', keyMap: { A: 'attack', B: 5, ['C'.repeat(200)]: 'move' }, debugKeyMap: 'nope' },
      }),
    );
    assert.deepEqual([...parsed.options], [['vsync', 0], ['ok', 'yes']]);
    assert.deepEqual(parsed.keys, { preset: 'hotbuild', maps: { user: new Map([['A', 'attack']]), debug: null } });
    assert.equal(parseSettingsFile('{"format":"tfaf-game-settings","version":1,"options":{"a":1},"keys":{"preset":"x"}}').keys, null);
  });

  it('imports the chosen sections with the values the game offers here', () => {
    const values = new Map<string, string | number | boolean>([
      ['primary_adapter', '9999,9999,60'],
      ['vsync', 0],
      ['level_of_detail', 2.0999999046326],
      ['fx_volume', 40],
      ['no_such_option', 1],
    ]);
    assert.deepEqual(Object.fromEntries(optionCounts(sections(), values)), { video: 3, sound: 1 });
    const video = importedOptions(sections(), values, new Set(['video']));
    assert.deepEqual(Object.fromEntries(video.accepted), { vsync: 0, level_of_detail: 2.1 });
    assert.deepEqual(video.skippedTitles, ['<LOC OPTIONS_0010>Primary Adapter']);
    assert.deepEqual(Object.fromEntries(importedOptions(sections(), values, new Set(['sound'])).accepted), { fx_volume: 40 });
    // The profile's own display mode is not offered either, but importing it changes nothing.
    assert.deepEqual(importedOptions(sections(), new Map([['primary_adapter', '2560,1440,144']]), new Set(['video'])).skippedTitles, []);
  });

  it('imports only bindings of keys and actions this game has', () => {
    const actions = profileKeyActions(files, readPrefsDocument("profile = { current = 1, profiles = { { } } }").profile);
    const { maps, skipped } = usableKeyMaps(
      { user: new Map([['A', 'attack'], ['Q', 'attack'], ['M', 'mod_action']]), debug: new Map([['Ctrl-F1', 'show_fps']]) },
      new Set(files.keyNames.values()),
      actions,
    );
    assert.deepEqual(maps, { user: new Map([['A', 'attack']]), debug: new Map([['Ctrl-F1', 'show_fps']]) });
    assert.deepEqual(skipped, ['Q: attack', 'M: mod_action']);
  });
});

describe('game options service', () => {
  interface Harness {
    service: GameOptionsService;
    /** TFAF.prefs, which the service works with. */
    prefsPath: string;
    /** The official client's Game.prefs, which TFAF.prefs starts from and which must stay as it is. */
    sharedPath: string;
    state: { phase: string; running: boolean; exportTo: string | null; importFrom: string | null };
  }

  async function harness(prefs: string | null = PREFS, data = dataPath): Promise<Harness> {
    const folder = await mkdtemp(path.join(directory, 'profile-'));
    const sharedPath = path.join(folder, 'Game.prefs');
    if (prefs !== null) {
      await writeFile(sharedPath, prefs, 'latin1');
    }
    const state: Harness['state'] = { phase: 'idle', running: false, exportTo: null, importFrom: null };
    const deps: GameOptionsDeps = {
      settings: { get: () => ({ dataPath: data, gamePrefsPath: sharedPath }) as never },
      games: { getState: () => ({ phase: state.phase }) as never },
      isForgedAllianceRunning: async () => state.running,
      pickExportFile: async () => state.exportTo,
      pickImportFile: async () => state.importFrom,
    };
    return { service: new GameOptionsService(deps), prefsPath: path.join(folder, 'TFAF.prefs'), sharedPath, state };
  }

  async function profileOf(prefsPath: string): Promise<LuaTable> {
    return readPrefsDocument(await readGamePrefs(prefsPath)).profile;
  }

  function storedOption(profile: LuaTable, key: string): unknown {
    return (profile.get('options') as LuaTable).get(key);
  }

  function keysOf(view: { categories: { actions: { id: string; keys: string[] }[] }[] }, id: string): string[] {
    return view.categories.flatMap((category) => category.actions).find((action) => action.id === id)!.keys;
  }

  it('reads the profile and tells when the game runs', async () => {
    const { service, state } = await harness();
    const view = await service.options();
    assert.equal(view.profile, 'Tester');
    assert.equal(view.gameRunning, false);
    state.running = true;
    assert.equal((await service.options()).gameRunning, true);
    state.running = false;
    state.phase = 'running';
    assert.equal((await service.keyBindings()).gameRunning, true);
  });

  it('saves an option with the ones the game changes with it and keeps the rest of the file', async () => {
    const { service, prefsPath, sharedPath } = await harness();
    const view = await service.setOption('fidelity_presets', 0);
    assert.equal(option(view.sections, 'fidelity').value, 0);
    const profile = await profileOf(prefsPath);
    assert.deepEqual(
      ['fidelity_presets', 'fidelity', 'shadow_quality', 'texture_level', 'render_skydome'].map((key) => storedOption(profile, key)),
      [0, 0, 0, 2, 0],
    );
    const document = readPrefsDocument(await readGamePrefs(prefsPath));
    assert.equal((document.globals.get('active_mods') as LuaTable).get('uid-a'), true);
    assert.equal(await readFile(`${prefsPath}.tfaf-backup`, 'latin1'), PREFS);
    // The official client's settings stay its own.
    assert.equal(await readGamePrefs(sharedPath), PREFS);
    await assert.rejects(service.setOption('no_such_option', 1), /нет настройки/);
    await assert.rejects(service.setOption('vsync', 5), /не принимает/);
  });

  it('changes nothing while Forged Alliance runs', async () => {
    const { service, prefsPath, sharedPath, state } = await harness();
    state.running = true;
    await assert.rejects(service.setOption('vsync', 0), /Закройте Forged Alliance/);
    await assert.rejects(service.assignKey('move', 'F1'), /Закройте Forged Alliance/);
    await assert.rejects(service.resetKeys('hotbuild'), /Закройте Forged Alliance/);
    state.running = false;
    state.phase = 'launching';
    await assert.rejects(service.unbindKey('attack', 'A'), /Закройте Forged Alliance/);
    assert.equal(await readGamePrefs(sharedPath), PREFS);
    assert.ok(['', PREFS].includes(await readGamePrefs(prefsPath)));
  });

  it('changes key bindings in the profile', async () => {
    const { service, prefsPath } = await harness();
    let view = await service.assignKey('move', 'Ctrl-A');
    assert.deepEqual(keysOf(view, 'move'), ['Ctrl-A']);
    assert.equal(view.customized, true);
    assert.equal(((await profileOf(prefsPath)).get('UserKeyMap') as LuaTable).get('Ctrl-A'), 'move');
    view = await service.unbindKey('move', 'Ctrl-A');
    assert.deepEqual(keysOf(view, 'move'), []);
    await assert.rejects(service.assignKey('move', 'Ctrl-Q'), /не поддерживает сочетание/);
    await assert.rejects(service.assignKey('no_such_action', 'A'), /нет действия/);
    view = await service.resetKeys('hotbuild');
    assert.equal(view.preset, 'hotbuild');
    assert.equal(view.customized, false);
    assert.deepEqual(keysOf(view, 'build_t1_factory'), ['F']);
    const profile = await profileOf(prefsPath);
    assert.equal(profile.get('UserKeyMapName'), 'hotbuildKeyMap.lua');
    assert.equal(profile.get('UserKeyMap'), null);
    assert.equal(view.keyCodes['4D'], 'M');
    assert.equal(view.keyLabels.Ctrl, 'Ctrl');
  });

  it('exports a profile and imports the chosen parts into another', async () => {
    const source = await harness();
    await source.service.setOption('vsync', 0);
    await source.service.setOption('fx_volume', 40);
    await source.service.assignKey('move', 'Ctrl-A');
    assert.equal(await source.service.exportSettings(), null);
    const exported = path.join(directory, 'exported.json');
    source.state.exportTo = exported;
    assert.equal(await source.service.exportSettings(), exported);

    const target = await harness(PREFS.replace("Name = 'Tester'", "Name = 'Other'"));
    target.state.importFrom = exported;
    const candidate = (await target.service.pickImport())!;
    assert.equal(candidate.fileName, 'exported.json');
    assert.equal(candidate.keyPreset, 'default');
    assert.deepEqual(
      candidate.parts.map((part) => [part.id, part.count]),
      [
        ['video', 12],
        ['sound', 3],
        ['keys', 6],
      ],
    );
    assert.deepEqual(await target.service.importSettings(candidate.token, ['sound', 'keys']), { options: 3, keyBindings: 6, skipped: [] });
    let profile = await profileOf(target.prefsPath);
    assert.equal(storedOption(profile, 'fx_volume'), 40);
    assert.equal(storedOption(profile, 'vsync'), 1);
    assert.equal((profile.get('UserKeyMap') as LuaTable).get('Ctrl-A'), 'move');
    assert.equal(profile.get('Name'), 'Other');
    // A picked file is imported once.
    await assert.rejects(target.service.importSettings(candidate.token, ['video']), /заново/);

    // The display mode in the file is the profile's own, which the game no longer offers: neither taken nor reported.
    const again = (await target.service.pickImport())!;
    assert.deepEqual(await target.service.importSettings(again.token, ['video']), { options: 11, keyBindings: null, skipped: [] });
    profile = await profileOf(target.prefsPath);
    assert.equal(storedOption(profile, 'vsync'), 0);

    // An import takes the values as they are: by hand, turning vertical sync on would also bring the frame time to 8.
    const linked = path.join(directory, 'linked.json');
    await writeFile(linked, serializeSettingsFile({ exportedAt: null, options: new Map([['vsync', 1], ['frametime', 5]]), keys: null }));
    target.state.importFrom = linked;
    const third = (await target.service.pickImport())!;
    assert.deepEqual(await target.service.importSettings(third.token, ['video']), { options: 2, keyBindings: null, skipped: [] });
    profile = await profileOf(target.prefsPath);
    assert.deepEqual([storedOption(profile, 'vsync'), storedOption(profile, 'frametime')], [1, 5]);
  });

  it('keeps the picked file until the game is closed', async () => {
    const file = path.join(directory, 'keys-only.json');
    await writeFile(
      file,
      serializeSettingsFile({ exportedAt: null, options: new Map(), keys: { preset: 'alternative', maps: { user: null, debug: null } } }),
    );
    const { service, prefsPath, state } = await harness();
    state.importFrom = file;
    const candidate = (await service.pickImport())!;
    assert.deepEqual(candidate.parts, [{ id: 'keys', title: 'Клавиши', count: 0 }]);
    state.running = true;
    await assert.rejects(service.importSettings(candidate.token, ['keys']), /Закройте Forged Alliance/);
    state.running = false;
    assert.deepEqual(await service.importSettings(candidate.token, ['keys']), { options: 0, keyBindings: 0, skipped: [] });
    assert.equal((await profileOf(prefsPath)).get('UserKeyMapName'), 'alternativeKeyMap.lua');
    await assert.rejects(service.importSettings('00000000-0000-0000-0000-000000000000', ['keys']), /заново/);
  });

  it('refuses files that are not settings', async () => {
    const { service, state } = await harness();
    assert.equal(await service.pickImport(), null);
    state.importFrom = path.join(directory, 'note.txt');
    await writeFile(state.importFrom, 'hello');
    await assert.rejects(service.pickImport(), /не файл настроек/);
    state.importFrom = path.join(directory, 'huge.json');
    await writeFile(state.importFrom, ' '.repeat(1024 * 1024 + 1));
    await assert.rejects(service.pickImport(), /не файл настроек/);
  });

  it('tells what is missing: game files or a game profile', async () => {
    await assert.rejects((await harness(PREFS, path.join(directory, 'no-data'))).service.options(), /не загружены/);
    await assert.rejects((await harness('profile = {')).service.options(), /Не удалось прочитать TFAF.prefs/);
    // No profile yet is a state the views show with a way to start the game, while changes still need one.
    const noProfile = await harness(null);
    assert.deepEqual(await noProfile.service.options(), { profile: null, sections: [], gameRunning: false });
    const keys = await noProfile.service.keyBindings();
    assert.deepEqual([keys.profile, keys.categories, keys.keyCodes['41']], [null, [], 'A']);
    await assert.rejects(noProfile.service.setOption('vsync', 0), /нет профиля/);
    noProfile.state.exportTo = path.join(directory, 'never.json');
    await assert.rejects(noProfile.service.exportSettings(), /нет профиля/);
  });

  it('reads the game files again when they are updated', async () => {
    const data = path.join(directory, 'updated-data');
    const paths = gameFilesPaths(data);
    await mkdir(path.dirname(paths.lua), { recursive: true });
    await writeFile(paths.lua, luaArchive());
    await writeFile(paths.loc, await readFile(gameFilesPaths(dataPath).loc));
    const { service } = await harness(PREFS, data);
    option((await service.options()).sections, 'vsync');
    const before = await stat(paths.lua);
    await writeFile(paths.lua, luaArchive(OPTIONS_LUA.replace("key = 'vsync'", "key = 'vertical_sync'")));
    assert.notEqual((await stat(paths.lua)).size, before.size);
    option((await service.options()).sections, 'vertical_sync');
  });
});
