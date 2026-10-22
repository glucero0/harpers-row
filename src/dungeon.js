import * as THREE from 'three';
import { SWORD_ARC, SWORD_RANGE } from './balance.js';
import { clearDustField, createDustField } from './dust.js';
import { clearance, closestOnSegment, lineOfSight, pointInPolygon } from './geometry.js';
import { audio } from './audio.js';
import ancientRuinsData from './ancientRuinsData.json';
import { DEAD_TREE_VARIANTS, ENVIRONMENT_PRESETS } from './rooms.js';
import { SCONCE_LIGHT_CULL_DISTANCE, createWallSconce } from './sconce.js';

const SCONCE_LIGHT_CULL_DISTANCE_SQ = SCONCE_LIGHT_CULL_DISTANCE * SCONCE_LIGHT_CULL_DISTANCE;

const WALL_HEIGHT = 10;
const DOOR_HEIGHT = 7;
const THICKNESS = 1;

const THEME = {
  outdoor: { fog: 0xc5d0d6, density: 0.009 },
  stone: { fog: 0x000000, density: 0.07 },
  wood: { fog: 0x2c221b, density: 0.02 },
  cave: { fog: 0x12161c, density: 0.04 },
};

const OUTDOOR_FOG = 0xc5d0d6;
const SUN_OUTDOOR = 2.4;
const SKY_OUTDOOR = 1.05;
const DAY_FILL = ENVIRONMENT_PRESETS.day.ambientLightIntensity;
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
const CHEST_BASE_WIDTH = 1.36;
const CHEST_BASE_DEPTH = 0.9;
const CHEST_BASE_HEIGHT = 0.8;
const CLOSED_ROTATION = 0;
const OPEN_ROTATION = -Math.PI * 0.6;
const LID_SECONDS = 0.55;
const LID_ARCH = 0.16;
const LID_THICK = 0.1;
const LID_SINK = 0;
const LID_DEPTH = CHEST_BASE_DEPTH;
const LID_WIDTH = CHEST_BASE_WIDTH + 0.06;
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

