// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import hubFile from '../content/areas/campfireHub.json';
import { createHub } from './hub.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

let testMaterials;

afterEach(() => {
  testMaterials?.dispose();
  testMaterials = undefined;
});

function bareHub() {
  const pit = hubFile.structure.parts.find((part) => part.type === 'fire-pit');
  return {
    radius: 12,
    plaza: [[-4, -4], [4, -4], [4, 4], [-4, 4]],
    spokes: [],
    trees: [],
    scenery: [],
    transitions: [],
    areaName: 'Test Hub',
    respawn: { x: 0, y: 0, z: 0, yaw: 0 },
    labels: { hub: 'Test Hub' },
    structure: { parts: [pit] },
  };
}

describe('createHub', () => {
  it('burns the campfire from the shared fire description and can be disposed twice', () => {
    testMaterials = withTestMaterials();
    const scene = new THREE.Scene();
    const hub = createHub(scene, testMaterials.materials, bareHub());
    const light = hub.group.getObjectByName('fire-light');
    const flames = hub.group.getObjectByName('fire-flames');
    expect(light.isPointLight).toBe(true);
    expect(light.color.getHexString()).toBe('ff7a18');
    expect(light.distance).toBe(8);
    expect(light.intensity).toBe(2.5);
    expect(light.castShadow).toBe(false);
    expect(flames.visible).toBe(true);
    for (const layer of flames.children) expect(layer.visible).toBe(true);
    hub.update(0);
    const first = light.intensity;
    hub.update(0.4);
    expect(flames.children[0].material.uniforms.uTime.value).toBe(0.4);
    expect(light.intensity).toBeGreaterThan(0);
    expect(light.intensity).not.toBeCloseTo(first);
    const ground = hub.group.children.find((child) => child.geometry?.type === 'CircleGeometry');
    const groundUv = ground.geometry.attributes.uv;
    let minU = Infinity;
    let maxU = -Infinity;
    for (let i = 0; i < groundUv.count; i += 1) {
      minU = Math.min(minU, groundUv.getX(i));
      maxU = Math.max(maxU, groundUv.getX(i));
    }
    expect(maxU - minU).toBeGreaterThan(10);
    const geometryDispose = vi.spyOn(flames.children[0].geometry, 'dispose');
    hub.dispose();
    hub.dispose();
    expect(geometryDispose).toHaveBeenCalled();
    expect(scene.children.includes(hub.group)).toBe(false);
  });
});
