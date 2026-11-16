// Interface texts in Russian and English. ru.ts is the source of the keys; en.ts has the same type, so a key missing
// there fails the type check. Texts of the server, chat messages and names of maps and mods are not translated.

import type { Language } from '../contract.ts';
import { en } from './en.ts';
import { Plural } from './plural.ts';
import { type Messages, ru } from './ru.ts';

export type Locale = Exclude<Language, 'system'>;

export const LOCALES: readonly Locale[] = ['ru', 'en'];

/** Locale tags for Intl, which formats dates and numbers. */
export const INTL_LOCALES: Record<Locale, string> = { ru: 'ru-RU', en: 'en-US' };

type KeysOf<T, Prefix extends string> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${Prefix}${K}` : KeysOf<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = KeysOf<Messages, ''>;

/**
 * Values for `{name}` placeholders. `count` is a quantity: it picks the plural form and is shown with digit grouping;
 * other numbers are shown as they are, so ids stay intact.
 */
export type MessageParams = Record<string, string | number>;

const MESSAGES: Record<Locale, Messages> = { ru, en };

export function resolveLocale(language: Language, systemLocale: string): Locale {
  if (language !== 'system') {
    return language;
  }
  return systemLocale.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function lookup(messages: Messages, key: string): string | Plural | null {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || node instanceof Plural) {
      return null;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || node instanceof Plural ? node : null;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
const countFormats = new Map<Locale, Intl.NumberFormat>();

function cached<T>(cache: Map<Locale, T>, locale: Locale, create: (tag: string) => T): T {
  let value = cache.get(locale);
  if (!value) {
    value = create(INTL_LOCALES[locale]);
    cache.set(locale, value);
  }
  return value;
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const message = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.ru, key) ?? key;
  const count = typeof params.count === 'number' ? params.count : null;
  let text: string;
  if (message instanceof Plural) {
    const category = cached(pluralRules, locale, (tag) => new Intl.PluralRules(tag)).select(count ?? 0);
    text = message.forms[category] ?? message.forms.other;
  } else {
    text = message;
  }
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (name === 'count' && count !== null) {
      return cached(countFormats, locale, (tag) => new Intl.NumberFormat(tag)).format(count);
    }
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Cancelled work fails with this message in the language of the moment it was cancelled. */
export function isCancelledMessage(message: string): boolean {
  return LOCALES.some((locale) => translate(locale, 'common.cancelled') === message);
}
