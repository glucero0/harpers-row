import * as THREE from 'three';
import { SWORD_ARC, SWORD_RANGE } from './balance.js';
import { clearDustField, createDustField } from './dust.js';
import { clearance, closestOnSegment, lineOfSight, pointInPolygon } from './geometry.js';
import { audio } from './audio.js';
import { createWallSconce } from './sconce.js';

const WALL_HEIGHT = 10;
const DOOR_HEIGHT = 7;
const THICKNESS = 1;

const THEME = {
  outdoor: { fog: 0x121416, density: 0.026 },
  stone: { fog: 0x0b0a09, density: 0.042 },
  wood: { fog: 0x2c221b, density: 0.02 },
  cave: { fog: 0x12161c, density: 0.04 },
};

const OUTDOOR_FOG = 0x121416;
const SUN_OUTDOOR = 0.85;
const SKY_OUTDOOR = 0.42;
const CHEST_GOLD = 100;

function canonical(ax, az, bx, bz) {
  let dx = bx - ax;
  let dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  dx /= length;
  dz /= length;
  if (dx < -1e-6 || (Math.abs(dx) <= 1e-6 && dz < 0)) {
    dx = -dx;
    dz = -dz;
  }
  const nx = -dz;
  const nz = dx;
  return { dx, dz, nx, nz, offset: ax * nx + az * nz };
}

function pointAt(line, t) {
  return [line.offset * line.nx + t * line.dx, line.offset * line.nz + t * line.dz];
}

function mergeIntervals(intervals) {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (!last || span[0] > last[1] + 0.02) merged.push([span[0], span[1]]);
    else last[1] = Math.max(last[1], span[1]);
  }
  return merged;
}

function subtractIntervals(covers, gaps) {
  let pieces = mergeIntervals(covers);
  for (const gap of gaps) {
    const next = [];
    for (const piece of pieces) {
      if (gap[1] <= piece[0] + 0.02 || gap[0] >= piece[1] - 0.02) {
        next.push(piece);
        continue;
      }
      if (gap[0] > piece[0] + 0.02) next.push([piece[0], gap[0]]);
      if (gap[1] < piece[1] - 0.02) next.push([gap[1], piece[1]]);
    }
    pieces = next;
  }
  return pieces.filter((piece) => piece[1] - piece[0] > 0.2);
}

function themeAt(covers, t) {
  const themes = covers
    .filter((cover) => t >= cover.t0 - 0.05 && t <= cover.t1 + 0.05)
    .map((cover) => cover.room.theme);
  if (themes.includes('wood') && themes.includes('cave')) return 'wood';
  if (themes.includes('stone')) return 'stone';
  if (themes.includes('wood')) return 'wood';
  return themes[0] || 'stone';
}

function polygonGeometry(polygon, y, upward) {
  const positions = [];
  const normals = [];
  const uvs = [];
  for (const [x, z] of polygon) {
    positions.push(x, y, z);
    normals.push(0, upward ? 1 : -1, 0);
    uvs.push(x / 7, z / 7);
  }
  const indices = [];
  for (let i = 1; i < polygon.length - 1; i += 1) indices.push(0, i, i + 1);
  const ax = positions[3] - positions[0];
  const az = positions[5] - positions[2];
  const bx = positions[6] - positions[0];
  const bz = positions[8] - positions[2];
  const pointsUp = az * bx - ax * bz > 0;
  if (pointsUp !== upward) {
    for (let i = 0; i < indices.length; i += 3) {
      const swap = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = swap;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function settle(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function scaleUvs(geometry, uScale, vScale) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
  }
}

function addWall(scene, ax, az, bx, bz, theme, materials, colliders, height, y0, collide, batch, roomIds, surface) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (length < 0.2) return;
  const along = Math.min(22, Math.max(1, Math.round(length / 1.85)));
  const rise = Math.min(8, Math.max(2, Math.round(height / 1.85)));
  const geometry = new THREE.BoxGeometry(length, height, THICKNESS, along, rise, 1);
  scaleUvs(geometry, Math.max(length / 8, 0.35), Math.max(height / 6, 0.35));
  const rotY = Math.atan2(-(bz - az), bx - ax);
  const material = surface || materials.surface(theme);
  if (batch && roomIds && roomIds.length) {
    batch.place(
      material,
      geometry,
      (ax + bx) / 2,
      y0 + height / 2,
      (az + bz) / 2,
      rotY,
      roomIds,
      true,
    );
  } else {
    const mesh = settle(new THREE.Mesh(geometry, material));
    mesh.position.set((ax + bx) / 2, y0 + height / 2, (az + bz) / 2);
    mesh.rotation.y = rotY;
    mesh.updateMatrix();
    scene.add(mesh);
  }
  if (!collide) return;
  const nx = -dz / length;
  const nz = dx / length;
  const half = THICKNESS / 2;
  for (const sign of [1, -1]) {
    const faceAx = ax + nx * half * sign;
    const faceAz = az + nz * half * sign;
    const faceBx = bx + nx * half * sign;
    const faceBz = bz + nz * half * sign;
    colliders.push({
      ax: faceAx,
      az: faceAz,
      bx: faceBx,
      bz: faceBz,
      nx: nx * sign,
      nz: nz * sign,
      minX: Math.min(faceAx, faceBx),
      maxX: Math.max(faceAx, faceBx),
      minZ: Math.min(faceAz, faceBz),
      maxZ: Math.max(faceAz, faceBz),
    });
  }
}

function disposeTree(node) {
  node.traverse((obj) => {
    if (!obj.isMesh && !obj.isPoints) return;
    obj.geometry?.dispose();
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) {
      if (!material || material.userData.shared) continue;
      material.map?.dispose();
      material.bumpMap?.dispose();
      material.dispose();
    }
  });
}

