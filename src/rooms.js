import { clearance, closestOnSegment, rectGap } from './geometry.js';
import { SKELETON_NAME } from './balance.js';

const TARGET_AREA = 10000;
const NORTH = 3;
const NAMES = {
  stone: ['Stone Gate', 'Stone Cells', 'Mason Hall', 'Stone Vault', 'Old Watch', 'Gallery of Blocks'],
  wood: ['Wood Hall', 'Timber Barracks', 'Rafter Loft', 'Plank Chapel', 'Dry Stores', 'Cooperage'],
  cave: ['Cave Bend', 'Damp Gallery', 'Low Cave', 'Echo Cave', 'Cave Crypt', 'Black Hollow'],
};

export function randomSeed() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoObj.getRandomValues(buffer);
    return buffer[0] || 1;
  }
  return (Math.random() * 0xffffffff) >>> 0 || 1;
}

function makeRng(seed) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range(min, max) {
      return min + next() * (max - min);
    },
    int(min, max) {
      return min + Math.floor(next() * (max - min));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
  };
}

function polygonFromRect(rect) {
  return [
    [rect.x, rect.z],
    [rect.x + rect.w, rect.z],
    [rect.x + rect.w, rect.z + rect.d],
    [rect.x, rect.z + rect.d],
  ];
}

function edgeLength(rect, dir) {
  return dir % 2 === 0 ? rect.d : rect.w;
}

function connect(parent, dir, length, width, offset, extent, span, slide) {
  if (dir === 0) {
    const corridor = { x: parent.x + parent.w, z: parent.z + offset, w: length, d: width };
    const room = { x: corridor.x + length, z: corridor.z - slide, w: extent, d: span };
    return {
      corridor,
      room,
      near: { axis: 'x', x: corridor.x, z0: corridor.z, z1: corridor.z + width },
      far: { axis: 'x', x: room.x, z0: corridor.z, z1: corridor.z + width },
    };
  }
  if (dir === 2) {
    const corridor = { x: parent.x - length, z: parent.z + offset, w: length, d: width };
    const room = { x: corridor.x - extent, z: corridor.z - slide, w: extent, d: span };
    return {
      corridor,
      room,
      near: { axis: 'x', x: parent.x, z0: corridor.z, z1: corridor.z + width },
      far: { axis: 'x', x: corridor.x, z0: corridor.z, z1: corridor.z + width },
    };
  }
  if (dir === 1) {
    const corridor = { x: parent.x + offset, z: parent.z + parent.d, w: width, d: length };
    const room = { x: corridor.x - slide, z: corridor.z + length, w: span, d: extent };
    return {
      corridor,
      room,
      near: { axis: 'z', z: corridor.z, x0: corridor.x, x1: corridor.x + width },
      far: { axis: 'z', z: room.z, x0: corridor.x, x1: corridor.x + width },
    };
  }
  const corridor = { x: parent.x + offset, z: parent.z - length, w: width, d: length };
  const room = { x: corridor.x - slide, z: corridor.z - extent, w: span, d: extent };
  return {
    corridor,
    room,
    near: { axis: 'z', z: parent.z, x0: corridor.x, x1: corridor.x + width },
    far: { axis: 'z', z: corridor.z, x0: corridor.x, x1: corridor.x + width },
  };
}

function cutDoor(opening, wanted, along, height) {
  const span = opening.axis === 'x' ? opening.z1 - opening.z0 : opening.x1 - opening.x0;
  const width = Math.min(span, Math.max(3.8, wanted));
  const slack = Math.max(0, span - width);
  const offset = Math.min(Math.max(0, along), slack);
  const mouth = opening.axis === 'x'
    ? { a: [opening.x, opening.z0], b: [opening.x, opening.z1] }
    : { a: [opening.x0, opening.z], b: [opening.x1, opening.z] };
  const door = opening.axis === 'x'
    ? {
      a: [opening.x, opening.z0 + offset],
      b: [opening.x, opening.z0 + offset + width],
    }
    : {
      a: [opening.x0 + offset, opening.z],
      b: [opening.x0 + offset + width, opening.z],
    };
  return { ...door, width, height, openingWidth: span, mouthA: mouth.a, mouthB: mouth.b };
}

function touching(a, b) {
  const gap = rectGap(a, b);
  return gap >= 0 && gap <= 0.08;
}

function fits(corridor, room, parent, existing) {
  if (!touching(corridor, parent) || !touching(room, corridor)) return false;
  if (rectGap(room, parent) < 2) return false;
  for (const space of existing) {
    if (space.rect === parent) continue;
    if (rectGap(corridor, space.rect) < 2 || rectGap(room, space.rect) < 2) return false;
  }
  return true;
}

function rollLink(rng, edge) {
  const width = Math.min(rng.range(5, 8.5), edge - 2);
  if (width < 5) return null;
  const length = rng.range(10, 28);
  const offset = rng.range(0.8, Math.max(0.81, edge - width - 0.8));
  const span = Math.max(16, width + 1, rng.range(16, 36));
  const extent = rng.range(16, 36);
  const slide = rng.range(0, Math.max(0.01, span - width));
  const wantedNear = rng.next() < 0.28 ? width : rng.range(3.8, width);
  const wantedFar = rng.next() < 0.28 ? width : rng.range(3.8, width);
  return { width, length, offset, span, extent, slide, wantedNear, wantedFar };
}