function archedLidGeometry(width, depth, arch, thick) {
  const shape = new THREE.Shape();
  const steps = 16;
  shape.moveTo(0, 0);
  shape.lineTo(depth, 0);
  shape.lineTo(depth, thick);
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps;
    shape.lineTo(depth * t, thick + Math.sin(t * Math.PI) * arch);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function lidStrapPose(reach) {
  const yAt = (z) => -LID_SINK + LID_THICK + Math.sin((z / LID_DEPTH) * Math.PI) * LID_ARCH;
  const y0 = yAt(0);
  const y1 = yAt(reach);
  const angle = Math.atan2(y1 - y0, reach);
  const lift = 0.006;
  return {
    angle,
    y: (y0 + y1) / 2 + lift * Math.cos(angle),
    z: reach / 2 - lift * Math.sin(angle),
  };
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
  lidPivot.name = 'chest-lid-pivot';
  lidPivot.position.set(0, CHEST_BASE_HEIGHT, -CHEST_BASE_DEPTH / 2);
  lidPivot.rotation.x = CLOSED_ROTATION;
  const lid = new THREE.Mesh(archedLidGeometry(LID_WIDTH, LID_DEPTH, LID_ARCH, LID_THICK), plank);
  lid.name = 'chest-lid';
  lid.position.y = -LID_SINK;
  lid.castShadow = true;
  lid.receiveShadow = true;
  // Sits inside the mouth, below the rim, so a grazing view cannot see the coins.
  const seal = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.06, 0.7), plank);
  seal.name = 'chest-lid-seal';
  seal.position.set(0, -0.03, 0.46);
  seal.castShadow = true;
  seal.receiveShadow = true;

  const hingeX = 0.42;
  const knuckle = new THREE.CylinderGeometry(0.034, 0.034, 0.09, 10);
  knuckle.rotateZ(Math.PI / 2);
  const pinL = new THREE.Mesh(knuckle, iron);
  pinL.name = 'chest-hinge-pin';
  pinL.position.set(-hingeX, 0, 0);
  pinL.castShadow = true;
  const pinR = pinL.clone();
  pinR.position.x = hingeX;

  const baseStrap = new THREE.BoxGeometry(0.075, 0.32, 0.03);
  const baseHingeL = new THREE.Mesh(baseStrap, iron);
  baseHingeL.name = 'chest-hinge-base';
  baseHingeL.position.set(-hingeX, CHEST_BASE_HEIGHT - 0.19, -CHEST_BASE_DEPTH / 2 - 0.012);
  baseHingeL.castShadow = true;
  const baseHingeR = baseHingeL.clone();
  baseHingeR.position.x = hingeX;

  const backLeaf = new THREE.BoxGeometry(0.075, 0.1, 0.028);
  const leafL = new THREE.Mesh(backLeaf, iron);
  leafL.name = 'chest-hinge-leaf';
  leafL.position.set(-hingeX, 0.04, -0.012);
  leafL.castShadow = true;
  const leafR = leafL.clone();
  leafR.position.x = hingeX;

  const strapReach = 0.22;
  const strapPose = lidStrapPose(strapReach);
  const topLeaf = new THREE.BoxGeometry(0.075, 0.026, strapReach);
  const topL = new THREE.Mesh(topLeaf, iron);
  topL.name = 'chest-hinge-leaf';
  topL.position.set(-hingeX, strapPose.y, strapPose.z);
  topL.rotation.x = -strapPose.angle;
  topL.castShadow = true;
  const topR = topL.clone();
  topR.position.x = hingeX;

  const hasp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.036), iron);
  hasp.name = 'chest-hasp';
  hasp.position.set(0, -0.06, CHEST_BASE_DEPTH + 0.016);
  hasp.castShadow = true;
  lidPivot.add(lid, seal, pinL, pinR, leafL, leafR, topL, topR, hasp);

  const heap = new THREE.Mesh(goldHeapGeometry(), materials.gold);
  heap.castShadow = true;
  heap.receiveShadow = true;
  const fill = new THREE.PointLight(0xffb15a, 0, 1.5, 2);
  fill.position.set(0, 0.5, 0.04);
  fill.castShadow = false;
  fill.visible = false;
  group.add(
    floor, front, back, left, right,
    frontBand, backBand, sideBand, sideBandB, footA, footB,
    baseHingeL, baseHingeR, heap, fill, lidPivot,
  );
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

function trackMaterial(owned, material) {
  material.userData.shared = true;
  owned.push(material);
  return material;
}

function ribbonGeometry(samples, y) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    positions.push(sample.x - sample.half, y, sample.z, sample.x + sample.half, y, sample.z);
    uvs.push(0, i * 0.22, 1, i * 0.22);
  }
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function deadTreeGeometry(spec, variant) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, spec.height, 5);
  trunk.translate(0, spec.height / 2, 0);
  parts.push(trunk);
  for (let i = 0; i < spec.branches; i += 1) {
    const branch = new THREE.BoxGeometry(0.12, spec.height * (spec.height < 2 ? 0.55 : 0.34), 0.12);
    const ang = (i / spec.branches) * Math.PI * 2 + variant * 0.47;
    const lift = spec.height * (0.42 + (i % 3) * 0.14);
    branch.rotateZ(spec.spread * (i % 2 === 0 ? 0.72 : -0.58));
    branch.rotateY(ang);
    branch.translate(Math.cos(ang) * 0.42, lift, Math.sin(ang) * 0.42);
    parts.push(branch);
  }
  return mergeGeometries(parts);
}

