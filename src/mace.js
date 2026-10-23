// The fighter's mace, built from src/gear/mace.json. Returns the group player.js used to parent to the
// right hand. New gear is built with createGear(); this wrapper remains for the mace's own tests.
import { createGear } from './gear.js';
import { maceDescription } from './gear-description.js';

export function createMace(_materials, description = maceDescription) {
  if (!description?.parsed || description.kind !== 'mace') {
    throw new Error('createMace needs a parsed mace description.');
  }
  const item = createGear(description);
  item.root.userData.dispose = item.dispose;
  return item.root;
}
