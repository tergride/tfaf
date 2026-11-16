import type { Tutorial, TutorialCategory } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asBoolean, asNumber, asObject, asString, type Resource, resolveDocument } from '../api/jsonApi.ts';
import type { GameRunner } from '../game/gameRunner.ts';
import { t } from '../i18n.ts';
import { isSafeFolderName } from '../vault/fsUtil.ts';
import { extractLinks, htmlToText, httpsUrlOrNull } from './html.ts';

const LIST_CACHE_MS = 30 * 60 * 1000;
const MAX_MAP_NAME_LENGTH = 255;

function toTutorial(resource: Resource): (Tutorial & { ordinal: number }) | null {
  const title = asString(resource.title) ?? asString(resource.titleKey);
  if (!title) {
    return null;
  }
  const mapVersion = asObject(resource.mapVersion);
  const description = asString(resource.description) ?? '';
  return {
    id: resource.id,
    title,
    description: htmlToText(description),
    links: extractLinks(description),
    imageUrl: httpsUrlOrNull(resource.imageUrl),
    launchable: asBoolean(resource.launchable) && Boolean(asString(resource.technicalName)),
    mapName: asString(asObject(mapVersion?.map)?.displayName),
    mapFolderName: asString(mapVersion?.folderName),
    mapPreviewUrl: httpsUrlOrNull(mapVersion?.thumbnailUrlLarge),
    ordinal: asNumber(resource.ordinal) ?? 0,
  };
}

/** Categories as the API lists them, each with its tutorials in their intended order. */
export function parseTutorialCategories(document: unknown): TutorialCategory[] {
  return resolveDocument(document).items.flatMap((category): TutorialCategory[] => {
    const tutorials = (Array.isArray(category.tutorials) ? category.tutorials : [])
      .map((tutorial) => (asObject(tutorial) ? toTutorial(tutorial as Resource) : null))
      .filter((tutorial) => tutorial !== null)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(({ ordinal: _ordinal, ...tutorial }) => tutorial);
    const name = asString(category.category) ?? asString(category.categoryKey);
    return name && tutorials.length > 0 ? [{ name, tutorials }] : [];
  });
}

/** What the game needs to start a tutorial: its scenario and the vault map that holds it. */
export function parseTutorialLaunch(document: unknown): { title: string; scenario: string; mapFolderName: string | null } {
  const tutorial = resolveDocument(document).items[0];
  const scenario = asString(tutorial?.technicalName);
  if (!tutorial || !asBoolean(tutorial.launchable) || !scenario || scenario.length > MAX_MAP_NAME_LENGTH) {
    throw new Error(t('main.info.tutorialNotLaunchable'));
  }
  const mapFolderName = asString(asObject(tutorial.mapVersion)?.folderName);
  if (mapFolderName !== null && !isSafeFolderName(mapFolderName)) {
    throw new Error(t('main.api.invalidMapData'));
  }
  return { title: asString(tutorial.title) ?? scenario, scenario, mapFolderName };
}

export class TutorialService {
  private readonly api: FafApi;
  private readonly games: GameRunner;

  constructor(api: FafApi, games: GameRunner) {
    this.api = api;
    this.games = games;
  }

  async list(): Promise<TutorialCategory[]> {
    return parseTutorialCategories(
      await this.api.getCached(
        '/data/tutorialCategory',
        { include: 'tutorials,tutorials.mapVersion,tutorials.mapVersion.map', 'page[size]': '1000' },
        LIST_CACHE_MS,
      ),
    );
  }

  async launch(tutorialId: string): Promise<void> {
    const tutorial = parseTutorialLaunch(await this.api.get(`/data/tutorial/${tutorialId}`, { include: 'mapVersion' }));
    await this.games.launchOffline(tutorial.title, 'tutorials', tutorial.scenario, tutorial.mapFolderName);
  }
}