function placeNext(rng, existing, heading) {
  const parent = existing[existing.length - 1].rect;
  const dirs = [heading, (heading + 1) & 3, (heading + 3) & 3, (heading + 2) & 3];
  for (const dir of dirs) {
    const edge = edgeLength(parent, dir);
    if (edge < 8) continue;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const roll = rollLink(rng, edge);
      if (!roll) break;
      const built = connect(
        parent,
        dir,
        roll.length,
        roll.width,
        roll.offset,
        roll.extent,
        roll.span,
        roll.slide,
      );
      if (!fits(built.corridor, built.room, parent, existing)) continue;
      return {
        heading: dir,
        corridor: built.corridor,
        room: built.room,
        run: roll.length,
        span: roll.width,
        nearDoor: cutDoor(built.near, roll.wantedNear, rng.range(0, roll.width), rng.range(6.5, 8.4)),
        farDoor: cutDoor(built.far, roll.wantedFar, rng.range(0, roll.width), rng.range(6.5, 8.4)),
      };
    }
  }
  return null;
}

function areaOf(spaces) {
  return spaces.reduce((sum, space) => sum + space.rect.w * space.rect.d, 0);
}

function runsNorth(spaces) {
  const first = spaces[0].rect;
  const last = spaces[spaces.length - 1].rect;
  return (first.z + first.d / 2) - (last.z + last.d / 2) > 30;
}

function tryFancy(rng) {
  const chamberCount = rng.int(9, 14);
  const spaces = [{
    kind: 'chamber',
    rect: { x: 0, z: 0, w: rng.range(16, 32), d: rng.range(16, 30) },
  }];
  const doors = [];
  for (let index = 1; index < chamberCount; index += 1) {
    const placed = placeNext(rng, spaces, NORTH);
    if (!placed) return null;
    spaces.push({ kind: 'corridor', rect: placed.corridor, run: placed.run, span: placed.span });
    doors.push(placed.nearDoor);
    spaces.push({ kind: 'chamber', rect: placed.room });
    doors.push(placed.farDoor);
  }
  const factor = Math.sqrt(TARGET_AREA / areaOf(spaces));
  if (factor < 0.9 || factor > 1.18 || !runsNorth(spaces)) return null;
  return { spaces, doors };
}

function tryStraight(rng) {
  const chamberCount = rng.int(9, 13);
  const spaces = [{
    kind: 'chamber',
    rect: { x: 0, z: 0, w: rng.range(18, 30), d: rng.range(16, 28) },
  }];
  const doors = [];
  for (let index = 1; index < chamberCount; index += 1) {
    const parent = spaces[spaces.length - 1].rect;
    const edge = parent.w;
    const width = Math.min(rng.range(5.5, 8), edge - 2.2);
    if (width < 5) return null;
    const length = rng.range(10, 24);
    const offset = rng.range(1, Math.max(1.1, edge - width - 1));
    const span = rng.range(Math.max(16, width + 2), 34);
    const extent = rng.range(16, 32);
    const slide = rng.range(0, span - width);
    const built = connect(parent, NORTH, length, width, offset, extent, span, slide);
    spaces.push({ kind: 'corridor', rect: built.corridor, run: length, span: width });
    doors.push(cutDoor(built.near, rng.range(4.2, width), rng.range(0, width), rng.range(6.5, 8.4)));
    spaces.push({ kind: 'chamber', rect: built.room });
    doors.push(cutDoor(built.far, rng.range(4.2, width), rng.range(0, width), rng.range(6.5, 8.4)));
  }
  const factor = Math.sqrt(TARGET_AREA / areaOf(spaces));
  if (factor < 0.9 || factor > 1.22 || !runsNorth(spaces)) return null;
  return { spaces, doors };
}

function scalePoint(point, factor) {
  return [point[0] * factor, point[1] * factor];
}

function widenDoor(door, minimum) {
  const mouth = Math.hypot(door.mouthB[0] - door.mouthA[0], door.mouthB[1] - door.mouthA[1]);
  const current = Math.hypot(door.b[0] - door.a[0], door.b[1] - door.a[1]);
  const target = Math.min(mouth, Math.max(minimum, current));
  const dx = (door.mouthB[0] - door.mouthA[0]) / mouth;
  const dz = (door.mouthB[1] - door.mouthA[1]) / mouth;
  const midX = (door.a[0] + door.b[0]) / 2;
  const midZ = (door.a[1] + door.b[1]) / 2;
  const start = (midX - door.mouthA[0]) * dx + (midZ - door.mouthA[1]) * dz;
  const half = target / 2;
  let t0 = start - half;
  let t1 = start + half;
  if (t0 < 0) {
    t1 -= t0;
    t0 = 0;
  }
  if (t1 > mouth) {
    t0 -= t1 - mouth;
    t1 = mouth;
  }
  t0 = Math.max(0, t0);
  door.a = [door.mouthA[0] + dx * t0, door.mouthA[1] + dz * t0];
  door.b = [door.mouthA[0] + dx * t1, door.mouthA[1] + dz * t1];
  door.width = Math.hypot(door.b[0] - door.a[0], door.b[1] - door.a[1]);
  door.openingWidth = mouth;
}

