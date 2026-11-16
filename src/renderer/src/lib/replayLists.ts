import { LIVE_REPLAY_DELAY_SECONDS, type LiveGame } from '../../../shared/contract.ts';

/** `a, b vs c, d`; players without a team each stand alone. */
export function playersLine(teams: { team: number; players: string[] }[]): string | null {
  const sides = teams.flatMap((team) => (team.team === 1 ? team.players.map((name) => [name]) : [team.players]));
  return sides.length > 0 ? sides.map((side) => side.join(', ')).join('  vs  ') : null;
}

/** Seconds until the replay server gives out a running game; 0 once it can be watched. */
export function watchableIn(game: LiveGame, now: number): number {
  const launchedAt = game.launchedAt ? Date.parse(game.launchedAt) : Number.NaN;
  const seconds = (launchedAt + LIVE_REPLAY_DELAY_SECONDS * 1000 - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
}
