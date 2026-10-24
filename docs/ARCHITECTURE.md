# Architecture

Harpers Row is built from small factory functions — `createX(...)` calls that return a plain
object closing over private state (meshes, materials, vectors, flags). There is no class hierarchy and
none is planned: closures already give each module private state and a stable public shape, with far
less risk than retrofitting inheritance onto ~5,000 lines of working gameplay code.

This document is the contract every module (existing or new) is expected to follow, and the map of how
today's files already satisfy it. `.cursor/rules/game-architecture.mdc` enforces the same rules for AI-
assisted changes.

## Module map

| Layer | Files | Responsibility |
| --- | --- | --- |
| Config / math | `balance.js`, `geometry.js`, `pixel-ratio.js`, `fire-description.js`, `gear-description.js`, `content/creatures/skeletelWarrior.json` | Pure constants and pure functions. No THREE, no DOM. Skeletal warrior name, health, damage, speed, and weapons are read from `content/creatures/skeletelWarrior.json` by `balance.js`. `fire-description.js` reads the shared flame block (particle emitter and flickering point light) used by campfires, torches, and sconces. `gear-description.js` reads the equipment files in `content/gear/` the same way: known fields only, finite numbers, no evaluated text. Fully unit-testable, and fully unit-tested. |
| World generation | `rooms.js`, `ancientRuinsData.json`, `location.js` | `location.js` (pure, no THREE, no DOM) validates and prepares a generator JSON file (such as `seed3000.json`): it clamps numbers, caps room, prop, and scenery counts, and builds the room graph (`layout.graph`: neighbors, door table, a BFS next-hop table, and per-room visibility sets), the floors, and the entrance, exit, and last room ids. It also measures the location (`measureLocation`: enemy spawns, and chests in rooms with both a sconce and a chest) and computes `completionPercent`, which reads 100 only when everything is done. Bad input throws `LocationError` with a short message. `rooms.js` is a pure procedural layout generator (no THREE, no DOM) kept for tests. The playable Ancient Ruins are the baked `ancientRuinsData.json`. That file owns the rooms, doors, approach, and the outdoor shell (`approach.shell`: facade height, flank height, cornice). `ancientRuinsLayout()` deep-copies that file, then sets `enemyName` from `content/creatures/skeletelWarrior.json`. Loading the ruins does not call `generateLayout()`. |
| Content / rendering | `dungeon.js`, `hub.js`, `places.js`, `path-mesh.js`, `materials.js`, `ruin-material.js`, `subsurface.js`, `flame.js`, `gear.js`, `item-mesh.js`, `sconce.js`, `dust.js`, `player-body.js`, `props.js`, `content/gear/` | Turn config + layout data into THREE objects and own their GPU resources. `hub.js` draws the plaza, spokes, and structure. `places.js` builds the hub and every connected location and shows one at a time, removing the hidden place's lights. `path-mesh.js` is the sloped path ribbon. Multi-floor locations are built one story at a time. Colliders carry an optional `story`, and `lineOfSight` and `resolveBody` take an optional `y`, so overlapping floors do not block each other. `content/gear/*.json` describes each held item. `gear.js` builds any of them. The torch's tip, and a hub fire-pit's `vfx` and `light`, are the same flame description. Guard timing stays in `balance.js`. Right-hand damage and reach are read from the equipped weapon. |
| Entities | `player.js`, `skeleton.js` | Autonomous actors: own state machines, animation, and combat behavior. |
| Game state / data | `game-state.js`, `master-config.js`, `world.js`, `content/areas/` | `master-config.js` (pure, no THREE, no DOM) fetches `content/areas/master_config.json` and validates the hub file name and the location list; only bare `.json` file names survive. Those names are loaded from `content/areas/`. `world.js` (also pure) checks that the hub's spoke count equals the location count, pairs them in order, points each spoke at that location's trail, and builds the exit path that runs around the outside of the rooms back to the entrance trail. A mismatch throws `WorldError`. `game-state.js` holds the hub, the list, and the spoke pairing (`spokes`), and is exposed as `window.gameState`. |
| Systems | `input.js`, `audio.js`, `ui.js`, `impact.js`, `zone-transition.js` | Cross-cutting concerns not tied to a specific entity or the dungeon: hardware input, sound, HUD, hit-stop/time control, and zone changes. `createZoneTransitions` fades the screen, then asks the caller to teleport and apply a lighting preset. It does not own dungeon meshes. |
| Composition root ("Engine") | `main.js` | Renderer/camera setup, the `requestAnimationFrame` loop, window resize, and the restart cycle (`beginRun`/`clearRun`) that wires every module together. |

New gameplay content (a new enemy type, a new chamber theme, a future second area) belongs in the
**content/rendering** or **entities** layer as a new file, not as a special case inside `main.js`.

## The module lifecycle contract

Every stateful factory satisfies some subset of this shape. Hooks are optional — a module only
implements the ones it needs — but whichever hooks it has must behave exactly as documented here, since
tests and the Cursor rule both check against this contract.