function shuffle(items, rng) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index + 1);
    const held = copy[index];
    copy[index] = copy[swap];
    copy[swap] = held;
  }
  return copy;
}

function themesFor(rng, count) {
  const deck = [];
  while (deck.length < count) deck.push(...shuffle(['stone', 'wood', 'cave'], rng));
  const themes = deck.slice(0, count);
  if (rng.next() < 0.8) themes[0] = 'stone';
  if (rng.next() < 0.8) themes[count - 1] = 'cave';
  for (const required of ['stone', 'wood', 'cave']) {
    if (!themes.includes(required)) themes[1 + rng.int(0, Math.max(1, count - 2))] = required;
  }
  return themes;
}

const AREA_NAME = 'The Ancient Ruins';
const PATH_WIDTH = 12;
const PATH_LENGTH = 56;
const COURT_DEPTH = 9;
const COURT_EXTRA = 16;
const VESTIBULE_DEPTH = 2.7;
const TRAIL_CLEARANCE = 3;
const PATH_SAMPLES = 20;
const CORRIDOR_HALF = (PATH_WIDTH + TRAIL_CLEARANCE) / 2;

// Daylight outside the arch, and a black interior once the threshold is crossed.
// `density` selects exponential fog; a near/far pair without it selects linear fog.
export const ENVIRONMENT_PRESETS = {
  day: {
    clearColor: '#c5d0d6',
    ambientLightIntensity: 0.55,
    fog: { color: '#c5d0d6', near: 28, far: 110, density: 0.009 },
    skyboxVisible: true,
  },
  interior: {
    clearColor: '#000000',
    ambientLightIntensity: 0.012,
    fog: { color: '#000000', near: 8, far: 20 },
    skyboxVisible: false,
  },
};

// Dead-wood silhouettes. Rendering reads this table so every copy is not the same cross of sticks.
export const DEAD_TREE_VARIANTS = [
  { branches: 3, height: 4.4, spread: 0.9 },
  { branches: 5, height: 6.2, spread: 0.55 },
  { branches: 4, height: 5.0, spread: 1.15 },
  { branches: 7, height: 7.1, spread: 0.4 },
  { branches: 2, height: 1.35, spread: 0.8 },
];

export const ZONE_LABELS = {
  'worn-trail': 'Worn Trail',
  'ancient-ruins': 'The Ancient Ruins',
  'world-hub': 'Mountain Pass',
};

function fitAntechamber(orig, mouthX0, mouthX1) {
  const mouth = Math.max(0.5, mouthX1 - mouthX0);
  const width = Math.min(orig.w, Math.max(mouth + 0.4, Math.min(16, orig.w)));
  let x = (mouthX0 + mouthX1) / 2 - width / 2;
  const maxX = orig.x + orig.w - width;
  x = Math.max(orig.x, Math.min(maxX, x));
  if (x > mouthX0 + 0.05 || x + width < mouthX1 - 0.05) return { x: orig.x, w: orig.w };
  return { x, w: width };
}

function ensureSpawns(room, linked, rng, minimum) {
  if (room.spawns.length >= minimum) return;
  const points = shuffle(candidates(room.rect, 1.2), rng);
  for (const [x, z] of points) {
    if (room.spawns.length >= minimum) break;
    if (clearance(x, z, room.polygon) < 1.45) continue;
    if (distanceToDoors(x, z, linked) < 2.2) continue;
    if (room.spawns.some((point) => Math.hypot(point[0] - x, point[1] - z) < 2.2)) continue;
    room.spawns.push([x, z]);
  }
}

function sconceAnchor(room, rng, linked) {
  const { rect } = room;
  const options = [
    { x: rect.x + 0.55, z: rect.z + rect.d * 0.5, nx: 1, nz: 0 },
    { x: rect.x + rect.w - 0.55, z: rect.z + rect.d * 0.5, nx: -1, nz: 0 },
    { x: rect.x + rect.w * 0.5, z: rect.z + 0.55, nx: 0, nz: 1 },
    { x: rect.x + rect.w * 0.5, z: rect.z + rect.d - 0.55, nx: 0, nz: -1 },
  ];
  let best = options[0];
  let bestScore = -Infinity;
  for (const option of options) {
    const score = distanceToDoors(option.x, option.z, linked) + rng.next();
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return { ...best };
}

function chestAnchor(room, sconce, linked) {
  const sideX = -sconce.nz;
  const sideZ = sconce.nx;
  // Rear face is ~1.22 m behind the anchor. The open lid swings ~1.15 m past
  // that hinge, plus 0.35 m of air so the lid clears the wall.
  const minClear = 1.22 + 1.15 + 0.35;
  let best = null;
  let bestClear = -Infinity;
  for (let lateral = 3.2; lateral >= 2.55; lateral -= 0.25) {
    for (const sign of [1, -1]) {
      for (let inward = 1.9; inward <= 3.15; inward += 0.25) {
        const x = sconce.x + sideX * sign * lateral + sconce.nx * inward;
        const z = sconce.z + sideZ * sign * lateral + sconce.nz * inward;
        const space = clearance(x, z, room.polygon);
        if (space < 0.6) continue;
        if (distanceToDoors(x, z, linked) < 1.5) continue;
        if (room.spawns.some((point) => Math.hypot(point[0] - x, point[1] - z) < 1.6)) continue;
        if (space > bestClear) {
          bestClear = space;
          best = { x, z };
        }
        if (space >= minClear) return { x, z };
      }
    }
  }
  return best || {
    x: sconce.x + sideX * 2.7 + sconce.nx * 2.5,
    z: sconce.z + sideZ * 2.7 + sconce.nz * 2.5,
  };
}

function clonePreset(preset) {
  return {
    clearColor: preset.clearColor,
    ambientLightIntensity: preset.ambientLightIntensity,
    fog: preset.fog ? { ...preset.fog } : null,
    skyboxVisible: preset.skyboxVisible,
  };
}

function stampTrailFrame(samples) {
  for (let i = 0; i < samples.length; i += 1) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    samples[i].tx = tx;
    samples[i].tz = tz;
    samples[i].nx = -tz;
    samples[i].nz = tx;
  }
  return samples;
}

