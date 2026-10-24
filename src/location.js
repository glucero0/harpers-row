// A location is one explorable place described by a JSON file (see ancientRuinsData.json and the
// files block-dungeon-generator writes). This module is pure: no THREE, no DOM. It treats the file as
// untrusted input, fills in the fields older files do not have, and derives what the rest of the game
// needs from it:
//
//   - floors: every room sits at a height `y`, a stairwell carries a ramp, and walls are cut per story
//   - the room graph: who is next to whom, the way from any room to any other, and which rooms are
//     worth drawing from where the player stands (the file is a tree, not a single chain)
//   - the entrance (the arch back to daylight) and the exit chamber (the deepest room)
//   - how much there is to do, so progress can be reported as a percentage
//
// `prepareLocation` mutates the layout in place and is safe to call more than once.
import { creatureById, defaultCreature } from './creatures.js';
import { STORY_HEIGHT } from './geometry.js';

const MAX_ROOMS = 400;
const MAX_PROPS_PER_ROOM = 200;
const MAX_SCENERY = 600;
const MAX_NAME = 80;

const prepared = new WeakSet();

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isPoint = (value) => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);

// Thrown for any problem with a location file. Its message is safe to show to the player: it names
// what is wrong with the file and never echoes more than a short id or label from it.
export class LocationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocationError';
  }
}

function fail(message) {
  throw new LocationError(`Location data is invalid: ${String(message).slice(0, 200)}`);
}

function text(value, fallback) {
  return typeof value === 'string' ? value.slice(0, MAX_NAME) : fallback;
}

function polygonFromRect(rect) {
  return [
    [rect.x, rect.z],
    [rect.x + rect.w, rect.z],
    [rect.x + rect.w, rect.z + rect.d],
    [rect.x, rect.z + rect.d],
  ];
}

// Props and scenery are decoration. One malformed entry is dropped rather than failing the location.
function cleanDecor(list, limit) {
  if (!Array.isArray(list)) return [];
  const clean = [];
  for (const item of list) {
    if (clean.length >= limit) break;
    if (!item || typeof item.type !== 'string' || !finite(item.x) || !finite(item.z)) continue;
    const entry = {
      type: item.type.slice(0, 40),
      x: item.x,
      z: item.z,
      rotationY: finite(item.rotationY) ? item.rotationY : 0,
      scale: finite(item.scale) && item.scale > 0 && item.scale < 20 ? item.scale : 1,
    };
    if (finite(item.variant)) entry.variant = Math.max(0, Math.floor(item.variant));
    clean.push(entry);
  }
  return clean;
}

const THEMES = new Set(['stone', 'wood', 'cave']);
const MAX_LISTED = 600;
const MAX_TRAIL = 200;
const MAX_REQUIREMENTS = 8;
const MAX_TRANSITIONS = 24;
const DEFAULT_LABELS = {
  'worn-trail': 'Worn Trail',
  'ancient-ruins': 'The Ancient Ruins',
  'world-hub': 'Mountain Pass',
};

const isRect = (value) => !!value && finite(value.x) && finite(value.z) && finite(value.w) && finite(value.d);
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// Keeps the entries of a list that are objects with every one of `keys` a finite number.
function cleanList(list, limit, keys) {
  if (!Array.isArray(list)) return [];
  const clean = [];
  for (const item of list) {
    if (clean.length >= limit) break;
    if (isObject(item) && keys.every((key) => finite(item[key]))) clean.push(item);
  }
  return clean;
}

function cleanPolygon(value) {
  return Array.isArray(value) && value.length >= 3 && value.length <= 200 && value.every(isPoint) ? value : [];
}

