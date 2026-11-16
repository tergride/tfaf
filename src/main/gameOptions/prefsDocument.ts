// Game.prefs as data: read with the strict parser, since the game writes it as plain data, and written back whole in
// the game's own format.

import { t } from '../i18n.ts';
import { LuaParseError, LuaTable, type LuaValue, luaString, luaTable, parseLua } from '../lua/luaParser.ts';
import { luaEquals, LuaWriteError, serializeLuaGlobals } from '../lua/luaWriter.ts';

/** Game.prefs has no profile yet: the game makes one the first time it starts. */
export class NoProfileError extends Error {}

export interface PrefsDocument {
  globals: Map<string, LuaValue>;
  /** The current profile, `profile.profiles[profile.current]`: options and key maps belong to it. */
  profile: LuaTable;
}

export function readPrefsDocument(content: string): PrefsDocument {
  let globals: Map<string, LuaValue>;
  try {
    globals = parseLua(content);
  } catch (error) {
    if (error instanceof LuaParseError) {
      throw new Error(t('main.gameOptions.unreadablePrefs', { error: error.message }), { cause: error });
    }
    throw error;
  }
  const profiles = luaTable(globals.get('profile') ?? null);
  const current = profiles?.get('current');
  const profile = typeof current === 'number' ? luaTable(luaTable(profiles!.get('profiles'))?.get(current) ?? null) : null;
  if (!profile) {
    throw new NoProfileError(t('main.gameOptions.noProfile'));
  }
  return { globals, profile };
}

export function profileName(profile: LuaTable): string {
  return luaString(profile.get('Name')) ?? '';
}

/**
 * The text to save, with the line breaks of the original. It is read back before saving: data the writer would not
 * keep exactly stops the save instead of damaging the file.
 */
export function writePrefsDocument(document: PrefsDocument, original: string): string {
  const newline = original.includes('\r\n') || !original.includes('\n') ? '\r\n' : '\n';
  let text: string;
  try {
    text = serializeLuaGlobals(document.globals, newline);
  } catch (error) {
    if (error instanceof LuaWriteError) {
      throw new Error(t('main.gameOptions.writeFailed'), { cause: error });
    }
    throw error;
  }
  if (!luaEquals(tableOf(document.globals), tableOf(parseLua(text)))) {
    throw new Error(t('main.gameOptions.writeFailed'));
  }
  return text;
}

function tableOf(globals: ReadonlyMap<string, LuaValue>): LuaTable {
  const table = new LuaTable();
  for (const [name, value] of globals) {
    table.set(name, value);
  }
  return table;
}
