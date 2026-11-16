// Chat text as the message list shows it: links, emoticons and mentions of the user, never as HTML.
import emoticonGroups from '../assets/emoticons.json';

export interface Emoticon {
  /** The first one is what a reaction or the picker sends, as in the official client. */
  shortcodes: string[];
  src: string;
}

export interface EmoticonGroup {
  name: string;
  emoticons: Emoticon[];
}

export type ChatToken =
  | { kind: 'text'; text: string }
  | { kind: 'link'; url: string; https: boolean }
  | { kind: 'emoticon'; shortcode: string; src: string }
  | { kind: 'mention'; text: string };

// The emoticon set of the official FAF client (MIT): reactions from either client show up in both.
export const EMOTICON_GROUPS: EmoticonGroup[] = (emoticonGroups as { name: string; emoticons: { shortcodes: string[]; base64SvgContent: string }[] }[]).map(
  (group) => ({
    name: group.name,
    emoticons: group.emoticons.map((emoticon) => ({
      shortcodes: emoticon.shortcodes,
      src: `data:image/svg+xml;base64,${emoticon.base64SvgContent}`,
    })),
  }),
);

const EMOTICONS = new Map(EMOTICON_GROUPS.flatMap((group) => group.emoticons.flatMap((emoticon) => emoticon.shortcodes.map((code) => [code, emoticon.src] as const))));

export function emoticonSrc(shortcode: string): string | null {
  return EMOTICONS.get(shortcode) ?? null;
}

const LINK = /https?:\/\/[^\s<>"]+/gi;
// Closing punctuation after a link usually ends the sentence rather than the address.
const TRAILING = /[.,!?;:'")\]]+$/;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Shortcodes like ":)" are emoticons only as words of their own, not inside "http://".
const EMOTICON_PATTERN = new RegExp(
  `(?<=^|\\s)(${[...EMOTICONS.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?=\\s|$)`,
  'g',
);

function splitEmoticons(text: string, mention: RegExp | null): ChatToken[] {
  const tokens: ChatToken[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOTICON_PATTERN)) {
    if (match.index > last) {
      tokens.push(...splitMentions(text.slice(last, match.index), mention));
    }
    tokens.push({ kind: 'emoticon', shortcode: match[0], src: EMOTICONS.get(match[0])! });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    tokens.push(...splitMentions(text.slice(last), mention));
  }
  return tokens;
}

function splitMentions(text: string, mention: RegExp | null): ChatToken[] {
  if (!mention) {
    return [{ kind: 'text', text }];
  }
  const tokens: ChatToken[] = [];
  let last = 0;
  for (const match of text.matchAll(mention)) {
    if (match.index > last) {
      tokens.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    tokens.push({ kind: 'mention', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    tokens.push({ kind: 'text', text: text.slice(last) });
  }
  return tokens;
}

export function tokenize(text: string, nick: string | null): ChatToken[] {
  const mention = nick ? new RegExp(`(?<![A-Za-z0-9_-])@?${escapeRegExp(nick)}(?![A-Za-z0-9_-])`, 'gi') : null;
  const tokens: ChatToken[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const url = match[0].replace(TRAILING, '');
    if (match.index > last) {
      tokens.push(...splitEmoticons(text.slice(last, match.index), mention));
    }
    tokens.push({ kind: 'link', url, https: url.toLowerCase().startsWith('https://') });
    last = match.index + url.length;
  }
  if (last < text.length) {
    tokens.push(...splitEmoticons(text.slice(last), mention));
  }
  return tokens;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
