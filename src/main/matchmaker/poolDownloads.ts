import type { LobbyNotice, MapPoolBracket } from '../../shared/contract.ts';
import { mapLimited } from '../concurrency.ts';
import { describeError } from '../errors.ts';
import { t } from '../i18n.ts';
import type { MapGenerator } from '../vault/mapGenerator.ts';
import type { MapService } from '../vault/mapService.ts';

const MAP_DOWNLOADS = 3;

export interface PoolDownload {
  maps: Pick<MapService, 'ensureInstalled'>;
  generator: Pick<MapGenerator, 'prepare'>;
  /** The queue's technical name, for the log, and its title, for the user. */
  queue: string;
  title: string;
  /** Stopping the search cancels the downloads. */
  signal: AbortSignal;
  /** Runs downloads without a toast each, under `signal`. */
  quietly<T>(work: () => Promise<T>): Promise<T>;
  /** What the preparation line shows now. */
  progress(text: string): void;
  notice(style: LobbyNotice['style'], text: string): void;
}

/**
 * Every map of every bracket, as the official client downloads them (MapService.downloadAllMatchmakerMaps), and the map
 * generators of the generated ones. A map that fails is reported, not fatal.
 */
export async function downloadPoolMaps(brackets: MapPoolBracket[], download: PoolDownload): Promise<void> {
  const { signal, queue, title } = download;
  const maps = brackets.flatMap((bracket) => bracket.maps);
  const folders = [...new Set(maps.flatMap((map) => (map.folderName ? [map.folderName] : [])))];
  const versions = [...new Set(maps.flatMap((map) => (map.generated?.version ? [map.generated.version] : [])))];
  const failed: string[] = [];
  let done = 0;
  const progress = (): void => download.progress(t('main.matchmaker.preparing.maps', { queue: title, done, total: folders.length }));
  progress();
  await download.quietly(() =>
    mapLimited(folders, MAP_DOWNLOADS, async (folder) => {
      if (signal.aborted) {
        return;
      }
      try {
        await download.maps.ensureInstalled(folder);
      } catch (error) {
        console.warn(`Map ${folder} of queue ${queue} could not be downloaded`, describeError(error));
        failed.push(folder);
      }
      done++;
      progress();
    }),
  );
  if (signal.aborted) {
    return;
  }
  // Generated maps are made when the match starts; Java and the generator are fetched now so that it is quick then.
  for (const version of versions) {
    if (signal.aborted) {
      return;
    }
    download.progress(t('main.matchmaker.preparing.generator', { version }));
    await download.generator.prepare(version).catch((error: unknown) => {
      console.warn(`Map generator ${version} could not be prepared`, describeError(error));
      download.notice('warning', t('main.matchmaker.generatorFailed', { version, error: describeError(error) }));
    });
  }
  if (failed.length > 0) {
    const names = `${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`;
    download.notice('warning', t('main.matchmaker.mapsFailed', { failed: failed.length, total: folders.length, queue: title, maps: names }));
  }
}
