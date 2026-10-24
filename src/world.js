// Connects the hub to the locations named in the master config. Pure: no THREE, no DOM.
//
// The hub file (a campfire, a castle, and so on) has one spoke per path leaving the plaza. The config
// lists one location file per spoke, in order. The counts have to match: the game will not guess which
// path a location belongs on. Each spoke then leads to that location's trail, and each location grows
// an outdoor path from its exit door, around the outside of every room, back to the trail that leads to
// the entrance.

import { FireDescriptionError, parseFireEmanation } from './fire-description.js';
import { LocationError, prepareLocation } from './location.js';

const MAX_SPOKES = 24;
const MAX_PARTS = 32;
const MAX_SAMPLES = 80;
const PAD = 8;
const PATH_HALF = 3;
const DOOR_WIDTH = 6;
const DOOR_HEIGHT = 7.2;
const LANDING = 8;
const JOIN_INDEX = 4;

const SIDES = [
  { id: 'N', nx: 0, nz: -1 },
  { id: 'E', nx: 1, nz: 0 },
  { id: 'S', nx: 0, nz: 1 },
  { id: 'W', nx: -1, nz: 0 },
];

const KEPT_TRANSITIONS = new Set(['ruin-entry', 'ruin-exit', 'mountain-pass', 'mountain-return']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

export class WorldError extends Error {
  constructor(message) {
    super(String(message).slice(0, 200));
    this.name = 'WorldError';
  }
}

function fail(message) {
  throw new WorldError(message);
}

function spokeLabel(spoke, index) {
  const name = typeof spoke?.name === 'string' ? spoke.name : '';
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 32 ? name : `spoke-${index + 1}`;
}

function stampFrame(samples) {
  const last = samples.length - 1;
  for (let index = 0; index < samples.length; index += 1) {
    const prev = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(last, index + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    samples[index].tx = tx;
    samples[index].tz = tz;
    samples[index].nx = -tz;
    samples[index].nz = tx;
  }
  return samples;
}

function rectsOverlap(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}

function wallCenter(rect, side) {
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.d / 2;
  if (side.id === 'N') return [cx, rect.z];
  if (side.id === 'S') return [cx, rect.z + rect.d];
  if (side.id === 'W') return [rect.x, cz];
  return [rect.x + rect.w, cz];
}

// The ground just outside a wall. Another room there means this side is not a way out.
function laneBlocked(rect, side, rooms, self) {
  const [cx, cz] = wallCenter(rect, side);
  const reach = PAD + 2;
  const wide = DOOR_WIDTH / 2 + 2;
  const lane = side.nx === 0
    ? { x0: cx - wide, x1: cx + wide, z0: Math.min(cz, cz + side.nz * reach), z1: Math.max(cz, cz + side.nz * reach) }
    : { x0: Math.min(cx, cx + side.nx * reach), x1: Math.max(cx, cx + side.nx * reach), z0: cz - wide, z1: cz + wide };
  return rooms.some((room) => {
    if (room === self) return false;
    const r = room.rect;
    return rectsOverlap(lane, { x0: r.x, x1: r.x + r.w, z0: r.z, z1: r.z + r.d });
  });
}

function exteriorScore(rect, side, bounds) {
  if (side.id === 'N') return rect.z - bounds.minZ;
  if (side.id === 'S') return bounds.maxZ - (rect.z + rect.d);
  if (side.id === 'W') return rect.x - bounds.minX;
  return bounds.maxX - (rect.x + rect.w);
}

function roomBounds(rooms) {
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const room of rooms) {
    const rect = room.rect;
    bounds.minX = Math.min(bounds.minX, rect.x);
    bounds.maxX = Math.max(bounds.maxX, rect.x + rect.w);
    bounds.minZ = Math.min(bounds.minZ, rect.z);
    bounds.maxZ = Math.max(bounds.maxZ, rect.z + rect.d);
  }
  return bounds;
}

function perimeterLength(box) {
  return 2 * ((box.maxX - box.minX) + (box.maxZ - box.minZ));
}

// Distance clockwise from the north-west corner.
function boundaryPos(box, point) {
  const eps = 0.2;
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  if (Math.abs(point[1] - box.minZ) <= eps) return point[0] - box.minX;
  if (Math.abs(point[0] - box.maxX) <= eps) return width + (point[1] - box.minZ);
  if (Math.abs(point[1] - box.maxZ) <= eps) return width + depth + (box.maxX - point[0]);
  return 2 * width + depth + (box.maxZ - point[1]);
}

function pointOnBoundary(box, distance) {
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  const loop = perimeterLength(box);
  let s = ((distance % loop) + loop) % loop;
  if (s <= width) return [box.minX + s, box.minZ];
  s -= width;
  if (s <= depth) return [box.maxX, box.minZ + s];
  s -= depth;
  if (s <= width) return [box.maxX - s, box.maxZ];
  s -= width;
  return [box.minX, box.maxZ - s];
}

function shorterArc(box, from, to) {
  const loop = perimeterLength(box);
  const start = boundaryPos(box, from);
  const end = boundaryPos(box, to);
  const clockwise = (end - start + loop) % loop;
  const counter = (start - end + loop) % loop;
  const forward = clockwise <= counter;
  const length = forward ? clockwise : counter;
  const steps = Math.max(1, Math.ceil(length / 3));
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const distance = start + (forward ? 1 : -1) * length * (step / steps);
    points.push(pointOnBoundary(box, distance));
  }
  return points;
}

