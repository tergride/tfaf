import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  bundledReleases,
  changelogSection,
  mergeReleases,
  parseChangelog,
  parseGithubReleases,
  parseReleaseNotes,
  visibleReleases,
} from '../src/main/changelog.ts';
import type { AppRelease } from '../src/shared/contract.ts';
import { compareVersions, isPrerelease, parseVersion } from '../src/shared/versions.ts';

const CHANGELOG = `# История версий

Текст до первой версии не попадает никуда.

## 0.8.1-beta.1 — 2026-11-05

- Бета.

## 0.8.0 — 2026-11-02

<!-- ru -->
### Новое
- Раздел «О программе».

<!-- en -->
### New
- The About page.

## Черновик

- не версия

## v0.7.0

Общий абзац.
`;

function release(version: string, text: string, url: string | null = null): AppRelease {
  const blocks = text ? [{ kind: 'item' as const, text }] : [];
  return { version, date: null, notes: { ru: blocks, en: blocks }, url };
}

describe('versions', () => {
  it('reads versions, betas and tags', () => {
    assert.equal(parseVersion('v1.2.3'), '1.2.3');
    assert.equal(parseVersion(' 0.10.01 '), '0.10.1');
    assert.equal(parseVersion('v1.2.3-beta.1'), '1.2.3-beta.1');
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('1.2.3-'), null);
    assert.equal(parseVersion('1.2.3-beta..1'), null);
    assert.equal(isPrerelease('0.17.0-beta.1'), true);
    assert.equal(isPrerelease('0.17.0'), false);
  });

  it('compares the parts as numbers', () => {
    assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
    assert.ok(compareVersions('0.6.0', '0.7.0') < 0);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  });

  it('puts a beta after the release before it and before its own release', () => {
    const ordered = ['0.16.0', '0.17.0-alpha.3', '0.17.0-beta.2', '0.17.0-beta.10', '0.17.0', '0.17.1-beta.1'];
    for (let index = 1; index < ordered.length; index++) {
      assert.ok(compareVersions(ordered[index]!, ordered[index - 1]!) > 0, `${ordered[index]!} after ${ordered[index - 1]!}`);
      assert.ok(compareVersions(ordered[index - 1]!, ordered[index]!) < 0);
    }
    assert.equal(compareVersions('0.17.0-beta.1', '0.17.0-beta.1'), 0);
    assert.ok(compareVersions('0.17.0-beta', '0.17.0-beta.1') < 0);
  });
});

