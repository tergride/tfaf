import type { Settings } from '../../../shared/contract.ts';
import { resolveLocale } from '../../../shared/i18n/index.ts';
import { setLanguage } from './i18n.ts';

/** Applies the language and the formats of the settings to the whole interface. */
export function applyLanguageSettings(settings: Pick<Settings, 'language' | 'dateFormat' | 'timeFormat'>): void {
  const language = resolveLocale(settings.language, window.tfaf.systemLocale);
  setLanguage(language, settings.dateFormat, settings.timeFormat);
  document.documentElement.lang = language;
}
