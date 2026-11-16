// Writes Lua data the way the game saves Game.prefs: one `name = value` per global, tables over several lines with four
// spaces per level, array items without keys and no comma after the last field.

import { isLuaName, LuaFunction, LuaTable, type LuaValue } from './luaParser.ts';

export class LuaWriteError extends Error {}

const INDENT = '    ';

export function serializeLuaGlobals(globals: ReadonlyMap<string, LuaValue>, newline = '\r\n'): string {
  let text = '';
  for (const [name, value] of globals) {
    if (value === null) {
      continue;
    }
    if (!isLuaName(name)) {
      throw new LuaWriteError(`Global '${name}' is not a Lua name`);
    }
    text += `${name} = ${serializeValue(value, 0, newline)}${newline}`;
  }
  return text;
}

function serializeValue(value: Exclude<LuaValue, null>, depth: number, newline: string): string {
  if (typeof value === 'string') {
    return quote(value);
  }
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof LuaFunction) {
    throw new LuaWriteError('Functions cannot be written');
  }
  return serializeTable(value, depth, newline);
}

function serializeTable(table: LuaTable, depth: number, newline: string): string {
  // Items of the array part are written in order without keys, so they keep their indexes when read back.
  const length = table.length;
  const fields: string[] = [];
  for (let index = 1; index <= length; index++) {
    fields.push(serializeValue(table.get(index)!, depth + 1, newline));
  }
  for (const key of table.keys()) {
    if (typeof key === 'number' && Number.isInteger(key) && key >= 1 && key <= length) {
      continue;
    }
    fields.push(`${serializeKey(key)} = ${serializeValue(table.get(key)!, depth + 1, newline)}`);
  }
  if (fields.length === 0) {
    return '{ }';
  }
  const indent = INDENT.repeat(depth + 1);
  return `{${newline}${fields.map((field) => indent + field).join(`,${newline}`)}${newline}${INDENT.repeat(depth)}}`;
}

function serializeKey(key: string | number | boolean): string {
  if (typeof key === 'string') {
    return isLuaName(key) ? key : `[${quote(key)}]`;
  }
  return `[${typeof key === 'number' ? formatNumber(key) : String(key)}]`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new LuaWriteError(`${value} cannot be written`);
  }
  return Object.is(value, -0) ? '0' : String(value);
}

// The file is read and written as latin1, so every character must fit in a byte.
function quote(text: string): string {
  let result = "'";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code > 0xff) {
      throw new LuaWriteError(`'${text}' does not fit in latin1`);
    }
    if (char === '\\' || char === "'") {
      result += `\\${char}`;
    } else if (char === '\n') {
      result += '\\n';
    } else if (char === '\r') {
      result += '\\r';
    } else if (code < 0x20 || code === 0x7f) {
      result += `\\${String(code).padStart(3, '0')}`;
    } else {
      result += char;
    }
  }
  return `${result}'`;
}

/** Whether two values hold the same data; tables are compared by content. */
export function luaEquals(a: LuaValue, b: LuaValue): boolean {
  if (a instanceof LuaTable && b instanceof LuaTable) {
    const keys = a.keys();
    return keys.length === b.keys().length && keys.every((key) => luaEquals(a.get(key), b.get(key)));
  }
  return a === b;
}
