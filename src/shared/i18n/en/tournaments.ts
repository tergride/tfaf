import { plural } from '../plural.ts';
import type { Messages } from '../ru.ts';

export const tournaments: Messages['tournaments'] = {
  title: 'Tournaments',
  refresh: 'Refresh list',
  site: 'Tournament site',
  intro: 'Sign up for a tournament and follow its bracket on the FAF tournament site, where you sign in with your FAF account.',
  show: 'Show',
  filters: {
    current: 'Current and upcoming',
    finished: 'Finished',
  },
  empty: {
    current: 'No tournaments right now',
    finished: 'No finished tournaments',
  },
  status: {
    running: 'In progress',
    open: 'Registration open',
    upcoming: 'Registration soon',
    closed: 'Registration closed',
    finished: 'Finished',
  },
  formats: {
    single: 'Single elimination',
    double: 'Double elimination',
    swiss: 'Swiss system',
  },
  official: 'Official',
  prize: 'Prize pool {amount}',
  teams: plural({ one: '{count} team', other: '{count} teams' }),
  teamRatingTo: 'team up to {max}',
  rating: 'Rating: {limits}',
  series: 'Series: {series}',
  signupUntil: 'registration until {date}',
  signUp: 'Sign up',
  open: 'Open',
};
