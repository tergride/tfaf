// The users of a channel with their mode prefixes (operator, voice, ...), as MODE and NAMES report them and as the
// server's ISUPPORT says to read those.

import type { ChannelRecord } from './chatChannel.ts';

/** ISUPPORT: which mode letters give which nick prefix, which channel modes take a parameter, which names are channels. */
export interface IrcSupport {
  prefixModes: Map<string, string>;
  modesWithParameter: { always: string; whenSet: string };
  channelTypes: string;
}

export function defaultSupport(): IrcSupport {
  return {
    prefixModes: new Map([
      ['q', '~'],
      ['a', '&'],
      ['o', '@'],
      ['h', '%'],
      ['v', '+'],
    ]),
    modesWithParameter: { always: 'beIk', whenSet: 'fl' },
    channelTypes: '#&',
  };
}

/** Takes in the tokens of the server's 005 (RPL_ISUPPORT) reply. */
export function applySupport(support: IrcSupport, tokens: string[]): void {
  for (const token of tokens) {
    const [key, value = ''] = token.split('=', 2);
    if (key === 'PREFIX') {
      const match = /^\(([^)]*)\)(.*)$/.exec(value);
      if (match && match[1]!.length === match[2]!.length) {
        support.prefixModes = new Map([...match[1]!].map((mode, index) => [mode, match[2]![index]!]));
      }
    } else if (key === 'CHANMODES') {
      const [list = '', always = '', whenSet = ''] = value.split(',');
      support.modesWithParameter = { always: list + always, whenSet };
    } else if (key === 'CHANTYPES' && value) {
      support.channelTypes = value;
    }
  }
}

/** Applies a channel MODE change to the prefixes of its users; true when one of them changed. */
export function applyModes(channel: ChannelRecord, modes: string, args: string[], support: IrcSupport): boolean {
  let adding = true;
  let changed = false;
  for (const mode of modes) {
    if (mode === '+' || mode === '-') {
      adding = mode === '+';
      continue;
    }
    const prefix = support.prefixModes.get(mode);
    const takesParameter =
      prefix !== undefined || support.modesWithParameter.always.includes(mode) || (adding && support.modesWithParameter.whenSet.includes(mode));
    const parameter = takesParameter ? args.shift() : undefined;
    if (prefix === undefined || !parameter) {
      continue;
    }
    const user = channel.users.get(parameter.toLowerCase());
    if (user) {
      user.prefixes = adding ? orderPrefixes(user.prefixes + prefix, support) : user.prefixes.replaceAll(prefix, '');
      changed = true;
    }
  }
  return changed;
}

/** Adds the users of a NAMES line, each with the prefixes in front of the nick. */
export function addNames(channel: ChannelRecord, names: string, support: IrcSupport): void {
  const prefixChars = new Set(support.prefixModes.values());
  for (const entry of names.split(' ')) {
    let index = 0;
    while (index < entry.length && prefixChars.has(entry[index]!)) {
      index++;
    }
    const nick = entry.slice(index).split('!')[0];
    if (nick) {
      channel.users.set(nick.toLowerCase(), { nick, prefixes: entry.slice(0, index), away: false });
    }
  }
}

function orderPrefixes(prefixes: string, support: IrcSupport): string {
  return [...support.prefixModes.values()].filter((prefix) => prefixes.includes(prefix)).join('');
}
