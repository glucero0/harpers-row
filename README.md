# Dungeon Combater

A first-person dungeon crawl in the browser. Every descent builds a new dungeon of about ten thousand square feet: rooms of different sizes, passages of different length and width, and doors that are not all the same. Stone, timber, and cave are mixed along the path. You see your own arms: the forearms come in from the lower corners, and a mace stands in the right fist while a torch stands in the left. The torch is the only light in the dungeon. The mace winds up toward the right edge of the screen and slashes diagonally down toward the left, reaching full extension before it lands. A skeleton is only hurt once the mace arrives, then the blow freezes for an instant, kicks the view and field of view along the swing, and the arm follows through and resets. Both weapons trace a figure-eight sway as you walk and lag a few frames behind when you turn, then catch up. Looking down shows your armor, legs, and boots. Skeletons walk their rounds until they see you, either because you stepped into their room or because they have a clear line to you through a doorway or down a passage. From then on they are locked on. They never go back to their rounds, and they follow you room to room through the doors for as long as you live. Melee skeletons chase you down, and archers keep shooting while they can see you, then move to get you back in their sights when you break the line. A melee skeleton draws its weapon back over the shoulder with the elbow folded, then drives the shoulder forward and snaps the forearm straight in an overhand chop before easing back to guard. Their stride follows the ground they actually cover, so their feet do not skate. A hit that does not kill makes the bones flash and recoil, with the spine snapping back and the skull rattling. A killing blow bursts the skeleton into its separate bones: skull, ribs, spine, pelvis, arms, legs, and whatever it carried. Each piece is thrown away from the blow with its own spin, bounces once or twice, and comes to rest flat on the floor, then the heap fades away after fifteen to twenty seconds. Archers hold the bow upright by its grip in the left hand with the limbs arching toward you. They turn side-on, reach for the string, and draw it straight back to the jaw with the arrow laid across the bow. On release the string hand snaps back past the ear, the bow hand kicks up, and the arrow flies at you. Their bones are dry and aged: rough, parchment-stained, and pitted, with dark eye sockets and a shadowed rib cage. Torchlight wraps around the skull and leaves a faint warm scatter on the thin edges. Some carry swords, some maces, some hammers, and some a bow. Deeper rooms move and strike faster, and the path runs north. The compass arrow keeps pointing that way. The haste slider speeds every attack the same way. When your health reaches zero, the run is over.

## Run

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (http://localhost:5173). Click the view to capture the mouse.

## Controls

- WASD move. Mouse looks.
- Left click or K attacks. Right click blocks.
- Esc releases the mouse and pauses, which is when the sliders can be dragged.
- Xbox controller: left stick moves, right stick looks, right trigger attacks, left trigger blocks, Start pauses. A connected pad keeps the fight running without locking the mouse.

## Difficulty

Two sliders sit on the HUD and are saved in this browser.

- **Undead haste** sets how steeply skeleton speed and attack rate climb from the first room to the last. All the way down, the last room is only a little quicker. All the way up, the last room is frantic.
- **Experience** sets how fast the fighter's bar fills when a skeleton falls. Each level raises maximum health, mace damage, and attack speed, and restores your health in full.

Armor softens every hit. Raising the torch arm softens most of what gets through and slows your steps.

Clear the last room to finish. Reaching zero health ends the run. Dying or finishing and choosing another descent builds a different layout. The sliders stay where you left them.

The game runs entirely in the browser. Slider values are stored locally and are ignored if they are not a number from 0 to 1.
