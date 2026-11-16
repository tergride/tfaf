// Fingerprints of the files a game loads. TFAF clients exchange them to tell whether everyone plays with the same
// files: a short hash of the featured mod file list, of the map's files and of the sim mods' files, together and each.

import { createHash } from 'node:crypto';
import type { FilesComparison, GameFilesReport, PlayerFiles, PlayerFilesCheck } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';
import { describeFolder } from '../vault/integrity.ts';
import { isBuiltInMod } from './gameVault.ts';

export interface GameFingerprint {
  gameFiles: string | null;
  map: string | null;
  /** Which map `map` describes (mapKey); null when the player does not send it, as older TFAF. */
  mapKey: string | null;
  mods: string | null;
  /** Each sim mod on its own; null when the player does not send them, as older TFAF. */
  modFiles: ModFingerprint[] | null;
}

/** A sim mod: `key` stands for its uid (modKey), `digest` for its files; null when they could not be read. */
export interface ModFingerprint {
  key: string;
  digest: string | null;
}

export const FINGERPRINT_BYTES = 8;

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, FINGERPRINT_BYTES * 2);
}

/** A short hash of lines whose order does not matter. */
export function digestLines(lines: string[]): string {
  return shortHash([...lines].sort().join('\n'));
}

/** The files of a map or a mod by path, size and CRC32: the same files give the same digest on every computer. */
export function filesDigest(files: { path: string; size: number; crc32: number }[]): string {
  return digestLines(files.map((file) => `${file.path}:${file.size}:${file.crc32 >>> 0}`));
}

/** Digest of whatever a folder holds, for content the vault does not describe; null when it cannot be read. */
export async function folderDigest(directory: string): Promise<string | null> {
  try {
    return filesDigest(await describeFolder(directory));
  } catch (error) {
    console.warn(`Files of ${directory} could not be read: ${describeError(error)}`);
    return null;
  }
}

/** All sim mods together; unknown when one of them is. */
export function modsDigest(mods: { uid: string; digest: string | null }[]): string | null {
  return mods.every((mod): mod is { uid: string; digest: string } => mod.digest !== null) ? digestLines(mods.map((mod) => `${mod.uid}:${mod.digest}`)) : null;
}

/** Stands for a mod's uid in the handshake: as long as a digest, whatever the uid's length. */
export function modKey(uid: string): string {
  return shortHash(uid.toLowerCase());
}

/** Stands for a map's folder name in the handshake, so a digest of another map is told from other files of this one. */
export function mapKey(folderName: string): string {
  return shortHash(folderName.toLowerCase());
}

export function modFingerprints(mods: { uid: string; digest: string | null }[]): ModFingerprint[] {
  return mods.map((mod) => ({ key: modKey(mod.uid), digest: mod.digest }));
}

function compare(local: string | null, remote: string | null): FilesComparison {
  if (local === null || remote === null) {
    return 'unknown';
  }
  return local === remote ? 'same' : 'different';
}

/** A player still bringing in the lobby's map reports the previous one, which says nothing about the files of this one. */
function compareMaps(local: GameFingerprint | null, remote: GameFingerprint): FilesComparison {
  const localKey = local?.mapKey ?? null;
  if (localKey !== null && remote.mapKey !== null && localKey !== remote.mapKey) {
    return 'unknown';
  }
  return compare(local?.map ?? null, remote.map);
}

export function compareFingerprints(local: GameFingerprint | null, remote: GameFingerprint): PlayerFiles {
  return {
    gameFiles: compare(local?.gameFiles ?? null, remote.gameFiles),
    map: compareMaps(local, remote),
    mods: compare(local?.mods ?? null, remote.mods),
  };
}

export interface PlayerFingerprint {
  playerId: number;
  login: string;
  /** Null for players that did not send one: other clients, or a TFAF client not heard from yet. */
  fingerprint: GameFingerprint | null;
}

/** A sim mod of the game as the lobby lists it. */
export interface GameMod {
  uid: string;
  name: string;
}

/**
 * Keys of the mods whose files differ; without `gameKeys` a mod only one side has differs too. With `gameKeys` only
 * the mods ticked in the game's lobby count: a mod the host unticked stays mounted but is not loaded, and a ticked mod
 * one side has not checked yet, e.g. an older TFAF that does not follow the lobby, is unknown. Empty without both
 * sides' details.
 */
