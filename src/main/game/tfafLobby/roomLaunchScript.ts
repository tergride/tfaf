// What every game of a TFAF lobby runs in place of the game's own lobby. The launcher mounts two files before the
// game's: `onlineprovider.lua`, the engine's entry to every lobby, which here always opens `roomlaunch.lua`, and
// `roomlaunch.lua` itself with the match the host's launcher settled (launchConfig.ts). The game connects to the
// others, shows a TFAF screen with the stage of the start and launches the match once everyone has reached everyone;
// the host's game gives the signal. Before anything else it checks what it needs of the engine and of FAF: a game
// that changed in a way TFAF does not know writes why on the screen and closes, as does any error of this code. The
// launcher brings everyone back to the room then. Only the lobby is replaced: the simulation and the replay are FAF's.

import type { LobbyLaunch, ThemePalette } from '../../../shared/contract.ts';
import { t } from '../../i18n.ts';

export const ONLINE_PROVIDER_SCRIPT = 'lua/multiplayer/onlineprovider.lua';
export const ROOM_LAUNCH_SCRIPT = 'lua/tfaf/roomlaunch.lua';
export const SCREEN_LOGO = 'textures/ui/tfaf/logo.dds';
/** How a game reports the stage of its start, in place of a message for the server. */
export const LOBBY_STAGE_MESSAGE = 'TfafStage';
/** The stages a game reports when it gives up: code it does not support, or anything else that went wrong. */
export const FAILED_STAGES = ['unsupported', 'failed'] as const;
const CLOSE_SECONDS = 5;

export interface RoomScreen {
  colors: Readonly<ThemePalette>;
  /** The size of the logo the launcher wrote to `SCREEN_LOGO`; null without one. */
  logo: { width: number; height: number } | null;
}

type LuaData = string | number | boolean | null | readonly LuaData[] | { readonly [key: string]: LuaData };

function luaText(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\0/g, '\\0');
  return `"${escaped}"`;
}

/** A Lua constructor; an object's keys become `["key"] =`, so no name of the game can clash with Lua syntax. */
function luaData(value: LuaData): string {
  if (value === null) {
    return 'nil';
  }
  if (Array.isArray(value)) {
    return `{ ${value.map(luaData).join(', ')} }`;
  }
  if (typeof value === 'object') {
    return `{ ${Object.entries(value)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => `[${luaText(key)}] = ${luaData(entry)}`)
      .join(', ')} }`;
  }
  return typeof value === 'string' ? luaText(value) : String(value);
}

function gameColour(hex: string): string {
  return `ff${hex.slice(1)}`;
}

/** A translated text as a format string of Lua: its own `%` stay text, the named placeholders become `%s` or `%d`. */
function formatText(key: Parameters<typeof t>[0], placeholders: Record<string, '%s' | '%d'> = {}): string {
  const markers = Object.fromEntries(Object.keys(placeholders).map((name, index) => [name, `\u0001${index}\u0001`]));
  let text = t(key, markers).replace(/%/g, '%%');
  Object.values(placeholders).forEach((format, index) => {
    text = text.split(`\u0001${index}\u0001`).join(format);
  });
  return text;
}

export function onlineProviderScript(): string {
  return [
    '-- Written by TFAF for one game of a TFAF lobby: the game plays the match of the room, whatever lobby it is asked for.',
    'function CreateLobby(autolaunch, protocol, port, playerName, uid, natTraversalProvider, hasSupcom)',
    `    lobby = import('/${ROOM_LAUNCH_SCRIPT}')`,
    '    lobby.CreateLobby(protocol, port, playerName, uid, natTraversalProvider)',
    '    return lobby',
    'end',
    '',
  ].join('\n');
}

