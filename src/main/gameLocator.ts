import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GAME_EXECUTABLES = ['ForgedAlliance.exe', 'SupremeCommander.exe'];
const STEAM_GAME_FOLDER = path.join('steamapps', 'common', 'Supreme Commander Forged Alliance');

export function isValidGamePath(gamePath: string | null): boolean {
  if (!gamePath) {
    return false;
  }
  return GAME_EXECUTABLES.some((exe) => existsSync(path.join(gamePath, 'bin', exe)));
}

async function readSteamPath(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      windowsHide: true,
      timeout: 5000,
    });
    const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(stdout);
    return match?.[1] ? path.normalize(match[1].trim()) : null;
  } catch {
    return null;
  }
}

/** Library roots listed in `steamapps/libraryfolders.vdf`, including the Steam installation itself. */
export function parseSteamLibraries(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!.replace(/\\\\/g, '\\'));
}

async function steamLibraries(): Promise<string[]> {
  const steamPath = await readSteamPath();
  if (!steamPath) {
    return [];
  }
  try {
    const vdf = await readFile(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    return [steamPath, ...parseSteamLibraries(vdf)];
  } catch {
    return [steamPath];
  }
}

/** Looks for Forged Alliance in the usual install locations (as GamePathHandler does) and in all Steam libraries. */
export async function detectGamePath(): Promise<string | null> {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const candidates = [
    ...(await steamLibraries()).map((library) => path.join(library, STEAM_GAME_FOLDER)),
    path.join(programFilesX86, 'Steam', STEAM_GAME_FOLDER),
    path.join(programFiles, 'THQ', 'Gas Powered Games', 'Supreme Commander - Forged Alliance'),
    path.join(programFilesX86, 'THQ', 'Gas Powered Games', 'Supreme Commander - Forged Alliance'),
    path.join(programFiles, 'Supreme Commander - Forged Alliance'),
    path.join(os.homedir(), '.steam', 'steam', STEAM_GAME_FOLDER),
  ];
  return candidates.find(isValidGamePath) ?? null;
}
