// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import torchFile from './gear/torch.json';
import { parseGearDescription } from './gear-description.js';
import { withTestMaterials } from './test-utils/testMaterials.js';
import { createHeldTorch, flickerTorch } from './torch.js';

let testMaterials;

afterEach(() => {
  testMaterials?.dispose();
  testMaterials = undefined;
});

describe('createHeldTorch', () => {
  it('builds the held torch from torch.json', () => {
    testMaterials = withTestMaterials();
    const torch = createHeldTorch(testMaterials.materials);
    const shaft = torch.root.getObjectByName('shaft');
    expect(torch.root.name).toBe('torch');
    expect(shaft).toBeTruthy();
    expect(shaft.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(shaft.castShadow).toBe(false);
    expect(torch.tip.name).toBe('TorchTipSocket');
    expect(torch.tip.position.y).toBeCloseTo(0.6144);
    expect(torch.light.color.getHexString()).toBe('ff7a18');
    expect(torch.light.distance).toBe(8);
    expect(torch.light.decay).toBe(2);
    expect(torch.light.castShadow).toBe(true);
    expect(torch.light.shadow.camera.layers.isEnabled(1)).toBe(true);
    expect(torch.light.shadow.camera.layers.isEnabled(2)).toBe(true);
    expect(torch.flame.uniforms.uFireColor0.value.getHexString()).toBe('ffaa22');
    expect(torch.flame.uniforms.uFireColor1.value.getHexString()).toBe('220500');
    expect(torch.flame.fire.material.blending).toBe(THREE.AdditiveBlending);
    flickerTorch(torch.light, 0.2, 0);
    expect(torch.light.intensity).toBeGreaterThan(0);
    expect(torch.light.intensity).toBeLessThan(8);
    const geometryDispose = vi.spyOn(shaft.geometry, 'dispose');
    const materialDispose = vi.spyOn(shaft.material, 'dispose');
    torch.dispose();
    torch.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('sizes the flame from the shared fire emitter', () => {
    testMaterials = withTestMaterials();
    const data = structuredClone(torchFile);
    const tip = data.parts.find((part) => part.name === 'TorchTipSocket');
    tip.vfx.emitter.rate = 8;
    tip.vfx.emitter.lifetime = [0.5, 0.5];
    const torch = createHeldTorch(testMaterials.materials, parseGearDescription(data));
    expect(torch.flame.fire.geometry.index.count).toBe(24);
    torch.dispose();
  });

  it('refuses a raw json object that has not been parsed', () => {
    testMaterials = withTestMaterials();
    expect(() => createHeldTorch(testMaterials.materials, torchFile)).toThrow(/parsed torch description/);
  });

  it('update() moves the flame and dispose() is safe twice', () => {
    testMaterials = withTestMaterials();
    const torch = createHeldTorch(testMaterials.materials);
    torch.update(0);
    const first = torch.light.intensity;
    torch.update(0.4);
    expect(torch.flame.uniforms.uTime.value).toBeCloseTo(0.4);
    expect(torch.light.intensity).not.toBe(first);
    torch.dispose();
    expect(() => torch.dispose()).not.toThrow();
    expect(() => torch.update(0.1)).not.toThrow();
  });
});
