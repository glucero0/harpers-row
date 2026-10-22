# Dungeon Combater

A first-person dungeon crawl in the browser. The area is The Ancient Ruins. You start outdoors, at the end of a dirt path, with the ruin standing in front of you and its door open. The name is printed in large white letters. A checklist in the lower right names the area, the skeletal warriors inside, and what you must carry: a torch and a mace. Equip puts both in your hands, and a check appears beside the requirement. Until then the doorway will not let you through, and the checklist flashes if you try.

Step inside and the day drops away. The first room is a small stone chamber, dusty, with dirt falling from the ceiling and nobody waiting. The corridor beyond is where the warriors are. The rest of the descent is the same sprawl of rooms and passages, about ten thousand square feet, but the walls, floors, and ceilings are weathered stone: mortar and uneven courses in one repeating bond, without a frame around each wall. Interior walls, floors, and ceilings are batched by material, and rooms more than one door away stay hidden. Dust falls while you walk, and a heavier fall of dust and crumbs drops when a fight hits a wall or a warrior falls. Passages have no sconces. Every chamber that holds enemies has an unlit iron sconce, and a heavy chest sits off to one side of it so the torch stays easy to reach. The doorway is a solid stone front, with return walls beside the passage, and a black veil until you step through. Daylight fades across the last few metres of the court instead of cutting off at the threshold. Skeletal warriors stay in their own rooms and do not come to the gate before that. Clear a chamber, then bring the torch to the sconce with a swing, block, or E. The sconce lights only its alcove and does not cast a shadow. The chest can be struck open whether or not that torch catches. Strike it with the mace to open it. The lid is a thick curved plank with iron bands. It hinges forward of the back edge and eases open to 95 degrees in just over half a second, so it clears the wall. Chests sit far enough off that wall for the lid to swing. Inside, the gold sits high in the chest and a small warm light stays on once the lid is open. Opening it throws 12 to 18 coins up out of the mouth; they scatter, then fade as the gold is collected. Each chest adds 100 gold.

The upper right keeps three run stats: the percent of enemies killed, the percent of loot collected, and your gold. Undead haste and experience still sit under those stats.

Once you have equipped, the mace is in the right hand and the torch is in the left. Each view arm is one skinned forearm that runs into a wrapped hand and a leather gauntlet, and the elbow bends with the swing. The mace sweeps an arc across the view, tilted through the cut, with a short bright trail on the head. Look down and the stone floor stays open in the middle of the view. Slim legs angle forward to a pair of dark boots with iron trim, one at each side of the bottom of the frame. There is no waist or belly in the view. The legs step with your movement. The view stops at sixty-five degrees down and about seventy-two degrees up, and the chest and helmet stay off the camera. The path outside is dusk and fog, not daylight. Indoors a low drone and the occasional stone creak sit under the fight, and the mace and bone impacts land as short heavy thuds. The torch is your light. It falls off quickly, flickers, and throws a soft warm shaft through the dust. A cleared room's sconce is an iron ring and cage holding a thick wooden torch, the head wrapped in pitch-soaked rags. Swing at it, hold block, or press E (Xbox X). A layered flame catches with a whoosh: a yellow-white core, orange tongues, a thin grey smoke plume, and sparks over the fire. The warm light eases on, flickers, and does not cast a shadow. The fire keeps crackling.

Dust hangs in an eight-by-six-by-eight metre cloud around the camera. The motes are soft and warm grey, drift downward only a little, and curl slowly, so they show up when they cross the torch rather than falling like hail. A harder fall of dust and stone crumbs, with a short gravel sound, drops when a blow lands, when a skeleton is knocked into a wall, and when one is destroyed. The mace winds up toward the right edge of the screen and slashes diagonally down toward the left, reaching full extension before it lands. A skeleton is only hurt once the mace arrives, then the blow freezes for an instant, kicks the view and field of view along the swing, and the arm follows through and resets. Both weapons trace a figure-eight sway as you walk and lag a few frames behind when you turn, then catch up. Looking down shows the open floor between the boots, with the legs and boots at the lower corners of the view. The skeletal warriors have angular skulls: deep black eye sockets with a faint ember in each, a heart-shaped nasal cavity, cheekbones, and a separate jaw with a tooth ridge. The neck meets the base of the skull. Skeletons walk their rounds until they see you, either because you stepped into their room or because they have a clear line to you through a doorway or down a passage. From then on they are locked on. They never go back to their rounds, and they follow you room to room through the doors for as long as you live. Melee skeletons chase you down, and archers keep shooting while they can see you, then move to get you back in their sights when you break the line. A melee skeleton draws its weapon back over the shoulder with the elbow folded, then drives the shoulder forward and snaps the forearm straight in an overhand chop before easing back to guard. Their stride follows the ground they actually cover, so their feet do not skate. A hit that does not kill makes the bones flash and recoil, pauses the fight for a fraction of a second, kicks dust off the weapon, and the spine snaps back while the skull rattles. The skull is a low, angular head: hollow eyes with a dim ember deep in each socket, an open nose, cheekbones, and a recessed jaw. A killing blow bursts the skeleton into ribs, femurs, skull fragments, and the rest of its bones. Each piece is thrown away from the blow with its own spin, bounces once or twice, and comes to rest flat on the floor, then the heap fades away after fifteen to twenty seconds. Archers hold the bow upright by its grip in the left hand with the limbs arching toward you. They turn side-on, reach for the string, and draw it straight back to the jaw with the arrow laid across the bow. On release the string hand snaps back past the ear, the bow hand kicks up, and the arrow flies at you. Their bones are dry and aged: rough, parchment-stained, and pitted, with dark eye sockets and a shadowed rib cage. Torchlight wraps around the skull and leaves a faint warm scatter on the thin edges. Some carry swords, some maces, some hammers, and some a bow. Deeper rooms move and strike faster, and the path runs north. The compass arrow keeps pointing that way. The haste slider speeds every attack the same way. When your health reaches zero, the run is over.

