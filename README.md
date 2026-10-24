# Harpers Row

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
- Esc releases the mouse and pauses, which is when the sliders can be dragged. At the hub, Equip opens a choice of one item for each hand. The left hand takes a torch or a shield. The right hand takes a sword, mace, dagger, hammer, spear, axe, or bow. Choose None on a hand to carry nothing there, then choose Exit. Locations do not offer Equip.
- Xbox controller: left stick moves, right stick looks, right trigger attacks, left trigger blocks, Start pauses. A connected pad keeps the fight running without locking the mouse.

## Difficulty

Three sliders sit on the HUD and are saved in this browser.

- **Undead haste** sets how steeply skeleton speed and attack rate climb from the first room to the last. All the way down, the last room is only a little quicker. All the way up, the last room is frantic.
- **Experience** sets how fast the fighter's bar fills when a skeleton falls. Each level raises maximum health and attack speed, and the damage of whatever is in the right hand, and restores your health in full.
- **Ambient light** starts all the way dark, which is how the rooms already look. Sliding it right raises the fill light, so a shield in the left hand can still leave the rooms readable. A torch still lights the space around you, and it is what lights a cleared sconce.

Armor softens every hit. Holding block (right click or left trigger) is done with the left hand: the arm snaps up in a tenth of a second and holds a torch or a shield still in front of you, which slows your steps. The right-hand weapon stays low and is never moved across for the block. Letting go lowers the guard over about two tenths of a second. The guard covers a cone of about 120 degrees ahead of you. A blow from a skeleton inside that cone lands on the guard: it is shoved back toward you for a moment before springing home, the view jolts, and the attacker is knocked back, and only a quarter of the damage gets through. Blows from the side or behind ignore the guard. An arrow that reaches the guard glances off it, tumbling away without hurting you, but an arrow that misses the guard, because you are turned away or the guard is down, hits for full damage. A torch in the left hand is what lights a cleared sconce. A shield blocks the same way and does not light sconces.

## Exploring a location

Nothing ends the run except dying. Clearing every skeleton does not finish the game: a location has an entrance and an exit, and you roam as much of it as you like.

- **Entrance and exit.** You arrive at the entrance chamber. The arch you came in by is also the way out, and so is the exit chamber at the far end, which is a landmark. Walk out whenever you want, before or after clearing anything. Going back through the arch picks up where you left off: slain skeletons stay slain, opened chests stay open, and sconces stay lit.
- **Multiple floors.** Locations can have several floors joined by stairwells. You climb and descend on foot, and the skeletons follow you up and down the stairs.
- **Percent complete.** The HUD shows how much of the location is done: skeletons felled plus chests opened, out of every skeleton spawn and every chest in the location file. A chest is placed in each chamber that has both a sconce and a chest. The figure only reads 100 when everything is done. Until then it stops at 99, so rounding never claims a finished dungeon early.
- **Gear.** Only the hub has an Equip button. It does not hand you both items: you check the torch, the mace, or neither, then choose Exit. A location has no requirements and no Equip button, and the arch does not stop you. Walk in with nothing if you want. What you took stays with you until you die.
- **Dying** ends the run. Choosing another descent reloads the location from its layout. The sliders stay where you left them. A hub world sends you back to the hub with nothing equipped, and the locations are built anew.

### The master config

`content/areas/master_config.json` names the central hub and lists the locations the game can offer, all as bare file names:

```json
{
  "version": 1,
  "hubLocation": "campfireHub.json",
  "locations": ["smRuins.json", "lgRuins.json", "medRuins.json"]
}
```

`hubLocation` is the game's central hub, a location file like the ones the block dungeon generator makes (`campfireHub.json` and others). It is where the player will start the game and where they come back after dying. It is optional, but if it is present it must be a plain `.json` file name, or the whole config is rejected. The names above are the files shipped in `content/areas/`: the campfire hub's spokes are `smallruins`, `largeruins`, and `medruins`, in that order. A fire pit in that file can describe the flame itself: particle color, lifetime, and rate, plus a flickering point light. The campfire, the held torch, and wall sconces all burn from that same description.

