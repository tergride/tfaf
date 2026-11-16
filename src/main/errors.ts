import { t } from './i18n.ts';

/** The user stopped the work, e.g. a download from its progress toast. */
export class CancelledError extends Error {
  constructor() {
    super(t('common.cancelled'));
    this.name = 'CancelledError';
  }
}

export function describeError(error: unknown): string {
  // undici hides the reason of every network failure behind `TypeError: fetch failed`.
  if (error instanceof TypeError && error.message === 'fetch failed') {
    const code = (error.cause as NodeJS.ErrnoException | undefined)?.code;
    return code ? t('common.noConnectionCode', { code }) : t('common.noConnection');
  }
  return error instanceof Error ? error.message : String(error);
}
