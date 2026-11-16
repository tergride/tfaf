// Plays the launch of a room out in the game's own Lua over stand-ins for the engine and FAF's modules: threads are
// coroutines, as in the game, so a wait in the wrong place fails here too. What it draws can only be seen in the game.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { onlineProviderScript, roomLaunchScript } from '../src/main/game/tfafLobby/roomLaunchScript.ts';
import type { LobbyLaunch } from '../src/shared/contract.ts';
import { THEME_PALETTES } from '../src/shared/themes.ts';

const LAUNCH: LobbyLaunch = {
  featuredMod: 'faf',
  factions: ['uef', 'aeon', 'cybran', 'seraphim'],
  options: { ScenarioFile: '/maps/theta.v0001/theta_scenario.lua', UnitCap: '1000', Unranked: 'Yes' },
  restrictions: ['T4'],
  spawnMex: [4],
  positionGroups: [[1, 2, 3]],
  armies: [
    { spot: 1, playerId: 1, name: 'alpha', lobbyName: 'alpha', ai: null, faction: 2, team: 2, color: 1, mean: 1500, deviation: 100, rating: 1200, games: 40, clan: 'TF', country: 'RU' },
    { spot: 2, playerId: 2, name: 'beta', lobbyName: 'beta', ai: null, faction: 3, team: 3, color: 2, mean: 900, deviation: 200, rating: 300, games: 3, clan: '', country: null },
    {
      spot: 3,
      playerId: null,
      name: 'Harms (AI: Easy)',
      lobbyName: 'AI: Easy',
      ai: 'easy',
      faction: 1,
      team: 3,
      color: 3,
      mean: 180,
      deviation: 0,
      rating: 180,
      games: 0,
      clan: '',
      country: null,
    },
  ],
  observers: [{ playerId: 5, name: 'watcher' }],
  simMods: ['sim-1'],
  digest: 'abc123',
};

const ALONE: LobbyLaunch = { ...LAUNCH, armies: LAUNCH.armies.filter((army) => army.playerId !== 2), observers: [] };

