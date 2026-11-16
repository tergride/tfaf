// The packages a featured mod's game loads, in the order its init file mounts them: the first package that has a path
// wins. FAF and its two test builds are full sets that differ only in the extension of their packages (init_faf.lua,
// init_fafbeta.lua, init_fafdevelop.lua). Nomads mounts its own packages over everything FAF mounts and adds a hook
// folder whose scripts the game appends to the script of the same path (init_nomads.lua).

import path from 'node:path';
import { t } from '../i18n.ts';
import type { GameFileSystem } from '../mapView/gameFileSystem.ts';

/** What the readers of a featured mod's scripts need of its packages. */
export type GameScripts = Pick<GameFileSystem, 'list' | 'read' | 'script'>;

/** A script a reader cannot do without. */
export async function requiredScript(files: Pick<GameScripts, 'script'>, file: string): Promise<string> {
  const text = await files.script(file);
  if (text === null) {
    throw new Error(t('main.gameOptions.gameFileMissing', { file }));
  }
  return text;
}

export interface GamePackageLayout {
  /** Package files, the first that has a path wins. */
  archives: string[];
  /** Hook folders such as `/nomadhook`, in the order the game appends their scripts. */
  hooks: string[];
}

const FAF_PACKAGES = ['effects', 'env', 'etc', 'loc', 'lua', 'meshes', 'mods', 'projectiles', 'textures', 'units'];
// The game's own packages init_*.lua mounts after FAF's; lua, moholua, mohodata, editor, ambience and schook stay out.
const GAME_PACKAGES = ['units', 'textures', 'skins', 'props', 'objects', 'mods', 'meshes', 'env', 'effects', 'projectiles'];
const BASE_EXTENSIONS: Readonly<Record<string, string>> = { faf: 'nx2', fafbeta: 'nx4', fafdevelop: 'nx5' };
const NOMADS_PACKAGES = ['units', 'textures', 'sounds', 'effects', 'env', 'nomadhook', 'lua', 'projectiles', 'loc', 'meshes'];

/** Any other featured mod is laid out as FAF, which the lobbies that read these files never host. */
export function gamePackages(featuredMod: string, dataPath: string, gamePath: string | null): GamePackageLayout {
  const gamedata = path.join(dataPath, 'gamedata');
  const extension = BASE_EXTENSIONS[featuredMod] ?? BASE_EXTENSIONS.faf!;
  const nomads = featuredMod === 'nomads';
  return {
    archives: [
      ...(nomads ? NOMADS_PACKAGES.map((name) => path.join(gamedata, `${name}.nmd`)) : []),
      ...FAF_PACKAGES.map((name) => path.join(gamedata, `${name}.${extension}`)),
      ...(gamePath ? GAME_PACKAGES.map((name) => path.join(gamePath, 'gamedata', `${name}.scd`)) : []),
    ],
    hooks: nomads ? ['/nomadhook'] : [],
  };
}