function resample(points) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index][0] - points[index - 1][0];
    const dz = points[index][1] - points[index - 1][1];
    lengths.push(lengths[index - 1] + Math.hypot(dx, dz));
  }
  const total = lengths[lengths.length - 1];
  const count = Math.max(2, Math.ceil(total / 3) + 1);
  const samples = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const distance = total * (index / (count - 1));
    while (cursor < points.length - 2 && lengths[cursor + 1] < distance) cursor += 1;
    const span = lengths[cursor + 1] - lengths[cursor] || 1;
    const t = Math.min(1, Math.max(0, (distance - lengths[cursor]) / span));
    const a = points[cursor];
    const b = points[cursor + 1];
    samples.push({
      x: a[0] + (b[0] - a[0]) * t,
      z: a[1] + (b[1] - a[1]) * t,
      s: distance,
    });
  }
  return { samples, total };
}

function insideRoom(x, z, room) {
  const rect = room.rect;
  return x > rect.x + 0.4 && x < rect.x + rect.w - 0.4 && z > rect.z + 0.4 && z < rect.z + rect.d - 0.4;
}

// The outdoor way back from the exit chamber to the entrance trail. Added to a location that
// `prepareLocation` has already accepted. The exit door is not a door in `layout.doors`: a door there
// has to join two rooms, and this one opens onto the path.
export function buildExitLoop(layout) {
  const approach = layout.approach;
  const trail = approach?.samples;
  if (!approach || !Array.isArray(trail) || trail.length < 2) fail('A location needs its entrance trail before an exit path can join it.');
  const exitRoom = layout.rooms.find((room) => room.id === layout.exitRoomId) || layout.rooms[layout.rooms.length - 1];
  const bounds = roomBounds(layout.rooms);
  const open = SIDES.filter((side) => !laneBlocked(exitRoom.rect, side, layout.rooms, exitRoom));
  if (!open.length) fail('The exit chamber has no clear outer wall to leave by.');
  open.sort((a, b) => exteriorScore(exitRoom.rect, a, bounds) - exteriorScore(exitRoom.rect, b, bounds));
  const side = open[0];
  const rect = exitRoom.rect;
  const [cx, cz] = wallCenter(rect, side);
  const half = Math.min(DOOR_WIDTH / 2, ((side.nx === 0 ? rect.w : rect.d) - 1) / 2);
  const door = {
    a: side.nx === 0 ? [cx - half, cz] : [cx, cz - half],
    b: side.nx === 0 ? [cx + half, cz] : [cx, cz + half],
    width: half * 2,
    height: DOOR_HEIGHT,
    openingWidth: half * 2,
    y: exitRoom.y || 0,
    from: exitRoom.id,
    to: null,
  };
  const box = {
    minX: bounds.minX - PAD,
    maxX: bounds.maxX + PAD,
    minZ: bounds.minZ - PAD,
    maxZ: bounds.maxZ + PAD,
  };
  const edge = [
    side.nx === 0 ? Math.min(box.maxX, Math.max(box.minX, cx)) : (side.nx < 0 ? box.minX : box.maxX),
    side.nz === 0 ? Math.min(box.maxZ, Math.max(box.minZ, cz)) : (side.nz < 0 ? box.minZ : box.maxZ),
  ];
  const join = trail[Math.min(JOIN_INDEX, trail.length - 1)];
  const south = [Math.min(box.maxX, Math.max(box.minX, join.x)), box.maxZ];
  const around = shorterArc(box, edge, south);
  const lead = [cx + side.nx * 1.6, cz + side.nz * 1.6];
  const points = [lead, edge, ...around, [join.x, join.z]];
  const { samples, total } = resample(points);
  const blocked = samples.some((sample) => sample.s > 12 && layout.rooms.some((room) => insideRoom(sample.x, sample.z, room)));
  if (blocked) fail('The exit path could not get around the outside of the location.');

  const drop = Math.max(0, exitRoom.y || 0);
  const run = Math.max(1, total - LANDING);
  const slope = drop > 0 ? drop / run : 0;
  for (const sample of samples) {
    const fallen = Math.max(0, sample.s - LANDING) * slope;
    sample.y = Math.max(0, drop - fallen);
    sample.half = PATH_HALF;
    sample.t = total > 0 ? sample.s / total : 0;
  }
  stampFrame(samples);

  const horizontal = side.nx !== 0;
  const span = Math.max(1, half * 2 - 0.6);
  const volumeAt = (x, z) => ({
    minX: x - (horizontal ? 0.55 : span / 2),
    maxX: x + (horizontal ? 0.55 : span / 2),
    minZ: z - (horizontal ? span / 2 : 0.55),
    maxZ: z + (horizontal ? span / 2 : 0.55),
    minY: (exitRoom.y || 0) - 2,
    maxY: (exitRoom.y || 0) + 4,
  });
  const day = layout.transitions.find((item) => item.environmentalPreset?.skyboxVisible !== false)?.environmentalPreset || null;
  const indoors = layout.transitions.find((item) => item.environmentalPreset?.skyboxVisible === false)?.environmentalPreset || null;
  const leaving = {
    id: 'exit-door-out',
    sourceZoneId: 'ancient-ruins',
    targetZoneId: 'worn-trail',
    targetSpawnPoint: {
      x: cx + side.nx * 3.5,
      y: exitRoom.y || 0,
      z: cz + side.nz * 3.5,
      rotationY: Math.atan2(-side.nx, -side.nz),
    },
    transitionType: 'fade',
    fadeDurationMs: 600,
    environmentalPreset: day,
    volume: volumeAt(cx - side.nx * 0.9, cz - side.nz * 0.9),
  };
  const returning = {
    id: 'exit-door-in',
    sourceZoneId: 'worn-trail',
    targetZoneId: 'ancient-ruins',
    targetSpawnPoint: {
      x: cx - side.nx * 3,
      y: exitRoom.y || 0,
      z: cz - side.nz * 3,
      rotationY: Math.atan2(side.nx, side.nz),
    },
    transitionType: 'fade',
    fadeDurationMs: 600,
    environmentalPreset: indoors,
    volume: volumeAt(cx + side.nx * 1, cz + side.nz * 1),
  };
  layout.transitions.push(leaving, returning);
  layout.exitLoop = {
    roomId: exitRoom.id,
    side: side.id,
    door,
    samples,
    length: total,
    join: { x: join.x, z: join.z },
  };
  const exit = layout.exits?.find((item) => item.id === 'exit');
  if (exit) exit.transitionId = leaving.id;
  return layout.exitLoop;
}

