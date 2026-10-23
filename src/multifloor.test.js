// @vitest-environment jsdom
// The generator's multi-floor locations end to end: build one, walk its stairs, leave by the arch and
// come back, and keep score.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from './balance.js';
import { createDungeon, locationLayout } from './dungeon.js';
import { resolveBody, storyAt } from './geometry.js';
import { completionPercent } from './location.js';
import { createSkeletons } from './skeleton.js';
import seed3000 from './test-utils/fixtures/seed3000.json';
import { withTestMaterials } from './test-utils/testMaterials.js';
import { createZoneTransitions } from './zone-transition.js';

let testMaterials;
let scene;
let layout;
let dungeon;

beforeEach(() => {
  testMaterials = withTestMaterials();
  scene = new THREE.Scene();
  layout = locationLayout(seed3000);
  dungeon = createDungeon(scene, testMaterials.materials, layout);
});

afterEach(() => {
  dungeon.dispose();
  testMaterials.dispose();
});

const byId = (id) => dungeon.rooms.find((room) => room.id === id);
const mid = (door) => [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2];
const doorBetween = (a, b) => dungeon.doorBetween(byId(a).index, byId(b).index);

function stubPlayer(overrides = {}) {
  return {
    alive: true,
    room: null,
    x: 0,
    y: 0,
    z: 0,
    guardX: 0,
    guardY: 0,
    guardZ: 0,
    guardUp: false,
    yaw: 0,
    ...overrides,
  };
}

// Walks a body in a straight line, the way the player does each frame, and reports whether a wall
// ever stopped it. The room and the floor under it are looked up as it goes.
function walk(from, to, state) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.ceil(distance / 0.25);
  state.x = from[0];
  state.z = from[1];
  let stopped = 0;
  for (let step = 1; step <= steps; step += 1) {
    const wantX = from[0] + ((to[0] - from[0]) * step) / steps;
    const wantZ = from[1] + ((to[1] - from[1]) * step) / steps;
    const resolved = resolveBody(wantX, wantZ, PLAYER_RADIUS, dungeon.colliders, state.y);
    if (Math.hypot(resolved.x - wantX, resolved.z - wantZ) > 0.01) stopped += 1;
    state.x = resolved.x;
    state.z = resolved.z;
    state.room = dungeon.roomAt(state.x, state.z, state.room?.id, state.y);
    state.y = dungeon.floorY(state.x, state.z, state.room);
  }
  return stopped;
}

describe('building a generator location', () => {
  it('builds all 32 rooms on two floors and reports what there is to do', () => {
    expect(dungeon.rooms).toHaveLength(32);
    expect(dungeon.floors).toBe(2);
    expect(dungeon.totals).toEqual({ enemies: 28, chests: 8 });
    expect(dungeon.chests).toHaveLength(8);
    expect(dungeon.entranceRoomId).toBe('space-0');
    expect(dungeon.exitRoomId).toBe('space-31');
  });

  it('puts chests and sconces on the floor of the room they are in', () => {
    const upper = dungeon.rooms.find((room) => room.y === 10 && room.chest && room.sconce);
    expect(upper).toBeTruthy();
    const chest = dungeon.chests.find((candidate) => candidate.x === upper.chest.x && candidate.z === upper.chest.z);
    expect(chest.y).toBe(10);
    expect(chest.group.position.y).toBe(10);
    const sconce = dungeon.sconces.find((candidate) => candidate.roomId === upper.id);
    expect(sconce.group.position.y).toBeCloseTo(15.6, 5);
    expect(sconce.interactable.lightY).toBeCloseTo(16.7, 5);
  });

  it('draws props and scenery as instanced meshes, and makes the solid ones solid', () => {
    const names = [];
    dungeon.group.traverse((object) => {
      if (object.name.startsWith('props-')) names.push(object.name);
    });
    expect(names.length).toBeGreaterThan(2);
    const propColliders = dungeon.colliders.filter((collider) => collider.radius && collider.story !== undefined);
    expect(propColliders.length).toBeGreaterThan(20);
    expect(propColliders.some((collider) => collider.story === 1)).toBe(true);
  });

  it('builds without errors a second time into the same scene, after disposing the first', () => {
    dungeon.dispose();
    dungeon = createDungeon(scene, testMaterials.materials, locationLayout(seed3000));
    expect(dungeon.rooms).toHaveLength(32);
  });

  it('cleans up after itself when a file is valid but will not build', () => {
    const before = scene.children.length;
    const broken = locationLayout(seed3000);
    broken.approach.court = null;
    expect(() => createDungeon(scene, testMaterials.materials, broken)).toThrow();
    expect(scene.children.length).toBe(before);
  });
});