function buildTrailSamples(midX, z0) {
  const samples = [];
  for (let i = 0; i <= PATH_SAMPLES; i += 1) {
    const t = i / PATH_SAMPLES;
    const z = z0 + t * PATH_LENGTH;
    const x = midX + Math.sin(t * Math.PI) * 1.65;
    const half = PATH_WIDTH / 2 + Math.sin(t * 8.4) * 0.42 + Math.sin(t * 3.1 + 0.7) * 0.26;
    samples.push({ x, z, half, t });
  }
  return stampTrailFrame(samples);
}

const VISTA_LENGTH = 118;
const VISTA_STEPS = 22;

function vistaTree(sample, side, lateral, index, variant, scaleMul) {
  const spec = DEAD_TREE_VARIANTS[variant];
  const along = ((index % 5) - 2) * 0.85;
  return {
    x: sample.x + sample.nx * side * lateral + sample.tx * along,
    z: sample.z + sample.nz * side * lateral + sample.tz * along,
    nx: sample.nx,
    nz: sample.nz,
    tx: sample.tx,
    tz: sample.tz,
    scale: (0.78 + (index % 5) * 0.1) * scaleMul,
    rotationY: (index * 1.17) % (Math.PI * 2),
    lean: (index % 2 === 0 ? 1 : -1) * (6 + (index % 4)) * (Math.PI / 180),
    leanAxis: (index * 0.73) % (Math.PI * 2),
    variant,
    branches: spec.branches,
    height: spec.height,
  };
}

// Scenery past the walkable hub: the path keeps going, and the range closes over its far end.
// The hub polygon and the mountain-pass trigger stay where they are.
export function buildMountainVista(end, hub) {
  const path = [];
  for (let i = 0; i <= VISTA_STEPS; i += 1) {
    const t = i / VISTA_STEPS;
    path.push({
      x: end.x + Math.sin(t * Math.PI) * -3.1,
      z: end.z + t * VISTA_LENGTH,
      half: end.half + (4.35 - end.half) * t,
      t,
    });
  }
  stampTrailFrame(path);
  const far = path[path.length - 1];
  const mountains = [
    { x: far.x - 96, z: far.z + 22, height: 62, radius: 38, yaw: 0.4, depth: 0.82 },
    { x: far.x - 62, z: far.z + 10, height: 90, radius: 42, yaw: 0.2, depth: 0.74 },
    { x: far.x - 34, z: far.z + 2, height: 108, radius: 36, yaw: -0.3, depth: 0.7 },
    { x: far.x - 14, z: far.z + 6, height: 74, radius: 28, yaw: 0.15, depth: 0.78 },
    { x: far.x, z: far.z + 14, height: 86, radius: 32, yaw: 0.05, depth: 0.66 },
    { x: far.x + 16, z: far.z + 6, height: 78, radius: 28, yaw: -0.2, depth: 0.76 },
    { x: far.x + 40, z: far.z + 4, height: 114, radius: 40, yaw: 0.35, depth: 0.72 },
    { x: far.x + 72, z: far.z + 14, height: 96, radius: 44, yaw: -0.15, depth: 0.8 },
    { x: far.x + 104, z: far.z + 26, height: 64, radius: 36, yaw: 0.5, depth: 0.84 },
    { x: far.x - 48, z: far.z - 2, height: 28, radius: 30, yaw: 0.25, depth: 0.7 },
    { x: far.x - 22, z: far.z - 8, height: 22, radius: 26, yaw: 0.6, depth: 0.62 },
    { x: far.x, z: far.z - 2, height: 16, radius: 20, yaw: 0.1, depth: 0.55 },
    { x: far.x + 22, z: far.z - 8, height: 20, radius: 24, yaw: -0.4, depth: 0.6 },
    { x: far.x + 50, z: far.z - 2, height: 30, radius: 32, yaw: -0.55, depth: 0.68 },
  ];
  const trees = [];
  const scrub = [];
  const clearZ = hub.z + hub.d + 1.6;
  for (let i = 1; i < path.length; i += 1) {
    const sample = path[i];
    if (sample.z < clearZ || sample.t > 0.8) continue;
    const side = i % 2 === 0 ? -1 : 1;
    const lateral = sample.half + 2.6 + (i % 4) * 1.15;
    trees.push(vistaTree(sample, side, lateral, i, i % DEAD_TREE_VARIANTS.length, 1));
    if (i % 2 === 0) {
      trees.push(vistaTree(sample, side, lateral + 6.5, i + 11, (i + 2) % DEAD_TREE_VARIANTS.length, 0.82));
    }
    for (const brushSide of [-1, 1]) {
      const brushLateral = sample.half + 1.35 + ((i + (brushSide > 0 ? 1 : 0)) % 3) * 0.7;
      const along = ((i % 3) - 1) * 1.15;
      scrub.push({
        x: sample.x + sample.nx * brushSide * brushLateral + sample.tx * along,
        z: sample.z + sample.nz * brushSide * brushLateral + sample.tz * along,
        scale: 0.75 + (i % 4) * 0.22,
        rotationY: (i * 1.31 + (brushSide > 0 ? 0.4 : 0)) % (Math.PI * 2),
        variant: (i + (brushSide > 0 ? 1 : 0)) % 2,
      });
      if (i % 3 !== 0) continue;
      const farLateral = brushLateral + 4.8;
      scrub.push({
        x: sample.x + sample.nx * brushSide * farLateral - sample.tx * 0.8,
        z: sample.z + sample.nz * brushSide * farLateral - sample.tz * 0.8,
        scale: 0.6 + (i % 3) * 0.2,
        rotationY: (i * 0.77) % (Math.PI * 2),
        variant: i % 2,
      });
    }
  }
  return {
    description: 'Scrub and dead trees follow a long dirt path away from the pass until the mountain range meets it.',
    path,
    mountains,
    scrub,
    trees,
  };
}

