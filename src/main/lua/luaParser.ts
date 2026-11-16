// Evaluator for the data-only Lua files shipped with maps and mods (`*_scenario.lua`, `mod_info.lua`).
// It understands assignments, literals, table constructors and simple operators. Calls such as `STRING('x')` that
// scenario files use for custom properties evaluate to their first argument. Control flow and function definitions are
// rejected: these files describe data and are never executed as code.
// The lenient mode reads data tables out of game scripts (`options.lua`, key maps). It skips function bodies and control
// flow without running them, calls only the functions passed in as globals, and turns what it cannot evaluate into nil.

import { t } from '../i18n.ts';

export type LuaValue = null | boolean | number | string | LuaTable | LuaFunction;
type LuaKey = string | number | boolean;

/** A function a chunk can call: one passed in `ParseOptions.globals`, or a skipped definition that returns nil. */
export class LuaFunction {
  readonly call: (args: LuaValue[]) => LuaValue;

  constructor(call: (args: LuaValue[]) => LuaValue) {
    this.call = call;
  }
}

const SKIPPED_FUNCTION = new LuaFunction(() => null);

export interface ParseOptions {
  lenient?: boolean;
  /** Globals set before the chunk runs, such as engine functions or variables a game script reads. */
  globals?: Iterable<[string, LuaValue]>;
}

export class LuaTable {
  private readonly entries = new Map<LuaKey, LuaValue>();

  get(key: LuaKey): LuaValue {
    return this.entries.get(key) ?? null;
  }

  set(key: LuaKey, value: LuaValue): void {
    if (value === null) {
      this.entries.delete(key);
    } else {
      this.entries.set(key, value);
    }
  }

  /** The border of the array part, like the `#` operator for tables without holes. */
  get length(): number {
    let length = 0;
    while (this.entries.has(length + 1)) {
      length++;
    }
    return length;
  }

  keys(): LuaKey[] {
    return [...this.entries.keys()];
  }
}

export class LuaParseError extends Error {}

type Token =
  | { kind: 'name'; value: string; pos: number }
  | { kind: 'string'; value: string; pos: number }
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'symbol'; value: string; pos: number }
  | { kind: 'eof'; pos: number };

const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

/** A name that can stand for a table key or a variable without brackets and quotes. */
export function isLuaName(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) && !KEYWORDS.has(text);
}

// `!=` is the inequality of the game's Lua dialect.
const SYMBOLS = ['...', '..', '==', '~=', '!=', '<=', '>=', '//', '::', '+', '-', '*', '/', '%', '^', '#', '<', '>', '=',
  '(', ')', '{', '}', '[', ']', ';', ':', ',', '.'];

/** Keywords that open a block closed by `end` (`repeat` is closed by `until`); `while` and `for` open it with `do`. */
const BLOCK_OPENERS = new Set(['function', 'if', 'do', 'repeat']);

const SIMPLE_ESCAPES: Record<string, string> = {
  a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n',
};

class Lexer {
  private readonly source: string;
  private pos = 0;

