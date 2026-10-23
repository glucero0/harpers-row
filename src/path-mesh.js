// A strip of ground along a sampled path. Each sample carries its own height and its own width, so a
// path can slope down from an upper floor and bend around a building. No classes, no listeners.

import * as THREE from 'three';

export function pathGeometry(samples) {
  const positions = [];
  const uvs = [];
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
    uvs.push(0, index * 0.22, 1, index * 0.22);
  }
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