```js
/**
 * @typedef {Object} ModuleLifecycle
 * @property {() => void} [init] - Allocate internal state. For every factory in this codebase today,
 *   the body of createX() itself *is* init — there is no separate call. Only introduce a standalone
 *   init() if a module genuinely needs to be allocated before it is loaded (e.g. something awaiting an
 *   async resource before it can attach to the scene).
 * @property {(scene, ctx) => void|Promise<void>} [load] - Build THREE objects and attach them to the
 *   scene graph. Matches what createDungeon/createSkeletons/createPlayer already do synchronously on
 *   call; everything here is procedural, so nothing currently needs this to be async.
 * @property {(dt, ctx) => void} update - Per-frame step, called once per `requestAnimationFrame` tick.
 *   MUST NOT allocate a new object/array/Vector3 in the hot path — reuse scratch variables declared in
 *   closure scope, and pool frequently spawned/destroyed objects (see skeleton.js's bone-fragment pool).
 * @property {(scene) => void} [unload] - Detach this module's own root object(s) from the scene and stop
 *   owned async work (looping sounds, timers). Objects parented under another module's root (e.g.
 *   skeleton meshes parented under `dungeon.group`) do NOT need their own unload — the owning module's
 *   dispose() already walks that subtree. Don't add a redundant unload just to satisfy the checklist.
 * @property {() => void} [dispose] - Idempotent final cleanup. Required for any module that:
 *     (a) creates its own THREE.BufferGeometry/Material/Texture, or
 *     (b) attaches a `window`/`document` listener.
 *   Must dispose every geometry/material/texture it created (skip materials flagged
 *   `material.userData.shared` *only* when disposing a single consumer mesh that merely borrows a
 *   shared material — the owning factory's own dispose() still disposes them), and must remove every
 *   listener its init/load attached. Calling dispose() twice must be a no-op, not a throw.
 */
```

## Who owns disposal today

- `dungeon.js`'s `dispose()` recursively disposes everything under its root group, including skeleton
  meshes, because `createSkeletons(dungeon.group, ...)` parents every skeleton under that same group.
  `createSkeletons` therefore does not need (and does not have) its own `dispose()`.
- Materials created by `materials.js` are flagged `userData.shared = true` so that `dungeon.js`'s
  per-mesh disposal skips them (many meshes share one material instance). `materials.js` itself now
  exposes `dispose()` so the *owning* factory can tear every material down when the whole material set
  is being rebuilt (e.g. a future theme swap) — this is a different situation from a single mesh being
  recycled, which must never dispose a shared material out from under every other consumer.
- `input.js` and `ui.js` both attach `window`/`document` listeners for the lifetime of the page today
  (they are created once in `main.js` and never torn down during play), but both now expose `dispose()`
  so they can be constructed and torn down safely inside tests, and so a future "return to title screen"
  flow has something to call.
- `player.js` is reset in place via `reset()` on every new run rather than recreated, so it does not need
  a `dispose()` — its view-model meshes live for the whole session, the same as `materials.js`'s output.
- `flame.js` holds the one fire/smoke/embers billboard assembly (`createFlamePoints()`). The hub
  campfire, wall sconces, and the held torch each pass a fire description from `fire-description.js`,
  so the particle colors, lifetime, rate, and light flicker live in one place. `disposeFlamePoints`
  is used by `torch.js` and `hub.js`. `sconce.js` does not yet dispose its flames, since wall sconces,
  like `player.js`, live for the whole session today.
- `torch.js`'s `createHeldTorch()` exposes `dispose()` for the same testability/future-teardown reasons
  as `input.js`/`ui.js`, even though `player.js` does not call it during normal play today.
- `mace.js`'s `createMace()` returns the group the right hand parents, and hangs `dispose()` on that
  group's `userData`. It disposes the mace geometries and the trail material, and a second call is a no-op.

## Extend, don't break

- Prefer adding a new optional parameter or a new field on a factory's returned object over changing an
  existing signature or return shape.
- If a breaking change is genuinely required, update every call site and every test that depends on the
  old shape in the same change, and call this out explicitly rather than leaving it implicit.
- New enemy types, chamber themes, or areas are added as new files that compose the existing systems
  (`balance.js`, `geometry.js`, `materials.js`, etc.) — they do not require editing `main.js` beyond
  wiring in the new factory the same way `createSkeletons`/`createPlayer` are wired in today.

## Performance

- No per-frame allocation inside any `update()` — reuse `THREE.Vector3`/arrays declared once in closure
  scope (see `dungeon.js`'s batching and `skeleton.js`'s animation code for existing examples).
- Pool frequently spawned/destroyed objects instead of recreating them every time, the way
  `skeleton.js`'s bone-fragment debris already does.
- The renderer pixel ratio is capped at 1.5 (`src/pixel-ratio.js`, applied in `main.js` at startup and
  on every resize). Do not call `renderer.setPixelRatio(window.devicePixelRatio)` without that cap —
  uncapped ratios on 2.5K/3K laptop panels miss 60 fps on integrated GPUs.
- Wall-sconce point lights turn off past `SCONCE_LIGHT_CULL_DISTANCE` (15 units) and when occluded.
  The flame mesh stays visible. Those lights, the chest fill, the loot flash, and the outdoor sun all
  have `castShadow = false`. The held torch is the only light that casts a shadow map.
- Repeated dressing — pillars, rocks, the dead trees and scrub outside the ruins, and any future Forest Area props — goes in one shared
  `BatchedMesh` or `InstancedMesh`, the way `dungeon.js` already batches walls and floors. A unique
  interactive object (a chest, a sconce) can stay its own scene node. Do not add one mesh per copy of
  a repeated prop.

## Testing

Tests live next to the module they cover as `*.test.js` (e.g. `balance.test.js` next to `balance.js`),
run via Vitest (`npm test`). Pure-logic specs (`balance`, `geometry`, `rooms`) run under Node; specs that
touch `window`/`document` (`ui`, `input`, `audio`) opt into a jsdom environment with a
`// @vitest-environment jsdom` comment at the top of the file. See `vitest.config.js`.

Every new or materially-changed module should land with a spec that exercises, at minimum: its
`update()` behavior and, if it has one, that `dispose()` actually disposes what it created and is safe
to call twice.
