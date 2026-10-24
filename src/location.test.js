import { describe, expect, it } from 'vitest';
import ancientRuinsData from './ancientRuinsData.json';
import { SKELETON_NAME } from './balance.js';
import { STORY_HEIGHT } from './geometry.js';
import {
  LocationError,
  completionPercent,
  floorHeightAt,
  hasChest,
  measureLocation,
  prepareLocation,
  stairHeightAt,
} from './location.js';
import seed3000 from './test-utils/fixtures/seed3000.json';

const copy = (data) => JSON.parse(JSON.stringify(data));

function room(id, x, z, extra = {}) {
  return {
    id,
    name: id,
    kind: 'chamber',
    theme: 'stone',
    rect: { x, z, w: 10, d: 10 },
    spawns: [],
    ...extra,
  };
}

function door(from, to, x, z) {
  return { from, to, a: [x, z], b: [x, z + 4] };
}

// The smallest location that passes: an entrance room and one room off it.
function tiny(extra = {}) {
  return {
    start: { x: 0, z: 40, yaw: 0 },
    rooms: [room('a', 0, 0), room('b', 10, 0)],
    doors: [door('a', 'b', 10, 3)],
    ...extra,
  };
}

describe('prepareLocation: the generator file format', () => {
  it('accepts a file from block-dungeon-generator and fills in what the game needs', () => {
    const layout = prepareLocation(copy(seed3000));
    expect(layout.rooms).toHaveLength(32);
    expect(layout.floors).toBe(2);
    expect(layout.entranceRoomId).toBe('space-0');
    expect(layout.exitRoomId).toBe('space-31');
    expect(layout.lastRoomId).toBe('space-31');
    expect(layout.graph.depth[0]).toBe(0);
    expect(layout.depthCount).toBeGreaterThan(20);
    expect(layout.scenery.length).toBe(10);
    const stairwell = layout.rooms.find((candidate) => candidate.kind === 'stairwell');
    expect(stairwell.storyFirst).toBe(0);
    expect(stairwell.storyLast).toBe(1);
    expect(layout.rooms.find((candidate) => candidate.id === 'space-16').y).toBe(10);
  });

  it('still accepts the baked file, which has no floors, props or scenery', () => {
    const layout = prepareLocation(copy(ancientRuinsData));
    expect(layout.floors).toBe(1);
    expect(layout.rooms.every((candidate) => candidate.y === 0 && candidate.props.length === 0)).toBe(true);
    expect(layout.scenery).toEqual([]);
    expect(layout.creatureId).toBe('skeleton');
    expect(layout.enemyName).toBe(SKELETON_NAME);
  });

  it('dresses every room in options.theme and spawns options.creature', () => {
    const layout = prepareLocation(tiny({
      options: { theme: 'wood', creature: 'goblin' },
      enemyName: 'Goblin',
      rooms: [
        room('a', 0, 0, { theme: 'stone', rocks: [[1, 1]] }),
        room('b', 10, 0, { theme: 'cave', rocks: [[12, 2]] }),
      ],
    }));
    expect(layout.rooms.every((candidate) => candidate.theme === 'wood' && candidate.rocks.length === 0)).toBe(true);
    expect(layout.creatureId).toBe('goblin');
    expect(layout.enemyName).toBe('Goblin');
    expect(layout.creature.stats.health).toBe(17);
  });

  it('leaves mixed themes and the skeletal warrior when theme and creature are null', () => {
    const layout = prepareLocation(tiny({
      options: { theme: null, creature: null },
      rooms: [
        room('a', 0, 0, { theme: 'wood' }),
        room('b', 10, 0, { theme: 'cave', rocks: [[12, 2]] }),
      ],
    }));
    expect(layout.rooms[0].theme).toBe('wood');
    expect(layout.rooms[1].theme).toBe('cave');
    expect(layout.rooms[1].rocks).toHaveLength(1);
    expect(layout.creatureId).toBe('skeleton');
    expect(layout.enemyName).toBe(SKELETON_NAME);
  });

  it('rejects an unknown theme or creature', () => {
    expect(() => prepareLocation(tiny({ options: { theme: 'marble' } }))).toThrow(LocationError);
    expect(() => prepareLocation(tiny({ options: { creature: 'dragon' } }))).toThrow(LocationError);
  });

  it('is idempotent: preparing twice changes nothing the second time', () => {
    const layout = prepareLocation(copy(seed3000));
    const graph = layout.graph;
    expect(prepareLocation(layout)).toBe(layout);
    expect(layout.graph).toBe(graph);
  });

  it('puts the entrance and the exit where the file says', () => {
    const layout = prepareLocation(copy(seed3000));
    const entrance = layout.exits.find((exit) => exit.id === 'entrance');
    const exit = layout.exits.find((candidate) => candidate.id === 'exit');
    expect(entrance).toMatchObject({ type: 'arch', roomId: 'space-0', transitionId: 'ruin-exit' });
    expect(exit).toMatchObject({ type: 'chamber', roomId: 'space-31' });
  });

  it('bounds every zone transition to the ground floor so a landing above the arch cannot fire it', () => {
    const layout = prepareLocation(copy(seed3000));
    for (const transition of layout.transitions) {
      expect(transition.volume.minY).toBeLessThan(0);
      expect(transition.volume.maxY).toBeLessThan(STORY_HEIGHT / 2);
    }
  });
});

