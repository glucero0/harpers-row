// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gearById } from './gear-description.js';
import { createGear } from './gear.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

let testMaterials;

afterEach(() => {
  testMaterials?.dispose();
  testMaterials = undefined;
});

describe('createGear', () => {
  it('builds a shield for the left hand and a bow for the right', () => {
    testMaterials = withTestMaterials();
    const shield = createGear(gearById.shield);
    const bow = createGear(gearById.bow);
    expect(shield.hand).toBe('left');
    expect(shield.combat).toBeNull();
    expect(shield.root.getObjectByName('board').geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(bow.hand).toBe('right');
    expect(bow.combat.range).toBe(14);
    expect(bow.root.getObjectByName('stave').geometry).toBeInstanceOf(THREE.TubeGeometry);
    const board = shield.root.getObjectByName('board');
    const geometryDispose = vi.spyOn(board.geometry, 'dispose');
    shield.dispose();
    shield.dispose();
    bow.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(() => shield.update(0.1)).not.toThrow();
  });
});
