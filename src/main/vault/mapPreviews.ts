// Map generators (Neroxis, StoneMap) put a picture of the map into its folder as `<folder>_preview.png`, and the content
// server has no preview of such maps (MapService.getGeneratedMapPreview of the official client). The renderer loads that
// picture by its own scheme, which serves it from the maps folder only.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isSafeFolderName } from './fsUtil.ts';

export const MAP_PREVIEW_SCHEME = 'tfaf-map-preview';
const HOST = 'maps';

export function localPreviewFileName(folderName: string): string {
  return `${folderName}_preview.png`;
}

export function localPreviewUrl(folderName: string): string {
  return `${MAP_PREVIEW_SCHEME}://${HOST}/${encodeURIComponent(folderName)}`;
}

function previewPath(mapsDirectory: string, folderName: string): string | null {
  return isSafeFolderName(folderName) ? path.join(mapsDirectory, folderName, localPreviewFileName(folderName)) : null;
}

/** The address of the map's own preview, when its folder in the maps folder has one. */
export function existingLocalPreviewUrl(mapsDirectory: string, folderName: string): string | null {
  const file = previewPath(mapsDirectory, folderName);
  return file && existsSync(file) ? localPreviewUrl(folderName) : null;
}

function folderNameOf(url: URL): string | null {
  if (url.protocol !== `${MAP_PREVIEW_SCHEME}:` || url.hostname !== HOST) {
    return null;
  }
  try {
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
}

export async function serveLocalPreview(mapsDirectory: string, request: Request): Promise<Response> {
  const folderName = request.method === 'GET' ? folderNameOf(new URL(request.url)) : null;
  const file = folderName === null ? null : previewPath(mapsDirectory, folderName);
  if (!file) {
    return new Response(null, { status: 404 });
  }
  try {
    const body = new Uint8Array(await readFile(file));
    // A map generated anew under the same name brings a new picture.
    return new Response(body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
