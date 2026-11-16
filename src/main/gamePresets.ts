// Create-game presets and the last state of the create-game form, kept in a JSON file next to the settings.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HOST_GAME_LIMITS, type HostGameDraft, type HostGamePreset, type HostGamePresets } from '../shared/contract.ts';
import { t } from './i18n.ts';

const MAX_FEATURED_MOD_LENGTH = 64;
const MAX_MAP_FOLDER_LENGTH = 255;
const MAX_MOD_UIDS = 1000;
const MAX_UID_LENGTH = 256;
const MAX_ID_LENGTH = 64;
const FEATURED_MOD = /^[a-z0-9_]*$/i;

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/** undefined marks an invalid value; null is a valid "no limit". */
function parseRating(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= HOST_GAME_LIMITS.ratingMax
    ? value
    : undefined;
}

function parseUids(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_MOD_UIDS) {
    return null;
  }
  const uids: string[] = [];
  for (const uid of value) {
    if (typeof uid !== 'string' || uid.length === 0 || uid.length > MAX_UID_LENGTH) {
      return null;
    }
    uids.push(uid);
  }
  return [...new Set(uids)];
}

/**
 * Checks the shape and size of a draft; null when it is malformed. Whether the draft can be hosted (ASCII title, a
 * map, min rating below max) is checked only when the game is created.
 */
export function parseHostGameDraft(input: unknown): HostGameDraft | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const { title, password, featuredMod, mapFolderName, friendsOnly, enforceRatingRange } = raw;
  const modUids = parseUids(raw.modUids);
  const ratingMin = parseRating(raw.ratingMin);
  const ratingMax = parseRating(raw.ratingMax);
  // Drafts saved before mod isolation became a setting get its default, off.
  const modIsolation = raw.modIsolation ?? false;
  // So do those saved before the choice of the lobby: the game's own one.
  const lobbyMode = raw.lobbyMode ?? 'faf';
  if (
    !isText(title, HOST_GAME_LIMITS.titleMaxLength) ||
    !isText(password, HOST_GAME_LIMITS.passwordMaxLength) ||
    !isText(featuredMod, MAX_FEATURED_MOD_LENGTH) ||
    !FEATURED_MOD.test(featuredMod) ||
    !isText(mapFolderName, MAX_MAP_FOLDER_LENGTH) ||
    typeof friendsOnly !== 'boolean' ||
    typeof enforceRatingRange !== 'boolean' ||
    typeof modIsolation !== 'boolean' ||
    (lobbyMode !== 'faf' && lobbyMode !== 'tfaf') ||
    modUids === null ||
    ratingMin === undefined ||
    ratingMax === undefined
  ) {
    return null;
  }
  return {
    title,
    password,
    featuredMod,
    mapFolderName,
    modUids,
    friendsOnly,
    ratingMin,
    ratingMax,
    enforceRatingRange,
    modIsolation,
    lobbyMode,
  };
}

export function parsePresetName(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const name = input.trim();
  return name.length > 0 && name.length <= HOST_GAME_LIMITS.presetNameMaxLength ? name : null;
}

function parsePreset(input: unknown): HostGamePreset | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const name = parsePresetName(raw.name);
  const draft = parseHostGameDraft(raw.draft);
  return typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= MAX_ID_LENGTH && name && draft
    ? { id: raw.id, name, draft }
    : null;
}

/** Keeps whatever is still valid in a stored file, so one damaged preset does not cost the others. */
export function parseStoredPresets(input: unknown): HostGamePresets {
  if (typeof input !== 'object' || input === null) {
    return { lastDraft: null, presets: [] };
  }
  const raw = input as Record<string, unknown>;
  const presets = Array.isArray(raw.presets)
    ? raw.presets
        .map(parsePreset)
        .filter((preset): preset is HostGamePreset => preset !== null)
        .slice(0, HOST_GAME_LIMITS.maxPresets)
    : [];
  return { lastDraft: parseHostGameDraft(raw.lastDraft), presets };
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, 'ru', { sensitivity: 'accent' }) === 0;
}

export class GamePresetStore {
  private readonly filePath: string;
  private data: HostGamePresets;
  private writing: Promise<void> = Promise.resolve();

  private constructor(filePath: string, data: HostGamePresets) {
    this.filePath = filePath;
    this.data = data;
  }

  static async load(filePath: string): Promise<GamePresetStore> {
    let content: string | null = null;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Game presets file is unreadable, starting without presets', error);
      }
    }
    let stored: unknown = null;
    if (content !== null) {
      try {
        stored = JSON.parse(content);
      } catch (error) {
        // The next save would overwrite the file, so the damaged one is kept aside for manual recovery.
        console.warn('Game presets file is corrupt, keeping it as .corrupt', error);
        await rename(filePath, `${filePath}.corrupt`).catch(() => undefined);
      }
    }
    return new GamePresetStore(filePath, parseStoredPresets(stored));
  }

  get(): HostGamePresets {
    return structuredClone(this.data);
  }

  saveDraft(draft: HostGameDraft): Promise<void> {
    this.data = { ...this.data, lastDraft: draft };
    return this.persist();
  }

  async save(name: string, draft: HostGameDraft): Promise<HostGamePreset[]> {
    const existing = this.data.presets.find((preset) => sameName(preset.name, name));
    if (!existing && this.data.presets.length >= HOST_GAME_LIMITS.maxPresets) {
      throw new Error(t('main.presets.limit', { max: HOST_GAME_LIMITS.maxPresets }));
    }
    const preset: HostGamePreset = { id: existing?.id ?? randomUUID(), name, draft };
    const presets = existing
      ? this.data.presets.map((candidate) => (candidate.id === existing.id ? preset : candidate))
      : [...this.data.presets, preset];
    this.data = { ...this.data, presets };
    await this.persist();
    return this.get().presets;
  }

  async delete(id: string): Promise<HostGamePreset[]> {
    this.data = { ...this.data, presets: this.data.presets.filter((preset) => preset.id !== id) };
    await this.persist();
    return this.get().presets;
  }

  /** Writes strictly one after another, so a burst of draft saves never interleaves on the temporary file. */
  private persist(): Promise<void> {
    const content = JSON.stringify(this.data, null, 2);
    const write = this.writing.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(tempPath, content, 'utf8');
      await rename(tempPath, this.filePath);
    });
    this.writing = write.catch(() => undefined);
    return write;
  }
}
