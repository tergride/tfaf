import type { LobbyMode } from './tfafLobby.ts';

/** Limits of the create-game form, checked both in the renderer and in the main process. */
export const HOST_GAME_LIMITS = {
  titleMaxLength: 100,
  passwordMaxLength: 64,
  ratingMax: 10_000,
  presetNameMaxLength: 60,
  maxPresets: 50,
} as const;

export interface HostGameOptions {
  title: string;
  password: string | null;
  featuredMod: string;
  mapFolderName: string;
  /** Mods to activate for the game (UI and sim); replaces the active mod set like the official client does. */
  modUids: string[];
  friendsOnly: boolean;
  ratingMin: number | null;
  ratingMax: number | null;
  enforceRatingRange: boolean;
  /**
   * The game mounts only its own mods, from a folder of links built for it, and the TFAF players' games do the same;
   * otherwise every game mounts the whole mods folder, as with the official client.
   */
  modIsolation: boolean;
  lobbyMode: LobbyMode;
}

/** Create-game form as the user left it: unlike HostGameOptions it may be incomplete or invalid. */
export interface HostGameDraft {
  title: string;
  /** Stored as plain text on purpose: it only keeps strangers out of a room with friends. */
  password: string;
  featuredMod: string;
  mapFolderName: string;
  modUids: string[];
  friendsOnly: boolean;
  ratingMin: number | null;
  ratingMax: number | null;
  enforceRatingRange: boolean;
  modIsolation: boolean;
  lobbyMode: LobbyMode;
}

export interface HostGamePreset {
  id: string;
  name: string;
  draft: HostGameDraft;
}

export interface HostGamePresets {
  /** The form as it was last left, restored when it opens again. */
  lastDraft: HostGameDraft | null;
  presets: HostGamePreset[];
}

/** Kinds of generated maps; all but `casual` force random options, so they take no seed or style. */
export const GENERATION_TYPES = ['casual', 'tournament', 'blind', 'unexplored'] as const;
export type GenerationType = (typeof GENERATION_TYPES)[number];

/** Choices of the Neroxis map generator of a version, as the generator itself lists them. */
export interface GeneratorOptionLists {
  version: string;
  symmetries: string[];
  styles: string[];
  terrainStyles: string[];
  textureStyles: string[];
  resourceStyles: string[];
  propStyles: string[];
}

/**
 * The custom map form (GeneratorPrefs of the official client); limits in `src/shared/mapGenerator.ts`. Of several
 * chosen values one is taken at random for each map, and an empty list leaves the choice to the generator.
 */
export interface GeneratorPrefs {
  generationType: GenerationType;
  /** 0: no teams. */
  numTeams: number;
  spawnCount: number;
  /** Map edge in game units: 512 is 10 km. */
  mapSize: number;
  symmetries: string[];
  fixedSeed: boolean;
  /** As typed; used only with `fixedSeed`. */
  seed: string;
  /** Terrain, biome, resources and props are chosen one by one instead of a whole map style. */
  customStyle: boolean;
  styles: string[];
  terrainStyles: string[];
  textureStyles: string[];
  resourceStyles: string[];
  propStyles: string[];
  /** Range on 0..127 from which each map draws its density. */
  resourceDensity: [number, number];
  reclaimDensity: [number, number];
}

/** One map to generate. A null option is left to the generator; densities are on 0..127. */
export interface CustomMapRequest {
  /** A generator 1.x, from GeneratorOptionLists. */
  version: string;
  generationType: GenerationType;
  numTeams: number;
  spawnCount: number;
  mapSize: number;
  seed: string | null;
  symmetry: string | null;
  style: string | null;
  terrainStyle: string | null;
  textureStyle: string | null;
  resourceStyle: string | null;
  propStyle: string | null;
  resourceDensity: number | null;
  reclaimDensity: number | null;
}
