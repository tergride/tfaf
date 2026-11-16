import type { MapDecal } from '../../../../shared/contract.ts';

/** Corner, axis u and axis v of a decal in the map plane. */
export type DecalGeometry = [number, number, number, number, number, number];

/**
 * Where a decal lies: it turns about its corner, and a positive angle turns its u axis from east toward south, as in
 * the game and the FAF map editor.
 */
export function decalGeometry(decal: Pick<MapDecal, 'position' | 'rotation' | 'scale'>): DecalGeometry {
  const angle = decal.rotation[1];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [decal.position[0], decal.position[2], cos * decal.scale[0], sin * decal.scale[0], -sin * decal.scale[2], cos * decal.scale[2]];
}
