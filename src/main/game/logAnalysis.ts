import { open } from 'node:fs/promises';

// What the official client looks for in the log of a crashed game (LogAnalyzerService).
const MINIMIZED_TRACE = 'info: Minimized true';
const SOUND_WARNING_TRACE = 'warning: SND';
const SOUND_XACT_TRACE = 'XACT';
// The forum topic the official client links for the sound issue (faf-client.help-links.soundIssues).
export const SOUND_ISSUES_URL = 'https://forum.faforever.com/topic/4084/solutions-for-snd-error-xact-invalid-arg-xact3dapply-failed';
// A long game writes a log of many megabytes; the traces of a crash are near its end.
const TAIL_BYTES = 4 * 1024 * 1024;

export type GameLogIssue = 'minimized' | 'sound';

export function analyzeGameLog(content: string): GameLogIssue[] {
  const issues: GameLogIssue[] = [];
  if (content.includes(MINIMIZED_TRACE)) {
    issues.push('minimized');
  }
  if (content.includes(SOUND_WARNING_TRACE) && content.includes(SOUND_XACT_TRACE)) {
    issues.push('sound');
  }
  return issues;
}

/** The end of a log; empty when the file is missing or unreadable. */
export async function readLogTail(file: string, bytes = TAIL_BYTES): Promise<string> {
  let handle;
  try {
    handle = await open(file, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('latin1');
  } catch {
    return '';
  } finally {
    await handle?.close();
  }
}
