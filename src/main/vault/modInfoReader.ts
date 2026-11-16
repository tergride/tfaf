import { t } from '../i18n.ts';
import { LuaParseError, luaString, parseLua } from '../lua/luaParser.ts';

export interface ModInfo {
  uid: string;
  name: string;
  version: string | null;
  author: string;
  description: string;
  uiOnly: boolean;
  icon: string | null;
}

/** Reads a `mod_info.lua` file, like ModReader from faf-java-commons. */
export function readModInfo(source: string): ModInfo {
  const globals = parseLua(source);
  const uid = luaString(globals.get('uid') ?? null);
  if (!uid) {
    throw new LuaParseError(t('main.lua.noModUid'));
  }
  return {
    uid,
    name: luaString(globals.get('name') ?? null) ?? uid,
    version: luaString(globals.get('version') ?? null),
    author: luaString(globals.get('author') ?? null) ?? '',
    description: luaString(globals.get('description') ?? null) ?? '',
    uiOnly: globals.get('ui_only') === true,
    icon: luaString(globals.get('icon') ?? null) || null,
  };
}