// The trail, court, arch and scenery around the entrance. All of it is optional dressing except what
// the arch needs, so a malformed list is dropped, while a malformed arch fails the file.
function prepareSurroundings(layout) {
  if (layout.entrance !== undefined && layout.entrance !== null) {
    const entrance = layout.entrance;
    if (!isObject(entrance) || !isPoint(entrance.a) || !isPoint(entrance.b)) {
      fail('entrance needs [x, z] points a and b');
    }
  } else {
    layout.entrance = null;
  }

  const start = layout.start;
  if (!isObject(start) || !finite(start.x) || !finite(start.z)) fail('start needs finite x and z');
  if (!finite(start.yaw)) start.yaw = 0;

  const inward = layout.gateInward;
  layout.gateInward = isObject(inward) && finite(inward.x) && finite(inward.z) ? inward : { x: 0, z: -1 };

  layout.exterior = cleanPolygon(layout.exterior);
  layout.hub = cleanPolygon(layout.hub);
  layout.vestibule = cleanPolygon(layout.vestibule);
  layout.trees = cleanList(layout.trees, MAX_LISTED, ['x', 'z', 'scale', 'rotationY', 'lean', 'leanAxis']);

  const approach = layout.approach;
  if (approach === undefined || approach === null) {
    layout.approach = null;
  } else {
    if (!isObject(approach) || !finite(approach.midX) || !finite(approach.southZ)) fail('approach needs finite midX and southZ');
    if (!isRect(approach.court) || !isRect(approach.vestibule) || !isRect(approach.hub)) {
      fail('approach needs court, vestibule and hub rectangles');
    }
    const shell = approach.shell;
    const cornice = shell?.cornice;
    if (!isObject(shell) || !finite(shell.facadeHeight) || !finite(shell.flankHeight)
      || !isObject(cornice) || !['overhang', 'height', 'depth', 'y'].every((key) => finite(cornice[key]))) {
      fail('approach needs a shell with facadeHeight, flankHeight and a cornice');
    }
    approach.samples = cleanList(approach.samples, MAX_TRAIL, ['x', 'z', 'half', 'nx', 'nz']);
    if (approach.samples.length < 2) fail('approach needs at least two trail samples');
    const vista = isObject(approach.vista) ? approach.vista : {};
    vista.path = cleanList(vista.path, MAX_TRAIL, ['x', 'z', 'half']);
    vista.mountains = cleanList(vista.mountains, 40, ['x', 'z', 'radius', 'height']);
    vista.scrub = cleanList(vista.scrub, MAX_LISTED, ['x', 'z', 'scale', 'rotationY']);
    vista.trees = cleanList(vista.trees, MAX_LISTED, ['x', 'z', 'scale', 'rotationY', 'lean', 'leanAxis']);
    approach.vista = vista;
  }

  layout.areaName = text(layout.areaName, 'Unknown Location');
  layout.requirements = Array.isArray(layout.requirements)
    ? layout.requirements.filter((item) => typeof item === 'string').slice(0, MAX_REQUIREMENTS).map((item) => item.slice(0, 60))
    : [];
  const labels = isObject(layout.zoneLabels) ? layout.zoneLabels : {};
  layout.zoneLabels = { ...DEFAULT_LABELS };
  for (const key of Object.keys(DEFAULT_LABELS)) layout.zoneLabels[key] = text(labels[key], DEFAULT_LABELS[key]);

  const clean = [];
  for (const config of Array.isArray(layout.transitions) ? layout.transitions : []) {
    if (clean.length >= MAX_TRANSITIONS) break;
    const spawn = config?.targetSpawnPoint;
    if (!isObject(config) || typeof config.id !== 'string'
      || typeof config.sourceZoneId !== 'string' || typeof config.targetZoneId !== 'string'
      || !isObject(spawn) || !finite(spawn.x) || !finite(spawn.z)
      || !isObject(config.volume)
      || !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => finite(config.volume[key]))) continue;
    if (!finite(spawn.rotationY)) spawn.rotationY = 0;
    if (!finite(spawn.y)) spawn.y = 0;
    clean.push(config);
  }
  layout.transitions = clean;
}

