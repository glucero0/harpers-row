// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDungeon } from './dungeon.js';
import { createSkeletons } from './skeleton.js';
import { generateLayout } from './rooms.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

const SEED = 7;

function stubPlayer(overrides = {}) {
  return {
    alive: true,
    room: null,
    x: 0,
    z: 0,
    guardX: 0,
    guardY: 0,
    guardZ: 0,
    guardUp: false,
    yaw: 0,
    ...overrides,
  };
}

let testMaterials;
let scene;
let layout;
let dungeon;

beforeEach(() => {
  testMaterials = withTestMaterials();
  scene = new THREE.Scene();
  layout = generateLayout(SEED);
  dungeon = createDungeon(scene, testMaterials.materials, layout);
});

afterEach(() => {
  dungeon.dispose();
  testMaterials.dispose();
});

describe('createSkeletons', () => {
  it('spawns exactly one skeleton per spawn point defined by the layout', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const expectedCount = layout.rooms.reduce((sum, room) => sum + room.spawns.length, 0);
    expect(skeletons.list).toHaveLength(expectedCount);
    expect(skeletons.fallen()).toBe(0);
  });

  it('update() runs a full frame tick both idle and hunting without throwing', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const hurt = () => 'hit';

    expect(() => {
      skeletons.update(1 / 60, stubPlayer(), hurt, 0.5, false);
    }).not.toThrow();

    dungeon.update(0, 0, 'stone', layout.rooms[1].rect.x, layout.rooms[1].rect.z, true, new THREE.PerspectiveCamera());
    expect(() => {
      skeletons.update(1 / 60, stubPlayer({ room: layout.rooms[1], x: layout.rooms[1].rect.x, z: layout.rooms[1].rect.z }), hurt, 0.5, true);
    }).not.toThrow();
  });

  describe('damage()', () => {
    it('reduces hp, flags aggro, and only reports a kill once hp reaches zero', () => {
      const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
      const target = skeletons.list[0];

      const stillAlive = skeletons.damage(target, 1);
      expect(stillAlive).toBe(false);
      expect(target.dead).toBe(false);
      expect(target.aggro).toBe(true);
      expect(target.hp).toBeLessThan(36);

      const killed = skeletons.damage(target, 1000);
      expect(killed).toBe(true);
      expect(target.dead).toBe(true);
      expect(target.hp).toBe(0);
      expect(skeletons.fallen()).toBe(1);

      // A dead skeleton cannot be killed twice.
      expect(skeletons.damage(target, 10)).toBe(false);
    });

    it('livingIn() drops as the skeletons in a room die', () => {
      const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
      const room = layout.rooms.find((candidate) => candidate.spawns.length > 0);
      const inRoom = skeletons.list.filter((skeleton) => skeleton.room.id === room.id);
      expect(inRoom.length).toBeGreaterThan(0);

      const before = skeletons.livingIn(room.id);
      skeletons.damage(inRoom[0], 1000);
      expect(skeletons.livingIn(room.id)).toBe(before - 1);
    });
  });

  it('cryptCleared() is false until every skeleton in the last room is dead', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const lastRoomSkeletons = skeletons.list.filter((skeleton) => skeleton.room.id === dungeon.lastRoomId);
    expect(lastRoomSkeletons.length).toBeGreaterThan(0);
    expect(skeletons.cryptCleared()).toBe(false);

    for (const skeleton of lastRoomSkeletons) skeletons.damage(skeleton, 1000);
    expect(skeletons.cryptCleared()).toBe(true);
  });

  it('reset() revives every skeleton back to its spawn point at full health', () => {
    const skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
    const target = skeletons.list[0];
    skeletons.damage(target, 1000);
    expect(target.dead).toBe(true);

    skeletons.reset();
    expect(target.dead).toBe(false);
    expect(target.hp).toBe(36);
    expect(target.x).toBe(target.spawnX);
    expect(target.z).toBe(target.spawnZ);
    expect(target.aggro).toBe(false);
  });
});
