// Resource and start markers from a map's `_save.lua`: `Scenario.MasterChain._MASTERCHAIN_.Markers`, as the map
// previews of faf-java-commons read them. Mass and hydrocarbon points by their type, start positions by the
// `ARMY_<n>` names of blank markers.

import type { MapMarker } from '../../shared/contract.ts';
import { LuaFunction, LuaTable, type LuaValue, parseLua } from '../lua/luaParser.ts';

const ARMY_MARKER = /^ARMY_(\d+)$/i;

const identity = new LuaFunction((args) => args[0] ?? null);
const vector = new LuaFunction((args) => {
  const value = new LuaTable();
  args.forEach((arg, index) => value.set(index + 1, arg));
  return value;
});

// Save files wrap their values in these engine functions.
const SAVE_GLOBALS: [string, LuaValue][] = [
  ['STRING', identity],
  ['FLOAT', identity],
  ['BOOLEAN', identity],
  ['GROUP', identity],
  ['VECTOR3', vector],
  ['RECT', vector],
];

function readScenario(source: string): LuaValue {
  let globals: Map<string, LuaValue>;
  try {
    globals = parseLua(source, { globals: SAVE_GLOBALS });
  } catch {
    globals = parseLua(source, { globals: SAVE_GLOBALS, lenient: true });
  }
  return globals.get('Scenario') ?? null;
}

function child(value: LuaValue, key: string): LuaValue {
  return value instanceof LuaTable ? value.get(key) : null;
}

export function readSaveMarkers(source: string): MapMarker[] {
  const table =child(child(child(readScenario(source), 'MasterChain'), '_MASTERCHAIN_'), 'Markers');
  if (!(table instanceof LuaTable)) {
    return [];
  }
  const result: MapMarker[] = [];
  for (const name of table.keys()) {
    const marker = table.get(name);
    const position = child(marker, 'position');
    const x = position instanceof LuaTable ? position.get(1) : null;
    const z = position instanceof LuaTable ? position.get(3) : null;
    if (typeof x !== 'number' || typeof z !== 'number') {
      continue;
    }
    const type = child(marker, 'type');
    const army = typeof name === 'string' ? ARMY_MARKER.exec(name) : null;
    if (type === 'Mass') {
      result.push({ kind: 'mass', x, z, army: null });
    } else if (type === 'Hydrocarbon') {
      result.push({ kind: 'hydro', x, z, army: null });
    } else if (army && type === 'Blank Marker') {
      result.push({ kind: 'spawn', x, z, army: Number(army[1]) });
    }
  }
  return result;
}