function prepareRoom(room, index) {
  if (!room || typeof room !== 'object') fail(`room ${index} must be an object`);
  if (typeof room.id !== 'string' || room.id === '') fail(`room ${index} needs an id`);
  const rect = room.rect;
  if (!rect || !finite(rect.x) || !finite(rect.z) || !finite(rect.w) || !finite(rect.d) || rect.w <= 0 || rect.d <= 0) {
    fail(`${room.id} needs a rect with finite x, z, w, d (w and d above zero)`);
  }
  if (room.polygon === undefined) room.polygon = polygonFromRect(rect);
  if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !room.polygon.every(isPoint)) {
    fail(`${room.id} polygon must be a list of at least three [x, z] points`);
  }
  if (room.spawns === undefined) room.spawns = [];
  if (!Array.isArray(room.spawns) || !room.spawns.every(isPoint)) fail(`${room.id} spawns must be [x, z] points`);

  room.index = index;
  room.name = text(room.name, 'Room');
  room.kind = typeof room.kind === 'string' ? room.kind : 'chamber';
  room.theme = room.theme === 'wood' || room.theme === 'cave' ? room.theme : 'stone';
  room.run = finite(room.run) ? room.run : 0;
  room.span = finite(room.span) ? room.span : 0;
  room.brazier = room.brazier ?? null;
  room.rocks = Array.isArray(room.rocks) ? room.rocks.filter(isPoint) : [];
  room.props = cleanDecor(room.props, MAX_PROPS_PER_ROOM);

  // A sconce and its chest belong together; one without the other is not drawn.
  const sconce = room.sconce;
  const chest = room.chest;
  const sconceOk = sconce && finite(sconce.x) && finite(sconce.z) && finite(sconce.nx) && finite(sconce.nz);
  const chestOk = chest && finite(chest.x) && finite(chest.z);
  room.sconce = sconceOk && chestOk ? sconce : null;
  room.chest = sconceOk && chestOk ? chest : null;

  // Files from before floors existed have no height: they are one ground story.
  const floor = finite(room.floor) ? Math.round(room.floor) : 0;
  room.floor = floor;
  room.y = finite(room.y) ? room.y : floor * STORY_HEIGHT;
  room.storyHeight = finite(room.storyHeight) && room.storyHeight > 0 ? room.storyHeight : STORY_HEIGHT;
  room.storyFirst = Math.round(room.y / STORY_HEIGHT);
  room.storyLast = room.storyFirst + Math.max(1, Math.round(room.storyHeight / STORY_HEIGHT)) - 1;

  const stairless = room.stair === undefined || room.stair === null;
  if (stairless) {
    room.stair = null;
    if (room.kind === 'stairwell' || room.block === 'stairwell') fail(`${room.id} is a stairwell and needs stair data`);
  } else {
    const stair = room.stair;
    if (!finite(stair.fromY) || !finite(stair.toY) || !isPoint(stair.low) || !isPoint(stair.high)) {
      fail(`${room.id} stair needs finite fromY, toY and [x, z] low and high points`);
    }
  }
  return room;
}

function prepareDoor(door, index, byId) {
  if (!door || typeof door !== 'object') fail(`door ${index} must be an object`);
  if (!isPoint(door.a) || !isPoint(door.b)) fail(`door ${index} needs [x, z] points a and b`);
  const from = byId.get(door.from);
  const to = byId.get(door.to);
  if (!from || !to) fail(`door ${index} joins unknown rooms (${String(door.from)}, ${String(door.to)})`);
  if (!isPoint(door.mouthA)) door.mouthA = door.a;
  if (!isPoint(door.mouthB)) door.mouthB = door.b;
  door.width = finite(door.width) ? door.width : Math.hypot(door.b[0] - door.a[0], door.b[1] - door.a[1]);
  door.openingWidth = finite(door.openingWidth) ? door.openingWidth : door.width;
  door.height = finite(door.height) && door.height > 0 ? door.height : 7;
  // A door with no height sits on the higher of the two floors it joins: the top of a stair, not the foot.
  door.y = finite(door.y) ? door.y : Math.max(from.y, to.y);
  return { from, to };
}

// The rooms worth drawing while the player is in `start`: itself, the passages joining it to its
// neighbours, and the next chamber beyond each passage. A chamber that is not the start ends the
// search, so the view never reaches through a whole floor.
function visibleFrom(start, rooms, neighbors) {
  const cost = new Map([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head];
    if (cost.get(here) !== 0) continue;
    for (const next of neighbors[here]) {
      if (cost.has(next)) continue;
      cost.set(next, rooms[next].kind === 'corridor' ? 0 : 1);
      queue.push(next);
    }
  }
  return queue.map((index) => rooms[index].id);
}

