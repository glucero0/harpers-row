# Dungeon Combater

A first-person dungeon crawl in the browser. 

## Run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (http://localhost:5173). Click the view to capture the mouse.

## Controls

- WASD move. Mouse looks.
- Left click or K attacks. Right click blocks, and also raises the torch to light a sconce once that chamber is clear. E, or a swing with the torch close to the sconce, lights it too. Left click opens a chest, whether or not its sconce is lit. A closed lid sits flush on the chest and hides the coins; opening it swings the lid back from the rear hinge.
- Esc releases the mouse and pauses, which is when the sliders can be dragged and Equip can be clicked.
- Xbox controller: left stick moves, right stick looks, right trigger attacks, left trigger blocks, Start pauses. A connected pad keeps the fight running without locking the mouse.

## Difficulty

Two sliders sit on the HUD and are saved in this browser.

- **Undead haste** sets how steeply skeleton speed and attack rate climb from the first room to the last. All the way down, the last room is only a little quicker. All the way up, the last room is frantic.
- **Experience** sets how fast the fighter's bar fills when a skeleton falls. Each level raises maximum health, mace damage, and attack speed, and restores your health in full.

Armor softens every hit. Holding block (right click or left trigger) is done with the torch hand alone: the left arm snaps up in a tenth of a second, leans the torch across your body with its flame pointing away from your face, and holds it still in front of you, which slows your steps. The mace stays low in your right hand and is never moved across for the block. Letting go lowers the torch back over about two tenths of a second. The torch guards a cone of about 120 degrees ahead of you. A blow from a skeleton inside that cone lands on the torch: the weapon is driven to meet it, a flash lights the attacker amber, white sparks and orange embers fly off the flame, the torch is shoved back toward you for a moment before springing home, the view jolts, and the attacker is knocked back, and only a quarter of the damage gets through. Blows from the side or behind ignore the guard. An arrow that reaches the torch glances off it, tumbling away without hurting you, but an arrow that misses the torch, because you are turned away or the guard is down, hits for full damage.

Clear the last room to finish. Reaching zero health ends the run. Dying or finishing and choosing another descent reloads The Ancient Ruins from the same baked layout. The sliders stay where you left them.

The game runs entirely in the browser. Slider values are stored locally and are ignored if they are not a number from 0 to 1.

You start on a worn dirt trail in daylight: a pale sky, thin clouds, and dead trees on parched ground, with the stone arch of the ruins at the end of the path. The trail continues the other way, out of the mountain pass: scrub and dead trees follow a long dirt path that runs into a mountain range. Walking into the arch, or out through the pass, fades the screen and moves you across. Inside the ruins the sky is gone — corridors fall off into black a short way ahead, and the torch is what you see by. Daylight outside does not cast a second shadow map; dark patches on the ground follow the sun so the torch can keep the only one.

## Architecture

The codebase is built from small `createX(...)` factory functions that return a plain object closing
over private state — meshes, materials, vectors, flags — rather than classes. Modules are grouped by
concern:

- **Config/math** (`balance.js`, `geometry.js`) — pure constants and functions, no THREE, no DOM.
- **World generation** (`rooms.js`, `ancientRuinsData.json`) — `rooms.js` can still build a procedural layout for tests. The game loads The Ancient Ruins from `ancientRuinsData.json` as a deep copy, and does not call `generateLayout()` on startup or on another descent.
- **Content/rendering** (`dungeon.js`, `materials.js`, `flame.js`, `torch.js`, `sconce.js`, `dust.js`, `player-body.js`, ...) — turns config and layout into THREE objects and owns their GPU resources.
- **Entities** (`player.js`, `skeleton.js`) — autonomous actors with their own state machines.
- **Systems** (`input.js`, `audio.js`, `ui.js`, `impact.js`, `zone-transition.js`) — cross-cutting concerns not tied to one entity. Zone changes (the ruin arch, the mountain pass) share one fade, teleport, and lighting preset.
- **Engine** (`main.js`) — the render loop, window resize, and the restart cycle that wires everything together. The renderer pixel ratio is capped at 1.5 so 2.5K/3K laptop panels stay at 60 fps on integrated GPUs. Wall sconces farther than 15 units turn their point light off and keep the flame mesh; only the held torch casts a shadow map. Repeated props (pillars, rocks, and the dead trees and scrub on the trail) belong in a shared batched mesh, the way walls and floors already do.

Every stateful module follows the same lifecycle contract (`update()`, and `dispose()`/`unload()` for
anything that owns GPU resources or `window`/`document` listeners), documented in full in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). New gameplay content — an enemy type, a chamber theme, a
future area — is added as a new file in the matching layer rather than a special case inside `main.js`.
[.cursor/rules/game-architecture.mdc](.cursor/rules/game-architecture.mdc) and
[.cursor/skills/adding-game-modules](.cursor/skills/adding-game-modules/SKILL.md) encode these rules for
AI-assisted changes.

## Testing

```bash
npm test            # run the full suite once (Vitest)
npm run test:watch  # re-run on change
```

Pure-logic specs (`balance`, `geometry`, `rooms`) run under Node. Specs that touch `window`/`document`
(`ui`, `input`, `audio`) or build real THREE scenes with real materials (`dungeon`, `skeleton`, `player`,
`materials`, `lifecycle`) opt into a jsdom environment. The `lifecycle.test.js` suite specifically
replays the game's restart cycle (dispose the dungeon, build a fresh one) several times in a row and
asserts the scene and GPU-resource disposal counts return to the same baseline every time, rather than
leaking across restarts. Every new or changed module should land with a spec covering its `update()` and,
if it owns resources, that `dispose()` cleans them up and is safe to call twice — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full contract.

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm test` and `npm run build` on every push
and pull request.