const STAND_INS = `
threads = {}
peers = {}
preferences = {}
files = {}
allMods = {}
texts = {}
launched = false

function WARN(text) print('warn ' .. text) end
function LOG() end
function GpgNetSend(command, first, second) print(command .. ' ' .. tostring(first) .. '|' .. tostring(second)) end
function ExitApplication() print('exit') end
function SetPreference(key, value) preferences[key] = value end
function ForkThread(body) table.insert(threads, coroutine.create(body)) end
function WaitSeconds() coroutine.yield() end
function GetFrame() return {} end
function DiskGetFileInfo(file) return files[file] ~= nil end
function doscript(file, env) for key, value in pairs(files[file] or {}) do env[key] = value end end
function InternalCreateLobby() end

local function nothing() end
function control()
    local made = { SetSolidColor = nothing, SetColor = nothing, text = '' }
    made.SetText = function(self, value) self.text = value end
    made.Destroy = function() print('screen gone') end
    return made
end

local methods = {}
for _, name in ipairs({ 'HostGame', 'JoinGame', 'ConnectToPeer', 'DisconnectFromPeer', 'BroadcastData', 'GetPeers',
    'GetLocalPlayerID', 'EjectPeer', 'LaunchGame', 'Destroy' }) do
    methods[name] = nothing
end
moho = { lobby_methods = methods }

localId = 1
comm = {
    HostGame = function() print('host') end,
    JoinGame = function(self, address, name, uid) print('join ' .. address) end,
    ConnectToPeer = function(self, address, name, uid) print('connect ' .. uid) end,
    DisconnectFromPeer = function(self, uid) print('disconnect ' .. uid) end,
    BroadcastData = function(self, data) print('broadcast ' .. data.Type .. ' ' .. data.Digest) end,
    GetPeers = function() return peers end,
    GetLocalPlayerID = function() return localId end,
    EjectPeer = function(self, id, reason) print('eject ' .. id .. ' ' .. reason) end,
    LaunchGame = function(self, info) launched = info print('launch') end,
    Destroy = function() print('comm gone') end,
}

modules = {
    ['/lua/ui/lobby/lobbycomm.lua'] = { CreateLobbyComm = function(protocol, port, name, uid, nat) created = { protocol, port, name, uid, nat } return comm end },
    ['/lua/mods.lua'] = {
        GetGameMods = function(wanted)
            local list = {}
            for uid in pairs(wanted) do table.insert(list, { uid = uid }) end
            return list
        end,
        AllMods = function() return allMods end,
        GetSelectedMods = function() return {} end,
    },
    ['/lua/ui/uiutil.lua'] = {
        bodyFont = 'body',
        CreateText = function() local made = control() table.insert(texts, made) return made end,
        CreateScreenGroup = function() return control() end,
        SetCurrentSkin = function(skin) print('skin ' .. skin) end,
    },
    ['/lua/maui/layouthelpers.lua'] = setmetatable({}, { __index = function() return nothing end }),
    ['/lua/maui/bitmap.lua'] = { Bitmap = function() return control() end },
    ['/lua/user/prefs.lua'] = { SetToCurrentProfile = function(key, value) print('pref ' .. key .. ' ' .. tostring(value)) end },
    ['/lua/ui/dialogs/eschandler.lua'] = {
        PushEscapeHandler = function(handler) escape = handler end,
        PopEscapeHandler = function() print('escape popped') escape = nil end,
        HandleEsc = function(quit) print('quit dialog ' .. tostring(quit)) end,
    },
    ['/lua/factions.lua'] = { Factions = { { Key = 'uef', DefaultSkin = 'uef' }, { Key = 'aeon', DefaultSkin = 'aeon' }, { Key = 'cybran' }, { Key = 'seraphim' } } },
}
function import(name)
    local module = modules[name]
    if not module then error('no module ' .. name) end
    return module
end
`;

const DRIVER = `
function tick(times)
    for _ = 1, times or 1 do
        for _, thread in ipairs(threads) do
            if coroutine.status(thread) ~= 'dead' then
                local ok, problem = coroutine.resume(thread)
                if not ok then print('thread died: ' .. tostring(problem)) end
            end
        end
    end
end

function status() return texts[2] and texts[2].text or '' end
function message() return texts[3] and texts[3].text or '' end

function hostGame()
    CreateLobby('UDP', 0, 'alpha', 1, 'nat')
    HostGame('game', '/maps/theta.v0001/theta_scenario.lua')
    comm:Hosting()
end

function joinGame()
    localId = 2
    CreateLobby('UDP', 0, 'beta', 2, 'nat')
    JoinGame('127.0.0.1:6000', false, 'beta', 2)
    comm:ConnectionToHostEstablished(2, 'beta', 1)
end
`;

