// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMaterials } from './materials.js';
import { installFakeCanvas } from './test-utils/fakeCanvas.js';

let restoreCanvas;

beforeEach(() => {
  restoreCanvas = installFakeCanvas();
});

afterEach(() => {
  restoreCanvas();
});

describe('createMaterials', () => {
  it('builds themed wall/floor surfaces, falling back to stone for unknown themes', () => {
    const materials = createMaterials();
    expect(materials.surface('wood')).toBeTruthy();
    expect(materials.surface('cave')).toBeTruthy();
    expect(materials.surface('not-a-real-theme')).toBe(materials.surface('stone'));
    expect(materials.floor('wood')).toBeTruthy();
    expect(materials.floor('not-a-real-theme')).toBe(materials.floor('stone'));
    expect(materials.surface('stone').map).toBeTruthy();
    expect(materials.floor('stone').map).toBe(materials.surface('stone').map);
    expect(materials.ceilingFor('stone').map).toBe(materials.surface('stone').map);
    expect(materials.ceilingFor('wood').map).toBe(materials.surface('wood').map);
    expect(materials.ceilingFor('wood').map).not.toBe(materials.surface('stone').map);
    expect(materials.floor('wood').map).toBe(materials.surface('wood').map);
    expect(materials.ceilingFor('cave').map).toBe(materials.surface('cave').map);
    expect(materials.floor('cave').map).toBe(materials.surface('cave').map);
    expect(materials.ceilingFor('not-a-real-theme')).toBe(materials.ceilingFor('stone'));
  });

  it('flags every reusable prop/surface material as shared, so per-mesh disposal skips them', () => {
    const materials = createMaterials();
    for (const key of ['surface', 'floor']) {
      expect(materials[key]('stone').userData.shared).toBe(true);
    }
    for (const key of ['plank', 'dirt', 'ceiling', 'ceilingCave', 'brazier', 'bowl', 'core', 'metal', 'armor', 'leather', 'chain', 'iron', 'gold', 'ember', 'rust', 'flame', 'eye', 'socket', 'bone', 'boneHot', 'boneFlash']) {
      expect(materials[key].userData.shared).toBe(true);
    }
  });

  it('fadeVariant() clones a material into an independent, transparent twin', () => {
    const materials = createMaterials();
    const twin = materials.fadeVariant(materials.bone);
    expect(twin).not.toBe(materials.bone);
    expect(twin.transparent).toBe(true);
    expect(twin.opacity).toBe(1);
    // The twin is its own object, so fading it does not touch the shared source material.
    twin.opacity = 0.2;
    expect(materials.bone.opacity).toBe(1);
  });

  it('dispose() disposes every owned material and texture, and is safe to call twice', () => {
    const materials = createMaterials();
    const boneDispose = vi.spyOn(materials.bone, 'dispose');
    const metalMapDispose = vi.spyOn(materials.metal.map, 'dispose');

    materials.dispose();
    expect(boneDispose).toHaveBeenCalledTimes(1);
    expect(metalMapDispose).toHaveBeenCalledTimes(1);

    expect(() => materials.dispose()).not.toThrow();
    expect(boneDispose).toHaveBeenCalledTimes(1);
  });
});