function buildWalls(root, materials, colliders, rooms, doors, batch) {
  const groups = new Map();
  for (const room of rooms) {
    const polygon = room.polygon;
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const line = canonical(a[0], a[1], b[0], b[1]);
      const key = `${line.dx.toFixed(4)}|${line.dz.toFixed(4)}|${line.offset.toFixed(3)}`;
      let group = groups.get(key);
      if (!group) {
        group = { ...line, covers: [] };
        groups.set(key, group);
      }
      const t1 = a[0] * group.dx + a[1] * group.dz;
      const t2 = b[0] * group.dx + b[1] * group.dz;
      group.covers.push({ t0: Math.min(t1, t2), t1: Math.max(t1, t2), room });
    }
  }

  for (const group of groups.values()) {
    const gaps = [];
    for (const door of doors) {
      const distA = Math.abs(door.a[0] * group.nx + door.a[1] * group.nz - group.offset);
      const distB = Math.abs(door.b[0] * group.nx + door.b[1] * group.nz - group.offset);
      if (distA > 0.4 || distB > 0.4) continue;
      const tA = door.a[0] * group.dx + door.a[1] * group.dz;
      const tB = door.b[0] * group.dx + door.b[1] * group.dz;
      gaps.push({
        t0: Math.min(tA, tB),
        t1: Math.max(tA, tB),
        height: door.height || DOOR_HEIGHT,
      });
    }
    const coverSpans = group.covers.map((cover) => [cover.t0, cover.t1]);
    for (const [t0, t1] of subtractIntervals(coverSpans, gaps.map((gap) => [gap.t0, gap.t1]))) {
      const [ax, az] = pointAt(group, t0);
      const [bx, bz] = pointAt(group, t1);
      const roomIds = [];
      for (const cover of group.covers) {
        if (cover.t1 < t0 - 0.02 || cover.t0 > t1 + 0.02) continue;
        if (!roomIds.includes(cover.room.id)) roomIds.push(cover.room.id);
      }
      addWall(root, ax, az, bx, bz, themeAt(group.covers, (t0 + t1) / 2), materials, colliders, WALL_HEIGHT, 0, true, batch, roomIds);
    }
    for (const gap of gaps) {
      const mid = (gap.t0 + gap.t1) / 2;
      const onWall = group.covers.some((cover) => mid >= cover.t0 - 0.05 && mid <= cover.t1 + 0.05);
      if (!onWall || gap.t1 - gap.t0 < 0.5) continue;
      const [ax, az] = pointAt(group, gap.t0);
      const [bx, bz] = pointAt(group, gap.t1);
      const sill = Math.min(WALL_HEIGHT - 1.2, Math.max(6.2, gap.height));
      addWall(
        root,
        ax,
        az,
        bx,
        bz,
        themeAt(group.covers, mid),
        materials,
        colliders,
        WALL_HEIGHT - sill,
        sill,
        false,
        batch,
        group.covers.map((cover) => cover.room.id).filter((id, index, list) => list.indexOf(id) === index),
      );
    }
  }
}

function addRock(scene, materials, x, z) {
  const rock = settle(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), materials.surface('cave')));
  rock.scale.set(1.15, 1.55, 1.05);
  rock.position.set(x, 0.7, z);
  rock.rotation.y = x * 0.2;
  rock.updateMatrix();
  scene.add(rock);
}

