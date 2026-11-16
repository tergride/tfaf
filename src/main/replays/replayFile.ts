// Reading and writing FAF replay files. A `.fafreplay` is one line of JSON metadata followed by the game's own
// `.scfareplay` stream, compressed with zstd or, in files of older clients, with Qt's qCompress in base64
// (ReplayDataParser of faf-java-commons). The stream starts with a binary header: game version, map, mods, game
// options and armies; the commands of the game follow it (replayBody.ts).

import zlib from 'node:zlib';
import type { MessageKey, MessageParams } from '../../shared/i18n/index.ts';
import { asNumber, asObject, asString } from '../api/jsonApi.ts';
import { t } from '../i18n.ts';

/** Larger streams are not replays the game wrote; the limit keeps a crafted file from exhausting memory. */
const MAX_STREAM_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const SCFA_SIGNATURE = Buffer.from('Supreme Commander v');

export class ReplayFormatError extends Error {
  constructor(detail: MessageKey, params?: MessageParams) {
    super(t('main.replays.file.invalid', { detail: t(detail, params) }));
  }
}

export interface ReplayMetadata {
  uid: number | null;
  title: string | null;
  /** Map folder; null when the server did not know it (generated maps are recorded as "None"). */
  mapName: string | null;
  featuredMod: string | null;
  /** Versions of the featured mod's files by file id. */
  featuredModVersions: number[];
  simMods: { uid: string; name: string }[];
  teams: { team: number; players: string[] }[];
  host: string | null;
  recorder: string | null;
  /** Unix time in seconds. */
  launchedAt: number | null;
  gameEnd: number | null;
  complete: boolean;
}

export interface ReplayArmy {
  name: string;
  team: number;
  /** 1 UEF, 2 Aeon, 3 Cybran, 4 Seraphim, 5 Nomads in its mod (civilians also use 5). */
  faction: number | null;
  human: boolean;
  civilian: boolean;
  mean: number | null;
  deviation: number | null;
  /** The army's command source in the header; 255 for none (civilians, AI). */
  source: number;
}

export interface ScfaHeader {
  /** Patch number of `Supreme Commander v1.50.3812`; the FAF version the game ran. */
  gameVersion: number | null;
  mapFolderName: string | null;
  simModUids: string[];
  /** `Options` of the scenario table: the lobby settings, such as share, victory condition or unit cap. */
  options: LuaTable;
  armies: ReplayArmy[];
  /** Where the commands of the game start, right after the header. */
  bodyOffset: number;
}

export interface ReplayFile {
  /** Null for a bare `.scfareplay`, which has no metadata line. */
  metadata: ReplayMetadata | null;
  /** The `.scfareplay` stream the game plays. */
  stream: Buffer;
}

export type LuaValue = number | string | boolean | null | LuaTable;
export interface LuaTable {
  [key: string]: LuaValue;
}

/**
 * Bounds-checked reader of the little-endian `.scfareplay` stream. A nil in the header has a padding byte after it,
 * one in the commands has not (`parseLua` of ReplayDataParser and of LoadUtils in faf-java-commons).
 */
export class StreamReader {
  private position = 0;
  private readonly buffer: Buffer;
  private readonly nilPadding: boolean;

  constructor(buffer: Buffer, nilPadding = true) {
    this.buffer = buffer;
    this.nilPadding = nilPadding;
  }

  get offset(): number {
    return this.position;
  }

  private need(bytes: number): void {
    if (this.position + bytes > this.buffer.length) {
      throw new ReplayFormatError('main.replays.file.truncatedHeader');
    }
  }

  byte(): number {
    this.need(1);
    return this.buffer[this.position++]!;
  }

  int(): number {
    this.need(4);
    const value = this.buffer.readInt32LE(this.position);
    this.position += 4;
    return value;
  }

  float(): number {
    this.need(4);
    const value = this.buffer.readFloatLE(this.position);
    this.position += 4;
    return value;
  }

  string(): string {
    const end = this.buffer.indexOf(0, this.position);
    if (end < 0) {
      throw new ReplayFormatError('main.replays.file.unterminatedString');
    }
    const value = this.buffer.toString('utf8', this.position, end);
    this.position = end + 1;
    return value;
  }

  peek(): number {
    this.need(1);
    return this.buffer[this.position]!;
  }

  lua(depth = 0): LuaValue {
    if (depth > 32) {
      throw new ReplayFormatError('main.replays.file.tableTooDeep');
    }
    const type = this.byte();
    switch (type) {
      case 0:
        return this.float();
      case 1:
        return this.string();
      case 2:
        if (this.nilPadding) {
          this.byte();
        }
        return null;
      case 3:
        return this.byte() !== 0;
      case 4: {
        const table: LuaTable = {};
        while (this.peek() !== 5) {
          const key = this.lua(depth + 1);
          const value = this.lua(depth + 1);
          // Headers key their tables by strings and numbers; a table used as a key has no name to keep.
          if (typeof key !== 'object' || key === null) {
            table[String(key)] = value;
          }
        }
        this.byte();
        return table;
      }
      default:
        throw new ReplayFormatError('main.replays.file.unknownLuaType', { type });
    }
  }
}

export function asTable(value: LuaValue | undefined): LuaTable | null {
  return typeof value === 'object' && value !== null ? value : null;
}

