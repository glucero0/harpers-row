// Props: the urns, barrels, stalagmites and the like a location file places inside rooms (`room.props`),
// and the boulders, gravestones and wrecks it places outside (`scenery`). Each type is a small kit of
// primitives merged into one geometry, built once, and drawn as many instances of a single
// BatchedMesh per material, so a hundred props cost a handful of draw calls.
//
// A file may name a type this kit does not know yet. It is drawn as rubble rather than dropped, so a
// newer generator never makes a prop silently vanish.
import * as THREE from 'three';
import { storyAt } from './geometry.js';

const up = new THREE.Vector3(0, 1, 0);
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();

// Moves a primitive into place inside the prop's own frame (y up, the prop faces +Z).
function part(geometry, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  scratchEuler.set(rx, ry, rz);
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchMatrix.compose(scratchPosition.set(x, y, z), scratchQuaternion, scratchScale.set(sx, sy, sz));
  geometry.applyMatrix4(scratchMatrix);
  return geometry;
}

// Merges primitives into one indexed geometry that keeps position, normal, and uv.
function merge(parts) {
  let vertices = 0;
  let indices = 0;
  for (const geometry of parts) {
    vertices += geometry.getAttribute('position').count;
    indices += geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const index = new Uint32Array(indices);
  let vertex = 0;
  let cursor = 0;
  for (const geometry of parts) {
    const source = geometry.getAttribute('position');
    position.set(source.array, vertex * 3);
    normal.set(geometry.getAttribute('normal').array, vertex * 3);
    const coords = geometry.getAttribute('uv');
    if (coords) uv.set(coords.array, vertex * 2);
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i += 1) index[cursor + i] = geometry.index.getX(i) + vertex;
      cursor += geometry.index.count;
    } else {
      for (let i = 0; i < source.count; i += 1) index[cursor + i] = vertex + i;
      cursor += source.count;
    }
    vertex += source.count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

const box = (w, h, d, at) => part(new THREE.BoxGeometry(w, h, d), at);
const cylinder = (top, bottom, h, sides, at) => part(new THREE.CylinderGeometry(top, bottom, h, sides), at);
const lump = (radius, at) => part(new THREE.DodecahedronGeometry(radius, 0), at);

// ---- Builders: one per prop type ----------------------------------------------------------------

function urn() {
  return merge([
    cylinder(0.55, 0.7, 0.35, 10, { y: 0.18 }),
    part(new THREE.SphereGeometry(1, 10, 8), { y: 1.5, sx: 1.05, sy: 1.25, sz: 1.05 }),
    cylinder(0.45, 0.7, 0.8, 10, { y: 2.95 }),
    cylinder(0.7, 0.45, 0.25, 10, { y: 3.45 }),
  ]);
}

function casket() {
  return merge([
    box(4.2, 1.3, 1.9, { y: 0.65 }),
    box(4.4, 0.45, 2.1, { y: 1.5 }),
    box(4.6, 0.3, 2.3, { y: 0.15 }),
  ]);
}

function brokenPillar() {
  return merge([
    cylinder(1.1, 1.3, 4.6, 10, { y: 2.3 }),
    box(2.6, 0.5, 2.6, { y: 0.25 }),
    box(1.1, 0.7, 0.9, { x: 0.2, y: 4.85, rz: 0.35, ry: 0.5 }),
    cylinder(1.1, 1.1, 1.7, 10, { x: 2.1, y: 1.1, rz: Math.PI / 2, ry: 0.4 }),
  ]);
}

const RUBBLE = [
  [0, 0, 0.9, 0.7], [0.9, 0.5, 0.65, 0.5], [-0.8, 0.4, 0.7, 0.55],
  [0.3, -0.9, 0.6, 0.45], [-0.4, -0.6, 0.5, 0.4], [1.2, -0.4, 0.4, 0.3],
];
function rubble() {
  return merge(RUBBLE.map(([x, z, radius, lift], index) => lump(radius, {
    x, z, y: lift, sy: 0.7, rx: index * 0.7, ry: index * 1.3,
  })));
}

function barrel() {
  const profile = [[0.7, 0], [1, 0.7], [1.1, 1.3], [1, 1.9], [0.7, 2.6]].map(([r, y]) => new THREE.Vector2(r, y));
  return merge([
    new THREE.LatheGeometry(profile, 12),
    part(new THREE.TorusGeometry(1.06, 0.07, 4, 12), { y: 0.65, rx: Math.PI / 2 }),
    part(new THREE.TorusGeometry(1.06, 0.07, 4, 12), { y: 1.95, rx: Math.PI / 2 }),
  ]);
}

function crate() {
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => box(0.28, 2.3, 0.28, { x: x * 1.05, y: 1.15, z: z * 1.05 }));
  return merge([
    box(2.2, 2.1, 2.2, { y: 1.05 }),
    box(2.5, 0.22, 2.5, { y: 2.2 }),
    box(2.5, 0.22, 2.5, { y: 0.11 }),
    ...corners,
  ]);
}

