// Pieces of game scripts found by their tokens rather than run: the definition of a function or a table by its name,
// the code between two snippets, and a fingerprint of such a piece that ignores comments and layout.

import { createHash } from 'node:crypto';
import { type LuaToken, tokenizeLua } from './luaParser.ts';

/** Keywords that open a block closed by `end` (`repeat` is closed by `until`); `while` and `for` open it with `do`. */
const BLOCK_OPENERS = new Set(['function', 'if', 'do', 'repeat']);

export interface LuaPiece {
  /** The piece's tokens, from its first to its last. */
  tokens: LuaToken[];
  /** For a function, the source between its parameters and its `end`. */
  body: string | null;
}

function isName(token: LuaToken | undefined, value?: string): boolean {
  return token?.kind === 'name' && (value === undefined || token.value === value);
}

function isSymbol(token: LuaToken | undefined, value: string): boolean {
  return token?.kind === 'symbol' && token.value === value;
}

/** The index of the `end` or `until` that closes the block opened at `start`, or -1. */
function blockEnd(tokens: readonly LuaToken[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'name') {
      continue;
    }
    if (BLOCK_OPENERS.has(token.value)) {
      depth++;
    } else if (token.value === 'end' || token.value === 'until') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** The index of the `}` that closes the table opened at `start`, or -1. */
function tableEnd(tokens: readonly LuaToken[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (isSymbol(tokens[index], '{')) {
      depth++;
    } else if (isSymbol(tokens[index], '}')) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** Whether `parts` (`a.b.c` split) stand at `index`, joined by dots or a colon; the index after them, or -1. */
function matchName(tokens: readonly LuaToken[], index: number, parts: readonly string[]): number {
  let at = index;
  for (let part = 0; part < parts.length; part++) {
    if (part > 0) {
      if (!isSymbol(tokens[at], '.') && !isSymbol(tokens[at], ':')) {
        return -1;
      }
      at++;
    }
    if (!isName(tokens[at], parts[part])) {
      return -1;
    }
    at++;
  }
  return at;
}

function functionPiece(source: string, tokens: readonly LuaToken[], start: number): LuaPiece | null {
  const end = blockEnd(tokens, start);
  const open = tokens.findIndex((token, index) => index > start && isSymbol(token, '('));
  const close = open < 0 ? -1 : tokens.findIndex((token, index) => index > open && isSymbol(token, ')'));
  if (end < 0 || close < 0 || close > end) {
    return null;
  }
  return { tokens: tokens.slice(start, end + 1), body: source.slice(tokens[close + 1]!.pos, tokens[end]!.pos) };
}

/**
 * The first definition of `name` in the source: `function name(`, `local function name(`, `name = function(` (also as
 * a table field) or `name = {`. A dotted name such as `lobbyComm.GameLaunched` matches only that path; a plain name
 * also matches the field of a table constructor.
 */
export function findLuaDefinition(source: string, name: string): LuaPiece | null {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const tokens = tokenizeLua(text);
  const parts = name.split('.');
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (isName(token, 'function')) {
      const after = matchName(tokens, index + 1, parts);
      if (after >= 0 && isSymbol(tokens[after], '(')) {
        return functionPiece(text, tokens, index);
      }
      continue;
    }
    // A name inside a longer path (`x.name = ...` when looking for `name`) is another definition.
    if (isSymbol(tokens[index - 1], '.') || isSymbol(tokens[index - 1], ':')) {
      continue;
    }
    const after = matchName(tokens, index, parts);
    if (after < 0 || !isSymbol(tokens[after], '=')) {
      continue;
    }
    const value = tokens[after + 1];
    if (isName(value, 'function')) {
      return functionPiece(text, tokens, after + 1);
    }
    if (isSymbol(value, '{')) {
      const end = tableEnd(tokens, after + 1);
      return end < 0 ? null : { tokens: tokens.slice(after + 1, end + 1), body: null };
    }
  }
  return null;
}

function sameTokens(tokens: readonly LuaToken[], at: number, wanted: readonly LuaToken[]): boolean {
  return wanted.every((token, offset) => {
    const other = tokens[at + offset];
    return other !== undefined && other.kind === token.kind && 'value' in other && 'value' in token && other.value === token.value;
  });
}

/** The code from the first place `from` stands to the end of the next `to` after it, both Lua snippets. */
export function findLuaSpan(source: string, from: string, to: string): LuaPiece | null {
  const tokens = tokenizeLua(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  const start = tokenizeLua(from).filter((token) => token.kind !== 'eof');
  const finish = tokenizeLua(to).filter((token) => token.kind !== 'eof');
  const first = tokens.findIndex((_, index) => sameTokens(tokens, index, start));
  if (first < 0) {
    return null;
  }
  const last = tokens.findIndex((_, index) => index >= first + start.length && sameTokens(tokens, index, finish));
  return last < 0 ? null : { tokens: tokens.slice(first, last + finish.length), body: null };
}

function tokenText(token: LuaToken): string {
  switch (token.kind) {
    case 'string':
      return JSON.stringify(token.value);
    case 'number':
      return String(token.value);
    case 'eof':
      return '';
    default:
      return token.value;
  }
}

/** sha256 of the tokens alone: comments, spaces, line breaks and the way a string is quoted do not count. */
export function luaFingerprint(tokens: readonly LuaToken[]): string {
  return createHash('sha256')
    .update(tokens.filter((token) => token.kind !== 'eof').map(tokenText).join(' '))
    .digest('hex');
}
