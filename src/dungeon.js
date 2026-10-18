import * as THREE from 'three';
import { clearance, pointInPolygon } from './geometry.js';

const WALL_HEIGHT = 10;
const DOOR_HEIGHT = 7;
const THICKNESS = 1;

const THEME = {
  stone: { fog: 0x2a2724, density: 0.018, ambient: 0.34, hemi: 0.5, floor: 0x9a948c, wall: 0xc8c2b8 },
  wood: { fog: 0x2c221b, density: 0.02, ambient: 0.32, hemi: 0.46, floor: 0xb08968, wall: 0xd7b48a },
  cave: { fog: 0x12161c, density: 0.04, ambient: 0.2, hemi: 0.3, floor: 0x6e6a66, wall: 0x8a8682 },
};

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
    uvs.push(x / 3.5, z / 3.5);
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
  mesh.castShadow = false;
  mesh.receiveShadow = false;
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

function addWall(scene, ax, az, bx, bz, theme, materials, colliders, height, y0, collide) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (length < 0.2) return;
  const geometry = new THREE.BoxGeometry(length, height, THICKNESS);
  scaleUvs(geometry, Math.max(length / 4, 0.4), Math.max(height / 4, 0.4));
  const mesh = settle(new THREE.Mesh(geometry, materials.surface(theme)));
  mesh.position.set((ax + bx) / 2, y0 + height / 2, (az + bz) / 2);
  mesh.rotation.y = Math.atan2(-(bz - az), bx - ax);
  mesh.updateMatrix();
  scene.add(mesh);
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
    if (!obj.isMesh) return;
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

function buildWalls(root, materials, colliders, rooms, doors) {
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
      addWall(root, ax, az, bx, bz, themeAt(group.covers, (t0 + t1) / 2), materials, colliders, WALL_HEIGHT, 0, true);
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
      );
    }
  }
}

function addFlame(materials, y, size) {
  const flame = new THREE.Mesh(new THREE.SphereGeometry(size, 7, 5), materials.flame);
  flame.position.y = y;
  const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.45, 6, 4), materials.core);
  core.position.y = y + size * 0.25;
  return { flame, core };
}

function addBrazier(scene, materials, x, z) {
  const group = new THREE.Group();
  const base = settle(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.1, 8), materials.brazier));
  base.position.y = 0.55;
  base.updateMatrix();
  const bowl = settle(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.28, 8), materials.bowl));
  bowl.position.y = 1.2;
  bowl.updateMatrix();
  const { flame, core } = addFlame(materials, 1.62, 0.22);
  group.add(base, bowl, flame, core);
  group.position.set(x, 0, z);
  scene.add(group);
  return { x, y: 1.9, z, flame, core, phase: Math.random() * Math.PI * 2, base: 46 };
}

function addSconce(scene, materials, x, z) {
  const group = new THREE.Group();
  const bracket = settle(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), materials.brazier));
  bracket.position.y = 5.7;
  bracket.updateMatrix();
  const { flame, core } = addFlame(materials, 6.15, 0.14);
  group.add(bracket, flame, core);
  group.position.set(x, 0, z);
  scene.add(group);
  return { x, y: 5.6, z, flame, core, phase: x * 0.17, base: 28 };
}

function addRock(scene, materials, x, z) {
  const rock = settle(new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), materials.surface('cave')));
  rock.scale.set(1.15, 1.55, 1.05);
  rock.position.set(x, 0.7, z);
  rock.rotation.y = x * 0.2;
  rock.updateMatrix();
  scene.add(rock);
}

export function createDungeon(scene, materials, layout) {
  const { rooms, doors } = layout;
  const colliders = [];
  const torches = [];
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
  root.add(ground);

  for (const room of rooms) {
    const floor = settle(new THREE.Mesh(
      polygonGeometry(room.polygon, 0, true),
      materials.floor(room.theme),
    ));
    root.add(floor);
    const ceiling = settle(new THREE.Mesh(
      polygonGeometry(room.polygon, WALL_HEIGHT, false),
      room.theme === 'cave' ? materials.ceilingCave : materials.ceiling,
    ));
    root.add(ceiling);
    if (room.brazier) {
      torches.push(addBrazier(root, materials, room.brazier[0], room.brazier[1]));
      colliders.push({ x: room.brazier[0], z: room.brazier[1], radius: 0.85 });
    } else if (room.sconce) {
      torches.push(addSconce(root, materials, room.sconce[0], room.sconce[1]));
    }
    for (const [x, z] of room.rocks) {
      addRock(root, materials, x, z);
      colliders.push({ x, z, radius: 1.05 });
    }
  }

  buildWalls(root, materials, colliders, rooms, doors);

  const ambient = new THREE.AmbientLight(0x322c28, 0.32);
  const hemi = new THREE.HemisphereLight(0x9aabbd, 0x3a2e26, 0.45);
  const hearth = new THREE.PointLight(0xff8a3d, 46, 36, 1.6);
  const fogColor = new THREE.Color();
  root.add(ambient, hemi, hearth);
  if (!scene.background) scene.background = new THREE.Color(0x14110e);
  if (!scene.fog) scene.fog = new THREE.FogExp2(0x1a1714, 0.012);

  function roomAt(x, z, previousId) {
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

  return {
    rooms,
    doors,
    colliders,
    lastRoomId: layout.lastRoomId,
    group: root,
    roomAt,
    dispose() {
      disposeTree(root);
      scene.remove(root);
    },
    update(time, dt, theme, x, z) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const torch of torches) {
        const dx = torch.x - x;
        const dz = torch.z - z;
        const dist = dx * dx + dz * dz;
        const flicker = 0.82 + Math.sin(time * 9 + torch.phase) * 0.08 + Math.sin(time * 23 + torch.phase) * 0.06;
        torch.flicker = flicker;
        if (dist < 6400) {
          const scale = 0.9 + flicker * 0.18;
          torch.flame.scale.setScalar(scale);
          torch.core.scale.setScalar(scale * 0.8);
        }
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = torch;
        }
      }
      if (nearest) {
        hearth.position.set(nearest.x, nearest.y, nearest.z);
        hearth.intensity = nearest.base * nearest.flicker;
      }
      const look = THEME[theme] || THEME.stone;
      const blend = 1 - Math.exp(-dt * 2.5);
      ambient.intensity += (look.ambient - ambient.intensity) * blend;
      hemi.intensity += (look.hemi - hemi.intensity) * blend;
      const fog = scene.fog;
      fogColor.set(look.fog);
      fog.color.lerp(fogColor, blend);
      scene.background.lerp(fogColor, blend);
      fog.density += (look.density - fog.density) * blend;
    },
  };
}
