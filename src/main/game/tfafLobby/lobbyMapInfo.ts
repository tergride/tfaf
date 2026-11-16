// What a TFAF lobby needs of a map: its name, scenario file and start positions, in the order of the game's slots.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { LOBBY_LIMITS, type LobbyMap, type LobbySpot } from '../../../shared/contract.ts';
import { luaPath, luaString, parseLua } from '../../lua/luaParser.ts';
import { arrayOf } from '../../gameOptions/gameFiles.ts';
import { readSaveMarkers } from '../../mapView/saveMarkers.ts';

const SCENARIO_SUFFIX = '_scenario.lua';
const SAVE_SUFFIX = '_save.lua';
const ARMY_NAME = /^ARMY_(\d+)$/i;
const MIDDLE: LobbySpot = { x: 0.5, y: 0.5 };

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Reads the map's own files; `folder` is where the game finds it. */
export async function readLobbyMap(folder: string): Promise<LobbyMap | null> {
  const files = await readdir(folder).catch(() => []);
  const scenarioName = files.find((file) => file.toLowerCase().endsWith(SCENARIO_SUFFIX));
  if (!scenarioName) {
    return null;
  }
  const folderName = path.basename(folder);
  const globals = parseLua(await readFile(path.join(folder, scenarioName), 'utf8'), { lenient: true });
  const info = globals.get('ScenarioInfo') ?? null;
  const width = luaPath(info, 'size', 1);
  const height = luaPath(info, 'size', 2);
  const armies = arrayOf(luaPath(info, 'Configurations', 'standard', 'teams', 1, 'armies'))
    .map(luaString)
    .filter((army) => army !== null)
    .slice(0, LOBBY_LIMITS.maxSlots);

  const saveName = files.find((file) => file.toLowerCase() === scenarioName.toLowerCase().replace(SCENARIO_SUFFIX, SAVE_SUFFIX));
  const markers = saveName ? readSaveMarkers(await readFile(path.join(folder, saveName), 'utf8')) : [];
  // A map may allow only some factions on a position, as the game's lobby reads it from the same table.
  const factions = arrayOf(luaPath(info, 'Configurations', 'standard', 'factions'));
  const spots = armies.map((army, index): LobbySpot => {
    const allowed = arrayOf(factions[index] ?? null)
      .map(luaString)
      .filter((key) => key !== null)
      .map((key) => key.toLowerCase());
    const number = Number(ARMY_NAME.exec(army)?.[1]);
    const marker = markers.find((candidate) => candidate.kind === 'spawn' && candidate.army === number);
    let spot = MIDDLE;
    if (marker && typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
      const side = Math.max(width, height);
      spot = { x: clamp((marker.x + (side - width) / 2) / side), y: clamp((marker.z + (side - height) / 2) / side) };
    }
    return allowed.length > 0 ? { ...spot, factions: allowed } : spot;
  });
  return {
    folderName,
    name: luaString(luaPath(info, 'name')) ?? folderName,
    scenario: `/maps/${folderName}/${scenarioName}`,
    spots,
    adaptive: luaPath(info, 'AdaptiveMap') === true,
  };
}
