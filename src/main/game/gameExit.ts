import { t } from '../i18n.ts';

// STATUS_DLL_NOT_FOUND, reported signed by Java and unsigned by Node.
const MISSING_DLL_EXIT_CODES = new Set([-1073741515, 3221225781]);

/** Why Forged Alliance stopped, from its exit code; null when it exited normally. `logFile` is the game's log. */
export function exitError(code: number | null, logFile: string): string | null {
  if (code === 0) {
    return null;
  }
  if (code === null) {
    return t('main.game.exitedUnknownCode', { log: logFile });
  }
  if (MISSING_DLL_EXIT_CODES.has(code)) {
    return t('main.game.missingLibraries');
  }
  return t('main.game.exitedWithCode', { code, log: logFile });
}