// Height of the exit path under a point, or null when the point is off the path.
export function exitLoopHeightAt(loop, x, z) {
  const samples = loop?.samples;
  if (!Array.isArray(samples) || samples.length < 2) return null;
  let best = Infinity;
  let height = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = samples[index];
    const b = samples[index + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const dist = Math.hypot(x - px, z - pz);
    const half = (a.half || PATH_HALF) + ((b.half || PATH_HALF) - (a.half || PATH_HALF)) * t;
    if (dist <= half + 0.5 && dist < best) {
      best = dist;
      height = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t;
    }
  }
  return best < Infinity ? height : null;
}

function cleanSamples(list, index) {
  if (!Array.isArray(list) || list.length < 2) fail(`Spoke ${index + 1} needs a path.`);
  const samples = [];
  for (const sample of list) {
    if (samples.length >= MAX_SAMPLES) break;
    if (!isObject(sample) || !finite(sample.x) || !finite(sample.z)) continue;
    samples.push({
      x: sample.x,
      z: sample.z,
      half: finite(sample.half) && sample.half > 0.5 && sample.half < 20 ? sample.half : 4,
      y: 0,
    });
  }
  if (samples.length < 2) fail(`Spoke ${index + 1} needs a path.`);
  return stampFrame(samples);
}