function pointOnTrail(samples, t) {
  const scaled = Math.min(0.999, Math.max(0, t)) * (samples.length - 1);
  const index = Math.floor(scaled);
  const frac = scaled - index;
  const a = samples[index];
  const b = samples[Math.min(samples.length - 1, index + 1)];
  return {
    x: a.x + (b.x - a.x) * frac,
    z: a.z + (b.z - a.z) * frac,
    half: a.half + (b.half - a.half) * frac,
    nx: a.nx + (b.nx - a.nx) * frac,
    nz: a.nz + (b.nz - a.nz) * frac,
    tx: a.tx + (b.tx - a.tx) * frac,
    tz: a.tz + (b.tz - a.tz) * frac,
  };
}

export function trailDistance(samples, x, z) {
  let best = Infinity;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    const closest = closestOnSegment(x, z, a.x, a.z, b.x, b.z);
    best = Math.min(best, Math.hypot(x - closest.x, z - closest.z));
  }
  return best;
}

// True when a prop would stand in the travel lane or in the open view toward the pass.
export function trailBlocksProp(samples, x, z) {
  if (!samples?.length) return false;
  const end = samples[samples.length - 1];
  if (trailDistance(samples, x, z) < CORRIDOR_HALF - 0.05) return true;
  if (z >= end.z - 0.5 && Math.abs(x - end.x) < CORRIDOR_HALF) return true;
  return false;
}

function nearestSample(samples, x, z) {
  let best = samples[0];
  let bestDist = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const dist = Math.hypot(samples[i].x - x, samples[i].z - z);
    if (dist < bestDist) {
      bestDist = dist;
      best = samples[i];
    }
  }
  return best;
}

function scatterTrees(rng, samples) {
  const trees = [];
  const minDist = 3.35;
  const end = samples[samples.length - 1];
  let guard = 0;
  while (trees.length < 30 && guard < 900) {
    guard += 1;
    let x;
    let z;
    if (trees.length > 2 && rng.next() < 0.62) {
      const anchor = trees[rng.int(0, trees.length)];
      const along = rng.range(-2.2, 2.2);
      const out = rng.range(0.35, 2.6);
      x = anchor.x + anchor.nx * out + anchor.tx * along;
      z = anchor.z + anchor.nz * out + anchor.tz * along;
    } else {
      const sample = pointOnTrail(samples, 0.05 + rng.next() * 0.74);
      const side = rng.next() < 0.5 ? -1 : 1;
      const lateral = sample.half + TRAIL_CLEARANCE / 2 + 0.85 + rng.next() * 6.5;
      x = sample.x + sample.nx * side * lateral;
      z = sample.z + sample.nz * side * lateral;
    }
    if (trailBlocksProp(samples, x, z)) continue;
    if (z < samples[0].z + 1 || z > end.z - 8) continue;
    let crowded = false;
    for (let i = 0; i < trees.length; i += 1) {
      if (Math.hypot(trees[i].x - x, trees[i].z - z) < minDist) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    const nearest = nearestSample(samples, x, z);
    const variant = rng.int(0, DEAD_TREE_VARIANTS.length);
    const spec = DEAD_TREE_VARIANTS[variant];
    trees.push({
      x,
      z,
      nx: nearest.nx,
      nz: nearest.nz,
      tx: nearest.tx,
      tz: nearest.tz,
      scale: 0.7 + rng.next() * 0.6,
      rotationY: rng.next() * Math.PI * 2,
      lean: (5 + rng.next() * 5) * (Math.PI / 180) * (rng.next() < 0.5 ? -1 : 1),
      leanAxis: rng.next() * Math.PI * 2,
      variant,
      branches: spec.branches,
      height: spec.height,
    });
  }
  return trees;
}

function exteriorFromTrail(court, samples, vestibule) {
  const polygon = [
    [vestibule.x, vestibule.z],
    [vestibule.x + vestibule.w, vestibule.z],
    [vestibule.x + vestibule.w, court.z],
    [court.x + court.w, court.z],
    [court.x + court.w, court.z + court.d],
  ];
  for (let i = 0; i < samples.length; i += 1) {
    polygon.push([samples[i].x + samples[i].half, samples[i].z]);
  }
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    polygon.push([samples[i].x - samples[i].half, samples[i].z]);
  }
  polygon.push([court.x, court.z + court.d]);
  polygon.push([court.x, court.z]);
  polygon.push([vestibule.x, court.z]);
  return polygon;
}