function launchData(launch: LobbyLaunch): string {
  const members = [...launch.armies.flatMap((army) => (army.playerId === null ? [] : [army.playerId])), ...launch.observers.map((observer) => observer.playerId)];
  const data: Record<string, LuaData> = {
    Digest: launch.digest,
    Factions: launch.factions,
    Options: launch.options,
    Restrictions: launch.restrictions,
    SpawnMex: launch.spawnMex,
    PositionGroups: launch.positionGroups,
    Armies: launch.armies.map((army) => ({
      Spot: army.spot,
      PlayerId: army.playerId === null ? null : String(army.playerId),
      Name: army.name,
      AI: army.ai,
      Faction: army.faction,
      Team: army.team,
      Color: army.color,
      Mean: army.mean,
      Deviation: army.deviation,
      Rating: army.rating,
      Games: army.games,
      Clan: army.clan,
      Country: army.country,
    })),
    Observers: launch.observers.map((observer) => ({ PlayerId: String(observer.playerId), Name: observer.name })),
    Members: [...new Set(members)].map(String),
    SimMods: launch.simMods,
  };
  return `local TfafLaunch = ${luaData(data)}`;
}

function screenData(launch: LobbyLaunch, { colors, logo }: RoomScreen): string {
  const screen = 'main.tfafLobby.screen';
  const names: Record<string, string> = {};
  for (const army of launch.armies) {
    if (army.playerId !== null) {
      names[String(army.playerId)] = army.name;
    }
  }
  for (const observer of launch.observers) {
    names[String(observer.playerId)] = observer.name;
  }
  const data: Record<string, LuaData> = {
    Names: names,
    Logo: logo ? { File: `/${SCREEN_LOGO}`, Width: logo.width, Height: logo.height } : null,
    Colors: {
      Background: gameColour(colors.card),
      Title: gameColour(colors.foreground),
      Text: gameColour(colors['muted-foreground']),
      Accent: gameColour(colors.primary),
    },
    Stages: {
      connecting: formatText(`${screen}.connecting`),
      waiting: formatText(`${screen}.waiting`, { names: '%s' }),
      linking: formatText(`${screen}.linking`, { names: '%s' }),
      launching: formatText(`${screen}.launching`),
    },
    Texts: {
      Title: t(`${screen}.title`),
      Exit: t(`${screen}.exit`),
      Pair: formatText(`${screen}.pair`, { first: '%s', second: '%s' }),
      Seconds: formatText(`${screen}.seconds`, { seconds: '%d' }),
      Unsupported: formatText(`${screen}.unsupported`, { changes: '%s' }),
      Failed: formatText(`${screen}.failed`, { problem: '%s' }),
      Closing: formatText(`${screen}.closing`, { seconds: '%d' }),
    },
  };
  return `local TfafScreen = ${luaData(data)}`;
}

