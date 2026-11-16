import type { Faction, GameResult, ReviewsSummary } from '../../shared/contract.ts';
import { INTL_LOCALES, isCancelledMessage } from '../../shared/i18n/index.ts';
import { ru } from '../../shared/i18n/ru.ts';
import { formatPrefs, locale, t } from './lib/i18n.ts';

// One kilometre of map is 51.2 height map pixels (MapSize.MAP_SIZE_FACTOR in the official client).
const PIXELS_PER_KM = 51.2;

// Intl formatters are slow to create and lists format hundreds of values, so they are kept per language and options.
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.DisplayNames>();

function formatter<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.DisplayNames>(
  kind: string,
  options: object,
  create: (tag: string) => T,
): T {
  const key = `${locale.value}:${kind}:${JSON.stringify(options)}`;
  let value = formatters.get(key) as T | undefined;
  if (!value) {
    value = create(INTL_LOCALES[locale.value]);
    formatters.set(key, value);
  }
  return value;
}

function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  return formatter('number', options, (tag) => new Intl.NumberFormat(tag, options));
}

function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return formatter('date', options, (tag) => new Intl.DateTimeFormat(tag, options));
}

export function playersLabel(count: number): string {
  return t('format.players', { count });
}

export function mapSizeKm(px: number): number {
  return Math.round(px / PIXELS_PER_KM);
}

/** `20 km` for a square map, `20×10 km` otherwise. */
export function mapSizeLabel(widthPx: number | null, heightPx: number | null): string | null {
  if (!widthPx || !heightPx) {
    return null;
  }
  const width = mapSizeKm(widthPx);
  const height = mapSizeKm(heightPx);
  return width === height ? t('format.mapSize', { size: width }) : t('format.mapSizeRect', { width, height });
}

export function formatNumber(value: number): string {
  return numberFormat().format(value);
}

/** Megabytes, gigabytes from 1 GB. */
export function formatSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  const size = numberFormat({ maximumFractionDigits: 1 });
  return megabytes >= 1024
    ? t('format.gigabytes', { size: size.format(megabytes / 1024) })
    : t('format.megabytes', { size: size.format(megabytes) });
}