function cleanPolygon(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 200) return [];
  const polygon = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2 || !finite(point[0]) || !finite(point[1])) return [];
    polygon.push([point[0], point[1]]);
  }
  return polygon;
}

function cleanPart(part) {
  if (!isObject(part) || typeof part.type !== 'string' || part.type.length > 32) return null;
  if (!finite(part.x) || !finite(part.z)) return null;
  const copy = { type: part.type, x: part.x, z: part.z };
  if (finite(part.y)) copy.y = part.y;
  if (finite(part.radius) && part.radius > 0 && part.radius <= 20) copy.radius = part.radius;
  if (finite(part.length) && part.length > 0 && part.length <= 20) copy.length = part.length;
  if (finite(part.rotationY)) copy.rotationY = part.rotationY;
  if (part.type === 'fire-pit' && (part.vfx !== undefined || part.light !== undefined)) {
    try {
      copy.fire = parseFireEmanation({ vfx: part.vfx, light: part.light });
    } catch (error) {
      fail(error instanceof FireDescriptionError ? error.message : 'The hub fire could not be read.');
    }
  }
  return copy;
}

function cleanStructure(structure) {
  if (!isObject(structure)) return null;
  const parts = [];
  const source = Array.isArray(structure.parts) ? structure.parts : [];
  for (const part of source) {
    if (parts.length >= MAX_PARTS) break;
    const cleaned = cleanPart(part);
    if (cleaned) parts.push(cleaned);
  }
  return { parts };
}

