import { createMaterials } from '../materials.js';

// Builds the *real* production material set for specs that consume it (dungeon, skeleton, player)
// instead of a hand-rolled mock. A hand mock would silently drift out of sync as those modules grow to
// expect new material properties; this stays representative for free. Requires a jsdom environment
// (`// @vitest-environment jsdom` at the top of the spec file) — `setupJsdomCanvas.js` (wired up as a
// global Vitest setup file) stubs `<canvas>` 2D rendering so `createMaterials()` can run.
export function withTestMaterials() {
  const materials = createMaterials();
  return {
    materials,
    dispose() {
      materials.dispose();
    },
  };
}
