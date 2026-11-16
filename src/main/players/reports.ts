// Reports to the FAF moderators (`moderationReport` of the API), as the official client's report dialog sends them.

import {
  type ModerationReportInput,
  type ModerationReportItem,
  REPORT_STATUSES,
  type ReportStatus,
} from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asObject, asString, resolveDocument } from '../api/jsonApi.ts';
import { rsqlAnd, rsqlEquals, rsqlQuote } from '../api/rsql.ts';
import { t } from '../i18n.ts';

const LIST_PAGE_SIZE = '100';
// The official client lists the reports of the last year.
const LIST_DAYS = 365;

/** The JSON:API document that creates a report; the reporter is the signed-in player. */
export function reportDocument(report: ModerationReportInput, reporterId: number): unknown {
  return {
    data: {
      type: 'moderationReport',
      attributes: {
        reportDescription: report.description,
        gameIncidentTimecode: report.incidentTime || null,
      },
      relationships: {
        reporter: { data: { type: 'player', id: String(reporterId) } },
        reportedUsers: { data: report.players.map((id) => ({ type: 'player', id: String(id) })) },
        ...(report.gameId === null ? {} : { game: { data: { type: 'game', id: String(report.gameId) } } }),
      },
    },
  };
}

function reportStatus(value: unknown): ReportStatus {
  const status = asString(value)?.toLowerCase();
  return REPORT_STATUSES.find((known) => known === status) ?? 'awaiting';
}

/** Reports with their reported players included, newest first. */
export function parseReports(document: unknown): ModerationReportItem[] {
  return resolveDocument(document)
    .items.map((resource): ModerationReportItem => {
      const gameId = Number(asString(asObject(resource.game)?.id));
      const reported = Array.isArray(resource.reportedUsers) ? resource.reportedUsers : [];
      return {
        id: resource.id,
        createdAt: asString(resource.createTime),
        status: reportStatus(resource.reportStatus),
        description: asString(resource.reportDescription) ?? '',
        reported: reported.map((player) => asString(asObject(player)?.login) ?? `#${asString(asObject(player)?.id) ?? '?'}`),
        gameId: Number.isSafeInteger(gameId) && gameId > 0 ? gameId : null,
        incidentTime: asString(resource.gameIncidentTimecode),
        moderatorNotice: asString(resource.moderatorNotice),
      };
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Ids of the players of a game from `/data/game` with `playerStats` included. */
export function gameParticipants(document: unknown): Set<number> {
  const ids = new Set<number>();
  for (const game of resolveDocument(document).items) {
    for (const stats of Array.isArray(game.playerStats) ? game.playerStats : []) {
      const id = Number(asString(asObject(asObject(stats)?.player)?.id));
      if (Number.isSafeInteger(id)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

export class ReportService {
  private readonly api: FafApi;
  private readonly selfId: () => number | null;

  constructor(api: FafApi, selfId: () => number | null) {
    this.api = api;
    this.selfId = selfId;
  }

  async list(): Promise<ModerationReportItem[]> {
    const since = new Date(Date.now() - LIST_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const document = await this.api.get('/data/moderationReport', {
      filter: rsqlAnd([rsqlEquals('reporter.id', this.requireSelf()), `createTime=ge=${rsqlQuote(since)}`]),
      include: 'reportedUsers',
      sort: '-createTime',
      'page[size]': LIST_PAGE_SIZE,
    });
    return parseReports(document);
  }

  /** As in the official client, a report about a game names only players who played in it. */
  async submit(report: ModerationReportInput): Promise<void> {
    const reporterId = this.requireSelf();
    if (report.players.includes(reporterId)) {
      throw new Error(t('main.reports.reportSelf'));
    }
    if (report.gameId !== null) {
      const document = await this.api.get('/data/game', {
        filter: rsqlEquals('id', report.gameId),
        include: 'playerStats',
        'fields[game]': 'playerStats',
        'fields[gamePlayerStats]': 'player',
      });
      if (resolveDocument(document).items.length === 0) {
        throw new Error(t('main.reports.gameNotFound', { id: report.gameId }));
      }
      const participants = gameParticipants(document);
      if (report.players.some((id) => !participants.has(id))) {
        throw new Error(t('main.reports.notInGame', { id: report.gameId }));
      }
    }
    await this.api.post('/data/moderationReport', reportDocument(report, reporterId));
  }

  private requireSelf(): number {
    const id = this.selfId();
    if (id === null) {
      throw new Error(t('main.reports.signedOut'));
    }
    return id;
  }
}