function triggerBox(x, z, width, depth) {
  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}

// The descent is one place: The Ancient Ruins. The fighter starts outdoors on a dirt path,
// the first room is a small empty stone antechamber, and every fought chamber keeps a sconce and a chest.
function shapeAncientRuins(layout, rng) {
  const { rooms, doors } = layout;
  const ante = rooms[0];
  const passage = rooms[1];
  if (!ante || !passage || !doors[0]) return;

  const usedNames = new Set(['Antechamber']);
  for (const room of rooms) {
    room.theme = 'stone';
    room.lighting = 'underground';
    room.rocks = [];
    room.brazier = null;
    if (room.kind === 'corridor') {
      room.name = room.run > 18 ? 'Long Passage' : room.span < 6.2 ? 'Narrow Passage' : 'Passage';
    } else if (room !== ante) {
      room.name = nameFor('stone', usedNames);
    }
  }

  const mouthX0 = passage.rect.x;
  const mouthX1 = passage.rect.x + passage.rect.w;
  const fitted = fitAntechamber(ante.rect, mouthX0, mouthX1);
  const depth = Math.min(12.5, ante.rect.d);
  ante.rect = { x: fitted.x, z: ante.rect.z, w: fitted.w, d: depth };
  ante.polygon = polygonFromRect(ante.rect);
  ante.spawns = [];
  ante.role = 'antechamber';
  ante.name = 'Antechamber';
  ante.description = 'A stone threshold under the arch. Pale daylight fails a few steps in, and the passage beyond is black.';
  ante.sconce = null;
  ante.chest = null;

  const southZ = ante.rect.z + ante.rect.d;
  const midX = ante.rect.x + ante.rect.w / 2;
  const doorWidth = Math.min(6.4, Math.max(4.8, ante.rect.w * 0.4));
  const courtW = ante.rect.w + COURT_EXTRA * 2;
  const court = {
    x: midX - courtW / 2,
    z: southZ,
    w: courtW,
    d: COURT_DEPTH,
  };
  const samples = buildTrailSamples(midX, court.z + court.d);
  const end = samples[samples.length - 1];
  const path = {
    x: midX - PATH_WIDTH / 2,
    z: samples[0].z,
    w: PATH_WIDTH,
    d: PATH_LENGTH,
  };
  const vestibule = {
    x: midX - doorWidth / 2,
    z: southZ - VESTIBULE_DEPTH,
    w: doorWidth,
    d: VESTIBULE_DEPTH,
  };
  const hub = {
    x: end.x - 9,
    z: end.z + 2.2,
    w: 18,
    d: 16,
  };
  const approachPoint = pointOnTrail(samples, 0.34);
  const towardX = midX - approachPoint.x;
  const towardZ = southZ - approachPoint.z;
  const towardLen = Math.hypot(towardX, towardZ) || 1;
  const innerSpawnZ = Math.min(
    ante.rect.z + ante.rect.d - 4.6,
    Math.max(ante.rect.z + 2.4, southZ - 5),
  );
  const returnPoint = pointOnTrail(samples, 0.82);

  layout.areaName = AREA_NAME;
  layout.enemyName = SKELETON_NAME;
  layout.requirements = ['torch', 'mace'];
  layout.entrance = {
    a: [midX - doorWidth / 2, southZ],
    b: [midX + doorWidth / 2, southZ],
    width: doorWidth,
    height: 7.2,
    openingWidth: ante.rect.w,
    mouthA: [ante.rect.x, southZ],
    mouthB: [ante.rect.x + ante.rect.w, southZ],
  };
  layout.vestibule = polygonFromRect(vestibule);
  layout.exterior = exteriorFromTrail(court, samples, vestibule);
  layout.hub = polygonFromRect(hub);
  layout.trees = scatterTrees(rng, samples);
  layout.zoneLabels = { ...ZONE_LABELS };
  layout.approach = {
    shell: {
      facadeHeight: 13,
      flankHeight: 6.5,
      cornice: { height: 1.15, depth: 1.35, overhang: 1.2, y: 12.5 },
    },
    court,
    path,
    samples,
    southZ,
    midX,
    vestibule,
    hub,
    corridorWidth: PATH_WIDTH + TRAIL_CLEARANCE,
    lighting: 'day',
    description: 'A worn dirt path ends at a weathered stone arch. Thin clouds cross a pale blue sky, and pale sun falls between dead trees on the parched ground. Beyond the pass, scrub and dead trees follow the path until a mountain range meets it.',
    vista: buildMountainVista(end, hub),
  };
  layout.transitions = [
    {
      id: 'ruin-entry',
      sourceZoneId: 'worn-trail',
      targetZoneId: 'ancient-ruins',
      targetSpawnPoint: { x: midX, y: 0, z: innerSpawnZ, rotationY: 0 },
      transitionType: 'fade',
      fadeDurationMs: 600,
      environmentalPreset: clonePreset(ENVIRONMENT_PRESETS.interior),
      volume: triggerBox(midX, southZ - 2.05, doorWidth - 0.6, 1.1),
      requiresGate: true,
    },
    {
      id: 'ruin-exit',
      sourceZoneId: 'ancient-ruins',
      targetZoneId: 'worn-trail',
      targetSpawnPoint: { x: midX, y: 0, z: southZ + 4.2, rotationY: Math.PI },
      transitionType: 'fade',
      fadeDurationMs: 600,
      environmentalPreset: clonePreset(ENVIRONMENT_PRESETS.day),
      volume: triggerBox(midX, southZ - 0.65, doorWidth - 0.6, 1.0),
    },
    {
      id: 'mountain-pass',
      sourceZoneId: 'worn-trail',
      targetZoneId: 'world-hub',
      targetSpawnPoint: { x: end.x, y: 0, z: hub.z + hub.d * 0.45, rotationY: Math.PI },
      transitionType: 'fade',
      fadeDurationMs: 300,
      environmentalPreset: clonePreset(ENVIRONMENT_PRESETS.day),
      volume: triggerBox(end.x, end.z - 0.2, PATH_WIDTH, 1.8),
    },
    {
      id: 'mountain-return',
      sourceZoneId: 'world-hub',
      targetZoneId: 'worn-trail',
      targetSpawnPoint: { x: returnPoint.x, y: 0, z: returnPoint.z, rotationY: 0 },
      transitionType: 'fade',
      fadeDurationMs: 300,
      environmentalPreset: clonePreset(ENVIRONMENT_PRESETS.day),
      volume: triggerBox(end.x, hub.z + 1.3, PATH_WIDTH, 1.6),
    },
  ];
  layout.gateInward = { x: 0, z: -1 };
  layout.start = {
    x: approachPoint.x,
    z: approachPoint.z,
    yaw: Math.atan2(-towardX / towardLen, -towardZ / towardLen),
  };
  layout.area = rooms.reduce((sum, room) => sum + room.rect.w * room.rect.d, 0);

  const linkedFor = (room) => doors.filter((door) => door.from === room.id || door.to === room.id);
  if (passage.kind === 'corridor') ensureSpawns(passage, linkedFor(passage), rng, 2);

  for (const room of rooms) {
    if (room.kind !== 'chamber' || !room.spawns.length) {
      room.sconce = null;
      room.chest = null;
      continue;
    }
    const anchor = sconceAnchor(room, rng, linkedFor(room));
    room.sconce = anchor;
    room.chest = chestAnchor(room, anchor, linkedFor(room));
  }
}

