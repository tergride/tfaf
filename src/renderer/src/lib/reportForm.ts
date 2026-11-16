import { z } from 'zod';
import { REPORT_LIMITS } from '../../../shared/contract.ts';
import { t } from './i18n.ts';

const MAX_GAME_ID = 2 ** 31 - 1;

/** `25000001` or `#25000001`; null for anything else. */
export function parseGameIdText(text: string): number | null {
  const id = Number(/^#?(\d{1,10})$/.exec(text.trim())?.[1]);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_GAME_ID ? id : null;
}

/**
 * Mirrors parseReportInput in the main process. The messages are in the interface language of the moment, so the
 * form builds the schema again when it changes.
 */
export function createReportSchema() {
  return z.object({
    players: z
      .array(z.object({ id: z.number().int().positive(), login: z.string() }))
      .min(1, t('profile.report.validation.playersRequired'))
      .max(REPORT_LIMITS.maxPlayers, t('profile.report.validation.tooManyPlayers', { limit: REPORT_LIMITS.maxPlayers })),
    gameId: z
      .string()
      .trim()
      .refine((value) => value === '' || parseGameIdText(value) !== null, t('profile.report.validation.gameId')),
    incidentTime: z
      .string()
      .trim()
      .max(REPORT_LIMITS.incidentTimeMaxLength, t('profile.report.validation.maxLength', { limit: REPORT_LIMITS.incidentTimeMaxLength })),
    description: z
      .string()
      .trim()
      .min(1, t('profile.report.validation.descriptionRequired'))
      .max(REPORT_LIMITS.descriptionMaxLength, t('profile.report.validation.maxLength', { limit: REPORT_LIMITS.descriptionMaxLength })),
  });
}

/** Checked apart from the schema: zod skips object-level refinements while any other field is invalid. */
export function incidentTimeError(gameId: string, incidentTime: string): string | null {
  return gameId.trim() !== '' && incidentTime.trim() === '' ? t('profile.report.validation.incidentTimeRequired') : null;
}
