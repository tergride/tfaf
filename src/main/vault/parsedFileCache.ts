import { stat } from 'node:fs/promises';

/**
 * What was parsed from a vault file (a map scenario, a mod_info.lua), reused while the file keeps its size and
 * modification time. Reading and parsing every file on each scan is what made large vaults slow.
 */
export class ParsedFileCache<T> {
  private readonly entries = new Map<string, { mtimeMs: number; size: number; value: T }>();

  /** `fresh` parses the file even when it looks unchanged; what starts a game never relies on size and time alone. */
  async get(file: string, parse: () => Promise<T>, fresh = false): Promise<T> {
    const info = await stat(file);
    const cached = this.entries.get(file);
    if (!fresh && cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.value;
    }
    const value = await parse();
    this.entries.set(file, { mtimeMs: info.mtimeMs, size: info.size, value });
    return value;
  }

  /** Forgets files that the last scan did not see, e.g. uninstalled maps. */
  retain(files: ReadonlySet<string>): void {
    for (const file of this.entries.keys()) {
      if (!files.has(file)) {
        this.entries.delete(file);
      }
    }
  }
}
