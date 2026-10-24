import { describe, expect, it } from 'vitest';
import {
  creatureAttackRange,
  creatureById,
  creatureWeapon,
  defaultCreature,
} from './creatures.js';
import { SKELETON_HP, SKELETON_NAME } from './balance.js';

describe('creatures', () => {
  it('uses the skeletal warrior when a dungeon names no creature', () => {
    const warrior = defaultCreature();
    expect(warrior.id).toBe('skeleton');
    expect(warrior.name).toBe(SKELETON_NAME);
    expect(warrior.stats.health).toBe(SKELETON_HP);
    expect(warrior.scale).toBe(1);
    expect(warrior.color).toBeNull();
    expect(creatureById('skeleton')).toBe(warrior);
  });

  it('reads a humanoid by the id a dungeon file stores', () => {
    const goblin = creatureById('goblin');
    expect(goblin.plan).toBe('humanoid');
    expect(goblin.stats.health).toBe(17);
    expect(goblin.scale).toBeCloseTo(0.72);
    expect(goblin.color).toBe('#8faf62');
    expect(creatureWeapon(goblin, 0)).toBe('sword');
    expect(creatureWeapon(goblin, 4)).toBe('sword');
    expect(creatureAttackRange(goblin, 'mace')).toBeCloseTo(3.35);
  });

  it('gives a quadruped a reach and no weapon', () => {
    const wolf = creatureById('wolf');
    expect(wolf.plan).toBe('quadruped');
    expect(creatureWeapon(wolf, 0)).toBeNull();
    expect(creatureAttackRange(wolf, null)).toBeGreaterThan(1);
    expect(creatureById('dragon')).toBeNull();
  });
});