function paintSky() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#d7e3eb');
  gradient.addColorStop(0.42, '#c5d0d6');
  gradient.addColorStop(1, '#c3cdc8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = 'rgba(244, 246, 248, 0.42)';
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath();
    ctx.ellipse(36 + i * 64, 58 + (i % 3) * 16, 46, 7, i * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildApproach(outdoor, threshold, materials, colliders, layout, owned) {
  const { approach, entrance } = layout;
  const ante = layout.rooms[0];
  if (!approach || !entrance || !ante) return null;
  const { court, samples, southZ, midX, vestibule, hub } = approach;
  const end = samples[samples.length - 1];
  const anteEast = ante.rect.x + ante.rect.w;
  const courtEast = court.x + court.w;
  const doorTop = entrance.height || 7.2;
  const left = entrance.a[0];
  const right = entrance.b[0];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 280), materials.dirt);
  ground.name = 'approach-ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(midX, -0.06, southZ + 40);
  ground.receiveShadow = true;
  ground.castShadow = false;
  outdoor.add(ground);

  addDirt(outdoor, materials.dirt, court);
  const pathMat = trackMaterial(owned, materials.dirt.clone());
  pathMat.color.set(0xc4a06a);
  const pathMesh = new THREE.Mesh(ribbonGeometry(samples, 0.045), pathMat);
  pathMesh.name = 'approach-path';
  pathMesh.receiveShadow = true;
  pathMesh.castShadow = false;
  outdoor.add(pathMesh);

  const bankMat = trackMaterial(owned, new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 1 }));
  const bankParts = [];
  const bankBox = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    for (const sign of [-1, 1]) {
      const half = (a.half + b.half) / 2 + 1.15;
      const ox = mx + a.nx * sign * half;
      const oz = mz + a.nz * sign * half;
      const piece = bankBox.clone();
      piece.scale(2.6, 0.42, len + 0.4);
      piece.rotateY(yaw);
      piece.translate(ox, 0.06, oz);
      bankParts.push(piece);
      const ax = a.x + a.nx * sign * half;
      const az = a.z + a.nz * sign * half;
      const bx = b.x + b.nx * sign * half;
      const bz = b.z + b.nz * sign * half;
      colliders.push(segmentCollider(ax, az, bx, bz, a.nx * sign, a.nz * sign));
    }
  }
  bankBox.dispose();
  const banks = new THREE.Mesh(mergeGeometries(bankParts), bankMat);
  banks.name = 'embankments';
  banks.castShadow = false;
  banks.receiveShadow = true;
  outdoor.add(banks);

  const mouthL = samples[0].x - samples[0].half;
  const mouthR = samples[0].x + samples[0].half;
  colliders.push(segmentCollider(court.x, samples[0].z, mouthL, samples[0].z, 0, -1));
  colliders.push(segmentCollider(mouthR, samples[0].z, courtEast, samples[0].z, 0, -1));
  const fence = end.half + 1.15;
  const fenceZ = hub.z + hub.d;
  colliders.push(segmentCollider(end.x - fence, end.z, end.x - fence, fenceZ, -1, 0));
  colliders.push(segmentCollider(end.x + fence, end.z, end.x + fence, fenceZ, 1, 0));
  colliders.push(segmentCollider(end.x - fence, fenceZ, end.x + fence, fenceZ, 0, 1));

  const facade = 13;
  const flank = 6.5;
  if (ante.rect.x > court.x + 0.4) {
    addWall(outdoor, court.x, southZ, ante.rect.x, southZ, 'stone', materials, colliders, facade, 0, true);
  }
  if (courtEast > anteEast + 0.4) {
    addWall(outdoor, anteEast, southZ, courtEast, southZ, 'stone', materials, colliders, facade, 0, true);
  }
  addWall(outdoor, court.x, court.z, court.x, court.z + court.d, 'stone', materials, colliders, flank, 0, true);
  addWall(outdoor, courtEast, court.z, courtEast, court.z + court.d, 'stone', materials, colliders, flank, 0, true);
  const stone = materials.surface('stone');
  const facadeZ = southZ + 0.55;
  if (left - ante.rect.x > 0.25) {
    addWall(outdoor, ante.rect.x - 0.5, facadeZ, left - 0.05, facadeZ, 'stone', materials, colliders, facade, 0, true);
  }
  if (anteEast - right > 0.25) {
    addWall(outdoor, right + 0.05, facadeZ, anteEast + 0.5, facadeZ, 'stone', materials, colliders, facade, 0, true);
  }
  addWall(outdoor, left - 0.4, facadeZ, right + 0.4, facadeZ, 'stone', materials, colliders, facade - doorTop, doorTop, false);
  addWall(outdoor, left - 0.7, southZ + 0.15, left - 0.7, southZ + 2.4, 'stone', materials, colliders, doorTop + 1.2, 0, true);
  addWall(outdoor, right + 0.7, southZ + 0.15, right + 0.7, southZ + 2.4, 'stone', materials, colliders, doorTop + 1.2, 0, true);
  addProp(outdoor, new THREE.BoxGeometry(court.w + 1.2, 1.15, 1.35), stone, court.x + court.w / 2, 12.5, southZ + 0.35);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(vestibule.w, vestibule.d), stone);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(vestibule.x + vestibule.w / 2, 0.03, vestibule.z + vestibule.d / 2);
  floor.receiveShadow = true;
  floor.castShadow = false;
  threshold.add(floor);
  addWall(threshold, vestibule.x, vestibule.z, vestibule.x, vestibule.z + vestibule.d, 'stone', materials, colliders, doorTop, 0, true);
  addWall(threshold, vestibule.x + vestibule.w, vestibule.z, vestibule.x + vestibule.w, vestibule.z + vestibule.d, 'stone', materials, colliders, doorTop, 0, true);
  const soffit = new THREE.Mesh(new THREE.BoxGeometry(vestibule.w + 0.4, 0.55, vestibule.d), stone);
  soffit.position.set(vestibule.x + vestibule.w / 2, doorTop - 0.2, vestibule.z + vestibule.d / 2);
  soffit.castShadow = false;
  soffit.receiveShadow = true;
  threshold.add(soffit);

  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(vestibule.w + 0.4, doorTop + 0.8),
    trackMaterial(owned, new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide })),
  );
  cap.name = 'entrance-veil';
  cap.position.set(midX, doorTop / 2, southZ - 3.2);
  cap.castShadow = false;
  cap.receiveShadow = false;
  outdoor.add(cap);

  const wood = trackMaterial(owned, new THREE.MeshStandardMaterial({ color: 0x645c54, roughness: 1 }));
  const trees = new THREE.BatchedMesh(40, 40000, 60000, wood);
  trees.name = 'dead-trees';
  trees.castShadow = false;
  trees.receiveShadow = true;
  const variantIds = DEAD_TREE_VARIANTS.map((spec, index) => {
    const geometry = deadTreeGeometry(spec, index);
    const id = trees.addGeometry(geometry);
    geometry.dispose();
    return id;
  });
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const leanAxis = new THREE.Vector3();
  const yawQ = new THREE.Quaternion();
  const leanQ = new THREE.Quaternion();
  const shadowDirX = 0.27;
  const shadowDirZ = 0.96;
  const shadowMat = trackMaterial(owned, new THREE.MeshBasicMaterial({
    color: 0x3a332c,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
  const shadowPlane = new THREE.PlaneGeometry(1.5, 1.5);
  shadowPlane.rotateX(-Math.PI / 2);
  const shadows = new THREE.BatchedMesh(40, 4000, 6000, shadowMat);
  shadows.name = 'contact-shadows';
  shadows.castShadow = false;
  shadows.receiveShadow = false;
  const shadowGeo = shadows.addGeometry(shadowPlane);
  shadowPlane.dispose();
  const shadowYaw = Math.atan2(shadowDirX, shadowDirZ);
  for (const tree of layout.trees || []) {
    leanAxis.set(Math.cos(tree.leanAxis), 0, Math.sin(tree.leanAxis));
    leanQ.setFromAxisAngle(leanAxis, tree.lean);
    yawQ.setFromAxisAngle(up, tree.rotationY);
    quaternion.copy(yawQ).multiply(leanQ);
    scale.set(tree.scale, tree.scale, tree.scale);
    position.set(tree.x, 0, tree.z);
    matrix.compose(position, quaternion, scale);
    const instance = trees.addInstance(variantIds[tree.variant] ?? variantIds[0]);
    trees.setMatrixAt(instance, matrix);
    quaternion.setFromAxisAngle(up, shadowYaw);
    scale.set(0.85 * tree.scale, 1, 2.2 * tree.scale);
    position.set(tree.x + shadowDirX * 1.15 * tree.scale, 0.05, tree.z + shadowDirZ * 1.15 * tree.scale);
    matrix.compose(position, quaternion, scale);
    const shadow = shadows.addInstance(shadowGeo);
    shadows.setMatrixAt(shadow, matrix);
  }
  trees.computeBoundingBox();
  trees.computeBoundingSphere();
  shadows.computeBoundingBox();
  shadows.computeBoundingSphere();
  outdoor.add(trees);
  outdoor.add(shadows);

  const ruinShadow = new THREE.Mesh(new THREE.PlaneGeometry(court.w * 0.62, 8.5), shadowMat);
  ruinShadow.name = 'ruin-shadow';
  ruinShadow.rotation.x = -Math.PI / 2;
  ruinShadow.position.set(midX + shadowDirX * 3.2, 0.04, southZ + 5.4);
  ruinShadow.rotation.z = -shadowYaw;
  outdoor.add(ruinShadow);

  const hillMat = materials.dirt;
  const hillGeo = new THREE.SphereGeometry(1, 6, 5);
  const hills = new THREE.BatchedMesh(20, 8000, 12000, hillMat);
  hills.name = 'perimeter-hills';
  hills.castShadow = false;
  hills.receiveShadow = true;
  const hillId = hills.addGeometry(hillGeo);
  hillGeo.dispose();
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    const radius = i % 2 === 0 ? 74 : 98;
    const hx = midX + Math.cos(angle) * radius;
    const hz = southZ + 30 + Math.sin(angle) * radius * 0.7;
    if (Math.abs(hx - end.x) < 18 && hz > end.z - 12) continue;
    const lift = i % 2 === 0 ? 3.2 : 4.6;
    quaternion.identity();
    scale.set(7 + (i % 3), lift, 8 + (i % 4));
    position.set(hx, lift * 0.15, hz);
    matrix.compose(position, quaternion, scale);
    const hill = hills.addInstance(hillId);
    hills.setMatrixAt(hill, matrix);
  }
  hills.computeBoundingBox();
  hills.computeBoundingSphere();
  outdoor.add(hills);

  const ridgeMat = trackMaterial(owned, new THREE.MeshStandardMaterial({ color: 0x8d877e, roughness: 1 }));
  const ridge = new THREE.ConeGeometry(1, 1, 6);
  for (const sign of [-1, 1]) {
    const mountain = new THREE.Mesh(sign < 0 ? ridge : ridge.clone(), ridgeMat);
    mountain.name = sign < 0 ? 'mountain-west' : 'mountain-east';
    mountain.scale.set(16, 18, 22);
    mountain.position.set(end.x + sign * 24, 6.2, end.z + 8);
    mountain.castShadow = false;
    mountain.receiveShadow = true;
    outdoor.add(mountain);
    colliders.push({ x: end.x + sign * 22, z: end.z + 7, radius: 8.5 });
  }

  const skyTex = paintSky();
  const skyMat = trackMaterial(owned, new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }));
  skyMat.userData.ownsMap = true;
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(160, 18, 12), skyMat);
  skyDome.name = 'approach-sky';
  skyDome.position.set(midX, 0, southZ + 24);
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -2;
  outdoor.add(skyDome);

  const shaftMat = trackMaterial(owned, new THREE.MeshBasicMaterial({
    color: 0xfff4dc,
    transparent: true,
    opacity: 0.045,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  }));
  const shafts = new THREE.Group();
  shafts.name = 'sun-shafts';
  const lightDir = new THREE.Vector3(shadowDirX, -0.72, shadowDirZ).normalize();
  for (let i = 0; i < 3; i += 1) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1 + i * 0.35, 22, 5, 1, true), shaftMat);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lightDir);
    cone.position.set(midX - 6 + i * 5, 24, southZ - 8 + i * 2);
    cone.castShadow = false;
    cone.renderOrder = 2;
    shafts.add(cone);
  }
  outdoor.add(shafts);

  return { skyMap: skyTex, cap };
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