The game reads the config once at startup. The number of names in `locations` has to equal the number of spokes (paths) in the hub file. Spoke 0 leads to the first file, spoke 1 to the second, and so on. When they match, you start on the hub's respawn point, and dying sends you back there with the locations built anew. Walk a spoke to its end to reach that ruin's trail. The header names the ruin. The line under the room name says the stone arch is the way in; the far end of the trail is the way back to the hub. Inside, the corridors are black without a torch in the left hand, and the same line says so.

Each location also grows an outdoor path from a door in its exit chamber. The path stays outside every room, slopes down to the ground when the exit is upstairs, and joins the trail that leads to the entrance, so you can walk out of the exit and follow the trail back to the hub.

If the counts differ, or a file will not load, the game stops and shows the reason on the title card. It does not guess a pairing. `gameState.spokes` lists the pairing (`{ name, location }`), and `gameState.worldError` is set when the check fails. A missing master config still falls back to The Ancient Ruins. To see the pairing, open the browser console and type `gameState.spokes`.

The config is validated like any other outside file: it is capped at 64 KB, entries must be plain `.json` file names (no folders, no URLs), duplicates are dropped, and at most 100 are kept. Anything rejected is counted in `gameState.rejectedLocations`.

Locations come from `content/areas/master_config.json`. There is no file picker. Each named file is fetched from `content/areas/`, capped in size, parsed with `JSON.parse` only, and checked field by field. Counts of rooms, props, and scenery are capped, numbers are clamped to sane ranges, and unknown prop types are skipped.

The game runs entirely in the browser. Slider values are stored locally and are ignored if they are not a number from 0 to 1.

You start on a worn dirt trail in daylight: a pale sky, thin clouds, and dead trees on parched ground of mixed soil and gravel, with the stone arch of the ruins at the end of the path. The trail continues the other way, out of the mountain pass: scrub and dead trees follow a long dirt path that runs into a mountain range. Walking into the arch, or out through the pass, fades the screen and moves you across. Inside the ruins the sky is gone — corridors fall off into black a short way ahead, and the torch is what you see by. Stone floors, walls, and ceilings are large blocks, several feet wide and high, some of them roughly hewn. Daylight outside does not cast a second shadow map; dark patches on the ground follow the sun so the torch can keep the only one.

## Architecture

The codebase is built from small `createX(...)` factory functions that return a plain object closing
over private state — meshes, materials, vectors, flags — rather than classes. Modules are grouped by
concern:

- **Config/math** (`balance.js`, `geometry.js`, `fire-description.js`, `gear-description.js`, `content/creatures/skeletelWarrior.json`) — pure constants and functions, no THREE, no DOM. Skeletal warrior name, health, damage, speed, and weapons are read from `content/creatures/skeletelWarrior.json`. Held equipment is read from the JSON files in `content/gear/` (torch and shield on the left, sword, mace, dagger, hammer, spear, axe, and bow on the right). `fire-description.js` reads the shared flame (particles and a flickering point light) used by the campfire, the torch, and wall sconces.
- **World generation** (`rooms.js`, `ancientRuinsData.json`) — `rooms.js` can still build a procedural layout for tests. The game loads The Ancient Ruins from `ancientRuinsData.json` as a deep copy, and does not call `generateLayout()` on startup or on another descent. The outdoor wall heights and cornice are `approach.shell` in that file. The checklist shows the area name. The enemy name comes from `content/creatures/skeletelWarrior.json`.
- **Content/rendering** (`dungeon.js`, `materials.js`, `flame.js`, `gear.js`, `item-mesh.js`, `sconce.js`, `dust.js`, `player-body.js`, ...) — turns config and layout into THREE objects and owns their GPU resources. Every held item is built by `gear.js` from its file in `content/gear/`. The torch's tip, and a hub fire-pit's `vfx` and `light`, are the same flame description. Only the held torch's point light casts a shadow.
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