function shelf() {
  const boards = [0.5, 2.1, 3.7, 5.3].map((y) => box(4.2, 0.2, 1.2, { y }));
  return merge([
    box(0.3, 6.5, 1.2, { x: -2, y: 3.25 }),
    box(0.3, 6.5, 1.2, { x: 2, y: 3.25 }),
    box(4.2, 6.5, 0.1, { y: 3.25, z: -0.55 }),
    ...boards,
    box(0.9, 0.7, 0.8, { x: -1.1, y: 0.95 }),
    box(0.7, 0.5, 0.7, { x: 1.2, y: 2.55 }),
  ]);
}

function plankPile() {
  const layers = [];
  for (let layer = 0; layer < 5; layer += 1) {
    layers.push(box(4, 0.28, 1.1, {
      x: (layer % 2) * 0.25 - 0.1,
      y: 0.16 + layer * 0.3,
      z: (layer % 3) * 0.12 - 0.1,
      ry: (layer - 2) * 0.12,
    }));
  }
  layers.push(box(3.4, 0.2, 1.6, { y: 1.75, ry: 0.5 }));
  return merge(layers);
}

function stalagmite() {
  return merge([
    part(new THREE.ConeGeometry(1.5, 6, 7), { y: 3 }),
    part(new THREE.ConeGeometry(0.75, 3.2, 6), { x: 1.5, z: 0.6, y: 1.6 }),
    part(new THREE.ConeGeometry(0.5, 2.1, 5), { x: -1.2, z: -0.7, y: 1.05 }),
  ]);
}

function bonePile() {
  const bones = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = i * 2.4;
    bones.push(part(new THREE.CapsuleGeometry(0.12, 1.5, 2, 5), {
      x: Math.cos(angle) * 0.7,
      z: Math.sin(angle) * 0.7,
      y: 0.4 + (i % 3) * 0.25,
      rz: Math.PI / 2 + i * 0.4,
      ry: angle,
    }));
  }
  return merge([
    lump(0.75, { y: 0.35, sy: 0.55 }),
    lump(0.6, { x: 0.8, z: 0.2, y: 0.3, sy: 0.6 }),
    lump(0.5, { x: -0.7, z: -0.4, y: 0.3, sy: 0.6 }),
    part(new THREE.SphereGeometry(0.42, 8, 6), { x: 0.2, z: 0.8, y: 0.45, sy: 0.9 }),
    ...bones,
  ]);
}

function boulder() {
  return merge([
    lump(1.6, { y: 0.95, sx: 1.3, sy: 0.9, sz: 1.1, ry: 0.4 }),
    lump(0.8, { x: 1.7, z: 0.6, y: 0.4, sy: 0.7 }),
  ]);
}

function scrub() {
  const clumps = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    clumps.push(part(new THREE.SphereGeometry(0.42, 5, 4), {
      x: Math.cos(angle) * 0.5, z: Math.sin(angle) * 0.34, y: 0.22, sx: 1.7, sy: 0.72, sz: 1.25,
    }));
  }
  return merge(clumps);
}

function standingStone() {
  return merge([
    box(1.5, 5.2, 0.9, { y: 2.6, rz: 0.04 }),
    box(1.2, 0.8, 0.8, { y: 5.4, rz: -0.25 }),
    box(2.2, 0.4, 1.6, { y: 0.2 }),
  ]);
}

function gravestone() {
  return merge([
    box(1.6, 2.2, 0.4, { y: 1.3 }),
    cylinder(0.8, 0.8, 0.4, 10, { y: 2.4, rx: Math.PI / 2 }),
    box(2.0, 0.3, 0.9, { y: 0.15 }),
    box(1.2, 0.2, 2.6, { y: 0.1, z: 1.6 }),
  ]);
}

function fallenColumn() {
  return merge([
    cylinder(1.2, 1.2, 7, 12, { y: 1.2, rz: Math.PI / 2 }),
    cylinder(1.35, 1.35, 0.5, 12, { x: -3.4, y: 1.2, rz: Math.PI / 2 }),
    cylinder(1.1, 1.1, 1.6, 12, { x: 4.6, y: 1.1, z: 1.2, rz: Math.PI / 2, ry: 0.5 }),
    lump(0.6, { x: -1.5, z: 1.5, y: 0.3, sy: 0.6 }),
  ]);
}