export function prepareHub(data) {
  if (!isObject(data)) fail('The hub file must be a JSON object.');
  const area = data.hubArea;
  if (!isObject(area) || !Array.isArray(area.spokes)) fail('The hub file needs a list of spokes.');
  if (area.spokes.length > MAX_SPOKES) fail(`A hub can have at most ${MAX_SPOKES} paths.`);
  const respawn = isObject(area.respawn) ? area.respawn : data.start;
  if (!isObject(respawn) || !finite(respawn.x) || !finite(respawn.z)) fail('The hub needs a respawn point.');
  const spokes = area.spokes.map((spoke, index) => {
    if (!isObject(spoke)) fail(`Spoke ${index + 1} is not an object.`);
    const samples = cleanSamples(spoke.samples, index);
    const end = samples[samples.length - 1];
    return {
      id: spokeLabel(spoke, index),
      name: spokeLabel(spoke, index),
      index,
      samples,
      polygon: cleanPolygon(spoke.polygon),
      mouth: { x: samples[0].x, z: samples[0].z },
      end: { x: end.x, z: end.z, yaw: finite(spoke.end?.yaw) ? spoke.end.yaw : 0 },
      transitionOut: typeof spoke.transitionOut === 'string' ? spoke.transitionOut : `to-${spokeLabel(spoke, index)}`,
      transitionIn: typeof spoke.transitionIn === 'string' ? spoke.transitionIn : `from-${spokeLabel(spoke, index)}`,
    };
  });
  const transitions = [];
  for (const config of Array.isArray(data.transitions) ? data.transitions : []) {
    if (transitions.length >= 48) break;
    if (!isObject(config) || typeof config.id !== 'string') continue;
    if (typeof config.sourceZoneId !== 'string' || typeof config.targetZoneId !== 'string') continue;
    transitions.push(config);
  }
  const trees = Array.isArray(data.trees) ? data.trees.filter((tree) => isObject(tree) && finite(tree.x) && finite(tree.z)).slice(0, 400) : [];
  const scenery = Array.isArray(data.scenery) ? data.scenery.filter((item) => isObject(item) && typeof item.type === 'string' && finite(item.x) && finite(item.z)).slice(0, 400) : [];
  return {
    areaName: typeof data.areaName === 'string' ? data.areaName.slice(0, 80) : 'The Hub',
    respawn: {
      x: respawn.x,
      y: finite(respawn.y) ? respawn.y : 0,
      z: respawn.z,
      yaw: finite(respawn.yaw) ? respawn.yaw || 0 : 0,
    },
    plaza: cleanPolygon(area.plaza),
    radius: finite(area.radius) ? area.radius : 20,
    spokes,
    transitions,
    trees,
    scenery,
    structure: cleanStructure(data.structure),
    labels: { hub: typeof data.areaName === 'string' ? data.areaName.slice(0, 80) : 'The Hub' },
  };
}

