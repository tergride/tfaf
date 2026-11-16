/** A post of the FAF news hub; the text is plain, without HTML. */
export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  link: string | null;
  date: string | null;
  author: string | null;
  imageUrl: string | null;
}

export interface League {
  id: string;
  /** "1v1", "2v2", ... */
  name: string;
}

export interface LeagueSeason {
  id: string;
  number: number;
  startDate: string | null;
  endDate: string | null;
}

export interface LeagueSubdivision {
  id: string;
  index: number;
  /** Roman numeral shown next to the division name, e.g. "II". */
  name: string;
  minRating: number | null;
  maxRating: number | null;
  /** Score at which a player moves up; null for the top subdivision. */
  highestScore: number | null;
  imageUrl: string | null;
  players: number;
}

export interface LeagueDivision {
  index: number;
  /** bronze, silver, gold, diamond, master, grandmaster, ... */
  nameKey: string;
  /** Highest subdivision first. */
  subdivisions: LeagueSubdivision[];
}

export interface LeagueStanding {
  /** Highest division first. */
  divisions: LeagueDivision[];
  players: number;
  me: {
    subdivisionId: string | null;
    score: number;
    gameCount: number;
    /** Games needed before a division is assigned. */
    placementGames: number;
    rank: number | null;
  } | null;
}

export interface LeagueEntry {
  rank: number;
  playerId: number;
  login: string;
  score: number;
  gameCount: number;
}

export interface LeaguePlayerLocation {
  playerId: number;
  subdivisionId: string;
  page: number;
}

/** `upcoming`: sign-up opens later; `closed`: sign-up is over, the tournament has not started yet. */
export type TournamentStatus = 'running' | 'open' | 'upcoming' | 'closed' | 'finished';

export type TournamentFormat = 'single' | 'double' | 'swiss';

/** A tournament of the FAF tournament site. */
export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  official: boolean;
  series: string | null;
  /** Players per team: 1 for 1v1 tournaments. */
  teamSize: number | null;
  format: TournamentFormat | null;
  /** Signed-up players and the teams formed from them. */
  players: number;
  teams: number;
  /** First game day; a date or a date and time. */
  startsAt: string | null;
  signupClosesAt: string | null;
  minRating: number | null;
  maxRating: number | null;
  maxTeamRating: number | null;
  prize: { amount: number; currency: string } | null;
  url: string;
}

export interface TutorialLink {
  label: string;
  url: string;
}

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  /** Links of the description, which the plain text leaves out. */
  links: TutorialLink[];
  imageUrl: string | null;
  launchable: boolean;
  mapName: string | null;
  mapFolderName: string | null;
  mapPreviewUrl: string | null;
}

export interface TutorialCategory {
  name: string;
  tutorials: Tutorial[];
}