describe('floors and walls', () => {
  it('stands on the floor under it: ground, slope, upper floor', () => {
    const stairwell = byId('space-15');
    expect(dungeon.floorY(stairwell.rect.x + stairwell.rect.w - 0.5, stairwell.rect.z + 6, stairwell)).toBe(0);
    expect(dungeon.floorY(-95, -31, stairwell)).toBeCloseTo(5, 5);
    expect(dungeon.floorY(-110, -31, byId('space-16'))).toBe(10);
    expect(dungeon.floorY(0, 0, byId('space-0'))).toBe(0);
    expect(dungeon.floorY(0, 0, { name: 'outside' })).toBe(0);
  });

  it('finds the room on the story the body is standing on', () => {
    const upper = byId('space-18');
    const x = upper.rect.x + upper.rect.w / 2;
    const z = upper.rect.z + upper.rect.d / 2;
    expect(dungeon.roomAt(x, z, null, 10).id).toBe('space-18');
    const stairwell = byId('space-15');
    expect(dungeon.roomAt(-95, -31, null, 5).id).toBe('space-15');
    expect(dungeon.roomAt(-95, -31, null, 0).id).toBe('space-15');
    expect(dungeon.roomAt(-95, -31, null, 10).id).toBe(stairwell.id);
  });

  it('keeps an upper floor\'s walls off a body on the floor below, and the reverse', () => {
    const lowerNear = (collider) => dungeon.colliders.some((other) => other.story === 0
      && Math.hypot((other.ax + other.bx) / 2 - (collider.ax + collider.bx) / 2, (other.az + other.bz) / 2 - (collider.az + collider.bz) / 2) < 6);
    const upperWall = dungeon.colliders.find((collider) => collider.story === 1 && collider.ax !== undefined && !lowerNear(collider));
    expect(upperWall).toBeTruthy();
    const x = (upperWall.ax + upperWall.bx) / 2 - upperWall.nx * 0.1;
    const z = (upperWall.az + upperWall.bz) / 2 - upperWall.nz * 0.1;
    const onUpper = resolveBody(x, z, 0.5, dungeon.colliders, 10);
    const onGround = resolveBody(x, z, 0.5, dungeon.colliders, 0);
    expect(Math.hypot(onUpper.x - x, onUpper.z - z)).toBeGreaterThan(0.2);
    expect(Math.hypot(onGround.x - x, onGround.z - z)).toBeLessThan(0.001);
    expect(storyAt(10)).toBe(1);
  });
});

describe('walking the whole way', () => {
  it('climbs the stairwell from the ground floor to the upper floor and back without a wall in the way', () => {
    const enter = mid(doorBetween('space-14', 'space-15'));
    const top = mid(doorBetween('space-15', 'space-16'));
    const lowerCenter = byId('space-14').rect;
    const outward = Math.sign(lowerCenter.x + lowerCenter.w / 2 - enter[0]) || 1;
    const state = { x: 0, y: 0, z: 0, room: null };
    const start = [enter[0] + outward * 1.5, enter[1]];
    const beyond = [top[0] + (byId('space-16').rect.x + byId('space-16').rect.w / 2 > top[0] ? 6 : -6), top[1]];

    let stopped = walk(start, enter, state);
    expect(state.y).toBe(0);
    stopped += walk(enter, top, state);
    expect(state.room.id).toBe('space-15');
    expect(state.y).toBe(10);
    stopped += walk(top, beyond, state);
    expect(state.room.id).toBe('space-16');
    expect(state.y).toBe(10);
    expect(stopped).toBe(0);

    stopped = walk(beyond, top, state);
    stopped += walk(top, enter, state);
    stopped += walk(enter, start, state);
    expect(state.room.id).toBe('space-14');
    expect(state.y).toBe(0);
    expect(stopped).toBe(0);
  });

  it('rises smoothly on the way up, never jumping more than a step', () => {
    const enter = mid(doorBetween('space-14', 'space-15'));
    const top = mid(doorBetween('space-15', 'space-16'));
    const state = { x: enter[0], y: 0, z: enter[1], room: byId('space-15') };
    let last = 0;
    const steps = 80;
    for (let step = 0; step <= steps; step += 1) {
      const x = enter[0] + ((top[0] - enter[0]) * step) / steps;
      const z = enter[1] + ((top[1] - enter[1]) * step) / steps;
      state.room = dungeon.roomAt(x, z, state.room.id, state.y);
      const y = dungeon.floorY(x, z, state.room);
      expect(y - last).toBeGreaterThanOrEqual(-1e-9);
      expect(y - last).toBeLessThan(0.5);
      last = y;
      state.y = y;
    }
    expect(last).toBe(10);
  });

  it('can route from the entrance to the exit through every floor', () => {
    let at = byId('space-0').index;
    const goal = byId('space-31').index;
    let hops = 0;
    while (at !== goal) {
      const hop = dungeon.nextHop(at, goal);
      expect(hop).toBeGreaterThanOrEqual(0);
      expect(dungeon.doorBetween(at, hop)).toBeTruthy();
      at = hop;
      hops += 1;
      expect(hops).toBeLessThan(40);
    }
    expect(hops).toBeGreaterThan(20);
  });
});

