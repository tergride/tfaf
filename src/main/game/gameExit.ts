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
  return t('main.game.exitedWithCode', { code: exitCodeText(code), log: logFile });
}

/**
 * Windows reports a crash or a killed process as an NTSTATUS value such as 0xC0000005, which Node gives unsigned
 * (3221225477) and Java signed; both read as the hex the forums and Microsoft use. Small codes stay decimal.
 */
function exitCodeText(code: number): string {
  const unsigned = code < 0 ? code + 0x1_0000_0000 : code;
  return unsigned >= 0x8000_0000 ? `0x${unsigned.toString(16).toUpperCase().padStart(8, '0')}` : String(code);
}
