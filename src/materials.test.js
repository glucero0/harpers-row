// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DIRT_TILE_METRES, STONE_COURSES, STONE_TILE_UNITS, createMaterials, sampleStone, stoneBlockAt } from './materials.js';
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

  it('builds stone as large blocks several feet across, some roughly hewn', () => {
    const materials = createMaterials();
    expect(STONE_TILE_UNITS).toBe(22);
    expect(materials.ruin.uniforms.ruinScale.value).toBeCloseTo(1 / STONE_TILE_UNITS);
    const span = STONE_COURSES.reduce((sum, course) => sum + course.span, 0);
    expect(span).toBeCloseTo(1, 5);

    let y = 0;
    let rough = 0;
    let dressed = 0;
    for (const course of STONE_COURSES) {
      expect(course.cuts[0]).toBe(0);
      expect(course.cuts.at(-1)).toBe(1);
      expect(course.seeds[0]).toBe(course.seeds.at(-1));
      expect(course.seeds).toHaveLength(course.cuts.length);
      const midV = y + course.span / 2;
      for (let cut = 0; cut < course.cuts.length - 1; cut += 1) {
        const midU = (course.cuts[cut] + course.cuts[cut + 1]) / 2;
        const block = stoneBlockAt(midU, midV);
        expect(block.width).toBeGreaterThanOrEqual(4);
        expect(block.width).toBeLessThanOrEqual(10);
        expect(block.height).toBeGreaterThanOrEqual(4);
        expect(block.height).toBeLessThanOrEqual(11);
        const foot = 1 / STONE_TILE_UNITS;
        const neighbor = stoneBlockAt(midU + foot, midV + foot * 0.5);
        expect(neighbor.course).toBe(block.course);
        expect(neighbor.column).toBe(block.column);
        if (block.rough) rough += 1;
        else dressed += 1;
      }
      y += course.span;
    }
    expect(rough).toBeGreaterThan(0);
    expect(dressed).toBeGreaterThan(0);

    const here = stoneBlockAt(0.37, 0.82);
    const tiled = stoneBlockAt(0.37 + 3, 0.82 - 2);
    expect(tiled.course).toBe(here.course);
    expect(tiled.column).toBe(here.column);
    expect(tiled.localX).toBeCloseTo(here.localX, 5);
    expect(tiled.localY).toBeCloseTo(here.localY, 5);

    let courseChanges = 0;
    let previous = null;
    for (let foot = 0; foot <= 10; foot += 0.25) {
      const block = stoneBlockAt(0.41, foot / STONE_TILE_UNITS);
      const id = block.course * 8 + block.column;
      if (previous !== null && id !== previous) courseChanges += 1;
      previous = id;
    }
    expect(courseChanges).toBeLessThanOrEqual(2);

    let darkest = 255 * 3;
    let lightest = 0;
    for (let step = 0; step <= 64; step += 1) {
      const sample = sampleStone(step / 64, 6 / STONE_TILE_UNITS / 2);
      const luminance = sample.color[0] + sample.color[1] + sample.color[2];
      darkest = Math.min(darkest, luminance);
      lightest = Math.max(lightest, luminance);
    }
    expect(lightest - darkest).toBeGreaterThan(70);

    const fragment = [
      '#include <common>',
      '#include <map_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <normal_fragment_begin>',
      '#include <fog_fragment>',
    ].join('\n');
    for (const material of [materials.surface('stone'), materials.floor('stone'), materials.ceilingFor('stone')]) {
      const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <begin_vertex>',
        fragmentShader: fragment,
      };
      material.onBeforeCompile(shader);
      expect(shader.fragmentShader).toContain('ruinMapPos');
      expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    }
    const woodShader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: fragment,
    };
    materials.surface('wood').onBeforeCompile(woodShader);
    expect(woodShader.fragmentShader).toContain('#include <map_fragment>');
    expect(woodShader.fragmentShader).not.toContain('ruinMapPos');
    materials.dispose();
  });

  it('builds dirt as tiling soil with bump and roughness', () => {
    const materials = createMaterials();
    expect(DIRT_TILE_METRES).toBe(4);
    expect(materials.dirt.map.wrapS).toBe(THREE.RepeatWrapping);
    expect(materials.dirt.map.wrapT).toBe(THREE.RepeatWrapping);
    expect(materials.dirt.bumpMap).toBeTruthy();
    expect(materials.dirt.bumpScale).toBeCloseTo(0.18);
    expect(materials.dirt.roughnessMap).toBeTruthy();
    expect(materials.dirt.roughness).toBe(1);
    expect(materials.dirt.color.getHex()).toBe(0x8a6a48);
    materials.dispose();
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
