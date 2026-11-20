// The recipe of a StoneMap map in a TFAF room. The host reads it from the map's generation.json; a player takes it from
// the host's room snapshot, which is untrusted input, and StoneMap makes the map from it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STONEMAP_PRESENTATION_LIMITS, type MapAdjustments, type MapPresentation, type StoneMapRecipe } from '../../shared/contract.ts';
import { describeError } from '../errors.ts';

const MAP_NAME = /^stonemap_map_generator_[a-z0-9_]{1,2000}$/;
const BUILD = /^[a-z0-9.-]{1,40}$/;
const OBJECT_ID = /^[a-z]{1,16}:\d{1,6}$/;
const FINGERPRINT = /^[\w.+/=:-]{1,128}$/;
const MAX_POSITIONS = 8192;
/** A room snapshot travels in fragments of at most 256 kB; the recipe must leave room for the rest of it. */
export const MAX_RECIPE_BYTES = 160 * 1024;

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === 'string' && value.length <= maxLength ? value : undefined;
}

function parsePresentation(value: unknown): MapPresentation | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = asObject(value);
  const name = optionalText(raw?.name, STONEMAP_PRESENTATION_LIMITS.name);
  const description = optionalText(raw?.description, STONEMAP_PRESENTATION_LIMITS.description);
  return name === undefined || description === undefined ? undefined : { name, description };
}

function parseAdjustments(value: unknown): MapAdjustments | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = asObject(value);
  const version = raw?.version;
  const baseFingerprint = raw?.baseFingerprint;
  if (
    (version !== 1 && version !== 2) ||
    typeof baseFingerprint !== 'string' ||
    !FINGERPRINT.test(baseFingerprint) ||
    !Array.isArray(raw?.positions) ||
    raw.positions.length > MAX_POSITIONS
  ) {
    return undefined;
  }
  const positions: MapAdjustments['positions'] = [];
  for (const entry of raw.positions) {
    const position = asObject(entry);
    const { id, x, z } = position ?? {};
    if (typeof id !== 'string' || !OBJECT_ID.test(id) || typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {
      return undefined;
    }
    positions.push({ id, x, z });
  }
  const deleted = raw.deletedIds;
  if (deleted !== undefined && deleted !== null && (!Array.isArray(deleted) || deleted.length > MAX_POSITIONS)) {
    return undefined;
  }
  const deletedIds = Array.isArray(deleted) ? deleted.filter((id): id is string => typeof id === 'string' && OBJECT_ID.test(id)) : null;
  if (deletedIds && deletedIds.length !== (deleted as unknown[]).length) {
    return undefined;
  }
  return { version, baseFingerprint, positions, ...(deletedIds && deletedIds.length > 0 ? { deletedIds } : {}) };
}

/** A recipe from a room snapshot, or null when it is missing or not one. */
export function parseStoneMapRecipe(input: unknown): StoneMapRecipe | null {
  const raw = asObject(input);
  const { build, mapName } = raw ?? {};
  if (typeof build !== 'string' || !BUILD.test(build) || typeof mapName !== 'string' || !MAP_NAME.test(mapName)) {
    return null;
  }
  const presentation = parsePresentation(raw?.presentation);
  const adjustments = parseAdjustments(raw?.adjustments);
  if (presentation === undefined || adjustments === undefined) {
    return null;
  }
  return { build, mapName, presentation, adjustments };
}

/** The recipe of a map StoneMap saved into `folder`, for the room of a host on the given build. */
export async function readStoneMapRecipe(folder: string, build: string): Promise<StoneMapRecipe | null> {
  try {
    const generation: unknown = JSON.parse(await readFile(path.join(folder, 'generation.json'), 'utf8'));
    const raw = asObject(generation);
    const recipe = parseStoneMapRecipe({ build, mapName: raw?.mapName, presentation: raw?.presentation, adjustments: raw?.adjustments });
    if (!recipe) {
      console.warn(`StoneMap recipe of ${path.basename(folder)} is unreadable`);
      return null;
    }
    if (Buffer.byteLength(JSON.stringify(recipe)) > MAX_RECIPE_BYTES) {
      console.warn(`StoneMap recipe of ${path.basename(folder)} is too large for the room; players must have the map`);
      return null;
    }
    return recipe;
  } catch (error) {
    console.warn(`StoneMap recipe of ${path.basename(folder)} could not be read: ${describeError(error)}`);
    return null;
  }
}
