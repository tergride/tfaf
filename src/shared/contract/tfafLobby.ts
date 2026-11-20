// The TFAF lobby: a room inside the launcher that TFAF players share over their network adapters. The game starts only
// when the host presses Start. The host's launcher owns the room; every other launcher shows its latest snapshot.

import type { MapTexture } from './mapView.ts';
import type { StoneMapRecipe } from './stoneMap.ts';

/** How a game is created: the game's own lobby, open to every FAF player, or a room in the launcher for TFAF players. */
export type LobbyMode = 'faf' | 'tfaf';

/** The featured mods a TFAF lobby plays: FAF, its two test builds and Nomads, whose files the launcher reads. */
export const TFAF_LOBBY_FEATURED_MODS = ['faf', 'fafbeta', 'fafdevelop', 'nomads'] as const;

export function isTfafLobbyFeaturedMod(name: string): boolean {
  return (TFAF_LOBBY_FEATURED_MODS as readonly string[]).includes(name);
}

export const LOBBY_LIMITS = {
  maxSlots: 16,
  maxChatLength: 300,
  maxChatLines: 200,
  maxOptions: 256,
  maxOptionKeyLength: 64,
  maxOptionTextLength: 128,
  maxSimMods: 32,
  /** More than every unit and upgrade of the game and of big unit mods together. */
  maxRestrictions: 2048,
  maxRestrictionLength: 64,
  maxTitleLength: 100,
  maxRulesLength: 500,
  maxKickReasonLength: 200,
  /** Numbers of the game's colours, from 1 (`GameColors.PlayerColors`). */
  colors: 19,
  /** Teams of the game's lobby: 1 is no team, 2 and up are teams 1 to 8. */
  maxTeam: 9,
  /** Teams one click on a map marker cycles through in manual automatic teams, as in the game's lobby. */
  maxManualTeam: 7,
  maxPresetName: 60,
  maxPresets: 50,
} as const;

/** 1 is no team in the game's lobby. */
export const NO_TEAM = 1;

/**
 * Options a TFAF lobby always plays with: its games never affect anyone's rating, and everyone has to know the map
 * before the game starts, while the game's own random map would pick one at launch.
 */
export const LOCKED_LOBBY_OPTIONS: Readonly<Record<string, LobbyOptionValue>> = { Unranked: 'Yes', RandomMap: 'Off' };

export type LobbyOptionValue = string | number | boolean;

/** How teams follow the start positions, as the game's `AutoTeams`: none, top against bottom, left against right, odd against even, or set by hand. */
export const LOBBY_AUTO_TEAMS = ['none', 'tvsb', 'lvsr', 'pvsi', 'manual'] as const;

export type LobbyAutoTeams = (typeof LOBBY_AUTO_TEAMS)[number];

export type LobbyOccupant = { kind: 'player'; playerId: number } | { kind: 'ai'; personality: string; name: string };

export interface LobbySlot {
  /** Start position on the map, from 1. */
  spot: number;
  occupant: LobbyOccupant | null;
  team: number;
  /** A number of `LobbyRoom.factions`, from 1; the one after them is the random faction. */
  faction: number;
  color: number;
  closed: boolean;
  /** A closed position whose mass points an adaptive map still spawns. */
  spawnMex: boolean;
}

/** `preparing`: the launcher is downloading or checking the room's map and mods. */
export type LobbyFilesState = 'preparing' | 'ready' | 'failed';

export interface LobbyMember {
  id: number;
  login: string;
  clan: string | null;
  country: string | null;
  rating: number | null;
  /** Null when the host does not know, as on 0.11.0 and older. */
  games: number | null;
  mean: number | null;
  deviation: number | null;
  ready: boolean;
  files: LobbyFilesState;
  /** The players whose launcher this one is connected to. */
  connected: number[];
}

export interface LobbySpot {
  /** 0..1 from the north-west corner of the square the map is centred in, which is how a preview shows a narrow map. */
  x: number;
  y: number;
  /** The faction keys the map allows on the position (`Configurations.standard.factions`); every faction without it. */
  factions?: readonly string[];
}

export interface LobbyMap {
  folderName: string;
  name: string;
  /** The map's scenario file as the game names it, `/maps/<folder>/<name>_scenario.lua`. */
  scenario: string;
  /** Start positions in slot order; the room sends them, since a player may not have the map yet. */
  spots: LobbySpot[];
  /** Mass points follow the positions that are played (`AdaptiveMap` of the scenario). */
  adaptive: boolean;
  /** How a player without this StoneMap map makes it; launchers before StoneMap leave it out. */
  recipe?: StoneMapRecipe;
}

export interface LobbySimMod {
  uid: string;
  name: string;
}

/** `open`: players gather; `starting`: everyone's game is starting; the match runs from then on outside the room. */
export type LobbyRoomPhase = 'open' | 'starting';

