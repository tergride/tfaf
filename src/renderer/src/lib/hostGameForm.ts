import { z } from 'zod';
import { HOST_GAME_LIMITS, type HostGameDraft } from '../../../shared/contract.ts';
import { t } from './i18n.ts';

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function maxLengthMessage(limit: number): string {
  return t('hostGame.validation.maxLength', { limit });
}

function ratingSchema() {
  return z
    .number({ invalid_type_error: t('hostGame.validation.integer') })
    .int(t('hostGame.validation.integer'))
    .min(-HOST_GAME_LIMITS.ratingMax, t('hostGame.validation.notBelow', { limit: HOST_GAME_LIMITS.ratingMax }))
    .max(HOST_GAME_LIMITS.ratingMax, t('hostGame.validation.notAbove', { limit: HOST_GAME_LIMITS.ratingMax }))
    .nullable();
}

/**
 * Mirrors parseHostGameOptions in the main process, so mistakes show up next to the field instead of on submit. The
 * messages are in the interface language of the moment, so the form builds the schema again when it changes.
 */
export function createHostGameSchema() {
  const asciiOnly = t('hostGame.validation.asciiOnly');
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('hostGame.validation.titleRequired'))
      .max(HOST_GAME_LIMITS.titleMaxLength, maxLengthMessage(HOST_GAME_LIMITS.titleMaxLength))
      .regex(PRINTABLE_ASCII, asciiOnly),
    password: z
      .string()
      .max(HOST_GAME_LIMITS.passwordMaxLength, maxLengthMessage(HOST_GAME_LIMITS.passwordMaxLength))
      .regex(PRINTABLE_ASCII, asciiOnly),
    featuredMod: z.string().min(1, t('hostGame.validation.featuredModRequired')),
    mapFolderName: z.string().min(1, t('hostGame.validation.mapRequired')),
    modUids: z.array(z.string()),
    friendsOnly: z.boolean(),
    ratingMin: ratingSchema(),
    ratingMax: ratingSchema(),
    enforceRatingRange: z.boolean(),
    modIsolation: z.boolean(),
    lobbyMode: z.enum(['faf', 'tfaf']),
  });
}

/** Checked apart from the schema: zod skips object-level refinements while any other field is invalid. */
export function ratingOrderError(min: number | null, max: number | null): string | null {
  return min !== null && max !== null && min > max ? t('hostGame.validation.ratingOrder') : null;
}

export function createPresetNameSchema() {
  return z
    .string()
    .trim()
    .min(1, t('hostGame.validation.presetNameRequired'))
    .max(HOST_GAME_LIMITS.presetNameMaxLength, maxLengthMessage(HOST_GAME_LIMITS.presetNameMaxLength));
}

export const EMPTY_DRAFT: HostGameDraft = {
  title: '',
  password: '',
  featuredMod: 'faf',
  mapFolderName: '',
  modUids: [],
  friendsOnly: false,
  ratingMin: null,
  ratingMax: null,
  enforceRatingRange: false,
  modIsolation: false,
  lobbyMode: 'faf',
};

const LEGACY_STORAGE_KEY = 'tfaf.createGame.lastOptions';

function legacyRating(value: unknown): number | null {
  const rating = typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isInteger(rating) && Math.abs(rating) <= HOST_GAME_LIMITS.ratingMax ? rating : null;
}

/** Earlier versions kept the last options in localStorage; they are taken over once and then removed. */
export function takeLegacyDraft(): Partial<HostGameDraft> | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null');
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (typeof stored !== 'object' || stored === null) {
      return null;
    }
    const raw = stored as Record<string, unknown>;
    return {
      title: typeof raw.title === 'string' ? raw.title.slice(0, HOST_GAME_LIMITS.titleMaxLength) : '',
      featuredMod: typeof raw.featuredMod === 'string' ? raw.featuredMod : EMPTY_DRAFT.featuredMod,
      mapFolderName: typeof raw.mapFolderName === 'string' ? raw.mapFolderName : '',
      ratingMin: legacyRating(raw.ratingMin),
      ratingMax: legacyRating(raw.ratingMax),
      enforceRatingRange: raw.enforceRatingRange === true,
      friendsOnly: raw.friendsOnly === true,
    };
  } catch {
    return null;
  }
}
