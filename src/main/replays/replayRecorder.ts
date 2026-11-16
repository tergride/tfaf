import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RawGame } from '../lobby/lobbyProtocol.ts';
import { encodeReplayFile } from './replayFile.ts';

// Longer recordings are not kept locally; the replay server still gets the whole stream.
const MAX_RECORDED_BYTES = 256 * 1024 * 1024;
const MAX_REQUEST_LINE_BYTES = 1024;

function unixSeconds(time: number): number {
  return Math.round(time / 1000);
}

/**
 * Keeps the replay stream of an online game and writes it to the replay folder when the game ends, in the format of
 * ReplayServer and ReplayFileWriterImpl of the official client (file `<uid>-<login>.fafreplay`).
 */
export class ReplayRecorder {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private overflow = false;
  /** Bytes before the game's `P/<uid>/<login>.SCFAreplay\0` request line has been read completely. */
  private head: Buffer | null = Buffer.alloc(0);
  private readonly launchedAt = Date.now();
  private game: RawGame | null = null;

  add(chunk: Buffer): void {
    if (this.overflow) {
      return;
    }
    let data = chunk;
    if (this.head) {
      const head = Buffer.concat([this.head, chunk]);
      if (head.length >= 2 && head.toString('latin1', 0, 2) !== 'P/') {
        this.head = null;
        data = head;
      } else {
        const end = head.indexOf(0);
        if (end < 0) {
          this.head = head.length > MAX_REQUEST_LINE_BYTES ? null : head;
          return;
        }
        this.head = null;
        data = head.subarray(end + 1);
      }
    }
    if (this.size + data.length > MAX_RECORDED_BYTES) {
      this.overflow = true;
      this.chunks.length = 0;
      console.warn('Replay is too long to keep locally');
      return;
    }
    this.chunks.push(data);
    this.size += data.length;
  }

  /** The lobby forgets a game once it closes, so the last known state is kept while the stream runs. */
  noteGame(game: RawGame | null): void {
    if (game) {
      this.game = game;
    }
  }

  get recorded(): number {
    return this.size;
  }

  /** Returns the written file, or null when the game sent nothing to keep. */
  async save(directory: string, gameId: number, recorder: string, launcherVersion: string): Promise<string | null> {
    if (this.overflow || this.size === 0) {
      return null;
    }
    const game = this.game;
    const metadata = {
      uid: gameId,
      title: game?.title ?? null,
      mapname: game?.mapFolderName ?? null,
      featured_mod: game?.featuredMod ?? null,
      featured_mod_versions: {},
      sim_mods: Object.fromEntries((game?.simMods ?? []).map((mod) => [mod.uid, mod.name])),
      teams: Object.fromEntries((game?.teamLogins ?? []).map((team) => [String(team.team), team.logins])),
      host: game?.host ?? null,
      num_players: game?.numPlayers ?? null,
      max_players: game?.maxPlayers ?? null,
      recorder,
      version_info: { lobby: `tfaf-${launcherVersion}` },
      launched_at: unixSeconds(this.launchedAt),
      game_end: unixSeconds(Date.now()),
      state: 'closed',
      complete: true,
    };
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${gameId}-${recorder.replace(/[^\w.-]+/g, '_')}.fafreplay`);
    const temp = `${file}.tfaf-tmp`;
    try {
      await writeFile(temp, encodeReplayFile(metadata, Buffer.concat(this.chunks)));
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return file;
  }
}
