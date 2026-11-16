import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LuaFunction, LuaParseError, LuaTable, parseLua } from '../src/main/lua/luaParser.ts';
import { readModInfo } from '../src/main/vault/modInfoReader.ts';
import { readScenario } from '../src/main/vault/scenarioReader.ts';

describe('parseLua', () => {
  it('evaluates literals, comments, long strings and escapes', () => {
    const globals = parseLua(`
      -- line comment
      --[[ block
           comment ]]
      a = 'single \\'quoted\\''
      b = "tab\\tnew\\nline \\65\\066"
      c = [==[
long ]] string]==]
      d = 0x10 + 1.5e1 * 2
      e = true; f = nil
      g = -3
    `);
    assert.equal(globals.get('a'), "single 'quoted'");
    assert.equal(globals.get('b'), 'tab\tnew\nline AB');
    assert.equal(globals.get('c'), 'long ]] string');
    assert.equal(globals.get('d'), 46);
    assert.equal(globals.get('e'), true);
    assert.equal(globals.get('f'), null);
    assert.equal(globals.get('g'), -3);
  });

  it('reads the escapes of Lua 5.0, which keeps unknown ones as plain characters', () => {
    const globals = parseLua(`
      saved = '\\-48\\-96\\-128'
      path = 'C:\\Users'
      newer = "\\x41 \\u{41} \\z  b"
    `);
    assert.equal(globals.get('saved'), '-48-96-128');
    assert.equal(globals.get('path'), 'C:Users');
    assert.equal(globals.get('newer'), 'x41 u{41} z  b');
  });

  it('builds tables with positional, named and bracketed keys', () => {
    const globals = parseLua(`t = { 'a', 'b'; x = 1, ['y z'] = { 2 }, [10] = 'ten', }`);
    const table = globals.get('t');
    assert.ok(table instanceof LuaTable);
    assert.equal(table.length, 2);
    assert.equal(table.get(2), 'b');
    assert.equal(table.get('x'), 1);
    assert.equal((table.get('y z') as LuaTable).get(1), 2);
    assert.equal(table.get(10), 'ten');
  });

  it('supports concatenation, references and field assignment', () => {
    const globals = parseLua(`
      base = "v"
      version = 3
      label = base .. version .. "." .. (version + 1)
      t = {}
      t.inner = { value = label }
    `);
    assert.equal(globals.get('label'), 'v3.4');
    assert.equal(((globals.get('t') as LuaTable).get('inner') as LuaTable).get('value'), 'v3.4');
  });

  it('treats calls like STRING(...) as their first argument', () => {
    const globals = parseLua(`props = { ['ExtraArmies'] = STRING( 'ARMY_9 NEUTRAL_CIVILIAN' ), f = FLOAT(1.5), s = STRING 'x' }`);
    const props = globals.get('props') as LuaTable;
    assert.equal(props.get('ExtraArmies'), 'ARMY_9 NEUTRAL_CIVILIAN');
    assert.equal(props.get('f'), 1.5);
    assert.equal(props.get('s'), 'x');
  });

  it('rejects executable code', () => {
    assert.throws(() => parseLua('function evil() end'), LuaParseError);
    assert.throws(() => parseLua('if x then y = 1 end'), LuaParseError);
  });

  it('reports unterminated strings', () => {
    assert.throws(() => parseLua('a = "open'), LuaParseError);
  });
});