  constructor(source: string) {
    this.source = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) {
        tokens.push({ kind: 'eof', pos: this.pos });
        return tokens;
      }
      tokens.push(this.nextToken());
    }
  }

  fail(message: string, pos = this.pos): never {
    throw new LuaParseError(t('main.lua.atLine', { message, line: lineOf(this.source, pos) }));
  }

  private skipWhitespaceAndComments(): void {
    const src = this.source;
    while (this.pos < src.length) {
      const ch = src[this.pos]!;
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v') {
        this.pos++;
      } else if (src.startsWith('--', this.pos)) {
        this.pos += 2;
        const level = this.longBracketLevel();
        if (level >= 0) {
          this.readLongBracket(level);
        } else {
          while (this.pos < src.length && src[this.pos] !== '\n') {
            this.pos++;
          }
        }
      } else {
        return;
      }
    }
  }

  private nextToken(): Token {
    const src = this.source;
    const start = this.pos;
    const ch = src[start]!;

    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(start, start + 256))!;
      this.pos += match[0].length;
      return { kind: 'name', value: match[0], pos: start };
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[start + 1] ?? ''))) {
      return this.readNumber();
    }
    if (ch === '"' || ch === "'") {
      return { kind: 'string', value: this.readQuotedString(ch), pos: start };
    }
    if (ch === '[') {
      const level = this.longBracketLevel();
      if (level >= 0) {
        return { kind: 'string', value: this.readLongBracket(level), pos: start };
      }
    }
    const symbol = SYMBOLS.find((candidate) => src.startsWith(candidate, start));
    if (!symbol) {
      this.fail(t('main.lua.unexpectedChar', { char: ch }));
    }
    this.pos += symbol.length;
    return { kind: 'symbol', value: symbol, pos: start };
  }

  private readNumber(): Token {
    const start = this.pos;
    const rest = this.source.slice(start, start + 128);
    const hex = /^0[xX][0-9a-fA-F]+/.exec(rest);
    if (hex) {
      this.pos += hex[0].length;
      return { kind: 'number', value: Number.parseInt(hex[0].slice(2), 16), pos: start };
    }
    const decimal = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (!decimal) {
      this.fail(t('main.lua.invalidNumber'));
    }
    this.pos += decimal[0].length;
    return { kind: 'number', value: Number(decimal[0]), pos: start };
  }

  private readQuotedString(quote: string): string {
    const src = this.source;
    const start = this.pos;
    this.pos++;
    let result = '';
    while (this.pos < src.length) {
      const ch = src[this.pos]!;
      if (ch === quote) {
        this.pos++;
        return result;
      }
      if (ch === '\n') {
        break;
      }
      if (ch !== '\\') {
        result += ch;
        this.pos++;
        continue;
      }
      const escape = src[this.pos + 1] ?? '';
      this.pos += 2;
      if (Object.hasOwn(SIMPLE_ESCAPES, escape)) {
        result += SIMPLE_ESCAPES[escape]!;
      } else if (escape === '\r') {
        result += '\n';
        if (src[this.pos] === '\n') {
          this.pos++;
        }
      } else if (/[0-9]/.test(escape)) {
        const digits = /^[0-9]{0,2}/.exec(src.slice(this.pos, this.pos + 2))![0];
        result += String.fromCharCode(Number(escape + digits));
        this.pos += digits.length;
      } else {
        // The game's Lua 5.0 keeps any other character as it is. Game.prefs depends on it: the game saves a byte above
        // 0x7f as a negative number (`\-48`) and reads that back as the text `-48`.
        result += escape;
      }
    }
    this.fail(t('main.lua.unclosedString'), start);
  }

  /** Returns the level of a long bracket (`[[`, `[==[`) at the current position, or -1. */
  private longBracketLevel(): number {
    const match = /^\[(=*)\[/.exec(this.source.slice(this.pos, this.pos + 64));
    return match ? match[1]!.length : -1;
  }

  private readLongBracket(level: number): string {
    const start = this.pos;
    this.pos += level + 2;
    if (this.source[this.pos] === '\r') {
      this.pos++;
    }
    if (this.source[this.pos] === '\n') {
      this.pos++;
    }
    const close = `]${'='.repeat(level)}]`;
    const end = this.source.indexOf(close, this.pos);
    if (end < 0) {
      this.fail(t('main.lua.unclosedLongString'), start);
    }
    const content = this.source.slice(this.pos, end);
    this.pos = end + close.length;
    return content;
  }
}

function lineOf(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

type Reference = { kind: 'global'; name: string } | { kind: 'field'; table: LuaTable; key: LuaKey } | { kind: 'value'; value: LuaValue };

const NIL_REFERENCE: Reference = { kind: 'value', value: null };

// Left and right binding power of binary operators, as in the reference Lua implementation.
const BINARY_PRIORITY = new Map<string, [left: number, right: number]>([
  ['or', [1, 1]],
  ['and', [2, 2]],
  ['<', [3, 3]], ['>', [3, 3]], ['<=', [3, 3]], ['>=', [3, 3]], ['~=', [3, 3]], ['!=', [3, 3]], ['==', [3, 3]],
  ['..', [9, 8]],
  ['+', [10, 10]], ['-', [10, 10]],
  ['*', [11, 11]], ['/', [11, 11]], ['//', [11, 11]], ['%', [11, 11]],
  ['^', [14, 13]],
]);
const UNARY_PRIORITY = 12;

function isTruthy(value: LuaValue): boolean {
  return value !== null && value !== false;
}

class Parser {
  private readonly lexer: Lexer;
  private readonly tokens: Token[];
  private readonly lenient: boolean;
  private index = 0;
  readonly globals: Map<string, LuaValue>;

  constructor(source: string, options: ParseOptions) {
    this.lexer = new Lexer(source);
    this.tokens = this.lexer.tokenize();
    this.lenient = options.lenient ?? false;
    this.globals = new Map(options.globals);
  }

  parseChunk(): void {
    while (this.peek().kind !== 'eof') {
      if (this.acceptSymbol(';')) {
        continue;
      }
      this.statement();
    }
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.peek();
    this.index = Math.min(this.index + 1, this.tokens.length - 1);
    return token;
  }

  private isSymbol(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'symbol' && token.value === value;
  }

  private isKeyword(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'name' && token.value === value;
  }

  private acceptSymbol(value: string): boolean {
    if (this.isSymbol(value)) {
      this.next();
      return true;
    }
    return false;
  }

  private expectSymbol(value: string): void {
    if (!this.acceptSymbol(value)) {
      this.fail(t('main.lua.expectedSymbol', { symbol: value }));
    }
  }

  private expectName(): string {
    const token = this.next();
    if (token.kind !== 'name' || KEYWORDS.has(token.value)) {
      this.fail(t('main.lua.expectedName'), token.pos);
    }
    return token.value;
  }

  private fail(message: string, pos = this.peek().pos): never {
    this.lexer.fail(message, pos);
  }

  /** In the lenient mode a value that cannot be evaluated is nil; otherwise the chunk is rejected. */
  private invalid(message: string, pos?: number): null {
    if (this.lenient) {
      return null;
    }
    return this.fail(message, pos);
  }

  private statement(): void {
    const token = this.peek();
    if (token.kind === 'name' && token.value === 'local') {
      this.next();
      if (this.lenient && this.isKeyword('function')) {
        const name = this.peek(1);
        this.skipBlock();
        if (name.kind === 'name') {
          this.globals.set(name.value, SKIPPED_FUNCTION);
        }
        return;
      }
      const names = [this.expectName()];
      while (this.acceptSymbol(',')) {
        names.push(this.expectName());
      }
      const values = this.acceptSymbol('=') ? this.expressionList() : [];
      names.forEach((name, i) => this.globals.set(name, values[i] ?? null));
      return;
    }
    if (token.kind === 'name' && KEYWORDS.has(token.value)) {
      if (!this.lenient || !this.skipKeywordStatement(token.value)) {
        this.fail(t('main.lua.unsupportedKeyword', { keyword: token.value }));
      }
      return;
    }

    const targets = [this.suffixedExpression()];
    if (!this.isSymbol('=') && !this.isSymbol(',')) {
      if (targets[0]!.kind !== 'value') {
        this.fail(t('main.lua.expectedAssignment'));
      }
      return;
    }
    while (this.acceptSymbol(',')) {
      targets.push(this.suffixedExpression());
    }
    this.expectSymbol('=');
    const values = this.expressionList();
    targets.forEach((target, i) => this.assign(target, values[i] ?? null));
  }

  /** Skips a function definition or a control statement without running it; false for a keyword that starts none. */
  private skipKeywordStatement(keyword: string): boolean {
    switch (keyword) {
      case 'function': {
        // Only `function name()` defines a global; `function a.b()` and `function a:b()` change tables it never built.
        const name = this.peek(1);
        const global = this.isSymbol('(', 2);
        this.skipBlock();
        if (name.kind === 'name' && global) {
          this.globals.set(name.value, SKIPPED_FUNCTION);
        }
        return true;
      }
      case 'if':
      case 'while':
      case 'for':
      case 'do':
      case 'repeat':
        this.skipBlock();
        return true;
      case 'return':
        this.next();
        if (this.peek().kind !== 'eof' && !this.isSymbol(';')) {
          this.expressionList();
        }
        return true;
      case 'break':
        this.next();
        return true;
      default:
        return false;
    }
  }

  /** Skips tokens up to the `end` (or `until` and its condition) that closes the block opened at the current token. */
  private skipBlock(): void {
    let depth = 0;
    for (;;) {
      const token = this.next();
      if (token.kind === 'eof') {
        this.fail(t('main.lua.unclosedBlock'), token.pos);
      }
      if (token.kind !== 'name') {
        continue;
      }
      if (BLOCK_OPENERS.has(token.value)) {
        depth++;
      } else if (token.value === 'end' || token.value === 'until') {
        depth--;
        if (depth <= 0) {
          if (token.value === 'until') {
            this.expression();
          }
          return;
        }
      }
    }
  }

  private assign(target: Reference, value: LuaValue): void {
    if (target.kind === 'global') {
      this.globals.set(target.name, value);
    } else if (target.kind === 'field') {
      target.table.set(target.key, value);
    } else {
      this.invalid(t('main.lua.assignToExpression'));
    }
  }

  private deref(reference: Reference): LuaValue {
    switch (reference.kind) {
      case 'global':
        return this.globals.get(reference.name) ?? null;
      case 'field':
        return reference.table.get(reference.key);
      case 'value':
        return reference.value;
    }
  }

  private expressionList(): LuaValue[] {
    const values = [this.expression()];
    while (this.acceptSymbol(',')) {
      values.push(this.expression());
    }
    return values;
  }

  private expression(limit = 0): LuaValue {
    let left: LuaValue;
    const unaryOperator = this.operatorAt(this.peek());
    if (unaryOperator === '-' || unaryOperator === '#' || unaryOperator === 'not') {
      this.next();
      left = this.unary(unaryOperator, this.expression(UNARY_PRIORITY));
    } else {
      left = this.simpleExpression();
    }

    for (;;) {
      const operatorToken = this.peek();
      const operator = this.operatorAt(operatorToken);
      const priority = operator ? BINARY_PRIORITY.get(operator) : undefined;
      if (!operator || !priority || priority[0] <= limit) {
        return left;
      }
      this.next();
      const right = this.expression(priority[1]);
      left = this.binary(operator, left, right, operatorToken.pos);
    }
  }

  private operatorAt(token: Token): string | null {
    return token.kind === 'symbol' || token.kind === 'name' ? token.value : null;
  }

  private unary(operator: string, operand: LuaValue): LuaValue {
    switch (operator) {
      case 'not':
        return !isTruthy(operand);
      case '-': {
        const number = this.toNumber(operand);
        return number === null ? null : -number;
      }
      default:
        if (typeof operand === 'string') {
          return operand.length;
        }
        if (operand instanceof LuaTable) {
          return operand.length;
        }
        return this.invalid(t('main.lua.invalidLength'));
    }
  }

  private binary(operator: string, left: LuaValue, right: LuaValue, pos: number): LuaValue {
    switch (operator) {
      case 'and':
        return isTruthy(left) ? right : left;
      case 'or':
        return isTruthy(left) ? left : right;
      case '==':
        return left === right;
      case '~=':
      case '!=':
        return left !== right;
      case '..':
        if ((typeof left !== 'string' && typeof left !== 'number') || (typeof right !== 'string' && typeof right !== 'number')) {
          return this.invalid(t('main.lua.invalidConcatenation'), pos);
        }
        return `${left}${right}`;
      case '<':
      case '>':
      case '<=':
      case '>=': {
        if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) {
          return this.invalid(t('main.lua.invalidComparison'), pos);
        }
        const a = left;
        const b = right as number | string;
        return operator === '<' ? a < b : operator === '>' ? a > b : operator === '<=' ? a <= b : a >= b;
      }
      default: {
        const a = this.toNumber(left);
        const b = this.toNumber(right);
        if (a === null || b === null) {
          return null;
        }
        switch (operator) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            return a / b;
          case '//':
            return Math.floor(a / b);
          case '%':
            return a - Math.floor(a / b) * b;
          default:
            return a ** b;
        }
      }
    }
  }

  /** The operand of arithmetic as a number; null when it is none, which only the lenient mode lets through. */
  private toNumber(value: LuaValue): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
    if (Number.isNaN(number)) {
      return this.invalid(t('main.lua.invalidArithmetic'));
    }
    return number;
  }

  private simpleExpression(): LuaValue {
    const token = this.peek();
    switch (token.kind) {
      case 'number':
      case 'string':
        this.next();
        return token.value;
      case 'name':
        if (token.value === 'nil' || token.value === 'true' || token.value === 'false') {
          this.next();
          return token.value === 'nil' ? null : token.value === 'true';
        }
        if (token.value === 'function' && this.lenient) {
          this.skipBlock();
          return SKIPPED_FUNCTION;
        }
        break;
      case 'symbol':
        if (token.value === '{') {
          return this.tableConstructor();
        }
        if (token.value === '...' && this.lenient) {
          this.next();
          return null;
        }
        break;
      default:
        break;
    }
    return this.deref(this.suffixedExpression());
  }

  private suffixedExpression(): Reference {
    let reference: Reference;
    if (this.acceptSymbol('(')) {
      reference = { kind: 'value', value: this.expression() };
      this.expectSymbol(')');
    } else {
      reference = { kind: 'global', name: this.expectName() };
    }

    for (;;) {
      if (this.acceptSymbol('.')) {
        reference = this.field(reference, this.expectName());
      } else if (this.acceptSymbol('[')) {
        const key = this.expression();
        this.expectSymbol(']');
        reference = this.field(reference, key);
      } else if (this.acceptSymbol(':')) {
        const method = this.expectName();
        const self = this.deref(reference);
        const args = this.callArguments();
        const callee = self instanceof LuaTable ? self.get(method) : null;
        reference = { kind: 'value', value: this.call(callee, [self, ...args], args[0] ?? null) };
      } else if (this.isSymbol('(') || this.isSymbol('{') || this.peek().kind === 'string') {
        const callee = this.deref(reference);
        const args = this.callArguments();
        reference = { kind: 'value', value: this.call(callee, args, args[0] ?? null) };
      } else {
        return reference;
      }
    }
  }

  /** `dataValue` is what a data file means by a call such as `STRING('x')`: its first argument. */
  private call(callee: LuaValue, args: LuaValue[], dataValue: LuaValue): LuaValue {
    if (callee instanceof LuaFunction) {
      return callee.call(args);
    }
    return this.lenient ? null : dataValue;
  }

  private field(reference: Reference, key: LuaValue): Reference {
    const table = this.deref(reference);
    if (!(table instanceof LuaTable)) {
      return this.invalid(t('main.lua.fieldOfNonTable')) ?? NIL_REFERENCE;
    }
    if (key === null || key instanceof LuaTable || key instanceof LuaFunction) {
      return this.invalid(t('main.lua.invalidKey')) ?? NIL_REFERENCE;
    }
    return { kind: 'field', table, key };
  }

  private callArguments(): LuaValue[] {
    const token = this.peek();
    if (token.kind === 'string') {
      this.next();
      return [token.value];
    }
    if (this.isSymbol('{')) {
      return [this.tableConstructor()];
    }
    this.expectSymbol('(');
    if (this.acceptSymbol(')')) {
      return [];
    }
    const args = this.expressionList();
    this.expectSymbol(')');
    return args;
  }

  private tableConstructor(): LuaTable {
    this.expectSymbol('{');
    const table = new LuaTable();
    let arrayIndex = 0;
    while (!this.isSymbol('}')) {
      if (this.acceptSymbol('[')) {
        const key = this.expression();
        this.expectSymbol(']');
        this.expectSymbol('=');
        const value = this.expression();
        if (key === null || key instanceof LuaTable || key instanceof LuaFunction) {
          this.invalid(t('main.lua.invalidKey'));
        } else {
          table.set(key, value);
        }
      } else if (this.peek().kind === 'name' && this.isSymbol('=', 1)) {
        const name = this.expectName();
        this.next();
        table.set(name, this.expression());
      } else {
        table.set(++arrayIndex, this.expression());
      }
      if (!this.acceptSymbol(',') && !this.acceptSymbol(';')) {
        break;
      }
    }
    this.expectSymbol('}');
    return table;
  }
}

/** Evaluates a data-only Lua chunk (or a game script, in the lenient mode) and returns its global variables. */
export function parseLua(source: string, options: ParseOptions = {}): Map<string, LuaValue> {
  const parser = new Parser(source, options);
  parser.parseChunk();
  return parser.globals;
}

export type LuaToken = Token;

/** The tokens of a chunk without its comments, for code that cuts or compares scripts instead of evaluating them. */
export function tokenizeLua(source: string): LuaToken[] {
  return new Lexer(source).tokenize();
}

export function luaString(value: LuaValue): string | null {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' ? String(value) : null;
}

export function luaTable(value: LuaValue): LuaTable | null {
  return value instanceof LuaTable ? value : null;
}

/** Follows nested table keys, returning nil as soon as a step is not a table. */
export function luaPath(value: LuaValue, ...keys: (string | number)[]): LuaValue {
  let current = value;
  for (const key of keys) {
    const table = luaTable(current);
    if (!table) {
      return null;
    }
    current = table.get(key);
  }
  return current;
}
