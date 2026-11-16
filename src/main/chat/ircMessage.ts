// IRC lines with IRCv3 message tags (https://ircv3.net/specs/extensions/message-tags):
// `@tag=value;tag2 :nick!user@host COMMAND param param :trailing parameter`.

export interface IrcMessage {
  /** Tag values are unescaped; a tag without a value maps to ''. */
  tags: Map<string, string>;
  /** `nick!user@host` of a user or the name of a server. */
  source: string | null;
  /** Upper case; numerics stay digits. */
  command: string;
  params: string[];
}

const TAG_UNESCAPES: Record<string, string> = { ':': ';', s: ' ', '\\': '\\', r: '\r', n: '\n' };
const TAG_ESCAPES: Record<string, string> = { '\\': '\\\\', ';': '\\:', ' ': '\\s', '\r': '\\r', '\n': '\\n' };

function unescapeTag(value: string): string {
  return value.replace(/\\(.?)/gs, (_, next: string) => (next === '' ? '' : (TAG_UNESCAPES[next] ?? next)));
}

function escapeTag(value: string): string {
  return value.replace(/[\\; \r\n]/g, (char) => TAG_ESCAPES[char]!);
}

/** The nick of a `nick!user@host` source; servers have none. */
export function nickOf(source: string | null): string | null {
  if (!source) {
    return null;
  }
  const bang = source.indexOf('!');
  if (bang > 0) {
    return source.slice(0, bang);
  }
  return source.includes('.') ? null : source;
}

export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.replace(/[\r\n]+$/, '');
  const tags = new Map<string, string>();
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    if (end < 0) {
      return null;
    }
    for (const part of rest.slice(1, end).split(';')) {
      if (part) {
        const equals = part.indexOf('=');
        tags.set(equals < 0 ? part : part.slice(0, equals), equals < 0 ? '' : unescapeTag(part.slice(equals + 1)));
      }
    }
    rest = rest.slice(end + 1).replace(/^ +/, '');
  }
  let source: string | null = null;
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    if (end < 0) {
      return null;
    }
    source = rest.slice(1, end);
    rest = rest.slice(end + 1).replace(/^ +/, '');
  }
  let command = '';
  const params: string[] = [];
  while (rest.length > 0) {
    if (command && rest.startsWith(':')) {
      params.push(rest.slice(1));
      break;
    }
    const end = rest.indexOf(' ');
    const word = end < 0 ? rest : rest.slice(0, end);
    if (command) {
      params.push(word);
    } else {
      command = word.toUpperCase();
    }
    rest = end < 0 ? '' : rest.slice(end + 1).replace(/^ +/, '');
  }
  return command ? { tags, source, command, params } : null;
}

/**
 * One line to send. Only the last parameter may contain spaces; no parameter may contain a line break, which would let
 * text from the user start a command of its own.
 */
export function formatIrcLine(command: string, params: string[] = [], tags: Record<string, string> = {}): string {
  if (!/^[A-Za-z0-9]+$/.test(command)) {
    throw new Error(`Invalid IRC command: ${command}`);
  }
  params.forEach((param, index) => {
    if (/[\r\n\0]/.test(param)) {
      throw new Error('IRC parameters cannot contain line breaks');
    }
    if (index < params.length - 1 && (param === '' || param.includes(' ') || param.startsWith(':'))) {
      throw new Error(`Invalid IRC parameter: ${param}`);
    }
  });
  const tagText = Object.entries(tags)
    .map(([key, value]) => (value === '' ? key : `${key}=${escapeTag(value)}`))
    .join(';');
  const last = params.at(-1);
  const trailing = last !== undefined && (last === '' || last.includes(' ') || last.startsWith(':'));
  const words = trailing ? [...params.slice(0, -1), `:${last}`] : params;
  return `${tagText ? `@${tagText} ` : ''}${[command, ...words].join(' ')}`;
}
