// What the renderer may send to the StoneMap API. Generation requests and adjustment drafts are checked by the API
// itself, which rejects unknown fields; here they only have to be plain JSON of a bounded size.

import {
  STONEMAP_MAX_JOBS,
  STONEMAP_MAX_REQUEST_BYTES,
  STONEMAP_PRESENTATION_LIMITS,
  STONEMAP_PREVIEW_SIZE,
  type MapPresentation,
  type PreviewOptions,
} from '../../shared/contract.ts';
import type { PreviewKind, PreviewQuality } from '../../shared/stoneMap/contracts.ts';
import { t } from '../i18n.ts';
import { InvalidInputError } from '../validation.ts';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEPTH = 32;
const PREVIEW_KINDS: readonly PreviewKind[] = ['map', 'terrain', 'resources', 'heightmap', 'textures'];
const PREVIEW_QUALITIES: readonly PreviewQuality[] = ['low', 'medium', 'high', 'ultra'];
const PREVIEW_FLAGS = ['markers', 'contours', 'reclaim', 'waterContours', 'waterSurface'] as const;

function invalid(): InvalidInputError {
  return new InvalidInputError(t('main.validation.invalidRequest'));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJson(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  // A field the form left unset; writing the request out leaves it away.
  if (value === undefined) {
    return depth > 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (depth >= MAX_DEPTH) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJson(item, depth + 1));
  }
  return isPlainObject(value) && Object.values(value).every((item) => isJson(item, depth + 1));
}

/** A JSON object for the API: plain data, at most STONEMAP_MAX_REQUEST_BYTES when written out. */
export function parseStoneMapBody<T>(input: unknown): T {
  if (!isPlainObject(input) || !isJson(input, 0)) {
    throw invalid();
  }
  if (Buffer.byteLength(JSON.stringify(input)) > STONEMAP_MAX_REQUEST_BYTES) {
    throw invalid();
  }
  return input as T;
}

export function parseStoneMapJobId(input: unknown): string {
  if (typeof input !== 'string' || !JOB_ID.test(input)) {
    throw invalid();
  }
  return input.toLowerCase();
}

export function parseStoneMapJobLimit(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > STONEMAP_MAX_JOBS) {
    throw invalid();
  }
  return input;
}

export function parsePreviewOptions(input: unknown): PreviewOptions {
  if (!isPlainObject(input)) {
    throw invalid();
  }
  const options: PreviewOptions = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'kind' && PREVIEW_KINDS.includes(value as PreviewKind)) {
      options.kind = value as PreviewKind;
    } else if (key === 'quality' && PREVIEW_QUALITIES.includes(value as PreviewQuality)) {
      options.quality = value as PreviewQuality;
    } else if (key === 'size' && (value === null || (Number.isInteger(value) && (value as number) >= STONEMAP_PREVIEW_SIZE.min && (value as number) <= STONEMAP_PREVIEW_SIZE.max))) {
      options.size = value as number | null;
    } else if ((PREVIEW_FLAGS as readonly string[]).includes(key) && typeof value === 'boolean') {
      options[key as (typeof PREVIEW_FLAGS)[number]] = value;
    } else {
      throw invalid();
    }
  }
  return options;
}

function presentationText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw invalid();
  }
  return value;
}

/** The map's own name and description; empty or missing ones fall back to the generator's text. */
export function parsePresentation(input: unknown): MapPresentation {
  if (!isPlainObject(input) || Object.keys(input).some((key) => key !== 'name' && key !== 'description')) {
    throw invalid();
  }
  const name = presentationText(input.name, STONEMAP_PRESENTATION_LIMITS.name);
  const description = presentationText(input.description, STONEMAP_PRESENTATION_LIMITS.description);
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
  };
}