function brokenStatue() {
  return merge([
    box(2.6, 1.2, 2.6, { y: 0.6 }),
    cylinder(0.75, 0.95, 2.6, 8, { y: 2.5 }),
    box(1.9, 0.8, 0.9, { y: 3.9 }),
    part(new THREE.SphereGeometry(0.5, 8, 6), { x: 0.7, y: 4.65, z: 0.1 }),
    box(0.45, 1.6, 0.45, { x: -1.2, y: 3.3, rz: 0.5 }),
    lump(0.6, { x: 1.9, z: 1.2, y: 0.3, sy: 0.6 }),
  ]);
}

function cartWreck() {
  return merge([
    box(4, 0.3, 2.4, { y: 1.1, rz: 0.12 }),
    box(4, 0.9, 0.2, { y: 1.65, z: 1.15, rz: 0.12 }),
    box(0.2, 0.9, 2.4, { x: -2, y: 1.7, rz: 0.12 }),
    part(new THREE.CylinderGeometry(1.3, 1.3, 0.2, 10), { x: 0.4, y: 1.3, z: 1.4, rx: Math.PI / 2 }),
    part(new THREE.CylinderGeometry(1.3, 1.3, 0.2, 10), { x: 1.2, y: 0.7, z: -1.6, rx: Math.PI / 2 + 0.9, rz: 0.4 }),
    box(3.2, 0.2, 0.2, { x: -3.1, y: 0.8, z: -0.4, ry: 0.5, rz: 0.2 }),
    box(1.6, 0.18, 0.7, { x: -1.4, y: 0.1, z: 2.1, ry: 0.9 }),
  ]);
}

function campfireAshes() {
  const stones = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    stones.push(lump(0.38, { x: Math.cos(angle) * 1.55, z: Math.sin(angle) * 1.55, y: 0.2, sy: 0.7 }));
  }
  return merge([
    cylinder(1.45, 1.6, 0.12, 12, { y: 0.07 }),
    ...stones,
    cylinder(0.2, 0.2, 1.8, 6, { x: 0.2, y: 0.3, rz: Math.PI / 2, ry: 0.3 }),
    cylinder(0.2, 0.2, 1.6, 6, { x: -0.3, y: 0.3, z: 0.3, rz: Math.PI / 2, ry: 1.9 }),
  ]);
}

function signpost() {
  return merge([
    cylinder(0.12, 0.17, 4.2, 6, { y: 2.1 }),
    box(1.9, 0.5, 0.1, { x: 0.8, y: 3.7, z: 0.14, rz: 0.04 }),
    box(1.5, 0.45, 0.1, { x: -0.6, y: 2.9, z: -0.14, rz: -0.06 }),
  ]);
}

// materialKey names a material the owner resolves. `solid` is a list of [dx, dz, radius] circles in
// the prop's own frame that stop the player and the undead; an empty list can be walked through.
const KIT = {
  urn: { material: 'stone', solid: [[0, 0, 1]], build: urn },
  casket: { material: 'stone', solid: [[-1.2, 0, 1.2], [1.2, 0, 1.2]], build: casket },
  'broken-pillar': { material: 'stone', solid: [[0, 0, 1.4], [2.1, 0, 1.1]], build: brokenPillar },
  rubble: { material: 'stone', caveMaterial: 'cave', solid: [[0, 0, 1.4]], build: rubble },
  barrel: { material: 'wood', solid: [[0, 0, 1.2]], build: barrel },
  crate: { material: 'wood', solid: [[0, 0, 1.5]], build: crate },
  shelf: { material: 'wood', solid: [[-1.4, 0, 1], [0, 0, 1], [1.4, 0, 1]], build: shelf },
  'plank-pile': { material: 'wood', solid: [[0, 0, 1.7]], build: plankPile },
  stalagmite: { material: 'cave', solid: [[0, 0, 1.4]], build: stalagmite },
  'bone-pile': { material: 'bone', solid: [[0, 0, 1.1]], build: bonePile },
  boulder: { material: 'cave', solid: [[0, 0, 1.9], [1.7, 0.6, 0.9]], build: boulder },
  scrub: { material: 'scrub', solid: [], build: scrub },
  'standing-stone': { material: 'stone', solid: [[0, 0, 1.1]], build: standingStone },
  gravestone: { material: 'stone', solid: [[0, 0, 0.9]], build: gravestone },
  'fallen-column': { material: 'stone', solid: [[-2.4, 0, 1.3], [0, 0, 1.3], [2.4, 0, 1.3]], build: fallenColumn },
  'broken-statue': { material: 'stone', solid: [[0, 0, 1.7]], build: brokenStatue },
  'cart-wreck': { material: 'wood', solid: [[-1.2, 0, 1.6], [1.2, 0, 1.6]], build: cartWreck },
  'campfire-ashes': { material: 'dark', solid: [], build: campfireAshes },
  'supply-crate': { material: 'wood', solid: [[0, 0, 1.5]], build: crate },
  signpost: { material: 'wood', solid: [[0, 0, 0.35]], build: signpost },
};

