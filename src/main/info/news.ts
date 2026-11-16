import type { NewsItem } from '../../shared/contract.ts';
import { asObject, asString } from '../api/jsonApi.ts';
import type { AuthService } from '../auth/authService.ts';
import { t } from '../i18n.ts';
import { fetchWithTimeout, retrying } from '../net/http.ts';
import { htmlToText, httpsUrlOrNull, truncate } from './html.ts';

const EXCERPT_LENGTH = 400;
const REQUEST_TIMEOUT_MS = 15_000;

// Editors sometimes leave out the scheme ("youtube.com/watch?v=...").
function linkOf(value: unknown): string | null {
  const link = asString(value)?.trim();
  if (!link) {
    return null;
  }
  return httpsUrlOrNull(/^[a-z][a-z\d+.-]*:/i.test(link) ? link : `https://${link}`);
}

/** Entries of `newshub.json`, the feed behind the news page of the FAF website and of the official client. */
export function parseNews(value: unknown): NewsItem[] {
  if (!Array.isArray(value)) {
    throw new Error(t('main.info.newsFormat'));
  }
  return value.flatMap((entry, index): NewsItem[] => {
    const raw = asObject(entry);
    const title = asString(raw?.title);
    if (!raw || !title) {
      return [];
    }
    const link = linkOf(raw.link);
    return [
      {
        id: link ?? `news-${index}`,
        title: htmlToText(title),
        excerpt: truncate(htmlToText(asString(raw.content) ?? ''), EXCERPT_LENGTH),
        link,
        date: asString(raw.date),
        author: asString(raw.author),
        imageUrl: httpsUrlOrNull(raw.media),
      },
    ];
  });
}

export class NewsService {
  private readonly auth: AuthService;
  private readonly userAgent: string;

  constructor(auth: AuthService, userAgent: string) {
    this.auth = auth;
    this.userAgent = userAgent;
  }

  async list(): Promise<NewsItem[]> {
    const url = `${this.auth.getServer().websiteBaseUrl}/data/newshub.json`;
    const response = await retrying(() =>
      fetchWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': this.userAgent } }, REQUEST_TIMEOUT_MS),
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(t('main.info.newsStatus', { status: response.status }));
    }
    return parseNews(await response.json());
  }
}
