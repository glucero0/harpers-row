// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPlaces } from './places.js';
import { generateLayout } from './rooms.js';
import { withTestMaterials } from './test-utils/testMaterials.js';
import { connectWorld } from './world.js';

function syntheticHub() {
  const samples = [];
  for (let step = 0; step <= 6; step += 1) {
    const t = step / 6;
    samples.push({ x: 12 + t * 18, z: 0, half: 4, t, nx: 0, nz: 1 });
  }
  const end = samples[samples.length - 1];
  const day = {
    clearColor: '#c5d0d6',
    ambientLightIntensity: 0.55,
    fog: { color: '#c5d0d6', near: 28, far: 110, density: 0.009 },
    skyboxVisible: true,
  };
  return {
    areaName: 'The Hub',
    hubArea: {
      radius: 14,
      plaza: [[-14, -14], [14, -14], [14, 14], [-14, 14]],
      respawn: { x: 0, y: 0, z: 4, yaw: 0 },
      spokes: [{
        name: 'path-0',
        samples,
        polygon: [[12, 4], [30, 4], [30, -4], [12, -4]],
        end: { x: end.x, z: end.z, yaw: 0 },
        transitionOut: 'to-path-0',
        transitionIn: 'from-path-0',
      }],
    },
    transitions: [
      {
        id: 'to-path-0',
        sourceZoneId: 'hub',
        targetZoneId: 'path-0',
        targetSpawnPoint: null,
        environmentalPreset: day,
        volume: { minX: end.x - 3, maxX: end.x + 3, minZ: -3, maxZ: 3 },
      },
      {
        id: 'from-path-0',
        sourceZoneId: 'path-0',
        targetZoneId: 'hub',
        targetSpawnPoint: { x: 20, y: 0, z: 0, rotationY: Math.PI },
        environmentalPreset: day,
        volume: null,
      },
    ],
    trees: [{ x: 8, z: 8, scale: 1, height: 4 }],
    scenery: [],
  };
}

describe('createPlaces', () => {
  it('starts at the hub, can show a location, and dispose cleans the scene twice', () => {
    const testMaterials = withTestMaterials();
    const scene = new THREE.Scene();
    const baseline = scene.children.length;
    const plan = connectWorld(syntheticHub(), [{ name: 'one.json', data: generateLayout(3) }]);
    const places = createPlaces(scene, testMaterials.materials, plan);
    places.show('hub');

    const hub = places.dungeon();
    expect(hub.kind).toBe('hub');
    expect(hub.roomAt(0, 4).theme).toBe('outdoor');
    expect(scene.children.filter((child) => child.isLight).length).toBeGreaterThan(0);

    places.show(0);
    const location = places.dungeon();
    expect(location.kind).toBeUndefined();
    expect(hub.group.visible).toBe(false);
    expect(location.group.visible).toBe(true);
    const loop = plan.bindings[0].layout.exitLoop;
    const sample = loop.samples.find((item) => item.s > 20);
    expect(location.floorY(sample.x, sample.z, location.roomAt(sample.x, sample.z, null, sample.y))).toBeCloseTo(sample.y, 4);
    expect(places.skeletons().list.length).toBeGreaterThan(0);

    places.show('hub');
    expect(places.dungeon().kind).toBe('hub');
    expect(places.skeletons().list).toEqual([]);

    places.dispose();
    places.dispose();
    expect(scene.children.length).toBe(baseline);
    testMaterials.dispose();
  });
});
