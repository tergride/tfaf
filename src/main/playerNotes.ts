import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_NOTE_LENGTH = 1000;
const MAX_NOTES = 5000;

/** Notes by player id, as stored; anything that is not a player id with a note is dropped. */
export function parseNotes(stored: unknown): Map<number, string> {
  const raw = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const notes = new Map<number, string>();
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (Number.isSafeInteger(id) && id > 0 && typeof value === 'string' && value.trim() && notes.size < MAX_NOTES) {
      notes.set(id, value.trim().slice(0, MAX_NOTE_LENGTH));
    }
  }
  return notes;
}

/**
 * The user's notes about players, kept apart from the settings in player-notes.json (notesByPlayerId of the official
 * client). They follow the player id, so a renamed player keeps their note.
 */
export class PlayerNotesStore {
  private readonly filePath: string;
  private notes: Map<number, string>;
  private writing: Promise<void> = Promise.resolve();

  private constructor(filePath: string, notes: Map<number, string>) {
    this.filePath = filePath;
    this.notes = notes;
  }

  static async load(filePath: string): Promise<PlayerNotesStore> {
    let content: string | null = null;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Player notes file is unreadable, starting without notes', error);
      }
    }
    let stored: unknown = null;
    if (content !== null) {
      try {
        stored = JSON.parse(content);
      } catch (error) {
        // The next save would overwrite the file, so the damaged one is kept aside for manual recovery.
        console.warn('Player notes file is corrupt, keeping it as .corrupt', error);
        await rename(filePath, `${filePath}.corrupt`).catch(() => undefined);
      }
    }
    return new PlayerNotesStore(filePath, parseNotes(stored));
  }

  /** Note by player id, as a plain object for IPC. */
  list(): Record<number, string> {
    return Object.fromEntries(this.notes);
  }

  /** An empty text removes the note. */
  async set(playerId: number, text: string): Promise<Record<number, string>> {
    const note = text.trim().slice(0, MAX_NOTE_LENGTH);
    const next = new Map(this.notes);
    if (note) {
      next.set(playerId, note);
    } else {
      next.delete(playerId);
    }
    this.notes = next;
    await this.persist();
    return this.list();
  }

  /** Writes strictly one after another, so quick edits never interleave on the temporary file. */
  private persist(): Promise<void> {
    const content = JSON.stringify(this.list(), null, 2);
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
