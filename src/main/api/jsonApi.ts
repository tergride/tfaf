// Minimal JSON:API (Elide) document reader: inlines `included` resources into their relationships so mappers can
// work with plain nested objects. Everything coming from the network is treated as untrusted and narrowed explicitly.

import { mapLimited } from '../concurrency.ts';
import { t } from '../i18n.ts';

/** A resolved resource. The JSON:API type is kept under `$type` because FAF resources have a `type` attribute. */
export interface Resource {
  id: string;
  $type: string;
  [field: string]: unknown;
}

export interface ResolvedDocument {
  items: Resource[];
  totalPages: number | null;
  totalRecords: number | null;
}

interface RawResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, unknown>;
}

const MAX_DEPTH = 3;
// A thousand resources: of the longest lists, such as coop results, only the start is shown.
const MAX_LIST_PAGES = 10;
const PAGE_CONCURRENCY = 6;

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

function toRawResource(value: unknown): RawResource | null {
  const raw = asObject(value);
  if (!raw || typeof raw.type !== 'string' || (typeof raw.id !== 'string' && typeof raw.id !== 'number')) {
    return null;
  }
  return {
    id: String(raw.id),
    type: raw.type,
    attributes: asObject(raw.attributes) ?? {},
    relationships: asObject(raw.relationships) ?? {},
  };
}

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

export function resolveDocument(document: unknown): ResolvedDocument {
  const root = asObject(document);
  if (!root) {
    throw new Error(t('main.api.invalidResponse'));
  }
  const data = Array.isArray(root.data) ? root.data : root.data == null ? [] : [root.data];
  const primary = data.map(toRawResource).filter((resource): resource is RawResource => resource !== null);
  const included = (Array.isArray(root.included) ? root.included : [])
    .map(toRawResource)
    .filter((resource): resource is RawResource => resource !== null);

  const index = new Map<string, RawResource>();
  for (const resource of [...included, ...primary]) {
    index.set(key(resource.type, resource.id), resource);
  }

  const resolveIdentifier = (identifier: unknown, depth: number): Resource | null => {
    const ref = toRawResource(identifier);
    if (!ref) {
      return null;
    }
    const found = index.get(key(ref.type, ref.id));
    return found && depth < MAX_DEPTH ? resolve(found, depth + 1) : { id: ref.id, $type: ref.type };
  };

  const resolve = (resource: RawResource, depth: number): Resource => {
    const result: Resource = { ...resource.attributes, id: resource.id, $type: resource.type };
    for (const [name, relationship] of Object.entries(resource.relationships)) {
      const linkage = asObject(relationship)?.data;
      result[name] = Array.isArray(linkage)
        ? linkage.map((item) => resolveIdentifier(item, depth)).filter((item) => item !== null)
        : resolveIdentifier(linkage, depth);
    }
    return result;
  };

  const page = asObject(asObject(root.meta)?.page);
  return {
    items: primary.map((resource) => resolve(resource, 0)),
    totalPages: asNumber(page?.totalPages),
    totalRecords: asNumber(page?.totalRecords),
  };
}

/**
 * A whole list as one document, so a resource can reach what another page included. The API cuts `page[size]` down to
 * a hundred without saying so, which leaves pages as the only way past that, as in the official client's getAll.
 */
export async function readAllPages(readPage: (number: number) => Promise<unknown>): Promise<unknown> {
  const first = await readPage(1);
  const totalPages = Math.min(resolveDocument(first).totalPages ?? 1, MAX_LIST_PAGES);
  const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
  const pages = [first, ...(await mapLimited(pageNumbers, PAGE_CONCURRENCY, readPage))];
  const member = (name: 'data' | 'included'): unknown[] =>
    pages.flatMap((page) => {
      const list: unknown = asObject(page)?.[name];
      return Array.isArray(list) ? (list as unknown[]) : [];
    });
  return { data: member('data'), included: member('included') };
}
