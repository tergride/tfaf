// The factions of a featured mod as lua/factions.lua numbers them: the four of the game (`OrgFactions`), then every
// `FactionList` entry of lua/CustomFactions whose mods the room plays (`GetCustomFactions`), which is how Nomads adds
// its faction. `OrgFactions` builds its list in a function the lenient parser does not run, so the four are named here.

import type { LobbyFaction, MapTexture } from '../../shared/contract.ts';
import { readDds } from '../mapView/ddsReader.ts';
import { luaString, luaTable, parseLua } from '../lua/luaParser.ts';
import { arrayOf } from './gameFiles.ts';
import type { GameScripts } from './gamePackages.ts';

export const STANDARD_FACTIONS = ['uef', 'aeon', 'cybran', 'seraphim'] as const;

const CUSTOM_FACTIONS_FOLDER = '/lua/CustomFactions';
// Faction emblems are skinnable; `common` is where the game falls back to.
const ICON_FOLDER = '/textures/ui/common';
const MAX_ICON_BYTES = 1024 ** 2;

interface CustomFaction {
  key: string;
  displayName: string | null;
  smallIcon: string | null;
}

async function customFactions(files: Pick<GameScripts, 'list' | 'script'>, simModUids: readonly string[]): Promise<CustomFaction[]> {
  const mods = new Set(simModUids.map((uid) => uid.toLowerCase()));
  const factions: CustomFaction[] = [];
  for (const file of (await files.list(CUSTOM_FACTIONS_FOLDER, '.lua')).sort()) {
    const script = await files.script(file);
    const list = script ? (parseLua(script, { lenient: true }).get('FactionList') ?? null) : null;
    for (const entry of arrayOf(list)) {
      const table = luaTable(entry);
      const key = luaString(table?.get('Key') ?? null);
      const required = luaTable(table?.get('ModsPrerequisite') ?? null);
      const playable = !required || arrayOf(required).every((uid) => mods.has(String(luaString(uid)).toLowerCase()));
      if (table && key && playable && !STANDARD_FACTIONS.includes(key as never) && !factions.some((faction) => faction.key === key)) {
        factions.push({ key, displayName: luaString(table.get('DisplayName')), smallIcon: luaString(table.get('SmallIcon')) });
      }
    }
  }
  return factions;
}

/** Faction keys by number, from 1. */
export async function readFactions(files: Pick<GameScripts, 'list' | 'script'>, simModUids: readonly string[]): Promise<string[]> {
  return [...STANDARD_FACTIONS, ...(await customFactions(files, simModUids)).map((faction) => faction.key)];
}

async function iconOf(files: Pick<GameScripts, 'read'>, smallIcon: string | null): Promise<MapTexture | null> {
  if (!smallIcon) {
    return null;
  }
  const data = await files.read(`${ICON_FOLDER}/${smallIcon.replace(/^\/+/, '')}`, MAX_ICON_BYTES).catch(() => null);
  const texture = data ? readDds(data) : null;
  return texture && { ...texture, levels: texture.levels.slice(0, 1) };
}

/** The factions as the room shows them, with the game's names and emblems of the custom ones. */
export async function readLobbyFactions(files: GameScripts, simModUids: readonly string[], localize: (text: string) => string): Promise<LobbyFaction[]> {
  const custom = await customFactions(files, simModUids);
  return [
    ...STANDARD_FACTIONS.map((key) => ({ key, name: key, icon: null })),
    ...(await Promise.all(custom.map(async (faction) => ({ key: faction.key, name: localize(faction.displayName ?? faction.key), icon: await iconOf(files, faction.smallIcon) })))),
  ];
}