function segmentCollider(ax, az, bx, bz, nx, nz) {
  return {
    ax,
    az,
    bx,
    bz,
    nx,
    nz,
    minX: Math.min(ax, bx),
    maxX: Math.max(ax, bx),
    minZ: Math.min(az, bz),
    maxZ: Math.max(az, bz),
  };
}

function addSlab(parent, rect, y, material, facingUp, batch, roomId) {
  const alongX = Math.min(28, Math.max(1, Math.round(rect.w / 1.9)));
  const alongZ = Math.min(28, Math.max(1, Math.round(rect.d / 1.9)));
  const geometry = new THREE.PlaneGeometry(rect.w, rect.d, alongX, alongZ);
  geometry.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2);
  if (batch && roomId != null) {
    batch.place(material, geometry, rect.x + rect.w / 2, y, rect.z + rect.d / 2, 0, [roomId], false);
    return;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(rect.x + rect.w / 2, y, rect.z + rect.d / 2);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  settle(mesh);
  parent.add(mesh);
}

const CHEST_SCALE = 2.7;
const LID_OPEN = (95 * Math.PI) / 180;
const LID_LEAN = 0.07;
const LID_SECONDS = 0.55;
const COIN_POP = 1.6;
const FLYING_COIN = new THREE.CylinderGeometry(0.11, 0.11, 0.032, 10);

const CHEST_INSIDE = new THREE.MeshStandardMaterial({ color: 0x1c120d, roughness: 0.96 });
CHEST_INSIDE.userData.shared = true;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function mergeGeometries(parts) {
  let vertices = 0;
  let indexes = 0;
  for (const geo of parts) {
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const position = geo.getAttribute('position');
    vertices += position.count;
    indexes += geo.index ? geo.index.count : position.count;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const indices = new Uint32Array(indexes);
  let vertex = 0;
  let index = 0;
  for (const geo of parts) {
    const position = geo.getAttribute('position');
    const normal = geo.getAttribute('normal');
    for (let i = 0; i < position.count; i += 1) {
      positions[(vertex + i) * 3] = position.getX(i);
      positions[(vertex + i) * 3 + 1] = position.getY(i);
      positions[(vertex + i) * 3 + 2] = position.getZ(i);
      normals[(vertex + i) * 3] = normal.getX(i);
      normals[(vertex + i) * 3 + 1] = normal.getY(i);
      normals[(vertex + i) * 3 + 2] = normal.getZ(i);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i += 1) indices[index + i] = geo.index.getX(i) + vertex;
      index += geo.index.count;
    } else {
      for (let i = 0; i < position.count; i += 1) indices[index + i] = vertex + i;
      index += position.count;
    }
    vertex += position.count;
    geo.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function goldHeapGeometry() {
  const parts = [];
  for (let index = 0; index < 42; index += 1) {
    const nugget = new THREE.IcosahedronGeometry(0.045 + (index % 4) * 0.012, 0);
    const layer = Math.floor(index / 14);
    const angle = index * 2.399963;
    const spread = 0.28 - layer * 0.06;
    nugget.translate(
      Math.cos(angle) * spread,
      0.36 + layer * 0.07,
      Math.sin(angle) * spread * 0.62,
    );
    parts.push(nugget);
  }
  return mergeGeometries(parts);
}

function chestPanel(width, height, depth, insideFace, plank) {
  const faces = [plank, plank, plank, plank, plank, plank];
  faces[insideFace] = CHEST_INSIDE;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), faces);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function curvedLidGeometry() {
  const shape = new THREE.Shape();
  const steps = 14;
  const z0 = 0.04;
  const z1 = 0.9;
  const arch = 0.26;
  const thick = 0.12;
  const point = (t, inset) => {
    const z = z0 + (z1 - z0) * t;
    const bow = Math.sin(t * Math.PI);
    return [z, bow * arch + (inset ? 0 : thick)];
  };
  let [z, y] = point(0, false);
  shape.moveTo(z, y);
  for (let i = 1; i <= steps; i += 1) {
    [z, y] = point(i / steps, false);
    shape.lineTo(z, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    [z, y] = point(i / steps, true);
    shape.lineTo(z, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.28,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -0.64);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createChest(materials) {
  const group = new THREE.Group();
  const plank = materials.plank;
  const iron = materials.iron || materials.metal;
  const floor = chestPanel(1.36, 0.1, 0.9, 2, plank);
  floor.position.y = 0.05;
  const front = chestPanel(1.36, 0.7, 0.08, 5, plank);
  front.position.set(0, 0.45, 0.41);
  const back = chestPanel(1.36, 0.7, 0.08, 4, plank);
  back.position.set(0, 0.45, -0.41);
  const left = chestPanel(0.08, 0.7, 0.74, 0, plank);
  left.position.set(-0.64, 0.45, 0);
  const right = chestPanel(0.08, 0.7, 0.74, 1, plank);
  right.position.set(0.64, 0.45, 0);
  const frontBand = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 0.07), iron);
  frontBand.position.set(0, 0.38, 0.46);
  frontBand.castShadow = true;
  const backBand = frontBand.clone();
  backBand.position.z = -0.46;
  const sideBand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.86), iron);
  sideBand.position.set(-0.68, 0.38, 0);
  sideBand.castShadow = true;
  const sideBandB = sideBand.clone();
  sideBandB.position.x = 0.68;
  const footA = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.08), iron);
  footA.position.set(0, 0.03, 0.36);
  const footB = footA.clone();
  footB.position.z = -0.36;

  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.8, -0.26);
  lidPivot.rotation.x = -LID_LEAN;
  const lid = new THREE.Mesh(curvedLidGeometry(), plank);
  lid.castShadow = true;
  lid.receiveShadow = true;
  const lidLip = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.08), iron);
  lidLip.position.set(0, 0.08, 0.88);
  const lidBandL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.82), iron);
  lidBandL.position.set(-0.46, 0.2, 0.46);
  lidBandL.rotation.x = -0.22;
  const lidBandR = lidBandL.clone();
  lidBandR.position.x = 0.46;
  lidPivot.add(lid, lidLip, lidBandL, lidBandR);

  const heap = new THREE.Mesh(goldHeapGeometry(), materials.gold);
  heap.castShadow = true;
  heap.receiveShadow = true;
  const fill = new THREE.PointLight(0xffb15a, 0, 1.5, 2);
  fill.position.set(0, 0.5, 0.04);
  fill.castShadow = false;
  fill.visible = false;
  group.add(floor, front, back, left, right, frontBand, backBand, sideBand, sideBandB, footA, footB, heap, fill, lidPivot);
  group.scale.set(CHEST_SCALE, CHEST_SCALE, CHEST_SCALE);
  return { group, lid: lidPivot, fill };
}

