// Command line of ForgedAlliance.exe for an online game, mirroring LaunchCommandBuilder of the official client.

export interface LaunchParameters {
  uid: number;
  username: string;
  gpgPort: number;
  replayPort: number;
  logFile: string;
  mean: number;
  deviation: number;
  /** League of a matchmaker game's leaderboard, which the game shows; null for other games. */
  division: string | null;
  subdivision: string | null;
  country: string | null;
  clan: string | null;
  numberOfGames: number;
  faction: string | null;
  team: number | null;
  expectedPlayers: number | null;
  mapPosition: number | null;
  gameOptions: Record<string, string> | null;
  /** Extra arguments sent by the server in `game_launch`. */
  additionalArgs: string[];
  /** The init file of the game's vault (gameVault.ts); without one the game mounts the player's vault. */
  initFile?: string;
}

const LOCALHOST = '127.0.0.1';

export const INIT_FILE_NAME = 'init.lua';

export function buildLaunchArguments(parameters: LaunchParameters): string[] {
  const args = ['/init', parameters.initFile ?? INIT_FILE_NAME, '/nobugreport'];
  if (parameters.faction) {
    args.push(`/${parameters.faction.toLowerCase()}`);
  }
  args.push('/log', parameters.logFile);
  args.push('/gpgnet', `${LOCALHOST}:${parameters.gpgPort}`);
  args.push('/mean', String(parameters.mean));
  args.push('/deviation', String(parameters.deviation));
  if (parameters.division) {
    args.push('/division', parameters.division);
  }
  if (parameters.subdivision?.trim()) {
    args.push('/subdivision', parameters.subdivision);
  }
  args.push('/savereplay', `gpgnet://${LOCALHOST}:${parameters.replayPort}/${parameters.uid}/${parameters.username}.SCFAreplay`);
  if (parameters.country) {
    args.push('/country', parameters.country);
  }
  if (parameters.clan?.trim()) {
    args.push('/clan', parameters.clan);
  }
  args.push('/numgames', String(parameters.numberOfGames));
  if (parameters.team !== null) {
    args.push('/team', String(parameters.team));
  }
  if (parameters.expectedPlayers !== null) {
    args.push('/players', String(parameters.expectedPlayers));
  }
  if (parameters.mapPosition !== null) {
    args.push('/startspot', String(parameters.mapPosition));
  }
  if (parameters.gameOptions) {
    args.push('/gameoptions', ...Object.entries(parameters.gameOptions).map(([key, value]) => `${key}:${value}`));
  }
  for (const extra of parameters.additionalArgs) {
    args.push(...extra.split(' ').filter((part) => part.length > 0));
  }
  return args;
}

/** A game without the lobby, such as a tutorial (ForgedAllianceLaunchService.launchOfflineGame). */
export function buildOfflineArguments(logFile: string, map: string, initFile = INIT_FILE_NAME): string[] {
  return ['/init', initFile, '/nobugreport', '/log', logFile, '/map', map];
}

/** The game's own main menu on the FAF files, without `/gpgnet`: skirmish against the AI, no server involved. */
export function buildSkirmishArguments(logFile: string, initFile = INIT_FILE_NAME): string[] {
  return ['/init', initFile, '/nobugreport', '/log', logFile];
}

/** `source` is a `.scfareplay` file or the `gpgnet://` address of a live game (ForgedAllianceLaunchService.startReplay). */
export function buildReplayArguments(logFile: string, source: string, replayId: number | null, initFile = INIT_FILE_NAME): string[] {
  return ['/init', initFile, '/nobugreport', '/log', logFile, '/replay', source, '/replayid', String(replayId ?? -1)];
}
