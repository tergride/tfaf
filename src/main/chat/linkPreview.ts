// Previews of links posted in the chat. They load only when the user asks: fetching every posted link would show its
// author the address of everyone reading. Only https pages and images on public hosts are fetched, within limits.

import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { LinkPreview } from '../../shared/contract.ts';
import { t } from '../i18n.ts';
import { decodeEntities } from '../info/html.ts';
import { fetchWithTimeout } from '../net/http.ts';

const TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
// SVG may carry scripts; the formats a browser shows without them are enough.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_TEXT_LENGTH = 300;

/** Loopback, private, link-local and other addresses that are not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) {
      return isPrivateAddress(lower.slice('::ffff:'.length));
    }
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:') {
    throw new Error(t('main.chat.preview.httpsOnly'));
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(t('main.chat.preview.privateNetwork'));
  }
}

async function readLimited(response: Response, maxBytes: number, truncate: boolean): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maxBytes) {
      if (!truncate) {
        throw new Error(t('main.chat.preview.tooLarge'));
      }
      chunks.push(buffer.subarray(0, buffer.length - (size - maxBytes)));
      break;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Follows redirects by hand, so every hop is checked before anything is sent to it. */
async function openPublic(url: URL, userAgent: string): Promise<{ type: string; response: Response }> {
  let current = url;
  for (let redirects = 0; ; redirects++) {
    await assertPublic(current);
    const response = await fetchWithTimeout(
      current,
      { redirect: 'manual', headers: { 'User-Agent': userAgent, Accept: 'text/html,image/*;q=0.9' } },
      TIMEOUT_MS,
    );
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      if (redirects >= MAX_REDIRECTS) {
        throw new Error('Ссылка перенаправляет слишком много раз');
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Сайт ответил ошибкой ${response.status}`);
    }
    return { type: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), response };
  }
}

async function fetchImage(url: URL, userAgent: string): Promise<string | null> {
  const { type, response } = await openPublic(url, userAgent);
  if (!IMAGE_TYPES.has(type)) {
    await response.body?.cancel();
    return null;
  }
  return dataUrl(type, await readLimited(response, MAX_IMAGE_BYTES, false));
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? decodeEntities(match[2] ?? match[3] ?? match[4] ?? '') : null;
}

function clip(text: string | null): string | null {
  const clean = text?.replace(/\s+/g, ' ').trim();
  return clean ? (clean.length > MAX_TEXT_LENGTH ? `${clean.slice(0, MAX_TEXT_LENGTH - 1)}…` : clean) : null;
}

/** Open Graph and plain HTML metadata of a page; the image address is resolved against the page. */
export function parseLinkMetadata(
  html: string,
  base: URL,
): { title: string | null; description: string | null; siteName: string | null; image: URL | null } {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attribute(match[0], 'property') ?? attribute(match[0], 'name'))?.toLowerCase();
    const content = attribute(match[0], 'content');
    if (key && content !== null && !meta.has(key)) {
      meta.set(key, content);
    }
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let image: URL | null = null;
  const imageAddress = meta.get('og:image') ?? meta.get('twitter:image');
  if (imageAddress) {
    try {
      image = new URL(imageAddress, base);
    } catch {
      image = null;
    }
  }
  return {
    title: clip(meta.get('og:title') ?? (title ? decodeEntities(title) : null)),
    description: clip(meta.get('og:description') ?? meta.get('description') ?? null),
    siteName: clip(meta.get('og:site_name') ?? null),
    image,
  };
}

function dataUrl(type: string, body: Buffer): string {
  return `data:${type};base64,${body.toString('base64')}`;
}

export async function fetchLinkPreview(address: string, userAgent: string): Promise<LinkPreview> {
  const url = new URL(address);
  const { type, response } = await openPublic(url, userAgent);
  if (IMAGE_TYPES.has(type)) {
    const image = dataUrl(type, await readLimited(response, MAX_IMAGE_BYTES, false));
    return { url: address, title: null, description: null, siteName: url.hostname, imageDataUrl: image };
  }
  if (type !== 'text/html' && type !== 'application/xhtml+xml') {
    await response.body?.cancel();
    throw new Error(t('main.chat.preview.unsupported'));
  }
  // The metadata sits in the head, so the start of a long page is enough.
  const metadata = parseLinkMetadata((await readLimited(response, MAX_PAGE_BYTES, true)).toString('utf8'), url);
  let imageDataUrl: string | null = null;
  if (metadata.image) {
    imageDataUrl = await fetchImage(metadata.image, userAgent).catch(() => null);
  }
  return {
    url: address,
    title: metadata.title,
    description: metadata.description,
    siteName: metadata.siteName ?? url.hostname,
    imageDataUrl,
  };
}
