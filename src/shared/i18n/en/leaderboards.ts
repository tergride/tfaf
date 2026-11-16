import { plural } from '../plural.ts';
import type { Messages } from '../ru.ts';

export const leaderboards: Messages['leaderboards'] = {
  title: 'Leaderboards',
  season: 'Season',
  seasonNumber: 'Season {number}',
  seasonWithDates: 'Season {number} · {dates}',
  divisions: {
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
    diamond: 'Diamond',
    master: 'Master',
    grandmaster: 'Grandmaster',
  },
  me: {
    title: 'Your standing',
    rank: 'Rank {rank} of {total}',
    pointsToPromotion: 'Points to promotion',
    seasonGames: plural({ one: '{count} game this season', other: '{count} games this season' }),
    placement: 'Placement',
    gamesPlayed: 'Games played',
    placementHint: 'After the placement games the system will assign your division.',
    notInSeason: 'You are not in this season. Play in the ranked queue to join the league.',
  },
  distribution: 'Players by division',
  noDivisions: 'This season has no divisions yet',
  subdivision: 'Subdivision',
  find: {
    login: 'Player nickname',
    submit: 'Find',
    notFound: 'Player “{login}” is not on this season’s leaderboard',
  },
  ratingRange: 'Division rating range: {min} – {max}',
  ratingRangeWithPromotion: 'Division rating range: {min} – {max} · promotion needs {score} points',
  emptyDivision: 'Nobody is in this division yet',
  emptyDivisionHint: 'Pick another division.',
  table: {
    label: 'Division players',
    rank: 'Rank',
    player: 'Player',
    score: 'Points',
    games: 'Games',
  },
};
