// The hub and every location it leads to, with only one of them in play at a time. Building them
// together means a spoke crossing does not have to assemble a level mid-fade. Hiding a place removes
// its lights as well as its meshes, so two suns never shine at once.

import { createDungeon } from './dungeon.js';
import { createHub } from './hub.js';
import { createSkeletons } from './skeleton.js';

const IDLE_SKELETONS = {
  list: [],
  livingIn() {
    return 0;
  },
  fallen() {
    return 0;
  },
  update() {},
  damage() {
    return false;
  },
};

export function createPlaces(scene, materials, plan, renderer) {
  const hub = createHub(scene, materials, plan.hub);
  const locations = [];
  try {
    for (const binding of plan.bindings) {
      const dungeon = createDungeon(scene, materials, binding.layout, renderer);
      const skeletons = createSkeletons(dungeon.group, dungeon, materials);
      dungeon.setShown(false);
      locations.push({ id: binding.index, dungeon, skeletons });
    }
  } catch (error) {
    hub.dispose();
    for (const location of locations) location.dungeon.dispose();
    throw error;
  }
  let current = 'hub';
  let disposed = false;

  function dungeonOf(id) {
    if (id === 'hub') return hub;
    return locations[id].dungeon;
  }

  return {
    show(id) {
      if (disposed) return;
      current = id;
      hub.setShown(id === 'hub');
      for (const location of locations) location.dungeon.setShown(location.id === id);
    },
    dungeon() {
      return dungeonOf(current);
    },
    skeletons() {
      return current === 'hub' ? IDLE_SKELETONS : locations[current].skeletons;
    },
    respawn: plan.hub.respawn,
    dispose() {
      if (disposed) return;
      disposed = true;
      hub.dispose();
      for (const location of locations) location.dungeon.dispose();
    },
  };
}