function nameFor(theme, used) {
  const pool = NAMES[theme];
  const available = pool.find((name) => !used.has(name));
  if (available) {
    used.add(available);
    return available;
  }
  const name = `${pool[used.size % pool.length]} ${used.size}`;
  used.add(name);
  return name;
}

function distanceToDoors(x, z, doors) {
  let best = Infinity;
  for (const door of doors) {
    const closest = closestOnSegment(x, z, door.a[0], door.a[1], door.b[0], door.b[1]);
    best = Math.min(best, Math.hypot(x - closest.x, z - closest.z));
  }
  return best;
}

function candidates(rect, step) {
  const points = [];
  for (let x = rect.x + 1.6; x <= rect.x + rect.w - 1.6; x += step) {
    for (let z = rect.z + 1.6; z <= rect.z + rect.d - 1.6; z += step) points.push([x, z]);
  }
  return points;
}

function decorate(spaces, doors, rng) {
  const factor = Math.sqrt(TARGET_AREA / areaOf(spaces));
  for (const space of spaces) {
    space.rect = {
      x: space.rect.x * factor,
      z: space.rect.z * factor,
      w: space.rect.w * factor,
      d: space.rect.d * factor,
    };
    if (space.kind === 'corridor') {
      space.run *= factor;
      space.span *= factor;
    }
  }
  for (const door of doors) {
    door.a = scalePoint(door.a, factor);
    door.b = scalePoint(door.b, factor);
    door.mouthA = scalePoint(door.mouthA, factor);
    door.mouthB = scalePoint(door.mouthB, factor);
    door.height = Math.min(8.6, Math.max(6.4, door.height));
    widenDoor(door, 3.5);
  }

  const chamberThemes = themesFor(rng, spaces.filter((space) => space.kind === 'chamber').length);
  let chamberIndex = 0;
  const usedNames = new Set();
  const rooms = spaces.map((space, index) => {
    const polygon = polygonFromRect(space.rect);
    let theme = 'stone';
    if (space.kind === 'chamber') {
      theme = chamberThemes[chamberIndex];
      chamberIndex += 1;
    }
    return {
      id: `space-${index}`,
      index,
      kind: space.kind,
      name: space.kind === 'corridor' ? 'Passage' : 'Room',
      theme,
      rect: space.rect,
      run: space.run || 0,
      span: space.span || 0,
      polygon,
      spawns: [],
      brazier: null,
      sconce: null,
      rocks: [],
    };
  });

  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    if (room.kind === 'corridor') {
      const previous = rooms[index - 1];
      const next = rooms[index + 1];
      room.theme = rng.next() < 0.5 ? previous.theme : next.theme;
      room.name = room.run > 18 ? 'Long Passage' : room.span < 6.2 ? 'Narrow Passage' : 'Passage';
    } else {
      room.name = nameFor(room.theme, usedNames);
    }
  }

  doors.forEach((door, index) => {
    door.from = rooms[index].id;
    door.to = rooms[index + 1].id;
  });

  for (const room of rooms) {
    const linked = doors.filter((door) => door.from === room.id || door.to === room.id);
    const points = candidates(room.rect, room.kind === 'corridor' ? 1.4 : 2);
    const shuffled = shuffle(points, rng);
    const taken = [];
    const area = room.rect.w * room.rect.d;
    let wanted = 0;
    if (room.kind === 'chamber') {
      if (area < 420) wanted = 2;
      else if (area < 780) wanted = 3;
      else if (area < 1200) wanted = 4;
      else wanted = 5;
    } else if (room.run >= 16 && area >= 100) {
      wanted = area > 180 ? 2 : 1;
    }
    for (const [x, z] of shuffled) {
      if (room.spawns.length >= wanted) break;
      if (clearance(x, z, room.polygon) < 1.45) continue;
      if (distanceToDoors(x, z, linked) < 2.4) continue;
      if (taken.some((point) => Math.hypot(point[0] - x, point[1] - z) < 2.3)) continue;
      room.spawns.push([x, z]);
      taken.push([x, z]);
    }

    if (room.kind === 'chamber') {
      for (const [x, z] of shuffled) {
        if (clearance(x, z, room.polygon) < 1.8) continue;
        if (distanceToDoors(x, z, linked) < 3) continue;
        if (room.spawns.some((point) => Math.hypot(point[0] - x, point[1] - z) < 2.4)) continue;
        room.brazier = [x, z];
        break;
      }
      if (!room.brazier) room.brazier = [room.rect.x + room.rect.w / 2, room.rect.z + room.rect.d / 2];
      if (room.theme === 'cave' && area > 450) {
        for (const [x, z] of shuffled) {
          if (room.rocks.length >= 2) break;
          if (clearance(x, z, room.polygon) < 2.2) continue;
          if (distanceToDoors(x, z, linked) < 3) continue;
          const crowded = room.spawns.some((point) => Math.hypot(point[0] - x, point[1] - z) < 2.6)
            || Math.hypot(room.brazier[0] - x, room.brazier[1] - z) < 2.6
            || room.rocks.some((point) => Math.hypot(point[0] - x, point[1] - z) < 3);
          if (crowded) continue;
          room.rocks.push([x, z]);
        }
      }
    }
  }

  const first = rooms[0];
  const firstDoor = doors[0];
  const doorX = (firstDoor.a[0] + firstDoor.b[0]) / 2;
  const doorZ = (firstDoor.a[1] + firstDoor.b[1]) / 2;
  let start = { x: first.rect.x + first.rect.w / 2, z: first.rect.z + first.rect.d / 2 };
  let best = -1;
  for (const [x, z] of candidates(first.rect, 1.5)) {
    if (clearance(x, z, first.polygon) < 2) continue;
    const doorDist = distanceToDoors(x, z, [firstDoor]);
    if (doorDist < 3.5) continue;
    const fire = first.brazier ? Math.hypot(first.brazier[0] - x, first.brazier[1] - z) : 10;
    if (fire < 2.4) continue;
    if (doorDist > best) {
      best = doorDist;
      start = { x, z };
    }
  }
  const fx = doorX - start.x;
  const fz = doorZ - start.z;
  const length = Math.hypot(fx, fz) || 1;
  start.yaw = Math.atan2(-fx / length, -fz / length);

  const layout = {
    seed: 0,
    area: areaOf(spaces),
    rooms,
    doors,
    start,
    lastRoomId: rooms[rooms.length - 1].id,
  };
  shapeAncientRuins(layout, rng);
  return layout;
}