export interface LobbyRoom {
  /** Rises with every change, so a late snapshot does not replace a newer one. */
  revision: number;
  hostId: number;
  title: string;
  featuredMod: string;
  /** The faction keys of the featured mod, numbered from 1 as the game numbers them. */
  factions: string[];
  phase: LobbyRoomPhase;
  map: LobbyMap;
  simMods: LobbySimMod[];
  /**
   * True in every room we create: each game of a room mounts only the room's mods (gameVault.ts), whatever this says.
   * Only players on 0.10.0 read it, and they refuse a room without it and follow its value.
   */
  modIsolation: boolean;
  /** Options that differ from the game's defaults. */
  options: Record<string, LobbyOptionValue>;
  /** What nobody can build, as the game's `RestrictedCategories`: keys of its restriction presets, unit ids, upgrade names. */
  restrictions: string[];
  /** The host's text for everyone, the game's `GameRules`. */
  rules: string;
  autoTeams: LobbyAutoTeams;
  /** With manual automatic teams, the team of each start position in slot order. */
  manualTeams: number[];
  slots: LobbySlot[];
  members: LobbyMember[];
  /** Members without a start position. */
  observers: number[];
}

/** A seat of the match as the host's launcher settled it when the start began. */
export interface LobbyLaunchArmy {
  /** The start position after the game's rules dealt them out, from 1. */
  spot: number;
  /** Null for an AI, which the host's game runs. */
  playerId: number | null;
  /** A login, or the name an AI plays under, as the game's lobby names one at launch. */
  name: string;
  /** The name the server knows the seat by: the login, or the AI's name in the room. */
  lobbyName: string;
  /** The AI type; null for a player. */
  ai: string | null;
  /** A faction of the featured mod, from 1; never the random one. */
  faction: number;
  team: number;
  color: number;
  mean: number;
  deviation: number;
  /** What the score screen shows (`PL`). */
  rating: number;
  games: number;
  clan: string;
  country: string | null;
}

export interface LobbyLaunchObserver {
  playerId: number;
  name: string;
}

/** The match a start of the room plays, settled by the host's launcher and played out by every game alike. */
export interface LobbyLaunch {
  featuredMod: string;
  /** Faction keys of the featured mod by number, from 1, which every game has to number the same way. */
  factions: string[];
  /** Every option of the match apart from the tables below, `ScenarioFile` included. */
  options: Record<string, LobbyOptionValue>;
  /** `RestrictedCategories`. */
  restrictions: string[];
  /** Closed positions of an adaptive map that keep their mass points (`SpawnMex`); null on another map. */
  spawnMex: number[] | null;
  /** The groups of positions the simulation shuffles at the start (`RandomPositionGroups`); null on fixed positions. */
  positionGroups: number[][] | null;
  armies: LobbyLaunchArmy[];
  observers: LobbyLaunchObserver[];
  simMods: string[];
  /** sha256 of everything above, which the games compare with the host's before they launch. */
  digest: string;
}

export const LOBBY_RESET_PARTS = ['options', 'restrictions'] as const;

export type LobbyResetPart = (typeof LOBBY_RESET_PARTS)[number];

export type LobbyAction =
  | { type: 'setReady'; ready: boolean }
  | { type: 'takeSpot'; spot: number }
  | { type: 'observe' }
  | { type: 'setFaction'; spot: number; faction: number }
  | { type: 'setTeam'; spot: number; team: number }
  | { type: 'setColor'; spot: number; color: number }
  // Host only.
  | { type: 'setMap'; folderName: string }
  | { type: 'setMods'; modUids: string[] }
  | { type: 'setOption'; key: string; value: LobbyOptionValue | null }
  | { type: 'setRestrictions'; restrictions: string[] }
  /** `part`: only the options or only the unit restrictions; without it, both and the automatic teams. */
  | { type: 'resetOptions'; part?: LobbyResetPart }
  | { type: 'setTitle'; title: string }
  | { type: 'setRules'; rules: string }
  /** On a position with an AI, this one takes its place and keeps the team, faction and colour. */
  | { type: 'addAi'; spot: number; personality: string; name: string }
  | { type: 'fillAi'; personality: string; name: string }
  | { type: 'clearAi' }
  | { type: 'clearSpot'; spot: number }
  | { type: 'closeSpot'; spot: number; closed: boolean; spawnMex?: boolean }
  | { type: 'closeEmptySpots' }
  | { type: 'swapSpots'; from: number; to: number }
  /** `teams`: how many teams to share the seated out in, 0 for none. */
  | { type: 'splitTeams'; teams: number }
  | { type: 'setAutoTeams'; mode: LobbyAutoTeams }
  | { type: 'cycleManualTeam'; spot: number }
  /** `aiRatings`: the catalog's ratings by AI personality, which the room does not keep. */
  | { type: 'autobalance'; aiRatings: Record<string, number> }
  | { type: 'kick'; playerId: number; reason?: string };

export interface LobbyChatLine {
  id: number;
  /** Null for a line of the launcher itself. */
  senderId: number | null;
  login: string;
  text: string;
  at: string;
  /** Set on a private message: who it is for. */
  whisperTo?: string | null;
}

/** Why the host cannot press Start yet. */
export type LobbyStartBlocker =
  | { kind: 'notReady'; logins: string[] }
  | { kind: 'files'; logins: string[] }
  | { kind: 'filesDiffer'; logins: string[] }
  | { kind: 'connection'; logins: string[] }
  | { kind: 'noPlayers' }
  /** Code of the game the launch relies on changed since this TFAF version was checked against it (launchCodeGuard.ts). */
  | { kind: 'unsupportedGame'; changes: string[] };