const LAUNCH_CODE = `
local Comm = false
local State = {
    localId = false,
    hostId = false,
    hosting = false,
    stage = false,
    detail = '',
    seconds = 0,
    launching = false,
    launched = false,
    failed = false,
    group = false,
    status = false,
    message = false,
    escape = false,
}

local function callable(value)
    local kind = type(value)
    return kind == 'function' or kind == 'cfunction'
end

--- What this game needs of the engine and of FAF that it does not have, as a list of names.
local function Missing()
    local missing = {}
    local function need(present, what)
        if not present then
            table.insert(missing, what)
        end
    end
    for _, name in ipairs({ 'import', 'InternalCreateLobby', 'GpgNetSend', 'ExitApplication', 'SetPreference', 'ForkThread',
        'WaitSeconds', 'GetFrame', 'DiskGetFileInfo', 'doscript', 'WARN', 'LOG' }) do
        need(callable(rawget(_G, name)), name)
    end
    local moho = rawget(_G, 'moho')
    local methods = type(moho) == 'table' and moho.lobby_methods
    for _, name in ipairs({ 'HostGame', 'JoinGame', 'ConnectToPeer', 'DisconnectFromPeer', 'BroadcastData', 'GetPeers',
        'GetLocalPlayerID', 'EjectPeer', 'LaunchGame', 'Destroy' }) do
        need(type(methods) == 'table' and callable(methods[name]), 'moho.lobby_methods.' .. name)
    end
    if not callable(rawget(_G, 'import')) then
        return missing
    end
    local modules = {
        { '/lua/ui/lobby/lobbycomm.lua', { 'CreateLobbyComm' } },
        { '/lua/mods.lua', { 'GetGameMods', 'AllMods', 'GetSelectedMods' } },
        { '/lua/ui/uiutil.lua', { 'CreateText', 'CreateScreenGroup', 'SetCurrentSkin' } },
        { '/lua/maui/layouthelpers.lua', { 'FillParent', 'AtCenterIn', 'AtHorizontalCenterIn', 'AtBottomIn', 'Below', 'SetDimensions' } },
        { '/lua/maui/bitmap.lua', { 'Bitmap' } },
        { '/lua/user/prefs.lua', { 'SetToCurrentProfile' } },
        { '/lua/ui/dialogs/eschandler.lua', { 'PushEscapeHandler', 'PopEscapeHandler', 'HandleEsc' } },
    }
    for _, module in ipairs(modules) do
        local ok, loaded = pcall(import, module[1])
        for _, name in ipairs(module[2]) do
            need(ok and type(loaded) == 'table' and loaded[name] ~= nil, module[1] .. ' ' .. name)
        end
    end
    -- The match numbers the factions as the launcher read them from the game's files.
    local ok, factions = pcall(function() return import('/lua/factions.lua').Factions end)
    if not ok or type(factions) ~= 'table' or table.getn(factions) ~= table.getn(TfafLaunch.Factions) then
        need(false, '/lua/factions.lua Factions')
    else
        for index, key in ipairs(TfafLaunch.Factions) do
            need(type(factions[index]) == 'table' and factions[index].Key == key, '/lua/factions.lua ' .. key)
        end
    end
    return missing
end

local function CreateScreen()
    local UIUtil = import('/lua/ui/uiutil.lua')
    local LayoutHelpers = import('/lua/maui/layouthelpers.lua')
    local Bitmap = import('/lua/maui/bitmap.lua').Bitmap
    local colors = TfafScreen.Colors

    local group = UIUtil.CreateScreenGroup(GetFrame(0), 'TFAF room launch')
    State.group = group
    -- Without a handler of its own, Esc looks for a match's command mode and fails outside a session.
    local EscapeHandler = import('/lua/ui/dialogs/eschandler.lua')
    State.escape = function() EscapeHandler.HandleEsc(true) end
    EscapeHandler.PushEscapeHandler(State.escape)
    local background = Bitmap(group)
    background:SetSolidColor(colors.Background)
    LayoutHelpers.FillParent(background, group)

    local above = false
    if TfafScreen.Logo then
        local logo = Bitmap(group, TfafScreen.Logo.File)
        LayoutHelpers.SetDimensions(logo, TfafScreen.Logo.Width, TfafScreen.Logo.Height)
        LayoutHelpers.AtCenterIn(logo, group, -120)
        above = logo
    end

    local title = UIUtil.CreateText(group, TfafScreen.Texts.Title, 24, 'Arial Gras', false)
    title:SetColor(colors.Title)
    if above then
        LayoutHelpers.Below(title, above, 24)
        LayoutHelpers.AtHorizontalCenterIn(title, group)
    else
        LayoutHelpers.AtCenterIn(title, group, -40)
    end

    local status = UIUtil.CreateText(group, '', 16, UIUtil.bodyFont, false)
    status:SetColor(colors.Text)
    LayoutHelpers.Below(status, title, 16)
    LayoutHelpers.AtHorizontalCenterIn(status, group)

    local message = UIUtil.CreateText(group, '', 16, UIUtil.bodyFont, false)
    message:SetColor(colors.Accent)
    LayoutHelpers.Below(message, status, 12)
    LayoutHelpers.AtHorizontalCenterIn(message, group)

    local hint = UIUtil.CreateText(group, TfafScreen.Texts.Exit, 14, UIUtil.bodyFont, false)
    hint:SetColor(colors.Text)
    LayoutHelpers.AtBottomIn(hint, group, 24)
    LayoutHelpers.AtHorizontalCenterIn(hint, group)

    State.status = status
    State.message = message
end

--- Gives up: says why where it can and closes the game, whose leaving the launcher answers.
local function Fail(kind, problem)
    if State.failed then
        return
    end
    State.failed = true
    local text = tostring(problem)
    pcall(WARN, 'TFAF lobby: ' .. kind .. ': ' .. text)
    pcall(GpgNetSend, '${LOBBY_STAGE_MESSAGE}', kind, text)
    local shown = State.message and pcall(function()
        local format = kind == 'unsupported' and TfafScreen.Texts.Unsupported or TfafScreen.Texts.Failed
        State.message:SetText(string.format(format, text))
    end)
    if shown and callable(rawget(_G, 'ForkThread')) then
        ForkThread(function()
            for left = ${CLOSE_SECONDS}, 1, -1 do
                pcall(function() State.status:SetText(string.format(TfafScreen.Texts.Closing, left)) end)
                WaitSeconds(1)
            end
            ExitApplication()
        end)
    else
        ExitApplication()
    end
end

--- Runs one step of this code; an error in it is a failed start, not a game left hanging. A step takes no arguments:
--- pcall here passes only those it is given by name, so a closure carries them.
local function Guard(step)
    local ok, problem = pcall(step)
    if not ok then
        Fail('failed', problem)
    end
end

local function ShowStage(stage, detail)
    if stage ~= State.stage or detail ~= State.detail then
        State.stage = stage
        State.detail = detail
        State.seconds = 0
        GpgNetSend('${LOBBY_STAGE_MESSAGE}', stage, detail)
    end
    if State.status then
        local text = string.format(TfafScreen.Stages[stage], detail)
        State.status:SetText(text .. ' (' .. string.format(TfafScreen.Texts.Seconds, State.seconds) .. ')')
    end
end

local function NameOf(id)
    return TfafScreen.Names[id] or id
end

local function Peers()
    local peers = {}
    for _, peer in pairs(Comm:GetPeers()) do
        peers[tostring(peer.id)] = peer
    end
    return peers
end

local function Present(peers, id)
    return id == State.localId or (peers[id] ~= nil and peers[id].status == 'Established')
end

--- What a peer reports: the local game has no report of its own and reaches whoever it sees.
local function Reaches(peers, id, other)
    if id == State.localId then
        return true
    end
    local peer = peers[id]
    if not peer or type(peer.establishedPeers) ~= 'table' then
        return false
    end
    for _, established in pairs(peer.establishedPeers) do
        if tostring(established) == other then
            return true
        end
    end
    return false
end

local function CurrentStage()
    if not State.localId then
        return 'connecting', ''
    end
    local peers = Peers()
    local absent = {}
    for _, id in ipairs(TfafLaunch.Members) do
        if not Present(peers, id) then
            table.insert(absent, NameOf(id))
        end
    end
    if table.getn(absent) > 0 then
        return 'waiting', table.concat(absent, ', ')
    end
    local unlinked = {}
    local members = TfafLaunch.Members
    for index = 1, table.getn(members) do
        for later = index + 1, table.getn(members) do
            local id, other = members[index], members[later]
            if not Reaches(peers, id, other) or not Reaches(peers, other, id) then
                table.insert(unlinked, string.format(TfafScreen.Texts.Pair, NameOf(id), NameOf(other)))
            end
        end
    end
    if table.getn(unlinked) > 0 then
        return 'linking', table.concat(unlinked, ', ')
    end
    return 'launching', ''
end

--- The host keeps out whoever the room does not know: the engine refuses to launch with someone left over.
local function EjectStrangers()
    local known = {}
    for _, id in ipairs(TfafLaunch.Members) do
        known[id] = true
    end
    for _, peer in pairs(Comm:GetPeers()) do
        if not known[tostring(peer.id)] then
            Comm:EjectPeer(peer.id, 'KickedByHost')
        end
    end
end

local function PlayerData(fields)
    local data = {
        Team = 1,
        PlayerColor = 1,
        ArmyColor = 1,
        StartSpot = 1,
        Ready = true,
        Faction = table.getn(TfafLaunch.Factions) + 1,
        PlayerClan = '',
        PlayerName = 'player',
        AIPersonality = '',
        Human = true,
        Civilian = false,
        OwnerID = false,
        BadMap = false,
        ObserverListIndex = -1,
        MEAN = 0,
        DEV = 0,
        PL = 0,
        NG = 0,
        Country = false,
    }
    for key, value in pairs(fields) do
        data[key] = value
    end
    return data
end

local function GameInfo()
    local options = {}
    for key, value in pairs(TfafLaunch.Options) do
        options[key] = value
    end
    options.RestrictedCategories = TfafLaunch.Restrictions
    if TfafLaunch.SpawnMex then
        options.SpawnMex = {}
        for _, spot in ipairs(TfafLaunch.SpawnMex) do
            options.SpawnMex[spot] = true
        end
    end
    if TfafLaunch.PositionGroups then
        options.RandomPositionGroups = TfafLaunch.PositionGroups
    end
    options.Ratings = {}
    options.ClanTags = {}

    local players = {}
    for _, army in ipairs(TfafLaunch.Armies) do
        players[army.Spot] = PlayerData({
            Team = army.Team,
            PlayerColor = army.Color,
            ArmyColor = army.Color,
            StartSpot = army.Spot,
            Faction = army.Faction,
            PlayerClan = army.Clan,
            PlayerName = army.Name,
            AIPersonality = army.AI or '',
            Human = army.AI == nil,
            OwnerID = army.PlayerId or State.hostId,
            MEAN = army.Mean,
            DEV = army.Deviation,
            PL = army.Rating,
            NG = army.Games,
            Country = army.Country or false,
        })
        options.Ratings[army.Name] = army.Rating
        options.ClanTags[army.Name] = army.Clan
    end
    local observers = {}
    for index, observer in ipairs(TfafLaunch.Observers) do
        observers[index] = PlayerData({ PlayerName = observer.Name, OwnerID = observer.PlayerId, Ready = false, ObserverListIndex = index })
    end
    return { GameOptions = options, PlayerOptions = players, Observers = observers }
end

--- What blueprint loading reads before the match (lua/system/Blueprints.lua): the map's folder and the icons of mods.
local function SetPreGameData(Mods)
    local preGameData = { CurrentMapDir = string.gsub(TfafLaunch.Options.ScenarioFile, '/[^/]*$', ''), IconReplacements = {} }
    local allMods = Mods.AllMods()
    local selected = Mods.GetSelectedMods()
    for _, uid in ipairs(TfafLaunch.SimMods) do
        selected[uid] = true
    end
    for uid, _ in pairs(selected) do
        local mod = allMods[uid]
        local file = mod and mod.location and (mod.location .. '/mod_icons.lua')
        if file and DiskGetFileInfo(file) then
            local ok = pcall(function()
                local env = {}
                doscript(file, env)
                if not (env.UnitIconAssignments or env.ScriptedIconAssignments) then
                    error('no icon assignments')
                end
            end)
            if ok then
                local parts = {}
                for part in string.gfind(mod.location, '[^/]+') do
                    table.insert(parts, part)
                end
                table.insert(preGameData.IconReplacements, {
                    Name = mod.name,
                    Author = mod.author,
                    Location = mod.location,
                    Identifier = string.lower(parts[2] or ''),
                    UID = uid,
                })
            end
        end
    end
    -- Several games on one computer may write the preferences at once.
    pcall(SetPreference, 'PreGameData', preGameData)
end

local function Launch()
    if State.launching then
        return
    end
    State.launching = true
    ShowStage('launching', '')
    local Mods = import('/lua/mods.lua')
    local info = GameInfo()
    local wanted = {}
    for _, uid in ipairs(TfafLaunch.SimMods) do
        wanted[uid] = true
    end
    info.GameMods = Mods.GetGameMods(wanted)
    SetPreGameData(Mods)

    local skin = 'uef'
    for _, army in ipairs(TfafLaunch.Armies) do
        if army.PlayerId == State.localId then
            local faction = import('/lua/factions.lua').Factions[army.Faction]
            skin = faction and (faction.DefaultSkin or faction.Key) or skin
            import('/lua/user/prefs.lua').SetToCurrentProfile('LoadingFaction', army.Faction)
        end
    end
    import('/lua/ui/uiutil.lua').SetCurrentSkin(skin)
    Comm:LaunchGame(info)
end

local function Step()
    if State.launching then
        return
    end
    local stage, detail = CurrentStage()
    ShowStage(stage, detail)
    if State.hosting then
        EjectStrangers()
        if stage == 'launching' then
            Comm:BroadcastData({ Type = 'TfafLaunch', Digest = TfafLaunch.Digest })
            Launch()
        end
    end
end

--- Only one step runs under pcall at a time: a thread cannot wait inside it in this Lua.
local function Run()
    while not State.failed and not State.launched do
        local ok, problem = pcall(Step)
        if not ok then
            Fail('failed', problem)
            return
        end
        WaitSeconds(1)
        State.seconds = State.seconds + 1
    end
end

local function OnHosting()
    State.localId = tostring(Comm:GetLocalPlayerID())
    State.hostId = State.localId
    State.hosting = true
end

local function OnConnected(localId, hostId)
    State.localId = tostring(localId)
    State.hostId = tostring(hostId)
end

local function OnData(data)
    if data.Type ~= 'TfafLaunch' or tostring(data.SenderID) ~= State.hostId or State.hosting then
        return
    end
    if data.Digest ~= TfafLaunch.Digest then
        Fail('failed', 'the host launches another match')
        return
    end
    Launch()
end

local function OnLaunched()
    State.launched = true
    GpgNetSend('GameState', 'Launching')
    if State.group then
        State.group:Destroy()
        State.group = false
    end
    if State.escape then
        import('/lua/ui/dialogs/eschandler.lua').PopEscapeHandler()
        State.escape = false
    end
    Comm:Destroy()
    Comm = false
end

local function Start(protocol, localPort, desiredPlayerName, localPlayerUID, natTraversalProvider)
    local missing = Missing()
    if table.getn(missing) > 0 then
        pcall(CreateScreen)
        Fail('unsupported', table.concat(missing, ', '))
        return
    end
    CreateScreen()
    Comm = import('/lua/ui/lobby/lobbycomm.lua').CreateLobbyComm(protocol, localPort, desiredPlayerName, localPlayerUID, natTraversalProvider)
    if not Comm then
        error('no lobby on port ' .. tostring(localPort))
    end
    Comm.Hosting = function(self) Guard(OnHosting) end
    Comm.ConnectionToHostEstablished = function(self, localId, newName, hostId) Guard(function() OnConnected(localId, hostId) end) end
    Comm.ConnectionFailed = function(self, reason) Fail('failed', 'connection failed: ' .. tostring(reason)) end
    Comm.Ejected = function(self, reason) Fail('failed', 'ejected: ' .. tostring(reason)) end
    Comm.DataReceived = function(self, data) Guard(function() OnData(data) end) end
    Comm.LaunchFailed = function(self, reasonKey) Fail('failed', 'the game cannot launch: ' .. tostring(reasonKey)) end
    Comm.GameLaunched = function(self) Guard(OnLaunched) end
    ForkThread(Run)
end

-- What the engine calls, through onlineprovider.lua.

function CreateLobby(protocol, localPort, desiredPlayerName, localPlayerUID, natTraversalProvider)
    Guard(function() Start(protocol, localPort, desiredPlayerName, localPlayerUID, natTraversalProvider) end)
end

function HostGame()
    if Comm then
        Guard(function() Comm:HostGame() end)
    end
end

function JoinGame(address, asObserver, playerName, uid)
    if Comm then
        Guard(function() Comm:JoinGame(address, playerName, uid) end)
    end
end

--- As the game's lobby does: a peer behind the network adapter is dropped first, should it be there already.
function DisconnectFromPeer(uid)
    if Comm then
        GpgNetSend('Disconnected', string.format('%d', uid))
        Comm:DisconnectFromPeer(uid)
    end
end

function ConnectToPeer(addressAndPort, name, uid)
    if Comm then
        if string.find(addressAndPort, '127.0.0.1', 1, true) then
            DisconnectFromPeer(uid)
        end
        Comm:ConnectToPeer(addressAndPort, name, uid)
    end
end
`;

/** The module the game runs in place of its lobby, with the match and the screen of this game. */
export function roomLaunchScript(launch: LobbyLaunch, screen: RoomScreen): string {
  return `-- Written by TFAF for one game of a TFAF lobby (roomLaunchScript.ts in the launcher).\n${launchData(launch)}\n${screenData(launch, screen)}\n${LAUNCH_CODE}`;
}
