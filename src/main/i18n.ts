import { type Locale, type MessageKey, type MessageParams, translate } from '../shared/i18n/index.ts';

// Russian until the settings are read, which is also what tests see.
let current: Locale = 'ru';

/** Messages are translated where they are made: a change of the language applies to the next ones. */
export function setLocale(locale: Locale): void {
  current = locale;
}

export function currentLocale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}
