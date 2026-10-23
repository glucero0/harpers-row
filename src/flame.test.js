import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import enhanced from '../public/campfireHubEnhanced.json';
import { parseFireEmanation } from './fire-description.js';
import { createFlamePoints, disposeFlamePoints } from './flame.js';

describe('createFlamePoints', () => {
  it('builds the campfire emitter and disposes it twice', () => {
    const pit = enhanced.structure.parts.find((part) => part.type === 'fire-pit');
    const emanation = parseFireEmanation(pit);
    const flame = createFlamePoints({ emanation });
    expect(flame.uniforms.uFireColor0.value.getHexString()).toBe('ffaa22');
    expect(flame.uniforms.uFireColor1.value.getHexString()).toBe('220500');
    expect(flame.uniforms.uFireLife.value.toArray()).toEqual([0.6, 1.2]);
    expect(flame.uniforms.uFireRise.value).toBeGreaterThan(1);
    expect(flame.fire.material.blending).toBe(THREE.AdditiveBlending);
    expect(flame.smoke.material.blending).toBe(THREE.NormalBlending);
    expect(flame.fire.geometry.index.count).toBe(27 * 6);

    const muted = createFlamePoints({
      emanation: parseFireEmanation({
        vfx: { ...pit.vfx, emitter: { ...pit.vfx.emitter, blendMode: 'normal' } },
        light: pit.light,
      }),
    });
    expect(muted.fire.material.blending).toBe(THREE.NormalBlending);

    const geometryDispose = vi.spyOn(flame.fire.geometry, 'dispose');
    const materialDispose = vi.spyOn(flame.fire.material, 'dispose');
    disposeFlamePoints(flame);
    disposeFlamePoints(flame);
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    disposeFlamePoints(muted);
  });
});
