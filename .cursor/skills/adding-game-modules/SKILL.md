---
name: adding-game-modules
description: >-
  Guides adding or changing a gameplay system, entity, or content module (enemy types, chamber themes,
  areas, UI/input/audio systems) in Dungeon Combater while keeping the codebase modular, reusable, and
  regression-safe. Use when the user asks to add a feature, enemy, area, weapon, system, or otherwise
  extend or modify src/*.js gameplay code in this project.
---

# Adding Game Modules (Dungeon Combater)

Full contract: [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md). Enforced rule:
[.cursor/rules/game-architecture.mdc](../../rules/game-architecture.mdc).

## Workflow

1. **Find the right layer.** Config/math → `balance.js`/`geometry.js`. World generation → `rooms.js`.
   Rendering/content → `dungeon.js`, `materials.js`, `flame.js`, `torch.js`, `sconce.js`, `dust.js`,
   `player-body.js`. Render budget (pixel-ratio cap) → `pixel-ratio.js`, applied from `main.js`.
   Entities → `player.js`, `skeleton.js`. Systems → `input.js`, `audio.js`, `ui.js`, `impact.js`. New
   content is a new file in the matching layer, not a special case in `main.js`.

2. **Extend, don't break.** Before changing an existing factory's signature or return shape, check
   whether a new optional parameter or an added field on the returned object gets the same result. If a
   breaking change really is necessary, update every call site and every test in the same change.

3. **Follow the factory + lifecycle pattern.** Write `createX(...)` returning a plain object with closure
   state — no classes. Implement only the hooks the module needs (`update`, `dispose`, `unload`, ...).
   Any module owning its own THREE geometry/material/texture or a `window`/`document` listener needs an
   idempotent `dispose()` (guard with a `disposed` flag). No allocations inside `update()`'s hot path —
   reuse scratch vectors/arrays declared in closure scope, and pool spawned/destroyed objects.

4. **Add a spec.** New or changed modules get a `*.test.js` next to the source file, run via
   `npm test` (Vitest). Specs touching `window`/`document` need `// @vitest-environment jsdom` at the
   top. Prefer real collaborators over mocks: build a real dungeon via
   `generateLayout()` + `createDungeon()`, and real materials via
   `withTestMaterials()` from `src/test-utils/testMaterials.js`, instead of hand-rolled stand-ins that
   can drift from the real API. Cover at minimum: the module's `update()` behavior, and — if it has one —
   that `dispose()` disposes what it created and is safe to call twice.

5. **Verify before calling it done.**
   ```
   npm test
   npm run build
   ```
   Both must pass. For a change that touches rendering, also smoke-test with `npm run dev`.

6. **Update docs if the shape of things changed.** If the change is user-visible (README) or changes the
   module map / lifecycle contract (`docs/ARCHITECTURE.md`), update that file in the same change.

## Checklist

```
- [ ] Implemented in the correct existing layer (or a clearly justified new file in that layer)
- [ ] No ES6 class introduced; factory + closure pattern used
- [ ] Extended an existing factory's shape rather than breaking it (or updated every call site + test)
- [ ] update() has no per-frame allocations; pooled objects reused where applicable
- [ ] Repeated props use a shared BatchedMesh/InstancedMesh; pixel ratio stays capped; extra point lights do not cast shadows
- [ ] dispose()/listener cleanup added if the module owns THREE resources or window/document listeners
- [ ] New *.test.js added or an existing one extended, covering update() and dispose()
- [ ] npm test and npm run build both pass
- [ ] README.md / docs/ARCHITECTURE.md updated if user-visible or architectural
```