describe('changelog', () => {
  it('splits the file into version sections and skips other headings', () => {
    const sections = parseChangelog(CHANGELOG);
    assert.deepEqual(
      sections.map(({ version, date }) => ({ version, date })),
      [
        { version: '0.8.1-beta.1', date: '2026-11-05' },
        { version: '0.8.0', date: '2026-11-02' },
        { version: '0.7.0', date: null },
      ],
    );
    assert.equal(sections[2]?.body, 'Общий абзац.');
    assert.equal(changelogSection(CHANGELOG, '0.8.1-beta.1'), '- Бета.');
  });

  it('gives the section of a version as the release text', () => {
    assert.equal(changelogSection(CHANGELOG, '0.8.0'), '<!-- ru -->\n### Новое\n- Раздел «О программе».\n\n<!-- en -->\n### New\n- The About page.');
    assert.equal(changelogSection(CHANGELOG, '0.6.0'), null);
    assert.equal(changelogSection('## 0.6.0\n\n', '0.6.0'), null);
  });

  it('turns markdown into headings, items and paragraphs of plain text', () => {
    const notes = parseReleaseNotes(
      [
        '### Новое',
        '- Флаги **стран** вместо `кодов`,',
        '  и ещё строка.',
        '  - вложенный [пункт](https://example.org)',
        '* *курсив* и snake_case_name',
        '',
        '---',
        'Абзац',
        'в две строки.',
        '<!-- заметка для себя -->',
      ].join('\n'),
    );
    assert.deepEqual(notes.ru, [
      { kind: 'heading', text: 'Новое' },
      { kind: 'item', text: 'Флаги стран вместо кодов, и ещё строка.' },
      { kind: 'subitem', text: 'вложенный пункт' },
      { kind: 'item', text: 'курсив и snake_case_name' },
      { kind: 'paragraph', text: 'Абзац в две строки.' },
    ]);
  });

  it('keeps each language apart, shares the text above the marks and falls back to the other language', () => {
    const notes = parseReleaseNotes('Общее\n\n<!-- ru -->\n- Пункт\n<!-- en -->\n- Item');
    assert.deepEqual(notes.ru.map((block) => block.text), ['Общее', 'Пункт']);
    assert.deepEqual(notes.en.map((block) => block.text), ['Общее', 'Item']);

    const russianOnly = parseReleaseNotes('<!-- ru -->\n- Только по-русски');
    assert.deepEqual(russianOnly.en, russianOnly.ru);
  });

  it('reads the changelog the build carries', async () => {
    const markdown = await readFile(path.join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8');
    const releases = bundledReleases(markdown);
    assert.ok(releases.length > 0);
    for (const entry of releases) {
      assert.ok(entry.notes.ru.length > 0 && entry.notes.en.length > 0, `notes of ${entry.version}`);
      assert.notDeepEqual(entry.notes.ru, entry.notes.en, `both languages of ${entry.version}`);
    }
  });
});

describe('GitHub releases', () => {
  it('keeps published releases and betas with version tags', () => {
    const releases = parseGithubReleases([
      {
        tag_name: 'v0.7.0',
        published_at: '2026-10-26T18:00:00Z',
        html_url: 'https://github.com/tergride/tfaf/releases/tag/v0.7.0',
        body: '<!-- ru -->\n- Пункт\n<!-- en -->\n- Item',
        draft: false,
        prerelease: false,
      },
      { tag_name: 'v0.8.0', draft: true },
      { tag_name: 'v0.8.0-beta.1', prerelease: true, body: '- Бета' },
      { tag_name: 'nightly' },
      { tag_name: 'v0.6.0', body: null, html_url: 'javascript:alert(1)' },
      'junk',
    ]);
    assert.deepEqual(releases, [
      {
        version: '0.7.0',
        date: '2026-10-26',
        notes: { ru: [{ kind: 'item', text: 'Пункт' }], en: [{ kind: 'item', text: 'Item' }] },
        url: 'https://github.com/tergride/tfaf/releases/tag/v0.7.0',
      },
      { version: '0.8.0-beta.1', date: null, notes: { ru: [{ kind: 'item', text: 'Бета' }], en: [{ kind: 'item', text: 'Бета' }] }, url: null },
      { version: '0.6.0', date: null, notes: { ru: [], en: [] }, url: null },
    ]);
    assert.throws(() => parseGithubReleases({ message: 'Not Found' }));
  });

  it("prefers GitHub's notes and the changelog's dates, keeps versions only the build knows and sorts newest first", () => {
    const merged = mergeReleases(
      [
        { ...release('0.7.0', 'from GitHub', 'https://github.com/x/y/releases/tag/v0.7.0'), date: '2026-10-30' },
        { ...release('0.6.0', ''), date: '2026-10-30' },
      ],
      [{ ...release('0.6.0', 'from the build'), date: '2026-10-01' }, release('0.7.0', 'from the build'), release('0.10.0', 'not published yet')],
    );
    assert.deepEqual(
      merged.map((entry) => [entry.version, entry.notes.en[0]?.text, entry.date, entry.url]),
      [
        ['0.10.0', 'not published yet', null, null],
        ['0.7.0', 'from GitHub', '2026-10-30', 'https://github.com/x/y/releases/tag/v0.7.0'],
        ['0.6.0', 'from the build', '2026-10-01', null],
      ],
    );
  });
});

describe('release visibility', () => {
  const releases = [release('0.17.0-beta.2', ''), release('0.17.0-beta.1', ''), release('0.16.0', '')];

  it('shows betas only to players who take them', () => {
    assert.deepEqual(visibleReleases(releases, { betas: true, current: '0.16.0' }).map((entry) => entry.version), ['0.17.0-beta.2', '0.17.0-beta.1', '0.16.0']);
    assert.deepEqual(visibleReleases(releases, { betas: false, current: '0.16.0' }).map((entry) => entry.version), ['0.16.0']);
  });

  it('keeps the beta a player runs after betas were turned off', () => {
    assert.deepEqual(visibleReleases(releases, { betas: false, current: '0.17.0-beta.1' }).map((entry) => entry.version), ['0.17.0-beta.1', '0.16.0']);
  });
});