function buildGraph(rooms, links, entranceIndex) {
  const count = rooms.length;
  const neighbors = rooms.map(() => []);
  const doorAt = new Map();
  for (const { door, from, to } of links) {
    if (from === to) continue;
    if (!neighbors[from].includes(to)) neighbors[from].push(to);
    if (!neighbors[to].includes(from)) neighbors[to].push(from);
    doorAt.set(`${from}:${to}`, door);
    doorAt.set(`${to}:${from}`, door);
  }

  // next[from * count + goal] is the room to walk into from `from` on the shortest way to `goal`.
  const next = new Int16Array(count * count).fill(-1);
  for (let goal = 0; goal < count; goal += 1) {
    const seen = new Uint8Array(count);
    seen[goal] = 1;
    const queue = [goal];
    for (let head = 0; head < queue.length; head += 1) {
      const here = queue[head];
      for (const there of neighbors[here]) {
        if (seen[there]) continue;
        seen[there] = 1;
        next[there * count + goal] = here;
        queue.push(there);
      }
    }
  }

  // Distance from the entrance, in rooms. It drives how fast the undead are, so a side branch is as
  // deep as the room it hangs off, not as deep as its position in the file.
  const depth = new Array(count).fill(-1);
  depth[entranceIndex] = 0;
  const queue = [entranceIndex];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head];
    for (const there of neighbors[here]) {
      if (depth[there] >= 0) continue;
      depth[there] = depth[here] + 1;
      queue.push(there);
    }
  }
  const unreachable = rooms.filter((room, index) => depth[index] < 0);
  if (unreachable.length) {
    fail(`${unreachable.map((room) => room.id).join(', ')} cannot be reached from the entrance`);
  }

  return {
    neighbors,
    doorAt,
    next,
    depth,
    visible: rooms.map((room, index) => visibleFrom(index, rooms, neighbors)),
  };
}

export function prepareLocation(layout) {
  if (!layout || typeof layout !== 'object') fail('expected an object');
  if (prepared.has(layout)) return layout;
  if (!Array.isArray(layout.rooms) || layout.rooms.length === 0) fail('rooms must be a non-empty list');
  if (layout.rooms.length > MAX_ROOMS) fail(`more than ${MAX_ROOMS} rooms`);
  if (!Array.isArray(layout.doors)) layout.doors = [];

  const byId = new Map();
  layout.rooms.forEach((room, index) => {
    prepareRoom(room, index);
    if (byId.has(room.id)) fail(`room id ${room.id} is used twice`);
    byId.set(room.id, room);
  });
  const links = layout.doors.map((door, index) => {
    const { from, to } = prepareDoor(door, index, byId);
    return { door, from: from.index, to: to.index };
  });

  // The entrance is the room the arch opens into. The exit is the deepest chamber.
  const entranceRoom = layout.rooms.find((room) => room.role === 'antechamber' || room.block === 'entrance')
    || layout.rooms[0];
  const exitRoom = layout.rooms.find((room) => room.role === 'exit' || room.block === 'exit')
    || byId.get(layout.lastRoomId)
    || layout.rooms[layout.rooms.length - 1];
  layout.entranceRoomId = entranceRoom.id;
  layout.exitRoomId = exitRoom.id;
  layout.lastRoomId = exitRoom.id;

  layout.graph = buildGraph(layout.rooms, links, entranceRoom.index);
  layout.rooms.forEach((room, index) => {
    room.depth = layout.graph.depth[index];
  });
  layout.depthCount = Math.max(...layout.graph.depth) + 1;

  prepareSurroundings(layout);
  layout.scenery = cleanDecor(layout.scenery, MAX_SCENERY);
  layout.floors = Math.max(...layout.rooms.map((room) => room.storyLast)) + 1;

  // Walking out of the ruins must not trigger from a stair landing above the arch: every zone
  // transition only fires at ground level.
  const transitions = Array.isArray(layout.transitions) ? layout.transitions : [];
  for (const transition of transitions) {
    const volume = transition?.volume;
    if (!volume) continue;
    if (!finite(volume.minY)) volume.minY = -2;
    if (!finite(volume.maxY)) volume.maxY = STORY_HEIGHT * 0.4;
  }

  // The ways out. The arch back to daylight works from the first step in, at any time; progress is
  // kept while the player is outside. The exit chamber is where the location ends, but reaching it
  // does not end anything.
  const leaving = transitions.find((item) => item.sourceZoneId === 'ancient-ruins' && item.targetZoneId === 'worn-trail');
  layout.exits = [
    { id: 'entrance', type: 'arch', roomId: entranceRoom.id, transitionId: leaving ? leaving.id : null },
    { id: 'exit', type: 'chamber', roomId: exitRoom.id, transitionId: null },
  ];

  applyDungeonOptions(layout);
  prepared.add(layout);
  return layout;
}