## Run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (http://localhost:5173). Click the view to capture the mouse.

## Controls

- WASD move. Mouse looks.
- Left click or K attacks. Right click blocks, and also raises the torch to light a sconce once that chamber is clear. E, or a swing with the torch close to the sconce, lights it too. Left click opens a chest, whether or not its sconce is lit.
- Esc releases the mouse and pauses, which is when the sliders can be dragged and Equip can be clicked.
- Xbox controller: left stick moves, right stick looks, right trigger attacks, left trigger blocks, Start pauses. A connected pad keeps the fight running without locking the mouse.

## Difficulty

Two sliders sit on the HUD and are saved in this browser.

- **Undead haste** sets how steeply skeleton speed and attack rate climb from the first room to the last. All the way down, the last room is only a little quicker. All the way up, the last room is frantic.
- **Experience** sets how fast the fighter's bar fills when a skeleton falls. Each level raises maximum health, mace damage, and attack speed, and restores your health in full.

Armor softens every hit. Holding block (right click or left trigger) is done with the torch hand alone: the left arm snaps up in a tenth of a second, leans the torch across your body with its flame pointing away from your face, and holds it still in front of you, which slows your steps. The mace stays low in your right hand and is never moved across for the block. Letting go lowers the torch back over about two tenths of a second. The torch guards a cone of about 120 degrees ahead of you. A blow from a skeleton inside that cone lands on the torch: the weapon is driven to meet it, a flash lights the attacker amber, white sparks and orange embers fly off the flame, the torch is shoved back toward you for a moment before springing home, the view jolts, and the attacker is knocked back, and only a quarter of the damage gets through. Blows from the side or behind ignore the guard. An arrow that reaches the torch glances off it, tumbling away without hurting you, but an arrow that misses the torch, because you are turned away or the guard is down, hits for full damage.

Clear the last room to finish. Reaching zero health ends the run. Dying or finishing and choosing another descent builds a different layout. The sliders stay where you left them.

The game runs entirely in the browser. Slider values are stored locally and are ignored if they are not a number from 0 to 1.

## Architecture

The codebase is built from small `createX(...)` factory functions that return a plain object closing
over private state — meshes, materials, vectors, flags — rather than classes. Modules are grouped by
concern:

- **Config/math** (`balance.js`, `geometry.js`) — pure constants and functions, no THREE, no DOM.
- **World generation** (`rooms.js`) — the pure procedural dungeon layout generator.
- **Content/rendering** (`dungeon.js`, `materials.js`, `flame.js`, `torch.js`, `sconce.js`, `dust.js`, `player-body.js`, ...) — turns config and layout into THREE objects and owns their GPU resources.
- **Entities** (`player.js`, `skeleton.js`) — autonomous actors with their own state machines.
- **Systems** (`input.js`, `audio.js`, `ui.js`, `impact.js`) — cross-cutting concerns not tied to one entity.
- **Engine** (`main.js`) — the render loop, window resize, and the restart cycle that wires everything together. The renderer pixel ratio is capped at 1.5 so 2.5K/3K laptop panels stay at 60 fps on integrated GPUs. Wall sconces farther than 15 units turn their point light off and keep the flame mesh; only the held torch casts a shadow map. Repeated props (pillars, rocks, foliage in a future area) belong in a shared batched mesh, the way walls and floors already do.

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
