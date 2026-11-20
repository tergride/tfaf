// Marker adjustments of a finished StoneMap map, as StoneMap's editor makes them: a draft holds every marker's
// position; moves and deletions go to the API, which applies them to the whole symmetry group. While a marker is
// dragged, previewMove shows the same group move locally; the API's answer on release is what counts.

import type { AdjustmentIssue, AdjustmentPlacementMap, AdjustmentScene, MapAdjustments } from './contracts.ts';

const HISTORY_DEPTH = 100;
const PLACEMENT_MAX_WIDTH = 512;
const BLOCKED_RGBA = [225, 56, 65, 92] as const;

export interface AdjustmentHistory {
  draft: MapAdjustments;
  undo: MapAdjustments[];
  redo: MapAdjustments[];
}

/** The draft of a scene as it is: every marker where it stands, deleted ones listed. */
export function sceneDraft(scene: AdjustmentScene): MapAdjustments {
  const deletedIds = scene.objects.filter((object) => object.isDeleted).map((object) => object.id);
  return {
    version: deletedIds.length > 0 ? 2 : 1,
    baseFingerprint: scene.baseFingerprint,
    positions: scene.objects.map((object) => ({ id: object.id, x: object.x, z: object.z })),
    ...(deletedIds.length > 0 ? { deletedIds } : {}),
  };
}

export function samePositions(a: MapAdjustments, b: MapAdjustments): boolean {
  const removed = new Set(b.deletedIds ?? []);
  return (
    a.positions.length === b.positions.length &&
    a.positions.every((position, index) => {
      const other = b.positions[index];
      return other !== undefined && position.id === other.id && position.x === other.x && position.z === other.z;
    }) &&
    (a.deletedIds?.length ?? 0) === removed.size &&
    (a.deletedIds ?? []).every((id) => removed.has(id))
  );
}

export function commitDraft(state: AdjustmentHistory, draft: MapAdjustments): AdjustmentHistory {
  return samePositions(state.draft, draft) ? state : { draft, undo: [...state.undo.slice(1 - HISTORY_DEPTH), state.draft], redo: [] };
}

export function undoDraft(state: AdjustmentHistory): AdjustmentHistory {
  const previous = state.undo.at(-1);
  return previous ? { draft: previous, undo: state.undo.slice(0, -1), redo: [state.draft, ...state.redo].slice(0, HISTORY_DEPTH) } : state;
}

export function redoDraft(state: AdjustmentHistory): AdjustmentHistory {
  const [next, ...rest] = state.redo;
  return next ? { draft: next, undo: [...state.undo.slice(1 - HISTORY_DEPTH), state.draft], redo: rest } : state;
}

/** A fix of one marker must not hide the unresolved problems of the others: issues stay on markers that did not move. */
export function unchangedIssues(issues: readonly AdjustmentIssue[], before: MapAdjustments, after: MapAdjustments): AdjustmentIssue[] {
  const previous = new Map(before.positions.map((position) => [position.id, position]));
  const next = new Map(after.positions.map((position) => [position.id, position]));
  const deleted = new Set(after.deletedIds ?? []);
  return issues.filter((issue) => {
    const a = previous.get(issue.objectId);
    const b = next.get(issue.objectId);
    return !deleted.has(issue.objectId) && a !== undefined && b !== undefined && a.x === b.x && a.z === b.z;
  });
}

/** A point of a rectangle on screen in map units. */
export function mapPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  mapSize: number,
): { x: number; z: number } {
  return { x: ((clientX - rect.left) * mapSize) / rect.width, z: ((clientY - rect.top) * mapSize) / rect.height };
}

/** The draft with a marker moved, its symmetry copies and, for a spawn, the resources of its base along with it. */
export function previewMove(scene: AdjustmentScene, draft: MapAdjustments, id: string, x: number, z: number): MapAdjustments {
  const positions = new Map(draft.positions.map((position) => [position.id, { ...position }]));
  const deleted = new Set(draft.deletedIds ?? []);
  if (deleted.has(id)) {
    return draft;
  }
  const group = scene.groups.find((candidate) => candidate.members.some((member) => member.id === id));
  if (!group || group.error) {
    return draft;
  }
  const move = (moved: typeof group, driver: string, toX: number, toZ: number): void => {
    const operation = moved.members.find((member) => member.id === driver)?.operations[0];
    const transform = operation === undefined ? undefined : scene.transforms[operation];
    if (!transform) {
      return;
    }
    const determinant = transform.a * transform.d - transform.b * transform.c;
    const cx = Math.floor((transform.d * (toX - transform.x) - transform.b * (toZ - transform.z)) / determinant) + 0.5;
    const cz = Math.floor((-transform.c * (toX - transform.x) + transform.a * (toZ - transform.z)) / determinant) + 0.5;
    for (const member of moved.members) {
      const own = scene.transforms[member.operations[0] ?? -1];
      if (own) {
        positions.set(member.id, {
          id: member.id,
          x: Math.floor(own.a * cx + own.b * cz + own.x) + 0.5,
          z: Math.floor(own.c * cx + own.d * cz + own.z) + 0.5,
        });
      }
    }
  };
  move(group, id, x, z);
  const spawnIds = new Set(group.members.filter((member) => member.id.startsWith('spawn:')).map((member) => member.id));
  for (const linked of spawnIds.size > 0 ? scene.groups : []) {
    if (deleted.has(linked.id)) {
      continue;
    }
    const resource = scene.objects.find(
      (object) => linked.members.some((member) => member.id === object.id) && object.ownerSpawnId !== null && spawnIds.has(object.ownerSpawnId),
    );
    if (!resource?.ownerSpawnId) {
      continue;
    }
    const before = draft.positions.find((position) => position.id === resource.ownerSpawnId);
    const after = positions.get(resource.ownerSpawnId);
    const point = positions.get(resource.id);
    if (before && after && point) {
      move(linked, resource.id, point.x + after.x - before.x, point.z + after.z - before.z);
    }
  }
  return { ...draft, positions: draft.positions.map((position) => positions.get(position.id) ?? position) };
}

/** RGBA pixels of a placement mask: translucent red where the chosen marker cannot stand, clear elsewhere. */
export function placementPixels(map: AdjustmentPlacementMap): Uint8ClampedArray {
  const valid =
    map.version === 1 &&
    Number.isInteger(map.width) &&
    map.width >= 1 &&
    map.width <= PLACEMENT_MAX_WIDTH &&
    map.height === map.width &&
    Number.isInteger(map.cellSize) &&
    map.cellSize >= 1 &&
    map.cellSize <= 4 &&
    map.mapSize === map.width * map.cellSize;
  if (!valid) {
    throw new RangeError('Unexpected placement mask');
  }
  const bits = atob(map.blocked);
  const count = map.width * map.height;
  if (bits.length !== Math.ceil(count / 8)) {
    throw new RangeError('Unexpected placement mask size');
  }
  const pixels = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index++) {
    if (bits.charCodeAt(index >> 3) & (1 << (index & 7))) {
      pixels.set(BLOCKED_RGBA, index * 4);
    }
  }
  return pixels;
}
