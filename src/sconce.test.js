// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCONCE_LIGHT_CULL_DISTANCE, createWallSconce } from './sconce.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

let testMaterials;
const built = [];

beforeEach(() => {
  testMaterials = withTestMaterials();
});

afterEach(() => {
  for (const sconce of built) disposeSconce(sconce);
  built.length = 0;
  testMaterials.dispose();
});

function disposeSconce(sconce) {
  sconce.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const materials = obj.material ? [].concat(obj.material) : [];
    for (const material of materials) {
      if (!material.userData?.shared) material.dispose();
    }
  });
}

function makeSconce() {
  const sconce = createWallSconce(testMaterials.materials, {
    x: 0,
    z: 0,
    nx: 1,
    nz: 0,
    roomId: 'space-2',
  });
  built.push(sconce);
  return sconce;
}

describe('createWallSconce', () => {
  it('never casts a shadow map from the wall light', () => {
    const sconce = makeSconce();
    expect(sconce.interactable.light.isPointLight).toBe(true);
    expect(sconce.interactable.light.castShadow).toBe(false);
  });

  it('drops the point light past the cull distance while the flame mesh stays lit', () => {
    expect(SCONCE_LIGHT_CULL_DISTANCE).toBeGreaterThanOrEqual(15);
    expect(SCONCE_LIGHT_CULL_DISTANCE).toBeLessThanOrEqual(20);

    const sconce = makeSconce();
    const { interactable } = sconce;
    interactable.ignite();

    expect(interactable.light.visible).toBe(true);
    expect(interactable.flame.visible).toBe(true);
    expect(interactable.particles.mesh.visible).toBe(true);

    interactable.cullLight(true);

    expect(interactable.light.visible).toBe(false);
    expect(interactable.light.castShadow).toBe(false);
    expect(interactable.flame.visible).toBe(true);
    expect(interactable.particles.mesh.visible).toBe(true);
    for (const layer of interactable.particles.mesh.children) {
      expect(layer.visible).toBe(true);
    }

    interactable.cullLight(false);
    expect(interactable.light.visible).toBe(true);
    expect(interactable.flame.visible).toBe(true);
  });

  it('flickers the wall light from the shared fire description', () => {
    const sconce = makeSconce();
    const { interactable } = sconce;
    interactable.ignite();
    interactable.update(0.05, 0.2);
    const first = interactable.light.intensity;
    interactable.update(0.05, 0.9);
    expect(first).toBeGreaterThan(0);
    expect(interactable.light.intensity).not.toBeCloseTo(first);
    expect(interactable.light.castShadow).toBe(false);
    expect(interactable.light.distance).toBe(10);
    expect(interactable.particles.uniforms.uFireColor0.value.getHexString()).toBe('fff29e');
  });
});