export { AREA_NAME };

export function generateLayout(seed = 1) {
  const rng = makeRng(seed);
  let built = null;
  for (let attempt = 0; attempt < 28 && !built; attempt += 1) built = tryFancy(rng);
  for (let attempt = 0; attempt < 28 && !built; attempt += 1) built = tryStraight(rng);
  if (!built) {
    const fallback = makeRng((seed ^ 0x9e3779b9) >>> 0 || 1);
    built = tryStraight(fallback) || tryFancy(fallback);
  }
  if (!built) {
    built = {
      spaces: [{ kind: 'chamber', rect: { x: 0, z: 0, w: 24, d: 20 } }],
      doors: [],
    };
    let parent = built.spaces[0].rect;
    for (let index = 0; index < 9; index += 1) {
      const builtLink = connect(parent, NORTH, 14, 6, 4, 22 + (index % 3) * 4, 18 + (index % 4) * 3, 3);
      built.spaces.push({ kind: 'corridor', rect: builtLink.corridor, run: 14, span: 6 });
      built.doors.push(cutDoor(builtLink.near, 4.5, 0.5, 7));
      built.spaces.push({ kind: 'chamber', rect: builtLink.room });
      built.doors.push(cutDoor(builtLink.far, 5, 0.4, 7.4));
      parent = builtLink.room;
    }
  }
  const layout = decorate(built.spaces, built.doors, rng);
  layout.seed = seed >>> 0 || 1;
  return layout;
}
