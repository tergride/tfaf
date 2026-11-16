import { t } from '../i18n.ts';
import { LuaParseError, luaPath, luaString, luaTable, parseLua } from '../lua/luaParser.ts';

export interface ScenarioInfo {
  name: string;
  description: string;
  type: string | null;
  widthPx: number | null;
  heightPx: number | null;
  maxPlayers: number;
  version: string | null;
  /** Game paths of the map's files, such as `/maps/seton.v0003/seton.scmap`. */
  files: { map: string | null; save: string | null; script: string | null };
}

export function removeLocalizationTag(text: string): string {
  return text.replace(/<LOC .*?>/g, '');
}

/** Reads the map metadata from a `*_scenario.lua` file, like MapService.readMap of the official client. */
export function readScenario(source: string): ScenarioInfo {
  const scenario = luaTable(parseLua(source).get('ScenarioInfo') ?? null);
  if (!scenario) {
    throw new LuaParseError(t('main.lua.noScenarioInfo'));
  }
  const name = luaString(scenario.get('name'));
  if (!name) {
    throw new LuaParseError(t('main.lua.noMapName'));
  }
  const size = luaTable(scenario.get('size'));
  const width = size?.get(1);
  const height = size?.get(2);
  const armies = luaTable(luaPath(scenario, 'Configurations', 'standard', 'teams', 1, 'armies'));

  return {
    name,
    description: removeLocalizationTag(luaString(scenario.get('description')) ?? ''),
    type: luaString(scenario.get('type')),
    widthPx: typeof width === 'number' ? width : null,
    heightPx: typeof height === 'number' ? height : null,
    maxPlayers: armies?.length ?? 0,
    version: luaString(scenario.get('map_version')),
    files: {
      map: luaString(scenario.get('map')),
      save: luaString(scenario.get('save')),
      script: luaString(scenario.get('script')),
    },
  };
}