describe('prepareLocation: the room graph', () => {
  it('routes between any two rooms by the shortest way, through a branching tree', () => {
    const layout = prepareLocation(tiny({
      rooms: [room('a', 0, 0), room('b', 10, 0), room('c', 20, 0), room('d', 10, 10)],
      doors: [door('a', 'b', 10, 3), door('b', 'c', 20, 3), door('b', 'd', 13, 10)],
    }));
    const { next } = layout.graph;
    const count = layout.rooms.length;
    expect(next[0 * count + 2]).toBe(1);
    expect(next[2 * count + 0]).toBe(1);
    expect(next[3 * count + 2]).toBe(1);
    expect(next[1 * count + 3]).toBe(3);
    expect(layout.graph.depth).toEqual([0, 1, 2, 2]);
    expect(layout.depthCount).toBe(3);
  });

  it('draws the passages and the next chamber from where the player stands, not the whole floor', () => {
    const layout = prepareLocation(copy(seed3000));
    const visible = layout.graph.visible[layout.rooms.findIndex((candidate) => candidate.id === 'space-0')];
    expect(visible).toContain('space-0');
    expect(visible).toContain('space-1');
    expect(visible.length).toBeLessThan(8);
    expect(visible).not.toContain('space-31');
  });

  it('refuses a location with a room nobody can walk to', () => {
    expect(() => prepareLocation(tiny({ rooms: [room('a', 0, 0), room('b', 10, 0), room('island', 50, 50)] })))
      .toThrow(/island cannot be reached/);
  });
});

describe('prepareLocation: untrusted input', () => {
  const bad = (change, pattern) => {
    const data = tiny();
    change(data);
    expect(() => prepareLocation(data)).toThrow(LocationError);
    expect(() => prepareLocation(data)).toThrow(pattern);
  };

  it('rejects data that is not a location', () => {
    expect(() => prepareLocation(null)).toThrow(LocationError);
    expect(() => prepareLocation('rooms')).toThrow(LocationError);
    expect(() => prepareLocation({ rooms: [] })).toThrow(/non-empty/);
  });

  it('rejects rooms and doors that would break the level instead of building a broken one', () => {
    bad((data) => { data.rooms[0].rect.w = Number.NaN; }, /rect/);
    bad((data) => { data.rooms[0].rect.d = -4; }, /rect/);
    bad((data) => { data.rooms[1].id = 'a'; }, /used twice/);
    bad((data) => { data.rooms[0].id = ''; }, /needs an id/);
    bad((data) => { data.rooms[0].polygon = [[0, 0], [1, 1]]; }, /polygon/);
    bad((data) => { data.rooms[0].spawns = [[0]]; }, /spawns/);
    bad((data) => { data.doors[0].to = 'nowhere'; }, /unknown rooms/);
    bad((data) => { data.doors[0].a = 'x'; }, /points a and b/);
    bad((data) => { data.rooms[1].kind = 'stairwell'; }, /stair data/);
    bad((data) => { data.rooms[1].stair = { fromY: 0 }; }, /stair needs/);
    bad((data) => { delete data.start; }, /start/);
  });

  it('caps the number of rooms', () => {
    const data = tiny();
    data.rooms = Array.from({ length: 401 }, (_, index) => room(`r${index}`, index * 11, 0));
    expect(() => prepareLocation(data)).toThrow(/more than 400 rooms/);
  });

  it('drops a malformed prop, scenery item or chest rather than failing the whole file', () => {
    const data = tiny();
    data.rooms[0].props = [
      { type: 'barrel', x: 1, z: 1 },
      { type: 'barrel', x: 'one', z: 1 },
      { type: 7, x: 1, z: 1 },
      null,
    ];
    data.rooms[0].sconce = { x: 1, z: 1, nx: 0, nz: 1 };
    data.rooms[0].chest = { x: 'far', z: 1 };
    data.scenery = [{ type: 'boulder', x: 1, z: 1, scale: -3 }, { type: 'boulder' }];
    const layout = prepareLocation(data);
    expect(layout.rooms[0].props).toHaveLength(1);
    expect(hasChest(layout.rooms[0])).toBe(false);
    expect(layout.scenery).toHaveLength(1);
    expect(layout.scenery[0].scale).toBe(1);
  });

  it('caps how many props and scenery items one file can place', () => {
    const data = tiny();
    data.rooms[0].props = Array.from({ length: 500 }, () => ({ type: 'barrel', x: 1, z: 1 }));
    data.scenery = Array.from({ length: 2000 }, () => ({ type: 'boulder', x: 1, z: 1 }));
    const layout = prepareLocation(data);
    expect(layout.rooms[0].props).toHaveLength(200);
    expect(layout.scenery).toHaveLength(600);
  });

  it('keeps long text out of the player-facing message', () => {
    const data = tiny();
    data.rooms[0].rect = null;
    data.rooms[0].id = 'x'.repeat(5000);
    try {
      prepareLocation(data);
    } catch (error) {
      expect(error.message.length).toBeLessThan(260);
    }
  });

  it('does not let an inherited key stand in for a missing one', () => {
    const data = JSON.parse('{"rooms":[{"__proto__":{"id":"evil"},"rect":{"x":0,"z":0,"w":1,"d":1}}],"start":{"x":0,"z":0}}');
    expect(() => prepareLocation(data)).toThrow(LocationError);
  });

  it('drops malformed transitions, trail samples and trees', () => {
    const data = copy(seed3000);
    data.transitions.push({ id: 'broken' }, null);
    data.trees.push({ x: 'a' });
    data.approach.vista.trees.push({ x: 1 });
    const layout = prepareLocation(data);
    expect(layout.transitions).toHaveLength(4);
    expect(layout.trees).toHaveLength(24);
  });

  it('rejects an approach the arch cannot be built from', () => {
    const data = copy(seed3000);
    delete data.approach.court;
    expect(() => prepareLocation(data)).toThrow(/court, vestibule and hub/);
  });
});

