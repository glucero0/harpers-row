// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import maceFile from './gear/mace.json';
import { withTestMaterials } from './test-utils/testMaterials.js';
import { createMace } from './mace.js';

let testMaterials;

afterEach(() => {
  testMaterials?.dispose();
  testMaterials = undefined;
});

describe('createMace', () => {
  it('builds the mace from mace.json and disposes what it created', () => {
    testMaterials = withTestMaterials();
    const { materials } = testMaterials;
    const mace = createMace(materials);
    const head = mace.getObjectByName('head');
    expect(mace.name).toBe('mace');
    expect(head.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(head.geometry.parameters.radius).toBeCloseTo(0.0819);
    expect(head.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(head.material).not.toBe(materials.rust);
    expect(mace.rotation.x).toBeCloseTo(15 * Math.PI / 180);
    expect(mace.rotation.z).toBeCloseTo(25 * Math.PI / 180);
    const sharedDispose = vi.spyOn(materials.leather, 'dispose');
    const geometryDispose = vi.spyOn(head.geometry, 'dispose');
    const ownedDispose = vi.spyOn(head.material, 'dispose');
    mace.userData.dispose();
    mace.userData.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(ownedDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
  });

  it('refuses a raw json object that has not been parsed', () => {
    testMaterials = withTestMaterials();
    expect(() => createMace(testMaterials.materials, maceFile)).toThrow(/parsed mace description/);
  });
});
