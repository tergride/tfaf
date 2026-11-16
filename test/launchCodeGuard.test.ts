import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { launchCodeFingerprints, unsupportedLaunchCode, WATCHED_CODE, watchedLabel } from '../src/main/game/tfafLobby/launchCodeGuard.ts';
import { gamePackages } from '../src/main/gameOptions/gamePackages.ts';
import { findLuaDefinition, findLuaSpan, luaFingerprint } from '../src/main/lua/luaChunks.ts';
import { GameFileSystem } from '../src/main/mapView/gameFileSystem.ts';
import type { Settings } from '../src/shared/contract.ts';

const SCRIPT = `
local x = "end"
-- function TryLaunch() end in a comment
local function TryLaunch(skip)
    if skip then
        for i = 1, 3 do
            while false do end
        end
    end
    local s = [[ end ]]
    repeat x = x .. 'end' until true
    return function() return 1 end
end

HostUtils = {
    SendArmySettingsToServer = function()
        local t = { a = { b = 1 } }
    end,
}

function lobbyComm.GameLaunched(self) end
lobbyComm.GameLaunched = function(self) GpgNetSend('GameState', 'Launching') end
Launch = { Accept = 1, Handle = function(data) end }
`;

describe('Lua pieces', () => {
  it('find a function to its own end past nested blocks, strings and comments', () => {
    const found = findLuaDefinition(SCRIPT, 'TryLaunch')!;
    const [first, last] = [found.tokens[0]!, found.tokens.at(-1)!];
    assert.ok(first.kind === 'name' && first.value === 'function');
    assert.ok(last.kind === 'name' && last.value === 'end');
    assert.match(found.body!, /^\s*if skip then/);
    assert.match(found.body!, /return function\(\) return 1 end\s*$/);
  });

  it('find a table field, a dotted name and a table', () => {
    assert.ok(findLuaDefinition(SCRIPT, 'SendArmySettingsToServer')!.body!.includes('local t'));
    assert.equal(findLuaDefinition(SCRIPT, 'lobbyComm.GameLaunched')!.body!.trim(), '');
    assert.equal(findLuaDefinition(SCRIPT, 'Launch')!.tokens[0]!.kind, 'symbol');
    assert.equal(findLuaDefinition(SCRIPT, 'GameLaunched'), null);
    assert.equal(findLuaDefinition(SCRIPT, 'Missing'), null);
  });

  it('cut the code between two snippets', () => {
    const span = findLuaSpan(SCRIPT, 'local s = [[ end ]]', "repeat x = x .. 'end' until true")!;
    assert.equal(span.tokens.length, 12);
    assert.equal(findLuaSpan(SCRIPT, 'local nothing = 1', 'end'), null);
  });

  it('fingerprint the code and nothing else', () => {
    const tight = findLuaDefinition('function f(a) return a + 1 end', 'f')!;
    const loose = findLuaDefinition("-- adds one\nfunction f( a )\n    return a+1 -- here\nend", 'f')!;
    const other = findLuaDefinition('function f(a) return a + 2 end', 'f')!;
    assert.equal(luaFingerprint(tight.tokens), luaFingerprint(loose.tokens));
    assert.notEqual(luaFingerprint(tight.tokens), luaFingerprint(other.tokens));
    const quoted = (quote: string): string => luaFingerprint(findLuaDefinition(`function f() return ${quote}x${quote} end`, 'f')!.tokens);
    assert.equal(quoted('"'), quoted("'"));
  });
});

describe('launch code guard', () => {
  const scripts = (sources: Record<string, string>) => ({ script: (file: string) => Promise.resolve(sources[file] ?? null) });
  const label = (index: number): string => watchedLabel(WATCHED_CODE[index]!);

  it('reports every piece that is gone or changed, and passes those it knows', async () => {
    const files = scripts({ '/lua/multiplayer/onlineprovider.lua': 'function CreateLobby() end' });
    const fingerprints = await launchCodeFingerprints(files, 'faf');
    const known = fingerprints.get(label(0))!;
    assert.ok(known);
    const unsupported = await unsupportedLaunchCode(files, 'faf', { [label(0)]: [known] });
    assert.ok(!unsupported.includes(label(0)));
    assert.ok(unsupported.includes('lua/ui/lobby/lobby.lua: TryLaunch'));
    assert.deepEqual(await unsupportedLaunchCode(files, 'faf', { [label(0)]: ['other'] }).then((list) => list.includes(label(0))), true);
  });

  it('checks the hook of Nomads only for Nomads', async () => {
    const files = scripts({});
    assert.ok(!(await launchCodeFingerprints(files, 'faf')).has('nomadhook/lua/ui/lobby/lobby.lua'));
    assert.ok((await launchCodeFingerprints(files, 'nomads')).has('nomadhook/lua/ui/lobby/lobby.lua'));
  });

  const installed = path.join('C:', 'ProgramData', 'TFAF');
  it('knows the code of the installed FAF', { skip: !existsSync(path.join(installed, 'gamedata', 'lua.nx2')) }, async () => {
    const files = new GameFileSystem({ get: () => ({ dataPath: installed, gamePath: null }) as Settings, mapsDirectory: installed }, ({ dataPath }) =>
      gamePackages('faf', dataPath, null),
    );
    assert.deepEqual(await unsupportedLaunchCode(files, 'faf'), []);
  });
});
