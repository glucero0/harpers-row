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
