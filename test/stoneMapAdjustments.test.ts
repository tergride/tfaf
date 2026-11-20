// Marker adjustments must behave as in StoneMap's own editor: the same drafts reach the API.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  commitDraft,
  mapPoint,
  placementPixels,
  previewMove,
  redoDraft,
  samePositions,
  sceneDraft,
  unchangedIssues,
  undoDraft,
  type AdjustmentHistory,
} from '../src/shared/stoneMap/adjustments.ts';
import type { AdjustmentPlacementMap, AdjustmentScene, MapAdjustments } from '../src/shared/stoneMap/contracts.ts';

function object(id: string, x: number, z: number, ownerSpawnId: string | null = null) {
  return { id, kind: id.split(':')[0] ?? '', name: id, x, z, teamId: null, ownerSpawnId, isDeleted: false };
}

describe('StoneMap marker adjustments', () => {
  it('maps a pointer to map units through the picture on screen', () => {
    assert.deepEqual(mapPoint(300, 250, { left: 100, top: 50, width: 400, height: 400 }, 1024), { x: 512, z: 512 });
    assert.deepEqual(mapPoint(300, 250, { left: -100, top: -150, width: 800, height: 800 }, 1024), { x: 512, z: 512 });
  });

  it('moves the mirrored spawn with the resources of both bases', () => {
    const scene: AdjustmentScene = {
      version: 1,
      mapSize: 256,
      baseFingerprint: 'root',
      spawnSymmetry: 'POINT2',
      teamSymmetry: 'XZ',
      objects: [object('spawn:0', 60.5, 70.5), object('spawn:1', 195.5, 185.5), object('mex:0', 68.5, 70.5, 'spawn:0'), object('mex:1', 187.5, 185.5, 'spawn:1')],
      groups: [
        { id: 'spawn:0', error: null, members: [{ id: 'spawn:0', operations: [0] }, { id: 'spawn:1', operations: [1] }] },
        { id: 'mex:0', error: null, members: [{ id: 'mex:0', operations: [0] }, { id: 'mex:1', operations: [1] }] },
      ],
      transforms: [
        { a: 1, b: 0, c: 0, d: 1, x: 0, z: 0 },
        { a: -1, b: 0, c: 0, d: -1, x: 256, z: 256 },
      ],
    };
    const original = sceneDraft(scene);
    const moved = previewMove(scene, original, 'spawn:1', 193.5, 182.5);
    assert.deepEqual(moved.positions, [
      { id: 'spawn:0', x: 62.5, z: 73.5 },
      { id: 'spawn:1', x: 193.5, z: 182.5 },
      { id: 'mex:0', x: 70.5, z: 73.5 },
      { id: 'mex:1', x: 185.5, z: 182.5 },
    ]);
    assert.equal(samePositions(original, sceneDraft(scene)), true);
    assert.equal(samePositions(original, moved), false);
  });

  it('undoes and redoes moves and deletions, and a new change drops the redo branch', () => {
    const original: MapAdjustments = { version: 1, baseFingerprint: 'base', positions: [{ id: 'mex:0', x: 20.5, z: 40.5 }, { id: 'mex:1', x: 235.5, z: 215.5 }] };
    const moved: MapAdjustments = { ...original, positions: [{ id: 'mex:0', x: 25.5, z: 40.5 }, { id: 'mex:1', x: 230.5, z: 215.5 }] };
    const deleted: MapAdjustments = { ...moved, version: 2, deletedIds: ['mex:0', 'mex:1'] };
    const initial: AdjustmentHistory = { draft: original, undo: [], redo: [] };
    const removal = commitDraft(commitDraft(initial, moved), deleted);
    assert.deepEqual(undoDraft(removal).draft, moved);
    assert.deepEqual(undoDraft(undoDraft(removal)).draft, original);
    assert.deepEqual(redoDraft(redoDraft(undoDraft(undoDraft(removal)))).draft, deleted);
    const branched = commitDraft(undoDraft(removal), { ...moved, positions: moved.positions.map((p) => ({ ...p, z: p.z + 1 })) });
    assert.equal(branched.redo.length, 0);
    assert.equal(redoDraft(branched), branched);
    assert.equal(initial.undo.length, 0);
  });

  it('keeps the problems of markers that did not move or go', () => {
    const original: MapAdjustments = {
      version: 1,
      baseFingerprint: 'root',
      positions: [{ id: 'mex:0', x: 20.5, z: 40.5 }, { id: 'mex:1', x: 235.5, z: 215.5 }, { id: 'hydro:0', x: 80.5, z: 80.5 }],
    };
    const issues = [
      { objectId: 'mex:0', message: 'slope' },
      { objectId: 'mex:1', message: 'shore' },
      { objectId: 'hydro:0', message: 'collision' },
    ];
    const moved = { ...original, positions: original.positions.map((p) => (p.id.startsWith('mex:') ? { ...p, x: p.x + 1 } : p)) };
    assert.deepEqual(unchangedIssues(issues, original, original), issues);
    assert.deepEqual(unchangedIssues(issues, original, moved), [issues[2]]);
    assert.deepEqual(unchangedIssues(issues, original, { ...original, version: 2, deletedIds: ['mex:0', 'mex:1'] }), [issues[2]]);
  });

  it('paints only the blocked cells of a placement mask and refuses other masks', () => {
    const map: AdjustmentPlacementMap = { version: 1, mapSize: 4, width: 4, height: 4, cellSize: 1, scope: '', blocked: Buffer.from([1, 128]).toString('base64') };
    const pixels = placementPixels(map);
    assert.deepEqual(Array.from(pixels.slice(0, 4)), [225, 56, 65, 92]);
    assert.deepEqual(Array.from(pixels.slice(4, 8)), [0, 0, 0, 0]);
    assert.equal(pixels[15 * 4 + 3], 92);
    assert.throws(() => placementPixels({ ...map, blocked: '' }));
    assert.throws(() => placementPixels({ ...map, version: 2 }));
    assert.throws(() => placementPixels({ ...map, width: 2048 }));
  });
});
