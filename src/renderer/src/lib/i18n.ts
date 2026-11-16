// The interface language and the date and time formats of the settings. `t` reads the language reactively, so a
// template or computed value that calls it follows a change of the setting; static data keeps keys, not texts.
// Tests import this module, so it stays free of the DOM; applyLanguageSettings in language.ts applies the settings.
import { readonly, ref, shallowReactive } from 'vue';
import type { DateFormat, TimeFormat } from '../../../shared/contract.ts';
import { type Locale, type MessageKey, type MessageParams, translate } from '../../../shared/i18n/index.ts';

const current = ref<Locale>('ru');
const formats = shallowReactive<{ date: DateFormat; time: TimeFormat }>({ date: 'auto', time: 'auto' });

export const locale = readonly(current);
export const formatPrefs = readonly(formats);

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current.value, key, params);
}

export function setLanguage(language: Locale, date: DateFormat, time: TimeFormat): void {
  current.value = language;
  formats.date = date;
  formats.time = time;
}
