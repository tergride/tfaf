import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDocument } from '../src/main/api/jsonApi.ts';
import { newerVersions } from '../src/main/vault/latestVersions.ts';

function mapVersions(latest: { id: string; folderName: string; hidden?: boolean }): ReturnType<typeof resolveDocument> {
  return resolveDocument({
    data: [
      {
        type: 'mapVersion',
        id: '10',
        attributes: { folderName: 'Seton_s_Clutch.v0002' },
        relationships: { map: { data: { type: 'map', id: '1' } } },
      },
    ],
    included: [
      { type: 'map', id: '1', relationships: { latestVersion: { data: { type: 'mapVersion', id: latest.id } } } },
      { type: 'mapVersion', id: latest.id, attributes: { folderName: latest.folderName, hidden: latest.hidden ?? false } },
    ],
  });
}

describe('newer vault versions for hosting', () => {
  it('finds the latest version of a map, by folder name in any case', () => {
    const newer = newerVersions(mapVersions({ id: '12', folderName: 'seton_s_clutch.v0003' }).items, 'map', 'folderName');
    assert.equal(newer.get('seton_s_clutch.v0002'), 'seton_s_clutch.v0003');
  });

  it('keeps the chosen version when it is the latest, hidden or newer than the listed one', () => {
    assert.equal(newerVersions(mapVersions({ id: '10', folderName: 'Seton_s_Clutch.v0002' }).items, 'map', 'folderName').size, 0);
    assert.equal(newerVersions(mapVersions({ id: '12', folderName: 'x.v0003', hidden: true }).items, 'map', 'folderName').size, 0);
    assert.equal(newerVersions(mapVersions({ id: '9', folderName: 'x.v0001' }).items, 'map', 'folderName').size, 0);
  });

  it('maps every mod uid to the uid of its latest version', () => {
    const document = resolveDocument({
      data: [
        { type: 'modVersion', id: '5', attributes: { uid: 'old-a' }, relationships: { mod: { data: { type: 'mod', id: 'a' } } } },
        { type: 'modVersion', id: '7', attributes: { uid: 'b' }, relationships: { mod: { data: { type: 'mod', id: 'b' } } } },
      ],
      included: [
        { type: 'mod', id: 'a', relationships: { latestVersion: { data: { type: 'modVersion', id: '6' } } } },
        { type: 'modVersion', id: '6', attributes: { uid: 'new-a' } },
        { type: 'mod', id: 'b', relationships: { latestVersion: { data: { type: 'modVersion', id: '7' } } } },
      ],
    });
    assert.deepEqual([...newerVersions(document.items, 'mod', 'uid')], [['old-a', 'new-a']]);
  });
});
