import { stat } from 'node:fs/promises';
import path from 'node:path';

const REPLAY_EXTENSIONS = new Set(['.fafreplay', '.scfareplay']);

/**
 * The replay file Windows passes on the command line when one is opened from Explorer (the installer registers both
 * extensions); null when there is none. Chromium switches and relative paths are not files Explorer would pass.
 */
export function replayFileArgument(argv: readonly string[]): string | null {
  const candidate = argv.findLast((arg) => !arg.startsWith('-') && REPLAY_EXTENSIONS.has(path.extname(arg).toLowerCase()));
  return candidate && path.isAbsolute(candidate) ? path.normalize(candidate) : null;
}

export async function isExistingFile(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null))?.isFile() === true;
}
