// Meshes of props in the game's SCM format, version 5. Static props are drawn in their bind pose, which is how the
// vertices are stored, so the bones are not needed.

import type { MapMesh } from '../../shared/contract.ts';

const SCM_MAGIC = 'MODL';
const SCM_VERSION = 5;
// Position, normal, tangent, binormal, two UV sets and four bone indices. Only the normal points out of closed meshes
// such as rocks, which is how its place was checked.
const VERTEX_BYTES = 68;
const NORMAL_OFFSET = 12;
const UV_OFFSET = 48;

/** The mesh, or null for a file that is not an SCM of version 5 or whose sections do not fit it. */
export function readScm(file: Uint8Array): MapMesh | null {
  const data = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (data.length < 48 || data.toString('latin1', 0, 4) !== SCM_MAGIC || data.readInt32LE(4) !== SCM_VERSION) {
    return null;
  }
  const vertexOffset = data.readInt32LE(16);
  const vertexCount = data.readInt32LE(24);
  const indexOffset = data.readInt32LE(28);
  const indexCount = data.readInt32LE(32);
  if (
    vertexCount <= 0 ||
    vertexCount > 0xffff + 1 ||
    indexCount <= 0 ||
    indexCount % 3 !== 0 ||
    vertexOffset < 0 ||
    indexOffset < 0 ||
    vertexOffset + vertexCount * VERTEX_BYTES > data.length ||
    indexOffset + indexCount * 2 > data.length
  ) {
    return null;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i++) {
    const vertex = vertexOffset + i * VERTEX_BYTES;
    for (let c = 0; c < 3; c++) {
      positions[i * 3 + c] = data.readFloatLE(vertex + c * 4);
      normals[i * 3 + c] = data.readFloatLE(vertex + NORMAL_OFFSET + c * 4);
    }
    uvs[i * 2] = data.readFloatLE(vertex + UV_OFFSET);
    uvs[i * 2 + 1] = data.readFloatLE(vertex + UV_OFFSET + 4);
  }
  const indices = new Uint16Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    const index = data.readUInt16LE(indexOffset + i * 2);
    if (index >= vertexCount) {
      return null;
    }
    indices[i] = index;
  }
  return { positions, normals, uvs, indices };
}
