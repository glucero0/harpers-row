// A strip of ground along a sampled path. Each sample carries its own height and its own width, so a
// path can slope down from an upper floor and bend around a building. UVs are world XZ divided by the
// dirt tile so gravel stays the same size on every outdoor surface. No classes, no listeners.

import * as THREE from 'three';
import { DIRT_TILE_METRES } from './materials.js';

const _groundVertex = new THREE.Vector3();

// Writes uv = (worldX / tile, worldZ / tile). Pass the mesh matrix when positions are still local
// (a plane or circle rotated flat). Omit it when positions are already world space.
export function assignWorldGroundUvs(geometry, tile, matrix) {
  const positions = geometry.attributes.position;
  let uvs = geometry.attributes.uv;
  if (!uvs || uvs.count !== positions.count) {
    uvs = new THREE.Float32BufferAttribute(positions.count * 2, 2);
    geometry.setAttribute('uv', uvs);
  }
  const span = tile || DIRT_TILE_METRES;
  for (let index = 0; index < positions.count; index += 1) {
    _groundVertex.fromBufferAttribute(positions, index);
    if (matrix) _groundVertex.applyMatrix4(matrix);
    uvs.setXY(index, _groundVertex.x / span, _groundVertex.z / span);
  }
  uvs.needsUpdate = true;
  return geometry;
}

export function pathGeometry(samples) {
  const positions = [];
  const indices = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const nx = sample.nx || 0;
    const nz = sample.nz || 1;
    const half = sample.half || 3;
    const y = sample.y || 0;
    positions.push(
      sample.x + nx * half, y + 0.04, sample.z + nz * half,
      sample.x - nx * half, y + 0.04, sample.z - nz * half,
    );
  }
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  assignWorldGroundUvs(geometry, DIRT_TILE_METRES);
  geometry.computeVertexNormals();
  return geometry;
}