export function ancientRuinsLayout() {
  return JSON.parse(JSON.stringify(ancientRuinsData));
}

export function createDungeon(scene, materials, layout = ancientRuinsLayout(), renderer = null) {
  const { rooms, doors } = layout;
  const colliders = [];
  const sconces = [];
  const chests = [];
  const owned = [];
  const root = new THREE.Group();
  const outdoorGroup = new THREE.Group();
  outdoorGroup.name = 'outdoor-zone';
  const thresholdGroup = new THREE.Group();
  thresholdGroup.name = 'threshold-zone';
  root.add(outdoorGroup, thresholdGroup);
  scene.add(root);

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
  const approachBuilt = buildApproach(outdoorGroup, thresholdGroup, materials, colliders, layout, owned);
  const skyMap = approachBuilt?.skyMap || null;

  const entrance = layout.entrance;
  const gateCollider = entrance
    ? segmentCollider(entrance.a[0], entrance.a[1], entrance.b[0], entrance.b[1], 0, 1)
    : null;
  if (gateCollider) colliders.push(gateCollider);
  let gateOpen = false;
  const activeList = [];

  const dust = createDustField(root);
  const approach = layout.approach || { midX: 0, southZ: 0 };
  const sun = new THREE.DirectionalLight(0xfff3dc, SUN_OUTDOOR);
  // Daylight does not cast a shadow map. Contact decals carry the sun's direction on the
  // ground so the torch stays the only shadow-casting light.
  sun.castShadow = false;
  // High, and a little north of the arch so the light rakes across the path from behind the ruin.
  sun.position.set(approach.midX - 16, 62, approach.southZ - 8);
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(approach.midX + 2, 2, approach.southZ + 18);
  sun.target = sunTarget;
  const sky = new THREE.HemisphereLight(0xe7eef3, 0xa08b6c, SKY_OUTDOOR);
  const fill = new THREE.AmbientLight(0xe4d7c2, DAY_FILL);
  scene.add(sun, sunTarget, sky, fill);

  const bgColor = new THREE.Color(OUTDOOR_FOG);
  const expFog = new THREE.FogExp2(OUTDOOR_FOG, THEME.outdoor.density);
  const linearFog = new THREE.Fog(0x000000, 8, 20);
  const blendFrom = new THREE.Color();
  const blendTo = new THREE.Color();
  const blend = {
    fromSun: SUN_OUTDOOR,
    toSun: SUN_OUTDOOR,
    fromSky: SKY_OUTDOOR,
    toSky: SKY_OUTDOOR,
    fromFill: DAY_FILL,
    toFill: DAY_FILL,
    fromDensity: THEME.outdoor.density,
    toDensity: THEME.outdoor.density,
    left: 0,
    dur: 1,
    pending: null,
  };
  scene.background = bgColor;
  scene.fog = expFog;

  let zoneId = 'worn-trail';

  function applyEnvironment(preset) {
    const source = preset || ENVIRONMENT_PRESETS.day;
    const fog = source.fog;
    const day = source.skyboxVisible !== false;
    sun.intensity = day ? SUN_OUTDOOR : 0;
    sky.intensity = day ? SKY_OUTDOOR : 0;
    fill.intensity = source.ambientLightIntensity;
    bgColor.set(source.clearColor || (fog && fog.color) || '#000000');
    scene.background = bgColor;
    if (fog && Number.isFinite(fog.density)) {
      expFog.color.copy(bgColor);
      expFog.density = fog.density;
      scene.fog = expFog;
    } else if (fog) {
      linearFog.color.set(fog.color);
      linearFog.near = fog.near;
      linearFog.far = fog.far;
      scene.fog = linearFog;
    }
    if (renderer) renderer.setClearColor(bgColor, day ? 1 : 0);
    outdoorGroup.visible = day;
    blend.left = 0;
    blend.pending = null;
  }

  function blendEnvironment(preset, seconds) {
    const source = preset || ENVIRONMENT_PRESETS.day;
    const day = source.skyboxVisible !== false;
    blend.fromSun = sun.intensity;
    blend.toSun = day ? SUN_OUTDOOR : 0;
    blend.fromSky = sky.intensity;
    blend.toSky = day ? SKY_OUTDOOR : 0;
    blend.fromFill = fill.intensity;
    blend.toFill = source.ambientLightIntensity;
    blendFrom.copy(scene.fog.color);
    blendTo.set((source.fog && source.fog.color) || source.clearColor || '#000000');
    blend.fromDensity = scene.fog === expFog ? expFog.density : THEME.outdoor.density;
    blend.toDensity = source.fog && Number.isFinite(source.fog.density) ? source.fog.density : 0.07;
    blend.left = Math.max(0.05, seconds || 0.6);
    blend.dur = blend.left;
    blend.pending = source;
  }

  function tickEnvironment(dt) {
    if (skyMap) skyMap.offset.x += dt * 0.003;
    if (blend.left <= 0) return;
    blend.left = Math.max(0, blend.left - dt);
    const t = 1 - blend.left / blend.dur;
    sun.intensity = blend.fromSun + (blend.toSun - blend.fromSun) * t;
    sky.intensity = blend.fromSky + (blend.toSky - blend.fromSky) * t;
    fill.intensity = blend.fromFill + (blend.toFill - blend.fromFill) * t;
    if (scene.fog === expFog) {
      expFog.color.copy(blendFrom).lerp(blendTo, t);
      expFog.density = blend.fromDensity + (blend.toDensity - blend.fromDensity) * t;
      scene.background.copy(expFog.color);
    }
    if (blend.left === 0 && blend.pending) {
      const next = blend.pending;
      blend.pending = null;
      applyEnvironment(next);
    }
  }

  const outdoors = {
    id: 'worn-trail',
    index: 0,
    kind: 'exterior',
    name: 'Worn Trail',
    theme: 'outdoor',
    lighting: 'day',
    description: approach.description || '',
    polygon: layout.exterior || [],
    spawns: [],
  };
  const hubRoom = {
    id: 'world-hub',
    index: 0,
    kind: 'exterior',
    name: 'Mountain Pass',
    theme: 'outdoor',
    lighting: 'day',
    description: 'The trail leaves the ruins through a gap in the low hills.',
    polygon: layout.hub || [],
    spawns: [],
  };
  const vestibulePoly = layout.vestibule || [];

  function showZone(nextZone) {
    zoneId = nextZone;
    outdoorGroup.visible = nextZone !== 'ancient-ruins';
  }

  function roomAt(x, z, previousId) {
    if (hubRoom.polygon.length > 2 && pointInPolygon(x, z, hubRoom.polygon)) return hubRoom;
    if (vestibulePoly.length > 2 && pointInPolygon(x, z, vestibulePoly)) {
      const previous = rooms.find((room) => room.id === previousId);
      if (previous && previous.theme !== 'outdoor') return previous;
      return outdoors;
    }
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
    flash.castShadow = false;
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

  applyEnvironment(ENVIRONMENT_PRESETS.day);
  showZone('worn-trail');

  return {
    rooms,
    doors,
    colliders,
    chests,
    sconces,
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
    isGateOpen() {
      return gateOpen;
    },
    showZone,
    applyEnvironment,
    blendEnvironment,
    tickEnvironment,
    currentZone() {
      return zoneId;
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
      for (const material of owned) {
        if (material.userData.ownsMap) material.map?.dispose();
        material.dispose();
      }
      owned.length = 0;
      disposeTree(root);
      scene.remove(root);
      scene.remove(sun);
      scene.remove(sunTarget);
      scene.remove(sky);
      scene.remove(fill);
    },
    update(time, dt, theme, x, z, moving, camera) {
      const here = roomAt(x, z, null);
      const inInteriorRoom = !!(here && here.theme !== 'outdoor');
      const indoors = zoneId === 'ancient-ruins' || inInteriorRoom;
      outdoorGroup.visible = !indoors;
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
      dust.update(time, theme !== 'outdoor', camera);
      for (const chest of chests) {
        if (chest.opened) {
          chest.lidAge = Math.min(LID_SECONDS, chest.lidAge + dt);
          const t = chest.lidAge / LID_SECONDS;
          const swing = t >= 1 ? 1 : easeOutCubic(t);
          chest.lid.rotation.x = CLOSED_ROTATION + (OPEN_ROTATION - CLOSED_ROTATION) * swing;
          chest.lidAngle = chest.lid.rotation.x;
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
          || dx * dx + dz * dz > SCONCE_LIGHT_CULL_DISTANCE_SQ
          || !lineOfSight(x, z, sconce.x, sconce.z, colliders);
        sconce.interactable.cullLight(hidden);
        sconce.interactable.update(dt, time);
      }
    },
  };
}