function addDirt(parent, material, rect) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rect.w, rect.d), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(rect.x + rect.w / 2, 0.02, rect.z + rect.d / 2);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

function addProp(parent, geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildApproach(parent, materials, colliders, layout) {
  const { approach, entrance } = layout;
  const ante = layout.rooms[0];
  if (!approach || !entrance || !ante) return;
  const { court, path, southZ } = approach;
  addDirt(parent, materials.dirt, court);
  addDirt(parent, materials.dirt, path);

  const facade = 13;
  const flank = 8;
  const curb = 1.7;
  if (ante.rect.x > court.x + 0.4) {
    addWall(parent, court.x, southZ, ante.rect.x, southZ, 'stone', materials, colliders, facade, 0, true);
  }
  const anteEast = ante.rect.x + ante.rect.w;
  const courtEast = court.x + court.w;
  if (courtEast > anteEast + 0.4) {
    addWall(parent, anteEast, southZ, courtEast, southZ, 'stone', materials, colliders, facade, 0, true);
  }
  addWall(parent, court.x, court.z, court.x, court.z + court.d, 'stone', materials, colliders, flank, 0, true);
  addWall(parent, courtEast, court.z, courtEast, court.z + court.d, 'stone', materials, colliders, flank, 0, true);
  addWall(parent, court.x, path.z, path.x, path.z, 'stone', materials, colliders, curb, 0, true);
  addWall(parent, path.x + path.w, path.z, courtEast, path.z, 'stone', materials, colliders, curb, 0, true);
  addWall(parent, path.x, path.z, path.x, path.z + path.d, 'stone', materials, colliders, curb, 0, true);
  addWall(parent, path.x + path.w, path.z, path.x + path.w, path.z + path.d, 'stone', materials, colliders, curb, 0, true);
  addWall(parent, path.x, path.z + path.d, path.x + path.w, path.z + path.d, 'stone', materials, colliders, 3.2, 0, true);
  const stone = materials.surface('stone').clone();
  stone.side = THREE.DoubleSide;
  stone.userData.shared = true;
  const facadeZ = southZ + 0.98;
  const doorTop = entrance.height || 7.2;
  const left = entrance.a[0];
  const right = entrance.b[0];
  if (left - ante.rect.x > 0.25) {
    addWall(parent, ante.rect.x - 0.5, facadeZ, left - 0.05, facadeZ, 'stone', materials, colliders, facade, 0, true, null, null, stone);
  }
  if (anteEast - right > 0.25) {
    addWall(parent, right + 0.05, facadeZ, anteEast + 0.5, facadeZ, 'stone', materials, colliders, facade, 0, true, null, null, stone);
  }
  addWall(parent, left - 0.4, facadeZ, right + 0.4, facadeZ, 'stone', materials, colliders, facade - doorTop, doorTop, false, null, null, stone);
  const pier = 5.4;
  addWall(parent, left - 0.75, southZ + 0.15, left - 0.75, southZ + pier, 'stone', materials, colliders, doorTop + 1.4, 0, true, null, null, stone);
  addWall(parent, right + 0.75, southZ + 0.15, right + 0.75, southZ + pier, 'stone', materials, colliders, doorTop + 1.4, 0, true, null, null, stone);
  addWall(parent, ante.rect.x - 1.05, ante.rect.z, ante.rect.x - 1.05, southZ + 0.5, 'stone', materials, colliders, WALL_HEIGHT, 0, true, null, null, stone);
  addWall(parent, anteEast + 1.05, ante.rect.z, anteEast + 1.05, southZ + 0.5, 'stone', materials, colliders, WALL_HEIGHT, 0, true, null, null, stone);
  addProp(
    parent,
    new THREE.BoxGeometry(court.w + 1.2, 1.15, 1.35),
    materials.surface('stone'),
    court.x + court.w / 2,
    12.5,
    southZ + 0.35,
  );
}

function createBatch(root) {
  const batches = new Map();
  const roomParts = new Map();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);

  function getBatch(material, castShadow) {
    let batch = batches.get(`${material.uuid}:${castShadow ? 1 : 0}`);
    if (batch) return batch;
    const mesh = new THREE.BatchedMesh(480, 700000, 1000000, material);
    mesh.name = castShadow ? 'WallInstancedMesh' : 'SlabInstancedMesh';
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.perObjectFrustumCulled = true;
    root.add(mesh);
    batch = { mesh };
    batches.set(`${material.uuid}:${castShadow ? 1 : 0}`, batch);
    return batch;
  }

  const activeSet = new Set();
  const wanted = new Map();
  return {
    place(material, geometry, x, y, z, rotY, roomIds, castShadow) {
      const batch = getBatch(material, castShadow);
      const geoId = batch.mesh.addGeometry(geometry);
      const id = batch.mesh.addInstance(geoId);
      position.set(x, y, z);
      quaternion.setFromAxisAngle(up, rotY);
      matrix.compose(position, quaternion, scale);
      batch.mesh.setMatrixAt(id, matrix);
      batch.mesh.setVisibleAt(id, false);
      geometry.dispose();
      for (const roomId of roomIds) {
        if (roomId == null) continue;
        let list = roomParts.get(roomId);
        if (!list) {
          list = [];
          roomParts.set(roomId, list);
        }
        list.push({ mesh: batch.mesh, id, show: false });
      }
    },
    showRooms(activeIds) {
      activeSet.clear();
      for (const id of activeIds) activeSet.add(id);
      wanted.clear();
      for (const [roomId, parts] of roomParts) {
        const on = activeSet.has(roomId);
        for (const part of parts) {
          const key = `${part.mesh.uuid}:${part.id}`;
          wanted.set(key, (wanted.get(key) || false) || on);
          part.want = wanted.get(key);
        }
      }
      for (const parts of roomParts.values()) {
        for (const part of parts) {
          if (part.show === part.want) continue;
          part.show = part.want;
          part.mesh.setVisibleAt(part.id, part.want);
        }
      }
    },
    finish() {
      for (const batch of batches.values()) {
        batch.mesh.computeBoundingBox();
        batch.mesh.computeBoundingSphere();
        batch.mesh.updateMatrix();
        batch.mesh.matrixAutoUpdate = false;
      }
    },
  };
}