describe('floors', () => {
  const stair = { fromY: 0, toY: 10, low: [-87.8, -31], high: [-102.2, -31] };

  it('rises evenly from the low point to the high point and is flat past either end', () => {
    expect(stairHeightAt(stair, -87.8, -31)).toBe(0);
    expect(stairHeightAt(stair, -95, -31)).toBeCloseTo(5, 5);
    expect(stairHeightAt(stair, -102.2, -31)).toBe(10);
    expect(stairHeightAt(stair, -87, -31)).toBe(0);
    expect(stairHeightAt(stair, -103, -31)).toBe(10);
  });

  it('floorHeightAt follows the stair in a stairwell and the room height elsewhere', () => {
    const layout = prepareLocation(copy(seed3000));
    const stairwell = layout.rooms.find((candidate) => candidate.kind === 'stairwell');
    const upper = layout.rooms.find((candidate) => candidate.id === 'space-18');
    expect(floorHeightAt(stairwell, -95, -31)).toBeCloseTo(5, 5);
    expect(floorHeightAt(upper, upper.rect.x + 1, upper.rect.z + 1)).toBe(10);
    expect(floorHeightAt(null, 0, 0)).toBe(0);
    expect(floorHeightAt({ name: 'outside' }, 0, 0)).toBe(0);
  });
});

describe('measuring a location', () => {
  it('counts one task per enemy placed and one per chest placed, from the file itself', () => {
    const layout = prepareLocation(copy(seed3000));
    const spawns = seed3000.rooms.reduce((sum, candidate) => sum + candidate.spawns.length, 0);
    const chests = seed3000.rooms.filter((candidate) => candidate.sconce && candidate.chest).length;
    expect(measureLocation(layout)).toEqual({ enemies: spawns, chests });
    expect(measureLocation(layout)).toEqual({ enemies: 28, chests: 8 });
  });

  it('does not count a chest that has no sconce to pair with', () => {
    const data = tiny();
    data.rooms[0].chest = { x: 1, z: 1 };
    data.rooms[0].spawns = [[2, 2]];
    expect(measureLocation(prepareLocation(data))).toEqual({ enemies: 1, chests: 0 });
  });
});

describe('completionPercent', () => {
  it('weighs enemies and chests alike', () => {
    expect(completionPercent({ enemiesFallen: 0, enemiesTotal: 28, lootTaken: 0, lootTotal: 8 })).toBe(0);
    expect(completionPercent({ enemiesFallen: 14, enemiesTotal: 28, lootTaken: 4, lootTotal: 8 })).toBe(50);
    expect(completionPercent({ enemiesFallen: 28, enemiesTotal: 28, lootTaken: 0, lootTotal: 8 })).toBe(77);
  });

  it('reads 100 only when everything is done, never from rounding', () => {
    expect(completionPercent({ enemiesFallen: 27, enemiesTotal: 28, lootTaken: 8, lootTotal: 8 })).toBe(97);
    expect(completionPercent({ enemiesFallen: 999, enemiesTotal: 1000, lootTaken: 0, lootTotal: 0 })).toBe(99);
    expect(completionPercent({ enemiesFallen: 28, enemiesTotal: 28, lootTaken: 8, lootTotal: 8 })).toBe(100);
  });

  it('is zero for a place with nothing to do, and ignores nonsense', () => {
    expect(completionPercent({ enemiesFallen: 0, enemiesTotal: 0, lootTaken: 0, lootTotal: 0 })).toBe(0);
    expect(completionPercent({})).toBe(0);
    expect(completionPercent({ enemiesFallen: -5, enemiesTotal: 10, lootTaken: Number.NaN, lootTotal: 0 })).toBe(0);
    expect(completionPercent({ enemiesFallen: 50, enemiesTotal: 10, lootTaken: 0, lootTotal: 0 })).toBe(100);
  });
});
