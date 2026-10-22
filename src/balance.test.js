import assert from 'node:assert/strict';
import { test } from 'vitest';
import warriorDef from '../skeletelWarrior.json';
import {
  attackRecover,
  attackWindup,
  clampUnit,
  inGuardArc,
  mitigatedDamage,
  paceMultiplier,
  skeletonAttackRange,
  skeletonWeapon,
  stepGuardBlend,
  SKELETON_DAMAGE,
  SKELETON_HP,
  SKELETON_MIN_RECOVER,
  SKELETON_MIN_WINDUP,
  SKELETON_MOVE_SPEED,
  SKELETON_NAME,
  SKELETON_WEAPONS,
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

test('skeletal warrior stats come from skeletelWarrior.json', () => {
  assert.equal(SKELETON_NAME, warriorDef.name);
  assert.equal(SKELETON_HP, warriorDef.stats.health);
  assert.equal(SKELETON_DAMAGE, warriorDef.stats.damage);
  assert.equal(SKELETON_MOVE_SPEED, warriorDef.stats.moveSpeed);
  assert.deepEqual(SKELETON_WEAPONS, warriorDef.weapons.map((weapon) => weapon.id));
  for (const weapon of warriorDef.weapons) {
    assert.equal(skeletonAttackRange(weapon.id), weapon.range);
  }
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

test('the guard only covers the cone in front of the player', () => {
  // Facing -Z (yaw 0): straight ahead, a little off to the side, and just inside the 60 degree half angle.
  assert.equal(inGuardArc(0, -1, 0, -3), true);
  assert.equal(inGuardArc(0, -1, 1, -3), true);
  assert.equal(inGuardArc(0, -1, Math.sin(0.99), -Math.cos(0.99)), true);
  // Just outside the cone, then flank and rear.
  assert.equal(inGuardArc(0, -1, Math.sin(1.1), -Math.cos(1.1)), false);
  assert.equal(inGuardArc(0, -1, 3, 0), false);
  assert.equal(inGuardArc(0, -1, 0, 3), false);
  // A widened arc admits the flank; a degenerate input never leaves the player unguarded by accident.
  assert.equal(inGuardArc(0, -1, 3, 0, 200), true);
  assert.equal(inGuardArc(0, -1, 0, 0), true);
  assert.equal(inGuardArc(0, 0, 1, 1), true);
});

test('the torch snaps up in a tenth of a second and settles down in under two tenths', () => {
  let blend = 0;
  for (let i = 0; i < 6; i += 1) blend = stepGuardBlend(blend, true, 1 / 60);
  assert.ok(blend > 0.999);
  assert.ok(Math.abs(stepGuardBlend(0, true, 0.05) - 0.5) < 1e-9);
  assert.equal(stepGuardBlend(0, true, 0.2), 1);
  assert.ok(Math.abs(stepGuardBlend(1, false, 0.09) - 0.5) < 1e-9);
  assert.equal(stepGuardBlend(1, false, 0.5), 0);
  // Pace does not depend on the frame rate, and a negative step never moves it backwards.
  assert.ok(Math.abs(stepGuardBlend(stepGuardBlend(0, true, 0.025), true, 0.025) - 0.5) < 1e-9);
  assert.equal(stepGuardBlend(0.4, true, -1), 0.4);
});