export function createDungeon(scene, materials, layout) {
  const { rooms, doors } = layout;
  const colliders = [];
  const sconces = [];
  const chests = [];
  const root = new THREE.Group();
  scene.add(root);

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const room of rooms) {
    for (const [x, z] of room.polygon) {
      minX = Math.min(minX, x);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxZ = Math.max(maxZ, z);
    }
  }
  const span = Math.max(maxX - minX, maxZ - minZ) + 120;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, -0.08, (minZ + maxZ) / 2);
  settle(ground);
  ground.castShadow = false;
  root.add(ground);

  const batch = createBatch(root);
  for (const room of rooms) {
    const floorMaterial = materials.floor(room.theme);
    const ceilingMaterial = room.theme === 'cave' ? materials.ceilingCave : materials.ceiling;
    if (room.rect) {
      addSlab(root, room.rect, 0, floorMaterial, true, batch, room.id);
      addSlab(root, room.rect, WALL_HEIGHT, ceilingMaterial, false, batch, room.id);
    } else {
      batch.place(floorMaterial, polygonGeometry(room.polygon, 0, true), 0, 0, 0, 0, [room.id], false);
      batch.place(ceilingMaterial, polygonGeometry(room.polygon, WALL_HEIGHT, false), 0, 0, 0, 0, [room.id], false);
    }
    if (room.sconce && room.chest) {
      const built = createWallSconce(materials, room.sconce);
      built.interactable.roomId = room.id;
      root.add(built.group);
      built.group.visible = false;
      const chestMesh = createChest(materials);
      chestMesh.group.position.set(room.chest.x, 0, room.chest.z);
      chestMesh.group.rotation.y = Math.atan2(room.sconce.nx, room.sconce.nz);
      chestMesh.group.visible = false;
      root.add(chestMesh.group);
      const chest = {
        x: room.chest.x,
        z: room.chest.z,
        nx: room.sconce.nx,
        nz: room.sconce.nz,
        group: chestMesh.group,
        lid: chestMesh.lid,
        fill: chestMesh.fill,
        opened: false,
        lidAngle: 0,
        lidAge: 0,
      };
      chests.push(chest);
      colliders.push({ x: chest.x, z: chest.z, radius: 1.7 });
      sconces.push({
        roomId: room.id,
        x: built.interactable.x,
        z: built.interactable.z,
        group: built.group,
        interactable: built.interactable,
        particles: built.particles,
        chest,
      });
    }
    for (const [x, z] of room.rocks) {
      addRock(root, materials, x, z);
      colliders.push({ x, z, radius: 1.05 });
    }
  }

  buildWalls(root, materials, colliders, rooms, layout.entrance ? [...doors, layout.entrance] : doors, batch);
  batch.finish();
  buildApproach(root, materials, colliders, layout);

  const entrance = layout.entrance;
  const gateCollider = entrance
    ? segmentCollider(entrance.a[0], entrance.a[1], entrance.b[0], entrance.b[1], 0, 1)
    : null;
  if (gateCollider) colliders.push(gateCollider);
  let gateOpen = false;
  let veil = null;
  const activeList = [];
  if (entrance && layout.approach) {
    veil = new THREE.Mesh(
      new THREE.PlaneGeometry(entrance.width + 0.8, 8.4),
      new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide }),
    );
    veil.name = 'entrance-veil';
    veil.position.set(layout.approach.midX, 4.1, layout.approach.southZ - 0.55);
    veil.castShadow = false;
    veil.receiveShadow = false;
    veil.frustumCulled = true;
    root.add(veil);
  }

  const dust = createDustField(root);
  const approach = layout.approach || { midX: 0, southZ: 0 };
  const sun = new THREE.DirectionalLight(0xb7c0c8, SUN_OUTDOOR);
  sun.position.set(approach.midX + 22, 42, approach.southZ + 26);
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(approach.midX, 6, approach.southZ);
  sun.target = sunTarget;
  const sky = new THREE.HemisphereLight(0x5c656e, 0x241e18, SKY_OUTDOOR);
  const fill = new THREE.AmbientLight(0x141210, 0.04);
  scene.add(sun, sunTarget, sky, fill);

  const fogColor = new THREE.Color();
  const outdoorFog = new THREE.Color(THEME.outdoor.fog);
  const indoorFog = new THREE.Color(THEME.stone.fog);
  const ENTRANCE_BLEND = 5;
  if (!scene.background) scene.background = new THREE.Color(OUTDOOR_FOG);
  if (!scene.fog) scene.fog = new THREE.FogExp2(OUTDOOR_FOG, 0.026);
  scene.background.set(OUTDOOR_FOG);
  scene.fog.color.set(OUTDOOR_FOG);
  scene.fog.density = 0.026;

  const outdoors = {
    id: 'approach',
    index: 0,
    kind: 'exterior',
    name: 'Dirt Path',
    theme: 'outdoor',
    polygon: layout.exterior || [],
    spawns: [],
  };

  function roomAt(x, z, previousId) {
    if (outdoors.polygon.length > 2 && pointInPolygon(x, z, outdoors.polygon)) return outdoors;
    const inside = rooms.filter((room) => pointInPolygon(x, z, room.polygon));
    if (inside.length === 1) return inside[0];
    if (inside.length > 1) return inside.find((room) => room.id === previousId) || inside[0];
    if (previousId) {
      const previous = rooms.find((room) => room.id === previousId);
      if (previous && clearance(x, z, previous.polygon) > -0.8) return previous;
    }
    return rooms.reduce((nearest, room) => {
      const dist = Math.abs(clearance(x, z, room.polygon));
      return dist < nearest.dist ? { room, dist } : nearest;
    }, { room: rooms[0], dist: Infinity }).room;
  }

  const coinMouth = new THREE.Vector3();
  const coinDirection = new THREE.Vector3();

  function emitChestCoin(chest) {
    chest.group.updateWorldMatrix(true, true);
    coinMouth.set((Math.random() - 0.5) * 0.45, 0.88, 0.12);
    chest.group.localToWorld(coinMouth);
    const up = (1.5 + Math.random()) * 3.2;
    const spread = 0.8 * 3.2;
    coinDirection.set((Math.random() - 0.5) * spread, up, (Math.random() - 0.5) * spread * 0.65 + 1.4);
    const speed = coinDirection.length();
    coinDirection.transformDirection(chest.group.matrixWorld);
    const coin = new THREE.Mesh(FLYING_COIN, chest.loot.material);
    coin.position.copy(coinMouth);
    coin.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    coin.userData.vel = coinDirection.clone().multiplyScalar(speed);
    coin.userData.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 14,
    );
    coin.castShadow = false;
    coin.receiveShadow = false;
    coin.frustumCulled = true;
    root.add(coin);
    chest.loot.coins.push(coin);
  }

  function spawnLoot(chest) {
    chest.group.updateWorldMatrix(true, true);
    coinMouth.set(0, 0.45, 0);
    chest.group.localToWorld(coinMouth);
    const flash = new THREE.PointLight(0xffc56a, 24, 6, 2);
    flash.position.copy(coinMouth);
    root.add(flash);
    const material = materials.gold.clone();
    material.transparent = true;
    material.opacity = 1;
    chest.loot = { coins: [], flash, material, age: 0, spawned: 0, total: 12 + Math.floor(Math.random() * 7), cleared: false };
  }

  function offerSconce(state, livingIn) {
    if (!state.equipped) return false;
    for (const sconce of sconces) {
      if (sconce.interactable.lit) continue;
      if (!lineOfSight(state.x, state.z, sconce.x, sconce.z, colliders)) continue;
      const lit = sconce.interactable.tryIgnite({
        x: state.x,
        z: state.z,
        yaw: state.yaw,
        torchX: state.guardX,
        torchZ: state.guardZ,
        swing: state.swinging,
        use: state.usePressed,
        block: state.blocking && state.blockBlend >= 0.6,
        clear: livingIn(sconce.roomId) === 0,
      });
      if (!lit) continue;
      return true;
    }
    return false;
  }

  function openChestAt(x, z, forwardX, forwardZ) {
    for (const chest of chests) {
      if (chest.opened) continue;
      const dx = chest.x - x;
      const dz = chest.z - z;
      const dist = Math.hypot(dx, dz);
      const angle = Math.atan2(forwardX * dz - forwardZ * dx, forwardX * dx + forwardZ * dz);
      if (dist > SWORD_RANGE || Math.abs(angle) > SWORD_ARC) continue;
      if (!lineOfSight(x, z, chest.x, chest.z, colliders)) continue;
      chest.opened = true;
      spawnLoot(chest);
      return CHEST_GOLD;
    }
    return 0;
  }

  return {
    rooms,
    doors,
    colliders,
    chests,
    lastRoomId: layout.lastRoomId,
    group: root,
    gateInward: layout.gateInward || { x: 0, z: -1 },
    intruded: false,
    activeRooms: new Set(),
    roomVisible(id) {
      return this.activeRooms.has(id);
    },
    roomAt,
    containsInterior(x, z) {
      return rooms.some((room) => pointInPolygon(x, z, room.polygon));
    },
    threshold() {
      return { x: approach.midX, z: approach.southZ + 2.2 };
    },
    nearGate(x, z) {
      if (!entrance || gateOpen) return false;
      const closest = closestOnSegment(x, z, entrance.a[0], entrance.a[1], entrance.b[0], entrance.b[1]);
      return Math.hypot(x - closest.x, z - closest.z) < 1.7;
    },
    openGate() {
      if (gateOpen || !gateCollider) return;
      gateOpen = true;
      const index = colliders.indexOf(gateCollider);
      if (index >= 0) colliders.splice(index, 1);
    },
    offerSconce,
    openChestAt,
    lootTaken() {
      return chests.filter((chest) => chest.opened).length;
    },
    lootTotal() {
      return chests.length;
    },
    dispose() {
      audio.stopFires();
      dust.dispose();
      clearDustField(dust);
      disposeTree(root);
      scene.remove(root);
      scene.remove(sun);
      scene.remove(sunTarget);
      scene.remove(sky);
      scene.remove(fill);
    },
    update(time, dt, theme, x, z, moving, camera) {
      const outerZ = approach.southZ + ENTRANCE_BLEND;
      const entranceT = Math.min(1, Math.max(0, (outerZ - z) / ENTRANCE_BLEND));
      const fog = scene.fog;
      fogColor.copy(outdoorFog).lerp(indoorFog, entranceT);
      fog.color.copy(fogColor);
      scene.background.copy(fogColor);
      fog.density = THEME.outdoor.density + (THEME.stone.density - THEME.outdoor.density) * entranceT;
      sun.intensity = SUN_OUTDOOR * (1 - entranceT);
      sky.intensity = SKY_OUTDOOR * (1 - entranceT);
      fill.intensity = 0.08 + (0.012 - 0.08) * entranceT;
      const here = roomAt(x, z);
      const indoors = here && here.theme !== 'outdoor' && Number.isFinite(here.index);
      if (indoors) this.intruded = true;
      activeList.length = 0;
      if (indoors) {
        for (const room of rooms) {
          if (Math.abs(room.index - here.index) <= 1) activeList.push(room.id);
        }
      }
      batch.showRooms(activeList);
      this.activeRooms.clear();
      for (const id of activeList) this.activeRooms.add(id);
      if (veil) veil.visible = !this.intruded;
      dust.update(time, theme !== 'outdoor', camera);
      for (const chest of chests) {
        if (chest.opened) {
          chest.lidAge = Math.min(LID_SECONDS, chest.lidAge + dt);
          const t = chest.lidAge / LID_SECONDS;
          const swing = t >= 1 ? 1 : easeOutCubic(t);
          chest.lid.rotation.x = -LID_LEAN - (LID_OPEN - LID_LEAN) * swing;
          const settled = t >= 1;
          chest.fill.visible = settled;
          chest.fill.intensity = settled ? 0.8 : 0;
        }
        if (chest.loot && !chest.loot.cleared && chest.loot.age < 2.4) {
          const loot = chest.loot;
          loot.age += dt;
          loot.flash.intensity = Math.max(0, 24 * (1 - loot.age / 0.4));
          if (chest.lidAge > 0.12 && loot.spawned < loot.total) {
            while (loot.spawned < loot.total) {
              emitChestCoin(chest);
              loot.spawned += 1;
            }
          }
          const fade = Math.min(1, Math.max(0, (loot.age - 1.05) / 0.55));
          loot.material.opacity = 1 - fade;
          for (const coin of loot.coins) {
            const vel = coin.userData.vel;
            vel.y -= 16 * dt;
            coin.position.addScaledVector(vel, dt);
            coin.rotation.x += dt * coin.userData.spin.x;
            coin.rotation.y += dt * coin.userData.spin.y;
            coin.rotation.z += dt * coin.userData.spin.z;
            if (coin.position.y < 0.12) {
              coin.position.y = 0.12;
              if (vel.y < -1.2) vel.y *= -0.28;
              else vel.y = 0;
              vel.x *= 0.45;
              vel.z *= 0.45;
              coin.userData.spin.multiplyScalar(0.4);
            }
          }
          if (loot.age > 1.65 && !loot.cleared) {
            for (const coin of loot.coins) root.remove(coin);
            loot.material.dispose();
            root.remove(loot.flash);
            loot.coins.length = 0;
            loot.cleared = true;
          }
        }
      }
      for (const sconce of sconces) {
        const shown = this.activeRooms.has(sconce.roomId);
        sconce.group.visible = shown;
        sconce.chest.group.visible = shown;
        const dx = sconce.x - x;
        const dz = sconce.z - z;
        const hidden = !shown || !sconce.interactable.lit
          || dx * dx + dz * dz > 225
          || !lineOfSight(x, z, sconce.x, sconce.z, colliders);
        sconce.interactable.cullLight(hidden);
        sconce.interactable.update(dt, time);
      }
    },
  };
}
