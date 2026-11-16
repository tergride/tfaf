import type { GameSessionState, TaskProgress } from '../shared/contract.ts';

export interface TaskbarProgress {
  mode: 'none' | 'normal' | 'indeterminate';
  /** 0..1 in `normal` mode. */
  fraction: number;
}

const NONE: TaskbarProgress = { mode: 'none', fraction: 0 };

/**
 * The progress on the taskbar button: a game start while it prepares, otherwise the running downloads together. A task
 * without a known size makes the bar indeterminate.
 */
export function taskbarProgress(tasks: readonly TaskProgress[], game: GameSessionState | null): TaskbarProgress {
  if (game && game.stages.length > 0 && game.error === null && game.phase !== 'idle' && game.phase !== 'running') {
    // Several stages run side by side, each counting for an equal share.
    const done = game.stages.reduce(
      (sum, stage) => sum + (stage.state === 'done' ? 1 : stage.state === 'running' ? (stage.progress ?? 0) : 0),
      0,
    );
    return { mode: 'normal', fraction: done / game.stages.length };
  }
  const running = tasks.filter((task) => task.state === 'running');
  if (running.length === 0) {
    return NONE;
  }
  if (running.some((task) => task.progress === null)) {
    return { mode: 'indeterminate', fraction: 0 };
  }
  return { mode: 'normal', fraction: running.reduce((sum, task) => sum + (task.progress ?? 0), 0) / running.length };
}

/** Raw pixels as `nativeImage.toBitmap()` gives them: BGRA rows without padding, alpha premultiplied. */
export interface Bitmap {
  width: number;
  height: number;
  data: Buffer;
}

/** The icon with the badge drawn over its bottom right corner, for the tray icon. */
export function withBadge(icon: Bitmap, badge: Bitmap): Buffer {
  const result = Buffer.from(icon.data);
  const left = icon.width - badge.width;
  const top = icon.height - badge.height;
  for (let y = Math.max(0, -top); y < badge.height; y++) {
    for (let x = Math.max(0, -left); x < badge.width; x++) {
      const source = (y * badge.width + x) * 4;
      const alpha = badge.data[source + 3] ?? 0;
      if (alpha === 0) {
        continue;
      }
      const target = ((top + y) * icon.width + left + x) * 4;
      // Premultiplied "source over": the badge plus what it lets through of the icon.
      for (let channel = 0; channel < 4; channel++) {
        const under = result[target + channel] ?? 0;
        result[target + channel] = Math.min(255, (badge.data[source + channel] ?? 0) + Math.round((under * (255 - alpha)) / 255));
      }
    }
  }
  return result;
}

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BADGE_URL_LENGTH = 64 * 1024;
const MAX_BADGE_SIZE = 64;

/** The badge the renderer drew: a PNG data URL of at most 64×64 pixels, read from the PNG header; null otherwise. */
export function parseBadgeImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_BADGE_URL_LENGTH || !value.startsWith(PNG_PREFIX)) {
    return null;
  }
  const data = value.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return null;
  }
  const png = Buffer.from(data, 'base64');
  // The signature, then the IHDR chunk: length, type, width and height as big-endian 32-bit integers.
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return width > 0 && height > 0 && width <= MAX_BADGE_SIZE && height <= MAX_BADGE_SIZE ? value : null;
}
