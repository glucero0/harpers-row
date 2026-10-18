import { clearance, closestOnSegment, rectGap } from './geometry.js';

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
    } else {
      room.sconce = [room.rect.x + room.rect.w / 2, room.rect.z + room.rect.d / 2];
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

  return {
    seed: 0,
    area: areaOf(spaces),
    rooms,
    doors,
    start,
    lastRoomId: rooms[rooms.length - 1].id,
  };
}

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
