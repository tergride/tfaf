import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { en } from '../src/shared/i18n/en.ts';
import { isCancelledMessage, type Locale, resolveLocale, translate } from '../src/shared/i18n/index.ts';
import { Plural } from '../src/shared/i18n/plural.ts';
import { ru } from '../src/shared/i18n/ru.ts';

const SOURCE_ROOT = path.join(import.meta.dirname, '..', 'src');
// Russian lives in these files only.
const RUSSIAN_SOURCES = path.join(SOURCE_ROOT, 'shared', 'i18n', 'ru');
/** Lines that may keep Cyrillic outside ru/, by file relative to src/, with the reason. */
const ALLOWED_CYRILLIC: Record<string, RegExp[]> = {
  // Recognises Russian link texts in the HTML of FAF news and tutorials; not an interface text.
  'main/info/html.ts': [/^const GENERIC_LINK_TEXT = /],
};

function leaves(node: unknown, prefix = ''): [string, string | Plural][] {
  if (typeof node === 'string' || node instanceof Plural) {
    return [[prefix, node]];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(message: string | Plural): string[] {
  const texts = message instanceof Plural ? Object.values(message.forms) : [message];
  return [...new Set(texts.flatMap((text) => [...(text ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '')))].sort();
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return full === RUSSIAN_SOURCES ? [] : sourceFiles(full);
      }
      return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

/** Only code and markup count, not comments. `//` after a colon is part of a URL, not a comment. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
}

describe('translate', () => {
  it('fills placeholders and leaves unknown ones as they are', () => {
    assert.equal(translate('ru', 'format.team', { number: 2 }), 'Команда 2');
    assert.equal(translate('en', 'format.team', { number: 2 }), 'Team 2');
    assert.equal(translate('en', 'format.team'), 'Team {number}');
  });

  it('picks plural forms by the rules of each language and groups the digits of the count', () => {
    const ruPlayers = (count: number): string => translate('ru', 'format.players', { count });
    assert.deepEqual(
      [1, 2, 5, 11, 21, 22, 1.5].map(ruPlayers),
      ['1 игрок', '2 игрока', '5 игроков', '11 игроков', '21 игрок', '22 игрока', '1,5 игрока'],
    );
    assert.equal(translate('en', 'format.players', { count: 1 }), '1 player');
    assert.equal(translate('en', 'format.players', { count: 12345 }), '12,345 players');
    assert.equal(ruPlayers(12345), '12 345 игроков');
  });

  it('recognises the cancel message of either language', () => {
    for (const locale of ['ru', 'en'] satisfies Locale[]) {
      assert.ok(isCancelledMessage(translate(locale, 'common.cancelled')));
    }
    assert.ok(!isCancelledMessage('Сервер не ответил'));
  });

  it('follows the system for the `system` language: Russian only for a Russian system', () => {
    assert.equal(resolveLocale('system', 'ru'), 'ru');
    assert.equal(resolveLocale('system', 'ru-RU'), 'ru');
    assert.equal(resolveLocale('system', 'uk'), 'en');
    assert.equal(resolveLocale('system', ''), 'en');
    assert.equal(resolveLocale('en', 'ru'), 'en');
  });
});

describe('messages', () => {
  const russian = new Map(leaves(ru));
  const english = new Map(leaves(en));

  it('have the same keys and placeholders in both languages', () => {
    assert.deepEqual([...english.keys()].sort(), [...russian.keys()].sort());
    const mismatched = [...russian].filter(([key, message]) => {
      const translation = english.get(key);
      return !translation || placeholders(translation).join() !== placeholders(message).join();
    });
    assert.deepEqual(
      mismatched.map(([key]) => key),
      [],
    );
  });

  it('have every plural form the language needs', () => {
    const missing: string[] = [];
    for (const [locale, messages] of [
      ['ru', russian],
      ['en', english],
    ] as const) {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const [key, message] of messages) {
        if (message instanceof Plural) {
          missing.push(...categories.filter((category) => !message.forms[category]).map((category) => `${locale} ${key} ${category}`));
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it('cover every text: no Cyrillic in code outside the Russian messages', async () => {
    const found: string[] = [];
    for (const file of await sourceFiles(SOURCE_ROOT)) {
      const relative = path.relative(SOURCE_ROOT, file).split(path.sep).join('/');
      const allowed = ALLOWED_CYRILLIC[relative] ?? [];
      withoutComments(await readFile(file, 'utf8'))
        .split('\n')
        .forEach((line, index) => {
          if (/[Ѐ-ӿ]/.test(line) && !allowed.some((pattern) => pattern.test(line))) {
            found.push(`${relative}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    assert.deepEqual(found, []);
  });
});

