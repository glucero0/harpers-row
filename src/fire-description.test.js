import { test, expect } from 'vitest';
import enhanced from '../content/areas/campfireHubEnhanced.json';
import hub from '../content/areas/campfireHub.json';
import { FireDescriptionError, fireWobble, parseFireEmanation } from './fire-description.js';

function pit(file) {
  return file.structure.parts.find((part) => part.type === 'fire-pit');
}

test('the campfire files describe the same emanating fire', () => {
  const fromEnhanced = parseFireEmanation(pit(enhanced));
  const fromHub = parseFireEmanation(pit(hub));
  expect(fromEnhanced).toEqual(fromHub);
  expect(fromEnhanced.preset).toBe('campfire_flames');
  expect(fromEnhanced.emitter).toEqual({
    rate: 30,
    lifetime: [0.6, 1.2],
    colorStart: '#ffaa22',
    colorEnd: '#220500',
    blendMode: 'additive',
  });
  expect(fromEnhanced.light).toEqual({
    color: '#ff7a18',
    intensity: 2.5,
    distance: 8,
    flicker: { speed: 12, variance: 0.4 },
  });
  expect(fromEnhanced.quads).toEqual({ fire: 27, smoke: 10, embers: 8 });
});

test('a shader string on the emitter is dropped rather than kept', () => {
  const data = structuredClone(pit(enhanced));
  data.vfx.emitter.fragmentShader = 'EVIL_SHADER';
  data.prefab = 'prefabs/campfire_lit.glb';
  const parsed = parseFireEmanation(data);
  expect(parsed.emitter.fragmentShader).toBeUndefined();
  expect(JSON.stringify(parsed)).not.toContain('EVIL_SHADER');
  expect(JSON.stringify(parsed)).not.toContain('prefab');
});

test('rejects colors, presets, and ranges that are not the fire description', () => {
  const data = structuredClone(pit(hub));
  data.vfx.emitter.colorStart = 'orange';
  expect(() => parseFireEmanation(data)).toThrow(FireDescriptionError);
  data.vfx.emitter.colorStart = '#ffaa22';
  data.vfx.preset = 'eval';
  expect(() => parseFireEmanation(data)).toThrow(/preset/);
  data.vfx.preset = 'campfire_flames';
  data.vfx.emitter.rate = 1000;
  expect(() => parseFireEmanation(data)).toThrow(/rate/);
  data.vfx.emitter.rate = 30;
  data.light.type = 'spot';
  expect(() => parseFireEmanation(data)).toThrow(/point/);
  data.light.type = 'point';
  data.vfx.emitter.lifetime = [1.2, 0.6];
  expect(() => parseFireEmanation(data)).toThrow(/lifetime/);
});

test('a foreign prototype is rejected and does not pollute Object', () => {
  const data = structuredClone(pit(hub));
  Object.setPrototypeOf(data.vfx, { polluted: true });
  expect(() => parseFireEmanation(data)).toThrow(FireDescriptionError);
  expect(Object.prototype.polluted).toBeUndefined();
});

test('flicker stays inside the variance and is not a flat line', () => {
  let low = Infinity;
  let high = -Infinity;
  for (let step = 0; step < 24; step += 1) {
    const wobble = fireWobble(12, 0.4, step * 0.07);
    expect(Math.abs(wobble)).toBeLessThanOrEqual(0.4 + 1e-9);
    low = Math.min(low, wobble);
    high = Math.max(high, wobble);
  }
  expect(high - low).toBeGreaterThan(0.05);
});
