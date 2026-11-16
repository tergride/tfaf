import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Whether any Forged Alliance process runs, e.g. a game started by the official client. */
export async function isForgedAllianceRunning(throwOnError = false): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq ForgedAlliance.exe', '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      timeout: 10_000,
    });
    return stdout.toLowerCase().includes('"forgedalliance.exe"');
  } catch (error) {
    if (throwOnError) throw error;
    return false;
  }
}
