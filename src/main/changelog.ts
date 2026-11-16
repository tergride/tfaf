// Release notes of the launcher. They are written in CHANGELOG.md, a `## <version> — <date>` section per version
// with `<!-- ru -->` and `<!-- en -->` parts. A version's section is also the text of its GitHub release, and the
// build carries the whole file. The interface gets plain blocks of text, never markdown or HTML.

import type { AppRelease, ReleaseNoteBlock } from '../shared/contract.ts';
import type { Locale } from '../shared/i18n/index.ts';
import { compareVersions, isPrerelease, parseVersion } from '../shared/versions.ts';
import { asObject, asString } from './api/jsonApi.ts';
import { t } from './i18n.ts';

export interface ChangelogSection {
  version: string;
  date: string | null;
  /** The markdown under the heading, as it goes into the GitHub release. */
  body: string;
}

// A beta's section is headed with its full version, `## 0.17.0-beta.1 — 2026-11-09`.
const SECTION_HEADING = /^##\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const LANGUAGE_MARK = /^<!--\s*(ru|en)\s*-->$/;
/* eslint-disable regexp/no-super-linear-backtracking -- anchored, on single lines of our own changelog */
const HEADING = /^#{1,6}\s+(.*?)\s*#*$/;
const ITEM = /^(\s*)[-*+]\s+(.*)$/;
/* eslint-enable regexp/no-super-linear-backtracking */
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const COMMENT = /^\s*<!--.*-->\s*$/;

/** Sections in the order of the file. A `##` heading that is not a version ends the section above and is skipped. */
export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: { version: string; date: string | null; lines: string[] } | null = null;
  const finish = (): void => {
    if (current) {
      sections.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() });
    }
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^##\s/.test(line)) {
      current?.lines.push(line);
      continue;
    }
    finish();
    const match = SECTION_HEADING.exec(line);
    const version = match ? parseVersion(match[1] ?? '') : null;
    current = version ? { version, date: match?.[2] ?? null, lines: [] } : null;
  }
  finish();
  return sections;
}

/** The text of a version's GitHub release; null when the changelog has no notes for it. */
export function changelogSection(markdown: string, version: string): string | null {
  return parseChangelog(markdown).find((section) => section.version === version)?.body || null;
}

/** Inline markup goes: links and images keep their text, code and bold lose their marks. */
function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBlocks(lines: readonly string[]): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  // The paragraph or item that a following line without a mark of its own continues.
  let open: ReleaseNoteBlock | null = null;
  for (const line of lines) {
    if (!line.trim() || RULE.test(line) || COMMENT.test(line)) {
      open = null;
      continue;
    }
    const heading = HEADING.exec(line);
    const item = ITEM.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] ?? '' });
      open = null;
    } else if (item) {
      open = { kind: (item[1] ?? '').length >= 2 ? 'subitem' : 'item', text: item[2] ?? '' };
      blocks.push(open);
    } else if (open) {
      open.text = `${open.text} ${line.trim()}`;
    } else {
      open = { kind: 'paragraph', text: line.trim() };
      blocks.push(open);
    }
  }
  return blocks.map((block) => ({ kind: block.kind, text: plainText(block.text) })).filter((block) => block.text);
}

/** Notes in each language: text above the first language mark goes to both, and a missing language gets the other. */
export function parseReleaseNotes(markdown: string): Record<Locale, ReleaseNoteBlock[]> {
  const parts: Record<Locale | 'common', string[]> = { common: [], ru: [], en: [] };
  let target: Locale | 'common' = 'common';
  for (const line of markdown.split(/\r?\n/)) {
    const mark = LANGUAGE_MARK.exec(line.trim());
    if (mark) {
      target = mark[1] === 'en' ? 'en' : 'ru';
    } else {
      parts[target].push(line);
    }
  }
  const common = parseBlocks(parts.common);
  const ru = parseBlocks(parts.ru);
  const en = parseBlocks(parts.en);
  return { ru: [...common, ...(ru.length ? ru : en)], en: [...common, ...(en.length ? en : ru)] };
}

export function bundledReleases(markdown: string): AppRelease[] {
  return parseChangelog(markdown).map((section) => ({
    version: section.version,
    date: section.date,
    notes: parseReleaseNotes(section.body),
    url: null,
  }));
}

function githubPageOrNull(value: string | null): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Releases from `GET /repos/{owner}/{repo}/releases`; drafts and tags other than `v1.2.3` or `v1.2.3-beta.1` are left
 * out. Betas stay in: visibleReleases decides who sees them.
 */
export function parseGithubReleases(value: unknown): AppRelease[] {
  if (!Array.isArray(value)) {
    throw new Error(t('main.appUpdates.releasesFormat'));
  }
  return value.flatMap((entry): AppRelease[] => {
    const raw = asObject(entry);
    const version = parseVersion(asString(raw?.tag_name) ?? '');
    if (!raw || !version || raw.draft === true) {
      return [];
    }
    const published = asString(raw.published_at);
    return [
      {
        version,
        date: published && /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null,
        notes: parseReleaseNotes(asString(raw.body) ?? ''),
        url: githubPageOrNull(asString(raw.html_url)),
      },
    ];
  });
}

/**
 * Newest first. GitHub's notes win over the changelog in the build unless the release has none, while the changelog's
 * date wins: a release only knows when it was published, and old versions were published later. Versions only the
 * build knows (not published yet, or GitHub out of reach) come from the changelog.
 */
export function mergeReleases(remote: readonly AppRelease[], bundled: readonly AppRelease[]): AppRelease[] {
  const byVersion = new Map(bundled.map((release) => [release.version, release]));
  for (const release of remote) {
    const known = byVersion.get(release.version);
    const hasNotes = release.notes.ru.length > 0 || release.notes.en.length > 0;
    byVersion.set(release.version, {
      ...release,
      date: known?.date ?? release.date,
      notes: hasNotes || !known ? release.notes : known.notes,
    });
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** Betas are shown to players who take them, and to everyone running one; other versions to everyone. */
export function visibleReleases(releases: readonly AppRelease[], options: { betas: boolean; current: string }): AppRelease[] {
  return releases.filter((release) => options.betas || !isPrerelease(release.version) || release.version === options.current);
}
