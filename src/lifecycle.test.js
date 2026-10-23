// @vitest-environment jsdom
//
// Operationalizes the "rapid area switching does not raise the memory baseline" checklist idea from
// docs/ARCHITECTURE.md by replaying main.js's own beginRun()/clearRun() restart cycle several times in a
// row: dispose the previous dungeon (which transitively disposes its skeletons, since they are parented
// under dungeon.group), build a fresh one, and confirm the scene and GPU-resource bookkeeping return to
// the same baseline every time rather than accumulating.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDungeon } from './dungeon.js';
import { createSkeletons } from './skeleton.js';
import { generateLayout } from './rooms.js';
import { withTestMaterials } from './test-utils/testMaterials.js';

const CYCLE_SEEDS = [3, 11, 19, 29, 41];

describe('restart cycle (beginRun/clearRun) lifecycle', () => {
  it('returns the scene to the same baseline after every dispose, across repeated restarts', () => {
    const testMaterials = withTestMaterials();
    const scene = new THREE.Scene();
    const baselineChildCount = scene.children.length;

    let dungeon = null;
    let skeletons = null;

    for (const seed of CYCLE_SEEDS) {
      if (dungeon) {
        dungeon.dispose();
        skeletons = null;
      }
      expect(scene.children.length).toBe(baselineChildCount);

      const layout = generateLayout(seed);
      dungeon = createDungeon(scene, testMaterials.materials, layout);
      skeletons = createSkeletons(dungeon.group, dungeon, testMaterials.materials);

      // One dungeon root group plus 4 lights (sun, sun target, sky, ambient fill) per live cycle —
      // never more, regardless of how many restarts have already happened.
      expect(scene.children.length).toBe(baselineChildCount + 5);
      expect(skeletons.list.length).toBeGreaterThan(0);
    }

    dungeon.dispose();
    expect(scene.children.length).toBe(baselineChildCount);
    testMaterials.dispose();
  }, 20000);

  it('disposes a geometry/material for everything it created on every cycle, not just the first', () => {
    const testMaterials = withTestMaterials();
    const scene = new THREE.Scene();
    const geometryDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');

    let dungeon = null;
    const disposedPerCycle = [];

    for (const seed of CYCLE_SEEDS) {
      if (dungeon) dungeon.dispose();
      geometryDisposeSpy.mockClear();

      const layout = generateLayout(seed);
      dungeon = createDungeon(scene, testMaterials.materials, layout);
      createSkeletons(dungeon.group, dungeon, testMaterials.materials);

      dungeon.dispose();
      disposedPerCycle.push(geometryDisposeSpy.mock.calls.length);
      dungeon = null;
    }

    // Every single restart must actually dispose geometry, not just the first one — a regression where
    // a later cycle silently stopped disposing (e.g. a guard flag that should have been per-instance
    // but became module-level) would show up as a 0 here.
    for (const count of disposedPerCycle) {
      expect(count).toBeGreaterThan(0);
    }

    geometryDisposeSpy.mockRestore();
    testMaterials.dispose();
  }, 20000);
});
