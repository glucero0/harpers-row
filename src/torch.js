// The held torch, built from src/gear/torch.json. `description` must be the parsed object from
// gear-description.js. The mesh, flame, and light live in gear.js; this file keeps the old entry point.
import { fireWobble } from './fire-description.js';
import { createGear } from './gear.js';
import { torchDescription } from './gear-description.js';

export function flickerTorch(light, time, flash = 0) {
  const flicker = light?.userData?.fireFlicker;
  const rest = light?.userData?.restIntensity;
  if (!light || !flicker || typeof rest !== 'number') return;
  light.intensity = Math.max(0, rest * (1 + fireWobble(flicker.speed, flicker.variance, time)) + (flash || 0));
}

export function createHeldTorch(_materials, description = torchDescription) {
  if (!description?.parsed || description.kind !== 'torch') {
    throw new Error('createHeldTorch needs a parsed torch description.');
  }
  return createGear(description);
}