/** Why a start was given up and everyone is back in the room. */
export type LobbyAbortReason = 'hostCancelled' | 'gameClosed' | 'timeout' | 'gameFailed';

/** The room as the current-game tab shows it. */
export interface TfafLobbyView {
  selfId: number;
  hosting: boolean;
  /** Null until the host's first snapshot arrived. */
  room: LobbyRoom | null;
  chat: LobbyChatLine[];
  /** Preview images of the room's map, which the main process names from its folder. */
  mapPreview: { small: string; large: string } | null;
  startBlockers: LobbyStartBlocker[];
  /** TrueSkill quality, 0..1, when two sides of rated players meet on fixed positions; null otherwise. */
  quality: number | null;
  /** The last spot change is unanswered or too recent, so the next one has to wait. */
  spotChangeLocked: boolean;
  /** Why the last start was given up, until the next one. */
  lastAbort: { reason: LobbyAbortReason; login: string | null } | null;
  /** The match of the start in progress, as the host's launcher settled it; null in an open room. */
  launch: LobbyLaunch | null;
}

export interface LobbyOptionChoice {
  value: LobbyOptionValue;
  label: string;
  help: string;
}

export interface LobbyOption {
  key: string;
  label: string;
  help: string;
  defaultValue: LobbyOptionValue;
  choices: LobbyOptionChoice[];
}

export type LobbyOptionGroupId = 'team' | 'game' | 'ai' | 'map' | 'mods';

export interface LobbyOptionGroup {
  id: LobbyOptionGroupId;
  options: LobbyOption[];
}

export interface LobbyAiType {
  key: string;
  name: string;
  /** The AI's base rating; 0 when it names none. */
  rating: number;
  /** An AIx: the game gives the cheat bonuses to every AI whose key has `cheat` in it. */
  cheat: boolean;
  /** The name of the mod the AI comes with; null for the game's own. */
  mod: string | null;
}

/** The groups of restriction presets, in the game's order; `other` is one the launcher has no name for. */
export type LobbyPresetGroup =
  | 'tech'
  | 'types'
  | 'typesByTech'
  | 'intel'
  | 'weapons'
  | 'strategic'
  | 'heavy'
  | 'economy'
  | 'support'
  | 'upgrades'
  | 'factions'
  | 'other';

/** A ready-made restriction of the game's Unit Manager. */
export interface LobbyRestrictionPreset {
  key: string;
  name: string;
  help: string;
  group: LobbyPresetGroup;
}

/** A faction of the room's featured mod as the room shows it. */
export interface LobbyFaction {
  key: string;
  /** The game's name; the launcher names the four of the game itself. */
  name: string;
  /** The game's small emblem of a faction the launcher has none of; null for the four of the game. */
  icon: MapTexture | null;
}

/** What the room can choose from, read from the game's files for the room's map and mods. */
export interface LobbyCatalog {
  factions: LobbyFaction[];
  groups: LobbyOptionGroup[];
  ais: LobbyAiType[];
  /** The game's colours as `#rrggbb`, from number 1. */
  colors: string[];
  restrictionPresets: LobbyRestrictionPreset[];
  /** Mods FAF refuses (`etc/faf/blacklist.lua`), in lower case: the game would drop them from the match. */
  bannedMods: string[];
}

/** Game settings the host saved, kept by the host's launcher only: the options, the forbidden units and the sim mods. */
export interface LobbyPreset {
  id: string;
  name: string;
  simMods: LobbySimMod[];
  options: Record<string, LobbyOptionValue>;
  restrictions: string[];
}

export interface LobbyPresets {
  /** The settings of the last game this launcher started as a host. */
  lastGame: LobbyPreset | null;
  presets: LobbyPreset[];
}

/** The columns of the game's Unit Manager. */
export type LobbyUnitGroup = 'naval' | 'air' | 'land' | 'construction' | 'economy' | 'support' | 'defense' | 'scu' | 'acu';

/** A unit or a commander upgrade that can be forbidden. */
export interface LobbyUnit {
  /** The restriction key: a unit's id, or an upgrade's name, which several commanders share. */
  id: string;
  name: string;
  description: string;
  /** In capitals, as in the blueprints' categories: `UEF`, `AEON`, `CYBRAN`, `SERAPHIM`, and what mods add. */
  faction: string;
  group: LobbyUnitGroup;
  tech: 'T1' | 'T2' | 'T3' | 'T4' | null;
  upgrade: boolean;
  modded: boolean;
  /** One level; a texture stays a texture here so that nothing has to encode images for a dialog few people open. */
  icon: MapTexture | null;
}

/** What the game's Unit Manager shows for the room's mods. Heavy with icons, so it is loaded only when asked for. */
export interface LobbyUnitCatalog {
  units: LobbyUnit[];
  /** By preset key, the ids of `units` the preset forbids. */
  covers: Record<string, string[]>;
  presetIcons: Record<string, MapTexture | null>;
}