export const PROP_TYPES = Object.keys(KIT);

// What a file's prop type resolves to in a room of `theme`: its kit entry and the material it uses.
export function propSpec(type, theme) {
  const kitType = Object.hasOwn(KIT, type) ? type : 'rubble';
  const entry = KIT[kitType];
  const material = theme === 'cave' && entry.caveMaterial ? entry.caveMaterial : entry.material;
  return { kitType, material, solid: entry.solid, build: entry.build };
}

// Draws `items` and returns the circle colliders they need.
//
//   parent           THREE.Object3D the batched meshes are added to
//   resolveMaterial  (materialKey) => THREE.Material  ('stone', 'wood', 'cave', 'bone', 'dark', 'scrub', 'dirt')
//   items            [{ type, theme, x, y, z, rotationY, scale, roomId }]. roomId ties a prop to a room so
//                    it is only drawn while that room is active. No roomId means always drawn.
//   castShadow       whether the props cast into the torch's shadow map
export function createPropField(parent, resolveMaterial, items, { castShadow = true } = {}) {
  const colliders = [];
  const records = [];
  const meshes = [];
  const groups = new Map();
  for (const item of items) {
    const spec = propSpec(item.type, item.theme);
    let group = groups.get(spec.material);
    if (!group) {
      group = { geometries: new Map(), placements: [] };
      groups.set(spec.material, group);
    }
    if (!group.geometries.has(spec.kitType)) group.geometries.set(spec.kitType, spec.build());
    group.placements.push({ item, spec });
  }

  for (const [materialKey, group] of groups) {
    let vertexCount = 0;
    let indexCount = 0;
    for (const geometry of group.geometries.values()) {
      vertexCount += geometry.getAttribute('position').count;
      indexCount += geometry.index.count;
    }
    const mesh = new THREE.BatchedMesh(group.placements.length, vertexCount, indexCount, resolveMaterial(materialKey));
    mesh.name = `props-${materialKey}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    const geometryIds = new Map();
    for (const [kitType, geometry] of group.geometries) {
      geometryIds.set(kitType, mesh.addGeometry(geometry));
      geometry.dispose();
    }
    for (const { item, spec } of group.placements) {
      const scale = item.scale > 0 ? item.scale : 1;
      const yaw = Number.isFinite(item.rotationY) ? item.rotationY : 0;
      scratchQuaternion.setFromAxisAngle(up, yaw);
      scratchMatrix.compose(scratchPosition.set(item.x, item.y || 0, item.z), scratchQuaternion, scratchScale.set(scale, scale, scale));
      const id = mesh.addInstance(geometryIds.get(spec.kitType));
      mesh.setMatrixAt(id, scratchMatrix);
      const roomId = item.roomId ?? null;
      mesh.setVisibleAt(id, roomId === null);
      if (roomId !== null) records.push({ mesh, id, roomId, shown: false });
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const story = storyAt(item.y || 0);
      for (const [dx, dz, radius] of spec.solid) {
        colliders.push({
          x: item.x + (dx * cos + dz * sin) * scale,
          z: item.z + (-dx * sin + dz * cos) * scale,
          radius: radius * scale,
          story,
        });
      }
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    parent.add(mesh);
    meshes.push(mesh);
  }

  let disposed = false;
  return {
    meshes,
    colliders,
    count: items.length,
    // Shows the props of every room in `active` (a Set of room ids) and hides the rest.
    showRooms(active) {
      for (const record of records) {
        const want = active.has(record.roomId);
        if (record.shown === want) continue;
        record.shown = want;
        record.mesh.setVisibleAt(record.id, want);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) {
        parent.remove(mesh);
        mesh.geometry.dispose();
        mesh.dispose();
      }
      meshes.length = 0;
      records.length = 0;
    },
  };
}
