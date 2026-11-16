import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapListParams, modListParams } from '../src/main/vault/vaultQueries.ts';

describe('vault listings', () => {
  it('lists every visible map without filters', () => {
    assert.deepEqual(mapListParams({ page: 1, pageSize: 30, sortField: 'gamesPlayed', sortOrder: 'desc' }, null), {
      filter: 'latestVersion.hidden==false',
      sort: '-gamesPlayed',
    });
  });

  it('combines the map filters, matching a size on either side', () => {
    const params = mapListParams(
      {
        page: 2,
        pageSize: 30,
        name: 'Set"on',
        author: 'Gyle',
        players: [2, 4],
        sizes: [256, 512],
        onlyRanked: true,
        onlyRecommended: true,
        onlyOwn: true,
        sortField: 'displayName',
        sortOrder: 'asc',
      },
      7,
    );
    assert.equal(
      params.filter,
      'latestVersion.hidden==false;displayName=="*Set\\"on*";author.login=="*Gyle*";latestVersion.maxPlayers=in=(2,4);' +
        '(latestVersion.width=in=(256,512),latestVersion.height=in=(256,512));latestVersion.ranked==true;recommended==true;' +
        'author.id==7',
    );
    assert.equal(params.sort, 'displayName');
  });

  it('needs a signed-in player for their own maps', () => {
    assert.throws(
      () => mapListParams({ page: 1, pageSize: 30, onlyOwn: true, sortField: 'gamesPlayed', sortOrder: 'desc' }, null),
      /вход/,
    );
  });

  it('combines the mod filters', () => {
    assert.deepEqual(
      modListParams({
        page: 1,
        pageSize: 30,
        name: 'Nomads',
        author: 'Exotic',
        type: 'SIM',
        onlyRanked: true,
        onlyRecommended: true,
        sortField: 'reviewsSummary.lowerBound',
        sortOrder: 'desc',
      }),
      {
        filter:
          'latestVersion.hidden==false;displayName=="*Nomads*";author=="*Exotic*";latestVersion.type=="SIM";' +
          'latestVersion.ranked==true;recommended==true',
        sort: '-reviewsSummary.lowerBound',
      },
    );
  });
});
