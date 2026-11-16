import type { Tournament, TournamentFormat, TournamentStatus } from '../../shared/contract.ts';
import { asNumber, asObject, asString } from '../api/jsonApi.ts';
import { t } from '../i18n.ts';
import { fetchWithTimeout, retrying } from '../net/http.ts';

// The FAF tournament site. The API's Challonge proxy that the official client reads fails on the server side.
const SITE_URL = 'https://tournaments.faforever.com';
const REQUEST_TIMEOUT_MS = 15_000;

const STATUS_ORDER: Record<TournamentStatus, number> = { running: 0, open: 1, upcoming: 2, closed: 3, finished: 4 };
const FORMATS: readonly TournamentFormat[] = ['single', 'double', 'swiss'];

function isPast(date: string | null, now: number): boolean {
  return date !== null && Date.parse(date) <= now;
}

function statusOf(raw: Record<string, unknown>, now: number): TournamentStatus | null {
  switch (asString(raw.status)) {
    case 'signup': {
      // A tournament has this status from its creation on, also while its sign-up waits for the opening time.
      const opensAt = asString(raw.signupOpensAt);
      if (opensAt !== null && !isPast(opensAt, now)) {
        return 'upcoming';
      }
      return isPast(asString(raw.signupClosesAt), now) ? 'closed' : 'open';
    }
    case 'draft':
    case 'drafted':
      return 'closed';
    case 'running':
    case 'live':
      return 'running';
    case 'finished':
    case 'done':
      return 'finished';
    default:
      return null;
  }
}

function prizeOf(value: unknown): Tournament['prize'] {
  const prize = asObject(value);
  const amount = asNumber(prize?.amount);
  const currency = asString(prize?.currency);
  return amount !== null && amount > 0 && currency && /^[A-Z]{3}$/.test(currency) ? { amount, currency } : null;
}

/** Soonest first, or latest first for finished tournaments; ones without a date go last. */
function byStart(a: Tournament, b: Tournament): number {
  const first = a.startsAt ? Date.parse(a.startsAt) : Number.NaN;
  const second = b.startsAt ? Date.parse(b.startsAt) : Number.NaN;
  if (Number.isNaN(first) || Number.isNaN(second)) {
    return Number(Number.isNaN(first)) - Number(Number.isNaN(second));
  }
  return a.status === 'finished' ? second - first : first - second;
}

/**
 * Published tournaments of the site, abandoned ones left out. Running ones come first, then the ones open for sign-up
 * and the ones about to start, soonest first; finished ones last, latest first.
 */
export function parseTournaments(value: unknown, now = Date.now()): Tournament[] {
  if (!Array.isArray(value)) {
    throw new Error(t('main.info.tournamentsFormat'));
  }
  const tournaments = value.flatMap((entry): Tournament[] => {
    const raw = asObject(entry);
    const id = asString(raw?.id);
    const name = asString(raw?.name)?.trim();
    const status = raw ? statusOf(raw, now) : null;
    if (!raw || !id || !/^[\w-]{1,64}$/.test(id) || !name || !status || raw.abandoned === 1 || raw.abandoned === true) {
      return [];
    }
    const format = asString(raw.bracketType);
    return [
      {
        id,
        name,
        status,
        official: raw.category === 'official',
        series: asString(raw.seriesName),
        teamSize: asNumber(raw.teamSize),
        format: FORMATS.find((known) => known === format) ?? null,
        players: asNumber(raw.players) ?? 0,
        teams: asNumber(raw.teams) ?? 0,
        startsAt: asString(raw.eventDate),
        signupClosesAt: asString(raw.signupClosesAt),
        // 0 is how the site stores "no lower limit".
        minRating: asNumber(raw.minRating) || null,
        maxRating: asNumber(raw.maxRating),
        maxTeamRating: asNumber(raw.maxTeamRating),
        prize: prizeOf(raw.prize),
        url: `${SITE_URL}/t/${id}`,
      },
    ];
  });
  return tournaments.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byStart(a, b));
}

export class TournamentService {
  private readonly userAgent: string;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
  }

  async list(): Promise<Tournament[]> {
    const response = await retrying(() =>
      fetchWithTimeout(
        `${SITE_URL}/api/tournaments`,
        { headers: { Accept: 'application/json', 'User-Agent': this.userAgent } },
        REQUEST_TIMEOUT_MS,
      ),
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(t('main.info.tournamentsStatus', { status: response.status }));
    }
    return parseTournaments(await response.json());
  }
}
