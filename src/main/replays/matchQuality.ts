import { matchQuality, type SkillRating } from '../../shared/trueskill.ts';

export interface RatedPlayer {
  /** FA team number: 1 means "no team", 2 and up are teams. */
  team: number;
  mean: number | null;
  deviation: number | null;
}

/**
 * Match quality of a finished game from the players' ratings before it, like JSkillsRatingService.calculateQuality of
 * the official client, but for any number of sides, as for open games: free for all too. Null unless every player's
 * rating is known. A player without a team is a side alone.
 */
export function replayQuality(players: readonly RatedPlayer[]): number | null {
  const sides = new Map<string, SkillRating[]>();
  for (const [index, player] of players.entries()) {
    if (player.team < 1) {
      continue;
    }
    if (player.mean === null || player.deviation === null) {
      return null;
    }
    const side = player.team === 1 ? `alone ${index}` : `team ${player.team}`;
    sides.set(side, [...(sides.get(side) ?? []), { mean: player.mean, deviation: player.deviation }]);
  }
  return matchQuality([...sides.values()]);
}