describe('what is drawn', () => {
  const camera = new THREE.PerspectiveCamera();

  it('draws only the room you are in, the passages off it and the chamber past them', () => {
    dungeon.update(0, 1 / 60, 'stone', 8, 6, false, camera, 0);
    expect(dungeon.activeRooms.has('space-0')).toBe(true);
    expect(dungeon.activeRooms.has('space-1')).toBe(true);
    expect(dungeon.activeRooms.has('space-31')).toBe(false);
    expect(dungeon.activeRooms.has('space-18')).toBe(false);
    expect(dungeon.activeRooms.size).toBeLessThan(8);
  });

  it('draws both ends of the stairs while you climb them, and the floor above once you arrive', () => {
    dungeon.update(0, 1 / 60, 'stone', -95, -31, true, camera, 5);
    expect(dungeon.activeRooms.has('space-15')).toBe(true);
    expect(dungeon.activeRooms.has('space-14')).toBe(true);
    expect(dungeon.activeRooms.has('space-16')).toBe(true);
    expect(dungeon.activeRooms.has('space-0')).toBe(false);
  });
});

describe('the exit and the way back in', () => {
  function transitionsFor(onCommit) {
    return createZoneTransitions({
      configs: layout.transitions.map((config) => ({ ...config, transitionType: 'instant' })),
      labels: layout.zoneLabels,
      initialZoneId: 'ancient-ruins',
      canActivate: (config) => (config.requiresGate ? dungeon.isGateOpen() : true),
      onCommit,
    });
  }
  const exitVolume = () => layout.transitions.find((config) => config.id === 'ruin-exit').volume;
  const centre = (volume) => [(volume.minX + volume.maxX) / 2, (volume.minZ + volume.maxZ) / 2];

  it('leaves through the arch from the ground floor', () => {
    const committed = [];
    const transitions = transitionsFor((config) => committed.push(config.id));
    const [x, z] = centre(exitVolume());
    transitions.update(0.016, x, z, 0);
    expect(committed).toEqual(['ruin-exit']);
    expect(transitions.zoneId()).toBe('worn-trail');
    transitions.dispose();
  });

  it('does not leave from a landing above the arch', () => {
    const committed = [];
    const transitions = transitionsFor((config) => committed.push(config.id));
    const [x, z] = centre(exitVolume());
    transitions.update(0.016, x, z, 10);
    expect(committed).toEqual([]);
    expect(transitions.zoneId()).toBe('ancient-ruins');
    transitions.dispose();
  });

  it('keeps the gate open, the loot taken and the enemies down while the player is outside', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    dungeon.openGate();
    const chest = dungeon.chests[0];
    expect(dungeon.openChestAt(chest.x, chest.z, 0, -1, chest.y)).toBeGreaterThan(0);
    skeletons.damage(skeletons.list[0], 1000);

    dungeon.showZone('worn-trail');
    dungeon.update(0, 1 / 60, 'outdoor', 8, 20, false, new THREE.PerspectiveCamera(), 0);
    expect(dungeon.activeRooms.size).toBe(0);
    dungeon.showZone('ancient-ruins');

    expect(dungeon.isGateOpen()).toBe(true);
    expect(dungeon.lootTaken()).toBe(1);
    expect(skeletons.fallen()).toBe(1);
    expect(skeletons.list[0].dead).toBe(true);
  });

  it('can re-enter after leaving: the entry volume fires again, with the gate already open', () => {
    dungeon.openGate();
    const committed = [];
    const transitions = createZoneTransitions({
      configs: layout.transitions.map((config) => ({ ...config, transitionType: 'instant' })),
      labels: layout.zoneLabels,
      initialZoneId: 'worn-trail',
      canActivate: (config) => (config.requiresGate ? dungeon.isGateOpen() : true),
      onCommit: (config) => committed.push(config.id),
    });
    const entry = layout.transitions.find((config) => config.id === 'ruin-entry').volume;
    transitions.update(0.016, (entry.minX + entry.maxX) / 2, (entry.minZ + entry.maxZ) / 2, 0);
    expect(committed).toEqual(['ruin-entry']);
    transitions.dispose();
  });
});