function parseDate(value: string | number | Date | null): Date | null {
  if (value === null || value === '') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_PATTERNS = { dmy: ['day', '.', 'month', '.', 'year'], mdy: ['month', '/', 'day', '/', 'year'], ymd: ['year', '-', 'month', '-', 'day'] };

/** The date in the format of the settings; `auto` is the short date of the interface language. */
function dateText(date: Date, timeZone?: string): string {
  const pattern = formatPrefs.date === 'auto' ? null : DATE_PATTERNS[formatPrefs.date];
  if (!pattern) {
    return dateTimeFormat({ year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(date);
  }
  const parts = new Map(
    dateTimeFormat({ year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return pattern.map((piece) => parts.get(piece as Intl.DateTimeFormatPartTypes) ?? piece).join('');
}

const HOUR_CYCLES = { auto: undefined, h24: 'h23', h12: 'h12' } as const;

/** Hours and minutes in the time format of the settings. */
export function formatTime(value: string | number | Date): string {
  const date = parseDate(value);
  return date ? dateTimeFormat({ hour: '2-digit', minute: '2-digit', hourCycle: HOUR_CYCLES[formatPrefs.time] }).format(date) : '';
}

/** `24 октября`, `October 24`: a day within the current year, as chat separators show it. */
export function formatDayMonth(value: string | number | Date): string {
  const date = parseDate(value);
  return date ? dateTimeFormat({ day: 'numeric', month: 'long' }).format(date) : '';
}

/** `12 окт.`, `Oct 12`: a date on a chart axis. */
export function formatShortDate(value: number): string {
  return dateTimeFormat({ day: 'numeric', month: 'short' }).format(new Date(value));
}

/** `окт. 2026 г.`, `Oct 2026`: a month on a chart axis. */
export function formatMonthYear(value: number): string {
  return dateTimeFormat({ month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatDate(iso: string | null): string | null {
  const date = parseDate(iso);
  return date ? dateText(date) : null;
}

/** A date, with the time when the value has one (`2026-10-24T14:00:00Z` vs `2026-10-24`). */
export function formatDateTime(iso: string | null): string | null {
  const date = parseDate(iso);
  if (!iso || !date) {
    return null;
  }
  return iso.includes('T') ? `${dateText(date)}, ${formatTime(date)}` : dateText(date, 'UTC');
}

/** TrueSkill match quality as the official client shows it: a whole percentage. */
export function formatQuality(quality: number | null): string | null {
  return quality === null ? null : numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(quality);
}

export function ratingLabel(reviews: ReviewsSummary | null): string | null {
  if (!reviews || reviews.numReviews === 0) {
    return null;
  }
  return `★ ${reviews.averageScore.toFixed(1)} (${formatNumber(reviews.numReviews)})`;
}

/** `dualgap_adaptive.v0012` → `dualgap_adaptive`, used to detect other installed versions of the same map. */
export function mapBaseName(folderName: string): string {
  return folderName.toLowerCase().replace(/\.v\d+$/, '');
}

/** `dualgap_adaptive.v0012` → `dualgap adaptive`, like MapService.convertMapFolderNameToHumanNameIfPossible. */
export function mapDisplayName(folderName: string): string {
  return folderName.replace(/_/g, ' ').replace(/\.v\d+/g, '');
}

export function teamLabel(team: number): string {
  if (team === 1) {
    return t('format.noTeam');
  }
  if (team === -1) {
    return t('format.observers');
  }
  return t('format.team', { number: team - 1 });
}

/** The country's name in the interface language; codes that are no region (A1, A2) stay as they are. */
export function countryName(country: string): string {
  const names = formatter('region', {}, (tag) => new Intl.DisplayNames(tag, { type: 'region' }));
  try {
    return names.of(country.toUpperCase()) ?? country;
  } catch {
    return country;
  }
}

export function ratingRangeLabel(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) {
    return `${min}–${max}`;
  }
  if (min !== null) {
    return t('format.ratingFrom', { min });
  }
  return max !== null ? t('format.ratingTo', { max }) : null;
}

export function timeAgo(iso: string | null, now: number): string | null {
  if (!iso) {
    return null;
  }
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (Number.isNaN(minutes)) {
    return null;
  }
  const relativeTime = formatter('relative', {}, (tag) => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }));
  return Math.abs(minutes) < 60 ? relativeTime.format(minutes, 'minute') : relativeTime.format(Math.round(minutes / 60), 'hour');
}

/** `1 h 05 min`, `23 min`. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) {
    return null;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return t('format.underMinute');
  }
  return minutes < 60
    ? t('format.minutes', { minutes })
    : t('format.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') });
}

/** `1:05:23`, `47:09`: exact times, as a leaderboard compares them. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(total % 60).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}

export function durationBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) {
    return null;
  }
  const seconds = (Date.parse(toIso) - Date.parse(fromIso)) / 1000;
  return Number.isFinite(seconds) ? seconds : null;
}

export function factionLabel(faction: Faction): string {
  return t(`format.factions.${faction}`);
}

export function resultLabel(result: GameResult): string {
  return t(`format.results.${result}`);
}

type Validity = keyof typeof ru.format.validity;

function isKnownValidity(validity: string): validity is Validity {
  return Object.hasOwn(ru.format.validity, validity);
}

/** Reasons the server gives for not rating a game; unknown ones are shown as they come. */
export function validityLabel(validity: string | null): string | null {
  if (!validity) {
    return null;
  }
  return isKnownValidity(validity) ? t(`format.validity.${validity}`) : t('format.unknownValidity', { validity });
}

/** Joins the present parts with a middle dot; null when there is nothing to show. */
export function joinParts(...parts: (string | null | undefined)[]): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(' · ') : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The user cancelled the download from its toast, which already says so; it is not shown as an error. */
export function isCancelled(error: unknown): boolean {
  return isCancelledMessage(errorMessage(error));
}
