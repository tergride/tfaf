import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readAllPages, resolveDocument } from '../src/main/api/jsonApi.ts';
import { rsqlContains } from '../src/main/api/rsql.ts';
import { toVaultMap, toVaultMod } from '../src/main/vault/apiMappers.ts';

describe('readAllPages', () => {
  const page = (id: number, totalPages: number): unknown => ({
    data: [{ type: 'mapVersion', id: String(id), relationships: { map: { data: { type: 'map', id: '1' } } } }],
    ...(id === 1 ? { included: [{ type: 'map', id: '1', attributes: { displayName: 'Dual Gap' } }] } : {}),
    meta: { page: { totalPages } },
  });

  it('joins the pages, so that a later one reaches what the first included', async () => {
    const document = resolveDocument(await readAllPages(async (number) => page(number, 3)));
    assert.deepEqual(document.items.map((version) => version.id), ['1', '2', '3']);
    assert.deepEqual(document.items[2]?.map, { id: '1', $type: 'map', displayName: 'Dual Gap' });
  });

  it('reads a list of one page once', async () => {
    const read: number[] = [];
    await readAllPages(async (number) => {
      read.push(number);
      return page(number, 1);
    });
    assert.deepEqual(read, [1]);
  });

  it('stops at a thousand resources', async () => {
    const read: number[] = [];
    await readAllPages(async (number) => {
      read.push(number);
      return page(number, 36);
    });
    assert.equal(read.length, 10);
  });

  it('refuses an answer that is not a document', async () => {
    await assert.rejects(readAllPages(async () => null));
  });
});

describe('resolveDocument', () => {
  it('inlines included resources and reads the page count', () => {
    const document = resolveDocument({
      data: [
        {
          type: 'map',
          id: '42',
          attributes: { displayName: 'Dual Gap', gamesPlayed: 1000, recommended: true },
          relationships: {
            latestVersion: { data: { type: 'mapVersion', id: '7' } },
            author: { data: { type: 'player', id: '5' } },
            reviewsSummary: { data: { type: 'mapReviewsSummary', id: '9' } },
            versions: { data: [{ type: 'mapVersion', id: '7' }, { type: 'mapVersion', id: '6' }] },
          },
        },
      ],
      included: [
        {
          type: 'mapVersion',
          id: '7',
          attributes: {
            folderName: 'dualgap_adaptive.v0012',
            description: '<LOC x>Two lanes',
            version: 12,
            maxPlayers: 8,
            width: 1024,
            height: 512,
            ranked: true,
            thumbnailUrlSmall: 'https://content.faforever.com/maps/previews/small/dualgap_adaptive.v0012.png',
          },
        },
        { type: 'player', id: '5', attributes: { login: 'Mapper' } },
        { type: 'mapReviewsSummary', id: '9', attributes: { averageScore: 4.5, reviews: 20, lowerBound: 3.9 } },
      ],
      meta: { page: { totalPages: 3, totalRecords: 70 } },
    });

    assert.equal(document.totalPages, 3);
    assert.equal(document.totalRecords, 70);
    const versions = document.items[0]?.versions as { id: string }[];
    assert.deepEqual(
      versions.map((version) => version.id),
      ['7', '6'],
    );

    const map = toVaultMap(document.items[0]!);
    assert.deepEqual(map, {
      mapId: 42,
      versionId: 7,
      displayName: 'Dual Gap',
      folderName: 'dualgap_adaptive.v0012',
      description: 'Two lanes',
      version: '12',
      maxPlayers: 8,
      widthPx: 1024,
      heightPx: 512,
      ranked: true,
      recommended: true,
      gamesPlayed: 1000,
      author: 'Mapper',
      createTime: null,
      updateTime: null,
      thumbnailUrlSmall: 'https://content.faforever.com/maps/previews/small/dualgap_adaptive.v0012.png',
      thumbnailUrlLarge: null,
      reviews: { averageScore: 4.5, numReviews: 20, lowerBound: 3.9 },
    });
  });

  it('skips resources whose latest version was not included', () => {
    const document = resolveDocument({
      data: [{ type: 'mod', id: '1', attributes: { displayName: 'X' }, relationships: { latestVersion: { data: null } } }],
    });
    assert.equal(toVaultMod(document.items[0]!), null);
  });

  it('maps UI mods', () => {
    const document = resolveDocument({
      data: [
        {
          type: 'mod',
          id: '3',
          attributes: { displayName: 'Supreme Score Board', author: 'Crotalus' },
          relationships: { latestVersion: { data: { type: 'modVersion', id: '30' } } },
        },
      ],
      included: [{ type: 'modVersion', id: '30', attributes: { uid: 'ssb-uid', type: 'UI', version: 5 } }],
    });
    const mod = toVaultMod(document.items[0]!);
    assert.equal(mod?.type, 'UI');
    assert.equal(mod?.uid, 'ssb-uid');
    assert.equal(mod?.author, 'Crotalus');
    assert.equal(mod?.version, '5');
  });

  it('rejects malformed documents', () => {
    assert.throws(() => resolveDocument('nope'));
  });
});

describe('rsql', () => {
  it('quotes and escapes user input', () => {
    assert.equal(rsqlContains('displayName', 'a"b\\c'), 'displayName=="*a\\"b\\\\c*"');
  });
});
