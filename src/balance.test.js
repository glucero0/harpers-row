import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attackRecover,
  attackWindup,
  clampUnit,
  mitigatedDamage,
  paceMultiplier,
  skeletonAttackRange,
  skeletonWeapon,
  SKELETON_MIN_RECOVER,
  SKELETON_MIN_WINDUP,
  statsForLevel,
  xpRequired,
} from './balance.js';

test('clampUnit keeps slider values in range', () => {
  assert.equal(clampUnit(0.25), 0.25);
  assert.equal(clampUnit('0.25'), 0.25);
  assert.equal(clampUnit('0'), 0);
  assert.equal(clampUnit(-2), 0);
  assert.equal(clampUnit(4), 1);
  assert.equal(clampUnit(Number.NaN), 0.5);
  assert.equal(clampUnit('nope'), 0.5);
  assert.equal(clampUnit(null), 0.5);
  assert.equal(clampUnit(undefined), 0.5);
  assert.equal(clampUnit(''), 0.5);
  assert.equal(clampUnit(Number.POSITIVE_INFINITY), 0.5);
});

test('the first room stays at the base pace', () => {
  assert.equal(paceMultiplier(0, 0), 1);
  assert.equal(paceMultiplier(0, 0.5), 1);
  assert.equal(paceMultiplier(0, 1), 1);
});

test('the last room matches the haste slider ends', () => {
  assert.ok(Math.abs(paceMultiplier(5, 0) - 1.25) < 1e-9);
  assert.ok(Math.abs(paceMultiplier(5, 1) - 3.75) < 1e-9);
  assert.ok(Math.abs(paceMultiplier(5, 0.5) - 2.5) < 1e-9);
});

test('pace rises with the room and never goes backwards', () => {
  for (const slider of [0, 0.35, 1]) {
    let previous = paceMultiplier(0, slider);
    for (let room = 1; room < 6; room += 1) {
      const next = paceMultiplier(room, slider);
      assert.ok(next > previous);
      previous = next;
    }
  }
});

test('a longer dungeon still ends at the slider pace', () => {
  assert.equal(paceMultiplier(0, 1, 20), 1);
  assert.ok(Math.abs(paceMultiplier(19, 0, 20) - 1.25) < 1e-9);
  assert.ok(Math.abs(paceMultiplier(19, 1, 20) - 3.75) < 1e-9);
});

test('out of range room indexes are clamped', () => {
  assert.equal(paceMultiplier(-4, 1), 1);
  assert.equal(paceMultiplier(99, 0), paceMultiplier(5, 0));
});

test('experience slider makes levels come faster without going free', () => {
  const slow = xpRequired(1, 0);
  const mid = xpRequired(1, 0.5);
  const fast = xpRequired(1, 1);
  assert.ok(slow > mid);
  assert.ok(mid > fast);
  assert.ok(fast >= 1);
  assert.ok(xpRequired(4, 0.5) > xpRequired(2, 0.5));
});

test('higher levels hit harder and swing a little faster', () => {
  const first = statsForLevel(1);
  const later = statsForLevel(4);
  assert.equal(first.maxHealth, 100);
  assert.equal(first.damage, 18);
  assert.ok(later.maxHealth > first.maxHealth);
  assert.ok(later.damage > first.damage);
  assert.ok(later.attackInterval < first.attackInterval);
  assert.equal(statsForLevel(0).level, 1);
});

test('weapons differ, but haste uses one attack cadence', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => skeletonWeapon(index)),
    ['sword', 'mace', 'hammer', 'bow', 'sword'],
  );
  assert.ok(skeletonAttackRange('bow') > skeletonAttackRange('hammer'));
  assert.ok(skeletonAttackRange('sword') > skeletonAttackRange('mace'));
  const slow = attackWindup(1);
  const frantic = attackWindup(3.75);
  assert.ok(frantic < slow);
  assert.ok(frantic >= SKELETON_MIN_WINDUP);
  assert.ok(attackRecover(3.75) >= SKELETON_MIN_RECOVER);
  assert.ok(attackRecover(1) > attackRecover(3.75));
});

test('armor softens hits and a block softens most of what remains', () => {
  const open = mitigatedDamage(20, false);
  const blocked = mitigatedDamage(20, true);
  assert.ok(Math.abs(open - 17) < 1e-9);
  assert.ok(Math.abs(blocked - 4.25) < 1e-9);
  assert.equal(mitigatedDamage(-5, false), 0);
});