// options.theme dresses every room. options.creature is the species at every spawn.
// A file that leaves either one unset keeps mixed room themes and the skeletal warrior.
function applyDungeonOptions(layout) {
  const options = layout.options && typeof layout.options === 'object' ? layout.options : {};
  const theme = options.theme;
  if (theme !== undefined && theme !== null) {
    if (!THEMES.has(theme)) fail('options.theme must be stone, wood, cave, or null');
    for (const room of layout.rooms) {
      room.theme = theme;
      if (theme !== 'cave') room.rocks = [];
    }
  }
  const requested = options.creature;
  let creature = defaultCreature();
  if (requested !== undefined && requested !== null && requested !== '') {
    if (typeof requested !== 'string') fail('options.creature must be a species id or null');
    creature = creatureById(requested);
    if (!creature) fail('options.creature is not a known species');
  }
  layout.creatureId = creature.id;
  layout.creature = creature;
  const named = typeof layout.enemyName === 'string' ? layout.enemyName.trim() : '';
  layout.enemyName = named ? named.slice(0, MAX_NAME) : creature.name;
}

// ---- Floors -----------------------------------------------------------------------------------

export function stairHeightAt(stair, x, z) {
  const dx = stair.high[0] - stair.low[0];
  const dz = stair.high[1] - stair.low[1];
  const length2 = dx * dx + dz * dz;
  if (length2 < 1e-9) return stair.fromY;
  const t = ((x - stair.low[0]) * dx + (z - stair.low[1]) * dz) / length2;
  return stair.fromY + (stair.toY - stair.fromY) * Math.min(1, Math.max(0, t));
}

// The walkable height at (x, z) inside `room`: flat for a room, a ramp for a stairwell.
export function floorHeightAt(room, x, z) {
  if (!room) return 0;
  if (room.stair) return stairHeightAt(room.stair, x, z);
  return finite(room.y) ? room.y : 0;
}

// ---- Progress ---------------------------------------------------------------------------------

// A chest is only built for a room that has both a sconce and a chest.
export function hasChest(room) {
  return !!(room && room.sconce && room.chest);
}

// What there is to do in a location: one task per enemy placed and one per chest placed.
export function measureLocation(layout) {
  let enemies = 0;
  let chests = 0;
  for (const room of layout.rooms) {
    enemies += room.spawns.length;
    if (hasChest(room)) chests += 1;
  }
  return { enemies, chests };
}

// Percent of the location done: enemies felled plus chests opened, over all enemies and chests
// placed. It only reads 100 when every one of them is done, never from rounding.
export function completionPercent({ enemiesFallen, enemiesTotal, lootTaken, lootTotal }) {
  const count = (value) => (finite(value) && value > 0 ? value : 0);
  const total = count(enemiesTotal) + count(lootTotal);
  if (!(total > 0)) return 0;
  const done = Math.min(count(enemiesFallen), count(enemiesTotal)) + Math.min(count(lootTaken), count(lootTotal));
  if (done >= total) return 100;
  return Math.min(99, Math.floor((done / total) * 100));
}