function luaNumber(value: LuaValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `/maps/<folder>/<name>.scmap` → `<folder>`. */
export function mapFolderFromPath(mapPath: string): string | null {
  const parts = mapPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 3 && parts[0]!.toLowerCase() === 'maps' ? parts[1]! : null;
}

export function parseScfaHeader(stream: Buffer): ScfaHeader {
  const reader = new StreamReader(stream);
  const patch = reader.string();
  if (!patch.startsWith(SCFA_SIGNATURE.toString())) {
    throw new ReplayFormatError('main.replays.file.noSignature');
  }
  reader.string();
  const mapPath = reader.string().split('\r\n')[1] ?? '';
  reader.string();
  reader.int();
  const mods = asTable(reader.lua()) ?? {};
  reader.int();
  const scenario = asTable(reader.lua()) ?? {};
  const sources = reader.byte();
  for (let i = 0; i < sources; i++) {
    reader.string();
    reader.int();
  }
  reader.byte();
  const armyCount = reader.byte();
  const armies: ReplayArmy[] = [];
  for (let i = 0; i < armyCount; i++) {
    reader.int();
    const army = asTable(reader.lua()) ?? {};
    const source = reader.byte();
    if (source !== 255) {
      reader.byte();
    }
    armies.push({
      name: typeof army.PlayerName === 'string' ? army.PlayerName : '',
      team: luaNumber(army.Team) ?? 1,
      faction: luaNumber(army.Faction),
      human: army.Human === true,
      civilian: army.Civilian === true,
      mean: luaNumber(army.MEAN),
      deviation: luaNumber(army.DEV),
      source,
    });
  }
  // The random seed of the game.
  reader.int();

  const version = Number(/\.(\d+)$/.exec(patch)?.[1]);
  return {
    gameVersion: Number.isInteger(version) && version > 0 ? version : null,
    mapFolderName: mapFolderFromPath(mapPath),
    simModUids: Object.values(mods)
      .map((mod) => asTable(mod)?.uid)
      .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0),
    options: asTable(scenario.Options) ?? {},
    armies,
    bodyOffset: reader.offset,
  };
}

/** Narrows the JSON metadata line; unknown fields are ignored like in the official client. */
export function parseReplayMetadata(value: unknown): ReplayMetadata {
  const raw = asObject(value);
  if (!raw) {
    throw new ReplayFormatError('main.replays.file.noMetadata');
  }
  const mapName = asString(raw.mapname);
  const teams = Object.entries(asObject(raw.teams) ?? {})
    .map(([team, players]) => ({
      team: Number(team),
      players: Array.isArray(players) ? players.map(asString).filter((name) => name !== null) : [],
    }))
    .filter((team) => Number.isInteger(team.team))
    .sort((a, b) => a.team - b.team);
  const uid = asNumber(raw.uid);
  return {
    uid: uid !== null && Number.isInteger(uid) && uid > 0 ? uid : null,
    title: asString(raw.title),
    mapName: mapName && mapName !== 'None' ? mapName : null,
    featuredMod: asString(raw.featured_mod),
    featuredModVersions: Object.values(asObject(raw.featured_mod_versions) ?? {})
      .map(asNumber)
      .filter((version) => version !== null),
    simMods: Object.entries(asObject(raw.sim_mods) ?? {}).map(([uid, name]) => ({ uid, name: asString(name) ?? uid })),
    teams,
    host: asString(raw.host),
    recorder: asString(raw.recorder),
    launchedAt: asNumber(raw.time) || asNumber(raw.launched_at),
    gameEnd: asNumber(raw.game_end),
    complete: raw.complete === true,
  };
}

/** Reads only the metadata line, for listing replay folders without decompressing every file. */
export function parseMetadataLine(start: Buffer): ReplayMetadata {
  const newline = start.indexOf(0x0a);
  if (newline < 0) {
    throw new ReplayFormatError('main.replays.file.noMetadata');
  }
  try {
    return parseReplayMetadata(JSON.parse(start.toString('utf8', 0, newline)));
  } catch (error) {
    throw error instanceof ReplayFormatError ? error : new ReplayFormatError('main.replays.file.unreadableMetadata');
  }
}

function decompress(body: Buffer, compression: unknown): Buffer {
  try {
    if (compression === 'zstd') {
      return zlib.zstdDecompressSync(body, { maxOutputLength: MAX_STREAM_BYTES });
    }
    if (compression === undefined || compression === null) {
      // qCompress: big-endian length of the uncompressed data, then a zlib stream; the whole is base64.
      const packed = Buffer.from(body.toString('latin1'), 'base64');
      return zlib.inflateSync(packed.subarray(4), { maxOutputLength: MAX_STREAM_BYTES });
    }
  } catch {
    throw new ReplayFormatError('main.replays.file.decompressFailed');
  }
  throw new ReplayFormatError('main.replays.file.unknownCompression', {
    compression: typeof compression === 'string' ? compression : JSON.stringify(compression),
  });
}

export function parseReplayFile(data: Buffer): ReplayFile {
  if (data.subarray(0, SCFA_SIGNATURE.length).equals(SCFA_SIGNATURE)) {
    return { metadata: null, stream: data };
  }
  const newline = data.indexOf(0x0a);
  if (newline < 0 || newline > MAX_METADATA_BYTES) {
    throw new ReplayFormatError('main.replays.file.noMetadata');
  }
  let json: unknown;
  try {
    json = JSON.parse(data.toString('utf8', 0, newline));
  } catch {
    throw new ReplayFormatError('main.replays.file.unreadableMetadata');
  }
  return {
    metadata: parseReplayMetadata(json),
    stream: decompress(data.subarray(newline + 1), asObject(json)?.compression),
  };
}

/** Writes the format the FAF replay server uses: metadata line, then the zstd-compressed stream. */
export function encodeReplayFile(metadata: Record<string, unknown>, stream: Buffer): Buffer {
  const line = JSON.stringify({ ...metadata, compression: 'zstd' });
  return Buffer.concat([Buffer.from(`${line}\n`, 'utf8'), zlib.zstdCompressSync(stream)]);
}
