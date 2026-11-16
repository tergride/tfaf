import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { t } from '../i18n.ts';
import { requireNativeBinary } from '../nativeBinaries.ts';

const execFileAsync = promisify(execFile);

function uidExecutableName(): string {
  switch (process.platform) {
    case 'win32':
      return 'faf-uid.exe';
    case 'darwin':
      return 'faf-uid-macos';
    default:
      return 'faf-uid';
  }
}

/**
 * The lobby server requires the hardware fingerprint produced by FAF's own `faf-uid` tool for every login session
 * (UidService in the official client). The value is sent to the server only and never logged.
 */
export async function generateUid(session: bigint): Promise<string> {
  const executable = requireNativeBinary(uidExecutableName());
  const { stdout } = await execFileAsync(executable, [String(session)], { windowsHide: true, timeout: 30_000 });
  const uid = stdout.trim();
  if (!uid) {
    throw new Error(t('main.lobby.noUid'));
  }
  return uid;
}
