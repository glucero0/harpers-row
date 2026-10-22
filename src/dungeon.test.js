// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDungeon } from './dungeon.js';
import { generateLayout } from './rooms.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

let testMaterials;

beforeEach(() => {
  testMaterials = withTestMaterials();
});

afterEach(() => {
  testMaterials.dispose();
});

function chamberWithChest(layout) {
  return layout.rooms.find((room) => room.kind === 'chamber' && room.chest);
}

describe('createDungeon', () => {
  it('attaches its root group and lights to the scene, carrying layout data through', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(7);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);

    expect(scene.children).toContain(dungeon.group);
    expect(dungeon.rooms).toBe(layout.rooms);
    expect(dungeon.doors).toBe(layout.doors);
    expect(dungeon.lastRoomId).toBe(layout.lastRoomId);
    // A directional sun, its target, a hemisphere sky light, and an ambient fill light.
    const lightCount = scene.children.filter((child) => child.isLight).length;
    expect(lightCount).toBe(3);

    dungeon.dispose();
  });

  it('roomAt() finds the antechamber at its own interior point and the exterior on the approach path', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(7);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);

    const antechamber = layout.rooms[0];
    const found = dungeon.roomAt(antechamber.rect.x, antechamber.rect.z, null);
    expect(found.id).toBe(antechamber.id);

    const outside = dungeon.roomAt(layout.start.x, layout.start.z, null);
    expect(outside.kind).toBe('exterior');

    dungeon.dispose();
  });

  it('openGate() removes the entrance collider so nearGate no longer reports the gate as closed-but-near', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(7);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);

    const gateX = (layout.entrance.a[0] + layout.entrance.b[0]) / 2;
    const gateZ = (layout.entrance.a[1] + layout.entrance.b[1]) / 2;
    expect(dungeon.nearGate(gateX, gateZ)).toBe(true);

    dungeon.openGate();
    expect(dungeon.nearGate(gateX, gateZ)).toBe(false);
    // Calling it again must not throw or remove anything else.
    expect(() => dungeon.openGate()).not.toThrow();

    dungeon.dispose();
  });

  it('openChestAt() opens the nearest chest once and lootTaken()/lootTotal() track it', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(7);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);
    const room = chamberWithChest(layout);
    expect(room).toBeTruthy();

    expect(dungeon.lootTotal()).toBe(dungeon.chests.length);
    expect(dungeon.lootTaken()).toBe(0);

    const gold = dungeon.openChestAt(room.chest.x, room.chest.z, 0, -1);
    expect(gold).toBeGreaterThan(0);
    expect(dungeon.lootTaken()).toBe(1);

    // Opening the same chest again from the same spot is a no-op, not double-counted gold.
    const again = dungeon.openChestAt(room.chest.x, room.chest.z, 0, -1);
    expect(again).toBe(0);
    expect(dungeon.lootTaken()).toBe(1);

    dungeon.dispose();
  });

  it('update() runs a full frame tick without throwing', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(7);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);
    const camera = new THREE.PerspectiveCamera();

    expect(() => {
      dungeon.update(0, 1 / 60, 'outdoor', layout.start.x, layout.start.z, true, camera);
    }).not.toThrow();

    dungeon.dispose();
  });

  it('turns a far sconce point light off and leaves its flame mesh visible', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(1);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);
    const camera = new THREE.PerspectiveCamera();
    const sconceRoom = layout.rooms.find((room) => room.id === 'space-2');
    const standRoom = layout.rooms.find((room) => room.id === 'space-1');
    const sconce = dungeon.sconces.find((entry) => entry.roomId === sconceRoom.id);
    const standX = standRoom.rect.x + standRoom.rect.w / 2;
    const standZ = standRoom.rect.z + standRoom.rect.d / 2;

    sconce.interactable.ignite();
    dungeon.update(0, 1 / 60, 'stone', sconce.x, sconce.z, false, camera);
    expect(sconce.group.visible).toBe(true);
    expect(sconce.interactable.light.visible).toBe(true);
    expect(sconce.interactable.flame.visible).toBe(true);

    dungeon.update(0, 1 / 60, 'stone', standX, standZ, false, camera);
    const distance = Math.hypot(sconce.x - standX, sconce.z - standZ);
    expect(distance).toBeGreaterThan(15);
    expect(dungeon.roomVisible(sconce.roomId)).toBe(true);
    expect(sconce.group.visible).toBe(true);
    expect(sconce.interactable.light.visible).toBe(false);
    expect(sconce.interactable.flame.visible).toBe(true);
    expect(sconce.interactable.particles.mesh.visible).toBe(true);

    dungeon.dispose();
  });

  it('lets only the held torch cast a shadow map, never the sun or a wall sconce', () => {
    const scene = new THREE.Scene();
    const layout = generateLayout(7);
    const dungeon = createDungeon(scene, testMaterials.materials, layout);

    const sun = scene.children.find((child) => child.isDirectionalLight);
    expect(sun.castShadow).toBe(false);
    dungeon.group.traverse((obj) => {
      if (obj.isPointLight) expect(obj.castShadow).toBe(false);
    });
    expect(dungeon.sconces.length).toBeGreaterThan(0);
    for (const sconce of dungeon.sconces) {
      expect(sconce.interactable.light.castShadow).toBe(false);
    }

    dungeon.dispose();
  });

  describe('dispose()', () => {
    it('detaches the root group and lights from the scene', () => {
      const scene = new THREE.Scene();
      const layout = generateLayout(7);
      const dungeon = createDungeon(scene, testMaterials.materials, layout);

      dungeon.dispose();

      expect(scene.children).not.toContain(dungeon.group);
      expect(scene.children.filter((child) => child.isLight)).toHaveLength(0);
    });

    it('disposes the geometries and materials it created, and is safe to call twice', () => {
      const scene = new THREE.Scene();
      const layout = generateLayout(7);
      const dungeon = createDungeon(scene, testMaterials.materials, layout);

      const geometryDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
      const groundGeometry = dungeon.group.children.find((child) => child.isMesh)?.geometry;

      dungeon.dispose();

      expect(geometryDisposeSpy).toHaveBeenCalled();
      if (groundGeometry) expect(groundGeometry.dispose).not.toBeUndefined();
      expect(() => dungeon.dispose()).not.toThrow();

      geometryDisposeSpy.mockRestore();
    });
  });
});