describe('launch of a room in the game\'s Lua', { skip: spawnSync('lua', ['-v']).error !== undefined }, () => {
  let folder = '';

  before(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'tfaf-room-launch-lua-'));
  });
  after(() => rm(folder, { recursive: true, force: true }));

  async function play(launch: LobbyLaunch, scenario: string, standIns = ''): Promise<string[]> {
    const script = `${STAND_INS}\n${standIns}\n${roomLaunchScript(launch, { colors: THEME_PALETTES.default, logo: { width: 256, height: 256 } })}\n${DRIVER}\n${scenario}`;
    const file = path.join(folder, 'roomlaunch.lua');
    await writeFile(file, script);
    const result = spawnSync('lua', [file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split(/\r?\n/).filter((line) => line !== '');
  }

  it('compiles, and so does the entry of the engine', async () => {
    for (const [name, text] of [
      ['roomlaunch.lua', roomLaunchScript(LAUNCH, { colors: THEME_PALETTES.uef, logo: null })],
      ['onlineprovider.lua', onlineProviderScript()],
    ] as const) {
      const file = path.join(folder, name);
      await writeFile(file, text);
      const result = spawnSync('luac', ['-p', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
  });

  it('passes on what the engine calls its lobby with', async () => {
    const file = path.join(folder, 'onlineprovider.lua');
    await writeFile(
      file,
      `function import(name)
        return { CreateLobby = function(protocol, port, name, uid, nat) print(name .. ' ' .. protocol .. ' ' .. port .. ' ' .. uid .. ' ' .. nat) end }
      end
      ${onlineProviderScript()}
      CreateLobby(0, 'UDP', 6000, 'alpha', 4357, 'nat', 1)`,
    );
    const result = spawnSync('lua', [file], { encoding: 'utf8' });
    assert.equal(result.stdout.trim(), 'alpha UDP 6000 4357 nat', result.stderr);

    const lines = await play(ALONE, `
      hostGame()
      print(table.concat(created, ' '))
    `);
    assert.deepEqual(lines, ['host', 'UDP 0 alpha 1 nat']);
  });

  it('launches the match of a host alone with the room\'s settings', async () => {
    const lines = await play(ALONE, `
      hostGame()
      escape()
      tick(2)
      local info = launched
      print(info.PlayerOptions[1].OwnerID .. ' ' .. info.PlayerOptions[1].Faction .. ' ' .. tostring(info.PlayerOptions[1].Human))
      print(info.PlayerOptions[3].OwnerID .. ' ' .. info.PlayerOptions[3].AIPersonality .. ' ' .. tostring(info.PlayerOptions[3].Human) .. ' ' .. info.PlayerOptions[3].PlayerName)
      print(info.GameOptions.UnitCap .. ' ' .. info.GameOptions.RestrictedCategories[1] .. ' ' .. tostring(info.GameOptions.SpawnMex[4]))
      print(table.getn(info.GameOptions.RandomPositionGroups[1]) .. ' ' .. info.GameOptions.Ratings['Harms (AI: Easy)'] .. ' ' .. info.GameOptions.ClanTags.alpha)
      print(info.GameMods[1].uid .. ' ' .. preferences.PreGameData.CurrentMapDir)
      comm:GameLaunched()
      tick(2)
    `);
    assert.deepEqual(lines, [
      'host',
      'quit dialog true',
      'TfafStage launching|',
      'broadcast TfafLaunch abc123',
      'pref LoadingFaction 2',
      'skin aeon',
      'launch',
      '1 2 true',
      '1 easy false Harms (AI: Easy)',
      '1000 T4 true',
      '3 180 TF',
      'sim-1 /maps/theta.v0001',
      'GameState Launching|nil',
      'screen gone',
      'escape popped',
      'comm gone',
    ]);
  });

  it('tells who it waits for and launches once everyone has reached everyone, keeping strangers out', async () => {
    const lines = await play(LAUNCH, `
      hostGame()
      tick()
      print(status())
      peers = { { id = 2, status = 'Established', establishedPeers = { '1' } }, { id = 9, status = 'Established', establishedPeers = {} } }
      tick()
      peers[3] = { id = '5', status = 'Established', establishedPeers = { '1' } }
      tick()
      peers[1].establishedPeers = { '1', '5' }
      peers[3].establishedPeers = { '1', '2' }
      tick()
      print(launched.Observers[1].OwnerID .. ' ' .. launched.Observers[1].PlayerName .. ' ' .. launched.Observers[1].ObserverListIndex)
    `);
    assert.deepEqual(lines, [
      'host',
      'TfafStage waiting|beta, watcher',
      'Ожидание игроков: beta, watcher (0 с)',
      'TfafStage waiting|watcher',
      'eject 9 KickedByHost',
      'TfafStage linking|beta и watcher',
      'eject 9 KickedByHost',
      'TfafStage launching|',
      'eject 9 KickedByHost',
      'broadcast TfafLaunch abc123',
      'pref LoadingFaction 2',
      'skin aeon',
      'launch',
      '5 watcher 1',
    ]);
  });

  it('launches a player\'s game on the host\'s signal, and only on the same match', async () => {
    const same = await play(LAUNCH, `
      joinGame()
      comm:DataReceived({ Type = 'TfafLaunch', SenderID = 1, Digest = 'abc123' })
      print(launched.PlayerOptions[3].OwnerID)
    `);
    assert.deepEqual(same.slice(-4), ['pref LoadingFaction 3', 'skin cybran', 'launch', '1']);
    assert.ok(same.includes('join 127.0.0.1:6000'));

    const other = await play(LAUNCH, `
      joinGame()
      comm:DataReceived({ Type = 'TfafLaunch', SenderID = 2, Digest = 'abc123' })
      comm:DataReceived({ Type = 'TfafLaunch', SenderID = 1, Digest = 'other' })
      print(message())
      tick(6)
      print(tostring(launched))
    `);
    assert.ok(!other.includes('launch'));
    assert.ok(other.includes('TfafStage failed|the host launches another match'));
    assert.ok(other.includes('Не удалось запустить матч: the host launches another match'));
    assert.deepEqual(other.slice(-2), ['exit', 'false']);
  });

  it('drops a peer behind the network adapter before connecting to it, as the game\'s lobby does', async () => {
    const lines = await play(LAUNCH, `
      hostGame()
      ConnectToPeer('127.0.0.1:6001', 'beta', 2)
      ConnectToPeer('10.0.0.2:6001', 'gamma', 3)
    `);
    assert.deepEqual(lines.slice(-4), ['Disconnected 2|nil', 'disconnect 2', 'connect 2', 'connect 3']);
  });

  it('says what changed in the game, launches nothing and closes', async () => {
    for (const change of ["moho.lobby_methods.LaunchGame = nil", "modules['/lua/mods.lua'].GetGameMods = nil", "table.insert(modules['/lua/factions.lua'].Factions, { Key = 'nomads' })"]) {
      const lines = await play(LAUNCH, `
        ${change}
        CreateLobby('UDP', 0, 'alpha', 1, nil)
        HostGame('game', '/maps/theta.v0001/theta_scenario.lua')
        print(message())
        tick(6)
        print(tostring(launched))
      `);
      assert.ok(lines.some((line) => line.startsWith('TfafStage unsupported|')), change);
      assert.ok(lines.some((line) => line.startsWith('Код игры изменился (')), change);
      assert.deepEqual(lines.slice(-2), ['exit', 'false'], change);
      assert.ok(!lines.includes('host'), change);
    }
  });

  it('closes the game when its own code fails or the game cannot launch', async () => {
    const broken = await play(LAUNCH, `
      hostGame()
      comm.GetPeers = function() error('no peers') end
      tick(7)
    `);
    assert.ok(broken.some((line) => /^TfafStage failed\|.*no peers/.test(line)));
    assert.equal(broken.filter((line) => line === 'exit').length, 1);
    assert.ok(!broken.some((line) => line.startsWith('thread died')));

    const refused = await play(ALONE, `
      hostGame()
      comm:LaunchFailed('StartSpots')
      tick(6)
    `);
    assert.ok(refused.includes('TfafStage failed|the game cannot launch: StartSpots'));
    assert.equal(refused.at(-1), 'exit');
  });

  it('tells blueprint loading which mods replace icons', async () => {
    const lines = await play(ALONE, `
      allMods = { ['sim-1'] = { name = 'Icons', author = 'me', location = '/mods/BigIcons' } }
      files['/mods/BigIcons/mod_icons.lua'] = { UnitIconAssignments = {} }
      hostGame()
      tick(2)
      local icons = preferences.PreGameData.IconReplacements[1]
      print(icons.Identifier .. ' ' .. icons.UID .. ' ' .. icons.Location)
    `);
    assert.equal(lines.at(-1), 'bigicons sim-1 /mods/BigIcons');
  });
});