function placeTitle(spokeName, fileName) {
  const raw = (typeof spokeName === 'string' && spokeName.trim())
    || String(fileName || '').replace(/\.json$/i, '');
  const compact = raw.toLowerCase().replace(/[-_\s]+/g, '');
  const sized = compact.match(/^(sm|small|lg|large|med|medium)ruins$/);
  const sizes = { sm: 'Small', small: 'Small', lg: 'Large', large: 'Large', med: 'Medium', medium: 'Medium' };
  if (sized) return `${sizes[sized[1]]} Ruins`;
  const spaced = raw.replace(/\.json$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  if (!spaced) return 'Location';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// What the header and the line under the room name should say. The header is the place (the hub, or
// which ruin this trail belongs to). The tag says how to go further: into the arch, back to the hub,
// or why the inside looks closed.
export function whereabouts({ kind, placeName, room, torch, entranceRoomId, exitRoomId } = {}) {
  const title = placeName || (kind === 'hub' ? 'The Hub' : 'Location');
  if (kind === 'hub') return { title, tag: 'Paths lead out from the hub.' };
  const outside = !room || room.kind === 'exterior' || room.theme === 'outdoor' || room.id === 'worn-trail' || room.id === 'world-hub';
  if (outside) {
    return {
      title,
      tag: room?.id === 'world-hub' ? 'This end of the trail returns to the hub.' : 'The stone arch is the way in.',
    };
  }
  if (!torch) return { title, tag: 'It is dark. Raise Ambient light, or equip a torch, to see.' };
  if (room.id === exitRoomId) return { title, tag: 'Exit chamber. The path outside leads back to the trail.' };
  if (room.id === entranceRoomId) return { title, tag: 'The arch leads back out to the trail.' };
  return { title, tag: '' };
}

function arrivalSpawn(layout) {
  return {
    x: layout.start.x,
    y: finite(layout.start.y) ? layout.start.y : 0,
    z: layout.start.z,
    rotationY: finite(layout.start.yaw) ? layout.start.yaw : 0,
  };
}

function returnVolume(layout) {
  const pass = layout.transitions.find((item) => item.id === 'mountain-pass' && item.volume);
  if (pass) return pass;
  const end = layout.approach.samples[layout.approach.samples.length - 1];
  const half = end.half || 6;
  layout.transitions.push({
    id: 'mountain-pass',
    sourceZoneId: 'worn-trail',
    targetZoneId: 'hub',
    targetSpawnPoint: { x: end.x, y: 0, z: end.z, rotationY: Math.PI },
    transitionType: 'fade',
    fadeDurationMs: 300,
    volume: { minX: end.x - half, maxX: end.x + half, minZ: end.z - 1.5, maxZ: end.z + 1.5, minY: -2, maxY: 4 },
  });
  return layout.transitions[layout.transitions.length - 1];
}

// `entries` is `{ name, data }` in master-config order. Spoke 0 takes the first, spoke 1 the second.
export function connectWorld(hubData, entries) {
  if (!Array.isArray(entries)) fail('Locations must be a list.');
  const hub = prepareHub(hubData);
  if (hub.spokes.length !== entries.length) {
    fail(`The hub has ${hub.spokes.length} paths and the config lists ${entries.length} locations. Those counts have to match.`);
  }
  const bindings = [];
  hub.transitions.forEach((config) => {
    config.placeId = 'hub';
  });
  entries.forEach((entry, index) => {
    const spoke = hub.spokes[index];
    let layout;
    try {
      layout = prepareLocation(JSON.parse(JSON.stringify(entry.data)));
    } catch (error) {
      const detail = error instanceof LocationError ? error.message : 'It could not be read as a location.';
      fail(`${entry.name}: ${detail}`);
    }
    layout.placeName = placeTitle(spoke.name, entry.name);
    layout.transitions = layout.transitions.filter((item) => KEPT_TRANSITIONS.has(item.id));
    buildExitLoop(layout);
    const outbound = hub.transitions.find((item) => item.id === spoke.transitionOut);
    const inbound = hub.transitions.find((item) => item.id === spoke.transitionIn);
    if (!outbound?.volume) fail(`The hub path "${spoke.name}" has no way out.`);
    if (!inbound?.targetSpawnPoint || !finite(inbound.targetSpawnPoint.x) || !finite(inbound.targetSpawnPoint.z)) {
      fail(`The hub path "${spoke.name}" has no way back.`);
    }
    outbound.targetZoneId = 'worn-trail';
    outbound.targetSpawnPoint = arrivalSpawn(layout);
    outbound.placeId = index;
    if (!finite(outbound.volume.minY)) outbound.volume.minY = -2;
    if (!finite(outbound.volume.maxY)) outbound.volume.maxY = 4;
    const returning = returnVolume(layout);
    returning.targetZoneId = 'hub';
    returning.targetSpawnPoint = {
      x: inbound.targetSpawnPoint.x,
      y: finite(inbound.targetSpawnPoint.y) ? inbound.targetSpawnPoint.y : 0,
      z: inbound.targetSpawnPoint.z,
      rotationY: finite(inbound.targetSpawnPoint.rotationY) ? inbound.targetSpawnPoint.rotationY : 0,
    };
    returning.placeId = 'hub';
    for (const config of layout.transitions) {
      if (config.placeId === undefined) config.placeId = index;
    }
    bindings.push({
      index,
      spoke: spoke.name,
      location: typeof entry.name === 'string' ? entry.name : `location-${index + 1}`,
      layout,
    });
  });
  return { hub, bindings };
}
