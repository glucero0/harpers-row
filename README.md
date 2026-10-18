# Dungeon Combater

A first-person dungeon crawl in the browser. Every descent builds a new dungeon of about ten thousand square feet: rooms of different sizes, passages of different length and width, and doors that are not all the same. Stone, timber, and cave are mixed along the path. You see your own arms: the sword is held up in the right hand, the shield’s face sits out on the left, and looking down shows your armor, legs, and boots. Skeletons wander until you step into their room, then they come for you. Some carry swords, some maces, some hammers, and some a bow. Deeper rooms move and strike faster, and the path runs north. The compass arrow keeps pointing that way. The haste slider speeds every attack the same way. When your health reaches zero, the run is over.

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
- **Experience** sets how fast the fighter's bar fills when a skeleton falls. Levels raise health, sword damage, and attack speed.

Armor softens every hit. Holding the shield softens most of what gets through and slows your steps.

Clear the last room to finish. Reaching zero health ends the run. Dying or finishing and choosing another descent builds a different layout. The sliders stay where you left them.

The game runs entirely in the browser. Slider values are stored locally and are ignored if they are not a number from 0 to 1.