describe('keeping score', () => {
  it('reaches 100 only when every enemy is down and every chest is open', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const report = () => completionPercent({
      enemiesFallen: skeletons.fallen(),
      enemiesTotal: skeletons.list.length,
      lootTaken: dungeon.lootTaken(),
      lootTotal: dungeon.lootTotal(),
    });
    expect(skeletons.list).toHaveLength(dungeon.totals.enemies);
    expect(dungeon.lootTotal()).toBe(dungeon.totals.chests);
    expect(report()).toBe(0);

    for (const skeleton of skeletons.list) skeletons.damage(skeleton, 1000);
    expect(skeletons.fallen()).toBe(28);
    expect(report()).toBe(77);
    // Everything cleared is not the end: the world keeps updating and the player is not stopped.
    expect(() => skeletons.update(1 / 60, stubPlayer(), () => false, 0.5, true)).not.toThrow();
    expect(() => dungeon.update(0, 1 / 60, 'stone', 8, 6, false, new THREE.PerspectiveCamera(), 0)).not.toThrow();

    for (const chest of dungeon.chests) dungeon.openChestAt(chest.x, chest.z, 0, -1, chest.y);
    expect(dungeon.lootTaken()).toBe(8);
    expect(report()).toBe(100);
  });

  it('will not open a chest from the floor above or below it', () => {
    const upper = dungeon.chests.find((chest) => chest.y === 10);
    expect(dungeon.openChestAt(upper.x, upper.z, 0, -1, 0)).toBe(0);
    expect(dungeon.lootTaken()).toBe(0);
    expect(dungeon.openChestAt(upper.x, upper.z, 0, -1, 10)).toBeGreaterThan(0);
  });
});

describe('the undead on other floors', () => {
  const upperSpawnRoom = () => dungeon.rooms.find((room) => room.y === 10 && room.spawns.length > 0);

  it('stand on the floor of their own room', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const upper = skeletons.list.find((skeleton) => skeleton.room.y === 10);
    expect(upper.y).toBe(10);
    expect(upper.mesh.root.position.y).toBe(10);
    expect(skeletons.list.find((skeleton) => skeleton.room.index === 1).y).toBe(0);
  });

  it('do not notice a player on the floor below them, however near on the map', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const room = upperSpawnRoom();
    const skeleton = skeletons.list.find((candidate) => candidate.room === room);
    dungeon.intruded = true;
    for (const id of dungeon.rooms.map((candidate) => candidate.id)) dungeon.activeRooms.add(id);
    const below = stubPlayer({ x: skeleton.x + 2, z: skeleton.z, y: 0, room: dungeon.rooms[0] });
    skeletons.update(1 / 60, below, () => false, 0.5, true);
    expect(skeleton.aggro).toBe(false);
    const level = stubPlayer({ x: skeleton.x + 2, z: skeleton.z, y: 10, room });
    skeletons.update(1 / 60, level, () => false, 0.5, true);
    expect(skeleton.aggro).toBe(true);
  });

  it('come down the stairs after a player on the ground floor', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const room = dungeon.rooms.find((candidate) => candidate.y === 10 && candidate.index < 20 && candidate.spawns.length > 0)
      || upperSpawnRoom();
    const skeleton = skeletons.list.find((candidate) => candidate.room === room);
    const lower = byId('space-14');
    const player = stubPlayer({
      x: lower.rect.x + lower.rect.w / 2,
      z: lower.rect.z + lower.rect.d / 2,
      y: 0,
      room: lower,
    });
    dungeon.intruded = true;
    for (const candidate of dungeon.rooms) dungeon.activeRooms.add(candidate.id);
    skeleton.aggro = true;
    // Only this one hunts: the others stay put so the test follows one body.
    // It stops to strike once the player is in reach, which is at the foot of the stairs.
    let seconds = 0;
    while (seconds < 120 && skeleton.y > 1.5) {
      skeletons.update(0.05, player, () => false, 0.5, true);
      seconds += 0.05;
    }
    expect(skeleton.y).toBeLessThanOrEqual(1.5);
    expect(skeleton.at.index).toBeLessThanOrEqual(byId('space-15').index);
    expect(skeleton.mesh.root.position.y).toBeCloseTo(skeleton.y, 5);
  });
});
