// FAF news, tournament and tutorial texts come as HTML. The renderer never injects remote HTML, so it gets plain text
// with paragraph breaks instead.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** Text of an HTML fragment: block ends become line breaks, tags go, entities are decoded, blank runs collapse. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cuts at a word boundary and marks the cut. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxLength * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Links and images from FAF content are only passed on when they are plain https URLs. */
export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

const GENERIC_LINK_TEXT = /^(here|link|this|click here|здесь|тут|ссылка)$/i;

/** Links of an HTML fragment, labelled by their text, or by their address when the text says nothing ("here"). */
export function extractLinks(html: string): { label: string; url: string }[] {
  const links = new Map<string, string>();
  for (const match of html.matchAll(/<a\b[^>]+?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    // Browsers drop tabs and line breaks in an address, and FAF texts have them, e.g. a line break before the quote.
    const url = httpsUrlOrNull(decodeEntities(match[1] ?? match[2] ?? '').replace(/[\t\n\r]/g, '').trim());
    if (!url || links.has(url)) {
      continue;
    }
    const text = htmlToText(match[3] ?? '').replace(/\s+/g, ' ');
    const { hostname, pathname } = new URL(url);
    const label = text && !GENERIC_LINK_TEXT.test(text) ? text : `${hostname}${pathname}`.replace(/\/$/, '');
    links.set(url, truncate(label, 80));
  }
  return [...links].map(([url, label]) => ({ label, url }));
}
