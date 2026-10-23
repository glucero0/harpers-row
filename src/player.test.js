// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDungeon } from './dungeon.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { floorHeight } from './geometry.js';
import { createSkeletons } from './skeleton.js';
import { generateLayout } from './rooms.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

const SEED = 7;

let testMaterials;
let scene;
let camera;
let layout;
let dungeon;
let skeletons;
let input;
let canvas;

beforeEach(() => {
  testMaterials = withTestMaterials();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, 1, 0.05, 500);
  scene.add(camera);
  layout = generateLayout(SEED);
  dungeon = createDungeon(scene, testMaterials.materials, layout);
  skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);
  canvas = document.createElement('canvas');
  input = createInput(canvas);
});

afterEach(() => {
  input.dispose();
  dungeon.dispose();
  testMaterials.dispose();
});

describe('createPlayer', () => {
  it('placeAt() moves the fighter without clearing gear or health', () => {
    const player = createPlayer(camera, testMaterials.materials, layout.start);
    player.equip();
    player.placeAt(layout.start.x + 4, layout.start.z - 3, 1.2);
    expect(player.state.x).toBe(layout.start.x + 4);
    expect(player.state.z).toBe(layout.start.z - 3);
    expect(player.state.yaw).toBe(1.2);
    expect(player.state.equipped).toBe(true);
    expect(player.state.health).toBe(100);
  });

  it('starts at the given spawn point, unequipped and at full health', () => {
    const player = createPlayer(camera, testMaterials.materials, layout.start);
    expect(player.state.x).toBe(layout.start.x);
    expect(player.state.z).toBe(layout.start.z);
    expect(player.state.yaw).toBe(layout.start.yaw);
    expect(player.state.equipped).toBe(false);
    expect(player.state.health).toBe(100);
    expect(player.state.maxHealth).toBe(100);
    expect(player.state.alive).toBe(true);
  });

  describe('equip()', () => {
    it('equips once, making the weapons visible, and refuses a second call', () => {
      const player = createPlayer(camera, testMaterials.materials, layout.start);
      expect(player.equip()).toBe(true);
      expect(player.state.equipped).toBe(true);
      expect(player.weapons.rightHand.visible).toBe(true);
      expect(player.weapons.leftHand.visible).toBe(true);
      expect(player.equip()).toBe(false);
    });
  });

  describe('hurt()', () => {
    it('applies armor mitigation and ends the run at zero health', () => {
      const player = createPlayer(camera, testMaterials.materials, layout.start);
      const result = player.hurt(20, { x: player.state.x, z: player.state.z + 5 });
      expect(result).toBe('hit');
      expect(player.state.health).toBeCloseTo(100 - 20 * 0.85, 5);
      expect(player.state.alive).toBe(true);

      // Bypass the post-hit invulnerability window (i-frames) that the previous hit just started,
      // the same way letting real frames pass during `update()` would.
      player.state.iframes = 0;
      const dead = player.hurt(1000, { x: player.state.x, z: player.state.z + 5 });
      expect(dead).toBe('hit');
      expect(player.state.health).toBe(0);
      expect(player.state.alive).toBe(false);
    });

    it('does nothing once the player is already dead', () => {
      const player = createPlayer(camera, testMaterials.materials, layout.start);
      player.hurt(1000, { x: player.state.x, z: player.state.z + 5 });
      expect(player.state.alive).toBe(false);
      expect(player.hurt(10, { x: player.state.x, z: player.state.z + 5 })).toBe(false);
      expect(player.state.health).toBe(0);
    });
  });

  describe('reconcileXp()', () => {
    it('levels up and tops off health when accrued xp crosses the threshold', () => {
      const player = createPlayer(camera, testMaterials.materials, layout.start);
      player.hurt(30, { x: player.state.x, z: player.state.z + 5 });
      expect(player.state.health).toBeLessThan(player.state.maxHealth);

      player.state.xp = 10000;
      player.reconcileXp(0.5);

      expect(player.state.level).toBeGreaterThan(1);
      expect(player.state.health).toBe(player.state.maxHealth);
      expect(player.state.damage).toBeGreaterThan(18);
    });
  });

  describe('reset()', () => {
    it('restores level, health, and position to a fresh run', () => {
      const player = createPlayer(camera, testMaterials.materials, layout.start);
      player.equip();
      player.hurt(1000, { x: player.state.x, z: player.state.z + 5 });
      player.state.xp = 10000;
      player.reconcileXp(0.5);

      const nextStart = { x: layout.start.x + 5, z: layout.start.z - 3, yaw: 1.2 };
      player.reset(nextStart);

      expect(player.state.x).toBe(nextStart.x);
      expect(player.state.z).toBe(nextStart.z);
      expect(player.state.yaw).toBe(nextStart.yaw);
      expect(player.state.level).toBe(1);
      expect(player.state.xp).toBe(0);
      expect(player.state.health).toBe(100);
      expect(player.state.alive).toBe(true);
      expect(player.state.swing).toBe(0);
    });
  });

  it('update() runs a full frame tick against a real dungeon/skeletons/input without throwing', () => {
    const player = createPlayer(camera, testMaterials.materials, layout.start);
    player.equip();
    player.state.room = dungeon.roomAt(layout.start.x, layout.start.z, null);

    const frame = input.poll();
    expect(() => {
      player.update(1 / 60, frame, dungeon, skeletons, 0.5, true, { realDt: 1 / 60 });
    }).not.toThrow();
    expect(player.state.room).toBeTruthy();
  });

  it('follows a stairwell from the lower sill up to the upper sill', () => {
    const stair = {
      id: 'stair',
      theme: 'stone',
      kind: 'stairwell',
      y: 0,
      storyHeight: 20,
      stair: { fromY: 0, toY: 10, low: [0, 0], high: [0, -16] },
    };
    const world = {
      colliders: [],
      gateInward: { x: 0, z: -1 },
      nearGate() { return false; },
      containsInterior() { return false; },
      roomAt() { return stair; },
      floorY(room, x, z) { return floorHeight(room, x, z); },
    };
    const player = createPlayer(camera, testMaterials.materials, { x: 0, z: 0, yaw: 0, y: 0 });
    player.equip();
    player.state.x = 0;
    player.state.z = -16;
    player.update(1 / 60, input.poll(), world, null, 0.5, true, { realDt: 1 / 60 });
    expect(player.state.y).toBeCloseTo(10, 5);
  });
});