function differentModKeys(
  host: ModFingerprint[] | null,
  player: ModFingerprint[] | null,
  gameKeys: ReadonlySet<string> | null,
): string[] {
  if (host === null || player === null) {
    return [];
  }
  const hostDigests = new Map(host.map((mod) => [mod.key, mod.digest]));
  const playerDigests = new Map(player.map((mod) => [mod.key, mod.digest]));
  return [...new Set([...hostDigests.keys(), ...playerDigests.keys()])].filter((key) => {
    const hostDigest = hostDigests.get(key);
    const playerDigest = playerDigests.get(key);
    if (gameKeys !== null && (!gameKeys.has(key) || hostDigest === undefined || playerDigest === undefined)) {
      return false;
    }
    // A mod one side could not read compares as unknown, not as different.
    return hostDigest !== null && playerDigest !== null && hostDigest !== playerDigest;
  });
}

/**
 * The sim mods compared one by one, when both sides sent them and the lobby lists the game's mods; null otherwise,
 * and then the digest of all mods together decides.
 */
function compareGameMods(
  host: ModFingerprint[] | null,
  player: ModFingerprint[] | null,
  gameKeys: ReadonlySet<string> | null,
  differing: string[],
): FilesComparison | null {
  if (host === null || player === null || gameKeys === null) {
    return null;
  }
  if (differing.length > 0) {
    return 'different';
  }
  const hostDigests = new Map(host.map((mod) => [mod.key, mod.digest]));
  const playerDigests = new Map(player.map((mod) => [mod.key, mod.digest]));
  const known = (digests: Map<string, string | null>, key: string): boolean => (digests.get(key) ?? null) !== null;
  return [...gameKeys].every((key) => known(hostDigests, key) && known(playerDigests, key)) ? 'same' : 'unknown';
}

const UNKNOWN_FILES: PlayerFiles = { gameFiles: 'unknown', map: 'unknown', mods: 'unknown' };

/**
 * Compares every player's files with the host's. `hostLogin` is null while the lobby has not named the host;
 * `modNames` names the mods by key, as far as we have them ourselves. `gameMods` are the sim mods the game's lobby
 * has ticked, null while unknown: the host may untick mods in the lobby, and the comparison follows without a restart.
 */
export function compareWithHost(
  hostLogin: string | null,
  players: PlayerFingerprint[],
  modNames: ReadonlyMap<string, string>,
  gameMods: readonly GameMod[] | null = null,
): GameFilesReport {
  // The mods of the game's mods.scd load from there and are never fingerprinted.
  const gameKeys = gameMods && new Set(gameMods.filter((mod) => !isBuiltInMod(mod.uid)).map((mod) => modKey(mod.uid)));
  const names = new Map(modNames);
  for (const mod of gameMods ?? []) {
    const key = modKey(mod.uid);
    if (!names.has(key)) {
      names.set(key, mod.name);
    }
  }
  const isHost = (player: PlayerFingerprint): boolean =>
    hostLogin !== null && player.login.toLowerCase() === hostLogin.toLowerCase();
  const host = players.find(isHost) ?? null;
  const reference = host?.fingerprint ?? null;
  const checks = players
    .filter((player) => !isHost(player))
    .map((player): PlayerFilesCheck => {
      const remote = player.fingerprint;
      if (reference === null || remote === null) {
        return { playerId: player.playerId, login: player.login, ...UNKNOWN_FILES, differentMods: [] };
      }
      const files = compareFingerprints(reference, remote);
      const differing = differentModKeys(reference.modFiles, remote.modFiles, gameKeys);
      return {
        playerId: player.playerId,
        login: player.login,
        ...files,
        mods:
          compareGameMods(reference.modFiles, remote.modFiles, gameKeys, differing) ??
          (differing.length > 0 ? 'different' : files.mods),
        differentMods: differing.map((key) => names.get(key) ?? null),
      };
    });
  return {
    host: hostLogin === null ? null : { playerId: host?.playerId ?? null, login: host?.login ?? hostLogin, known: reference !== null },
    players: checks,
  };
}

/** One key per player and part that differs from the host, so a new difference can be told from a known one. */
export function differenceKeys(report: GameFilesReport): Set<string> {
  const keys = new Set<string>();
  for (const player of report.players) {
    for (const part of ['gameFiles', 'map', 'mods'] as const) {
      if (player[part] === 'different') {
        keys.add(`${player.playerId}:${part}`);
      }
    }
    for (const mod of player.differentMods) {
      keys.add(`${player.playerId}:mod:${mod ?? '?'}`);
    }
  }
  return keys;
}
