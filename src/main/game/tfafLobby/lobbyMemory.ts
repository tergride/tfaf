// What a launcher keeps of TFAF lobbies between games, next to the settings: the host's last options, the player's last
// faction and colour, the way the game's lobby keeps them in its profile, and the saved lobbies.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LOBBY_LIMITS, type LobbyAutoTeams, type LobbyOptionGroup, type LobbyOptionValue, type LobbyPreset, type LobbyPresets } from '../../../shared/contract.ts';
import { RANDOM_FACTION } from '../../../shared/tfafLobby.ts';
import { t } from '../../i18n.ts';
import { parseAutoTeams, parseLobbyPreset, parseOptions } from './lobbyWire.ts';

/** The id of the preset that holds the last game. */
export const LAST_GAME_PRESET = 'lastGame';

export interface LobbyMemoryData {
  options: Record<string, LobbyOptionValue>;
  autoTeams: LobbyAutoTeams;
  /** A faction key or `random`: featured mods number their factions differently. */
  faction: string | null;
  color: number | null;
  lastGame: LobbyPreset | null;
  presets: LobbyPreset[];
}

// Up to 0.12.0 the faction was kept by its number in FAF.
const FAF_FACTION_NUMBERS = ['uef', 'aeon', 'cybran', 'seraphim', RANDOM_FACTION];
const FACTION_KEY = /^[A-Za-z0-9_]{1,32}$/;

function storedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function storedFaction(value: unknown): string | null {
  if (typeof value === 'number') {
    return FAF_FACTION_NUMBERS[value - 1] ?? null;
  }
  return typeof value === 'string' && FACTION_KEY.test(value) ? value : null;
}

/** Keeps whatever is still valid in a stored file, so one damaged preset does not cost the others. */
export function parseLobbyMemory(input: unknown): LobbyMemoryData {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    options: parseOptions(raw.options) ?? {},
    autoTeams: parseAutoTeams(raw.autoTeams) ?? 'none',
    faction: storedFaction(raw.faction),
    color: storedNumber(raw.color),
    lastGame: parseLobbyPreset(raw.lastGame),
    presets: (Array.isArray(raw.presets) ? raw.presets : [])
      .map(parseLobbyPreset)
      .filter((preset) => preset !== null)
      .slice(0, LOBBY_LIMITS.maxPresets),
  };
}

/** Those of the host's last options the game still knows with these values, like the check of the game's lobby. */
export function validOptions(groups: readonly LobbyOptionGroup[], options: Readonly<Record<string, LobbyOptionValue>>): Record<string, LobbyOptionValue> {
  const valid: Record<string, LobbyOptionValue> = {};
  for (const option of groups.flatMap((group) => group.options)) {
    const value = options[option.key];
    if (value !== undefined && value !== option.defaultValue && option.choices.some((choice) => choice.value === value)) {
      valid[option.key] = value;
    }
  }
  return valid;
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, 'ru', { sensitivity: 'accent' }) === 0;
}

export class LobbyMemory {
  private readonly filePath: string;
  private data: LobbyMemoryData;
  private writing: Promise<void> = Promise.resolve();

  private constructor(filePath: string, data: LobbyMemoryData) {
    this.filePath = filePath;
    this.data = data;
  }

  static async load(filePath: string): Promise<LobbyMemory> {
    let content: string | null = null;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Lobby memory file is unreadable, starting without it', error);
      }
    }
    let stored: unknown = null;
    if (content !== null) {
      try {
        stored = JSON.parse(content);
      } catch (error) {
        // The next save would overwrite the file, so the damaged one is kept aside for manual recovery.
        console.warn('Lobby memory file is corrupt, keeping it as .corrupt', error);
        await rename(filePath, `${filePath}.corrupt`).catch(() => undefined);
      }
    }
    return new LobbyMemory(filePath, parseLobbyMemory(stored));
  }

  get current(): Readonly<LobbyMemoryData> {
    return this.data;
  }

  presets(): LobbyPresets {
    return structuredClone({ lastGame: this.data.lastGame, presets: this.data.presets });
  }

  /** A saved lobby by id, or the last game's. */
  preset(id: string): LobbyPreset | null {
    return (id === LAST_GAME_PRESET ? this.data.lastGame : this.data.presets.find((preset) => preset.id === id)) ?? null;
  }

  update(change: Partial<Pick<LobbyMemoryData, 'options' | 'autoTeams' | 'faction' | 'color' | 'lastGame'>>): void {
    this.data = { ...this.data, ...change };
    this.persist().catch((error: unknown) => console.warn('Lobby memory could not be saved', error));
  }

  /** Saves under a name, over a preset that has it. */
  async savePreset(make: (id: string) => LobbyPreset, name: string): Promise<LobbyPresets> {
    const existing = this.data.presets.find((preset) => sameName(preset.name, name));
    if (!existing && this.data.presets.length >= LOBBY_LIMITS.maxPresets) {
      throw new Error(t('main.presets.limit', { max: LOBBY_LIMITS.maxPresets }));
    }
    const preset = make(existing?.id ?? randomUUID());
    const presets = existing ? this.data.presets.map((candidate) => (candidate.id === existing.id ? preset : candidate)) : [...this.data.presets, preset];
    this.data = { ...this.data, presets };
    await this.persist();
    return this.presets();
  }

  async deletePreset(id: string): Promise<LobbyPresets> {
    this.data = { ...this.data, presets: this.data.presets.filter((preset) => preset.id !== id) };
    await this.persist();
    return this.presets();
  }

  /** Writes strictly one after another, so a burst of changes never interleaves on the temporary file. */
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