describe('parseLua in the lenient mode', () => {
  it('reads the data of a game script without running its code', () => {
    const globals = parseLua(
      `
      local Prefs = import("/lua/user/prefs.lua")
      local volume = import("/lua/usermusic.lua").SetMusicVolume
      local function computed()
          if x != 1 then return { key = 'a' } end
          for i = 1, 3 do repeat y = i until y > 2 end
      end
      function Global(a, ...) while true do break end end
      options = {
          items = {
              { key = 'first', set = function(key, value) ConExecute("x " .. value) end },
              computed(),
              { key = 'third', states = (function() if a then return {} end end)() },
          },
      }
      `,
      { lenient: true },
    );
    const items = (globals.get('options') as LuaTable).get('items') as LuaTable;
    assert.equal((items.get(1) as LuaTable).get('key'), 'first');
    assert.equal((items.get(1) as LuaTable).get('set') instanceof LuaFunction, true);
    // The computed item leaves a hole, so the next one keeps its place.
    assert.equal(items.get(2), null);
    assert.equal((items.get(3) as LuaTable).get('key'), 'third');
    assert.equal((items.get(3) as LuaTable).get('states'), null);
    assert.equal(globals.get('Prefs'), null);
    assert.equal(globals.get('volume'), null);
    assert.equal(globals.get('Global') instanceof LuaFunction, true);
  });

  it('calls the functions passed in as globals', () => {
    const library = new LuaTable();
    library.set('combine', new LuaFunction((args) => {
      const combined = new LuaTable();
      for (const arg of args) {
        for (const key of (arg as LuaTable).keys()) {
          combined.set(key, (arg as LuaTable).get(key));
        }
      }
      return combined;
    }));
    const globals = parseLua(`local a = { x = 1 }\nlocal b = { y = 2 }\nall = table.combine(a, b)`, {
      lenient: true,
      globals: [['table', library], ['__language', 'RU']],
    });
    const all = globals.get('all') as LuaTable;
    assert.deepEqual([all.get('x'), all.get('y')], [1, 2]);
    assert.equal(globals.get('__language'), 'RU');
  });

  it('still rejects code outside the lenient mode', () => {
    assert.throws(() => parseLua('t = { set = function() end }'), LuaParseError);
    assert.throws(() => parseLua('local function f() end'), LuaParseError);
  });

  it('reports a block that is never closed', () => {
    assert.throws(() => parseLua('function f() if x then', { lenient: true }), LuaParseError);
  });
});

describe('readScenario', () => {
  it('reads the map metadata like the official client', () => {
    const scenario = readScenario(`
      version = 3
      ScenarioInfo = {
        name = 'Seton\\'s Clutch',
        description = "<LOC SCMP_015_Description>Dear Lord, what a place.",
        preview = '',
        map_version = 7,
        type = 'skirmish',
        starts = true,
        size = {1024, 1024},
        map = '/maps/SCMP_015/SCMP_015.scmap',
        Configurations = {
          ['standard'] = {
            teams = {
              { name = 'FFA', armies = {'ARMY_1','ARMY_2','ARMY_3','ARMY_4','ARMY_5','ARMY_6','ARMY_7','ARMY_8'} },
            },
            customprops = {
              ['ExtraArmies'] = STRING( 'ARMY_9 NEUTRAL_CIVILIAN' ),
            },
          },
        }
      }
    `);
    assert.deepEqual(scenario, {
      name: "Seton's Clutch",
      description: 'Dear Lord, what a place.',
      type: 'skirmish',
      widthPx: 1024,
      heightPx: 1024,
      maxPlayers: 8,
      version: '7',
      files: { map: '/maps/SCMP_015/SCMP_015.scmap', save: null, script: null },
    });
  });

  it('fails when ScenarioInfo is missing', () => {
    assert.throws(() => readScenario('version = 3'), LuaParseError);
  });
});

describe('readModInfo', () => {
  it('reads mod_info.lua fields', () => {
    const mod = readModInfo(`
      name = "TFAF Sim"
      uid = "5f3a2c1e-0000-4000-8000-000000000001"
      version = 2
      copyright = "MIT"
      description = [[Balance changes
for friends]]
      author = "Tergride"
      icon = "/mods/tfaf-sim/icon.png"
      selectable = true
      enabled = true
      exclusive = false
      ui_only = false
      requires = { }
      conflicts = { }
      before = { }
      after = { }
    `);
    assert.deepEqual(mod, {
      uid: '5f3a2c1e-0000-4000-8000-000000000001',
      name: 'TFAF Sim',
      version: '2',
      author: 'Tergride',
      description: 'Balance changes\nfor friends',
      uiOnly: false,
      icon: '/mods/tfaf-sim/icon.png',
    });
  });

  it('requires a uid', () => {
    assert.throws(() => readModInfo('name = "No uid"'), LuaParseError);
  });
});
