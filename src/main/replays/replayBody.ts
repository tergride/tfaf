// The commands of a `.scfareplay` after its header, read the way ReplayDataParser of faf-java-commons reads them
// (ReplayBodyTokenizer, ReplayBodyParser): each operation is a type byte, the operation's length in two bytes (with
// these three) and its data. Only the passing of time and the chat are read; the chat travels as the sim callback
// `GiveResourcesToPlayer` with the message in `Msg`.

import type { ReplayChatMessage, ReplayDetails, ReplayGameOption } from '../../shared/contract.ts';
import { replayQuality } from './matchQuality.ts';
import { asTable, type LuaTable, type LuaValue, parseScfaHeader, type ScfaHeader, StreamReader } from './replayFile.ts';

const OPERATION_HEADER_BYTES = 3;
// Operation types in the order of ReplayBodyToken.TokenId.
const ADVANCE = 0;
const LUA_SIM_CALLBACK = 22;
const END_GAME = 23;
const TICKS_PER_SECOND = 10;
// A real game has a few hundred lines; the limit keeps a crafted file from filling the window.
const MAX_CHAT_MESSAGES = 5000;
const MAX_OPTION_TEXT = 300;

/**
 * A chat line, or null for any other callback. The sender must be the player of the army the message comes from;
 * observers (`From` of -1) are left out, as in parseGiveResourcesToPlayer. `From` is the sending army's number, which
 * ReplayDataParser looks up among the command sources instead; either match is accepted here.
 */
function chatMessage(data: Buffer, ticks: number, armies: ScfaHeader['armies']): ReplayChatMessage | null {
  let args: LuaTable | null;
  try {
    const reader = new StreamReader(data, false);
    if (reader.string() !== 'GiveResourcesToPlayer') {
      return null;
    }
    args = asTable(reader.lua());
    if (!args) {
      return null;
    }
    // The units selected when the callback was sent; an operation with anything left over is damaged.
    const units = reader.int();
    if (units < 0 || units * 4 !== data.length - reader.offset) {
      return null;
    }
  } catch {
    return null;
  }
  const message = asTable(args.Msg);
  const { From: from, Sender: sender } = args;
  const to = message?.to;
  const text = message?.text;
  if (typeof from !== 'number' || typeof sender !== 'string' || typeof to !== 'string' || typeof text !== 'string') {
    return null;
  }
  const army = Math.trunc(from) - 1;
  if (army === -2) {
    return null;
  }
  const bySource = armies.findLast((candidate) => candidate.source === army);
  if (armies[army]?.name !== sender && bySource?.name !== sender) {
    return null;
  }
  return { time: Math.floor(ticks / TICKS_PER_SECOND), sender, to, text };
}

/** Chat of the game with its game time; a stream cut short (a game still running) gives what it has. */
export function parseReplayChat(stream: Buffer, header: Pick<ScfaHeader, 'armies' | 'bodyOffset'>): ReplayChatMessage[] {
  const messages: ReplayChatMessage[] = [];
  let ticks = 0;
  let position = header.bodyOffset;
  while (position + OPERATION_HEADER_BYTES <= stream.length && messages.length < MAX_CHAT_MESSAGES) {
    const type = stream[position]!;
    const end = position + stream.readUInt16LE(position + 1);
    if (type > END_GAME || end < position + OPERATION_HEADER_BYTES || end > stream.length) {
      break;
    }
    const data = stream.subarray(position + OPERATION_HEADER_BYTES, end);
    if (type === ADVANCE && data.length === 4) {
      ticks += data.readInt32LE(0);
    } else if (type === LUA_SIM_CALLBACK) {
      const message = chatMessage(data, ticks, header.armies);
      if (message) {
        messages.push(message);
      }
    } else if (type === END_GAME) {
      break;
    }
    position = end;
  }
  return messages;
}

/** Numbers are single-precision floats in the file; seven digits give back what the lobby set (0.1, not 0.100000001). */
function luaNumberText(value: number): number {
  return Number(value.toPrecision(7));
}

function optionText(value: LuaValue, depth = 0): string {
  if (typeof value === 'number') {
    return String(luaNumberText(value));
  }
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  if (depth > 0) {
    return '…';
  }
  const entries = Object.entries(value);
  const list = entries.every(([key]) => /^\d+$/.test(key));
  return entries.map(([key, item]) => (list ? optionText(item, 1) : `${key}: ${optionText(item, 1)}`)).join(', ');
}

/** The lobby settings sorted by key, like ReplayService.loadReplayDetails of the official client. */
export function toGameOptions(options: LuaTable): ReplayGameOption[] {
  return Object.entries(options)
    .flatMap(([key, value]): ReplayGameOption[] => {
      if (value === null) {
        return [];
      }
      if (typeof value === 'object') {
        const text = optionText(value);
        return [{ key, value: text.length > MAX_OPTION_TEXT ? `${text.slice(0, MAX_OPTION_TEXT)}…` : text }];
      }
      return [{ key, value: typeof value === 'number' ? luaNumberText(value) : value }];
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }));
}

/** Options, chat and match quality of a `.scfareplay` stream; quality counts the human armies only. */
export function readReplayDetails(stream: Buffer): ReplayDetails {
  const header = parseScfaHeader(stream);
  return {
    gameVersion: header.gameVersion,
    options: toGameOptions(header.options),
    chat: parseReplayChat(stream, header),
    quality: replayQuality(
      header.armies
        .filter((army) => army.human && !army.civilian)
        .map((army) => ({ team: army.team, mean: army.mean, deviation: army.deviation })),
    ),
  };
}
