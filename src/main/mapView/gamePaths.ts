// Paths inside the game's virtual file system, such as `/env/evergreen/layers/eg_grass001_albedo.dds`. The game
// ignores case and accepts backslashes; these helpers bring paths from maps and blueprints to one form.

const MAX_GAME_PATH = 512;

/** `/a/b.dds` with forward slashes and `..` resolved, or null for a path that leaves the root, names a drive or is empty. */
export function normalizeGamePath(raw: string): string | null {
  const parts: string[] = [];
  for (const part of raw.trim().replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.pop() === undefined) {
        return null;
      }
      continue;
    }
    if (part.includes(':') || part.includes('\0')) {
      return null;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    return null;
  }
  const normalized = `/${parts.join('/')}`;
  return normalized.length <= MAX_GAME_PATH ? normalized : null;
}

/** A path relative to the file `base` is in, as blueprints name their textures; absolute ones stay as they are. */
export function resolveGamePath(base: string, raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/');
  if (trimmed.startsWith('/')) {
    return normalizeGamePath(trimmed);
  }
  return normalizeGamePath(`${base.slice(0, base.lastIndexOf('/') + 1)}${trimmed}`);
}

/** The key the game would find a file by. */
export function gamePathKey(gamePath: string): string {
  return gamePath.toLowerCase();
}
