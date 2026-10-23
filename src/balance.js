import warriorDef from '../skeletelWarrior.json';
import { maceDescription } from './gear-description.js';

export const ROOM_COUNT = 6;

export const MIN_END_PACE = 1.25;
export const MAX_END_PACE = 3.75;

export const XP_PER_KILL = 20;
export const BASE_XP = 40;
export const XP_GROWTH = 1.35;
export const XP_SCALE_SLOW = 4;
export const XP_SCALE_FAST = 0.45;

export const PLAYER_BASE_HEALTH = 100;
export const PLAYER_HEALTH_PER_LEVEL = 15;
// Mace damage and swing speed are the unarmed baseline, read from src/gear/mace.json.
// An equipped right-hand weapon replaces the damage and the interval; level steps stay here.
export const PLAYER_BASE_DAMAGE = maceDescription.combat.damage;
export const PLAYER_DAMAGE_PER_LEVEL = 3;
export const PLAYER_BASE_ATTACK_INTERVAL = maceDescription.combat.attackInterval;
export const PLAYER_ATTACK_INTERVAL_PER_LEVEL = 0.02;
export const PLAYER_MIN_ATTACK_INTERVAL = 0.28;
export const PLAYER_SPEED = 9.5;
export const PLAYER_BLOCK_SPEED_FACTOR = 0.58;
export const PLAYER_RADIUS = 0.8;
export const PLAYER_EYE_HEIGHT = 5.5;
export const PLAYER_IFRAMES = 0.4;

export const ARMOR_MITIGATION = 0.15;
// How much of a hit remains after armor when the guard catches it.
export const BLOCK_REMAINING = 0.25;
// The raised guard only covers the front. A blow from outside this cone (total width, in degrees)
// lands as if there were no guard.
export const GUARD_ARC_DEGREES = 120;
// How far up the arm must be before the guard counts (0 lowered, 1 fully raised).
export const GUARD_READY = 0.6;
// An arrow whose path passes this close to the left hand is caught on it.
export const GUARD_RADIUS = 0.85;
// The guard snaps up fast so the defence feels instant, and settles back down more gently.
export const GUARD_RAISE_SECONDS = 0.1;
export const GUARD_LOWER_SECONDS = 0.18;

// Moves the guard progress (0 lowered .. 1 raised) toward its target at a fixed pace, so a full raise
// takes GUARD_RAISE_SECONDS and a full lower takes GUARD_LOWER_SECONDS regardless of frame rate.
export function stepGuardBlend(blend, raising, dt) {
  const step = Math.max(0, dt) / (raising ? GUARD_RAISE_SECONDS : GUARD_LOWER_SECONDS);
  const next = raising ? blend + step : blend - step;
  return Math.min(1, Math.max(0, next));
}

// Is an attacker at offset (dx, dz) from the player inside the cone the player is facing?
export function inGuardArc(forwardX, forwardZ, dx, dz, arcDegrees = GUARD_ARC_DEGREES) {
  const reach = Math.hypot(dx, dz);
  const facing = Math.hypot(forwardX, forwardZ);
  if (!(reach > 1e-6) || !(facing > 1e-6)) return true;
  const cosine = (forwardX * dx + forwardZ * dz) / (reach * facing);
  return cosine >= Math.cos((arcDegrees / 2) * (Math.PI / 180));
}

const DRAWABLE_WEAPONS = new Set(['sword', 'mace', 'hammer', 'bow']);

function warriorNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`skeletelWarrior.json ${label} must be a finite number >= 0`);
  }
  return value;
}

const warriorStats = warriorDef.stats;
if (!warriorStats || typeof warriorDef.name !== 'string' || warriorDef.name.trim() === '') {
  throw new Error('skeletelWarrior.json needs a name and a stats object');
}
if (!Array.isArray(warriorDef.weapons) || warriorDef.weapons.length === 0) {
  throw new Error('skeletelWarrior.json weapons must be a non-empty list');
}

const weaponRanges = new Map();
for (const weapon of warriorDef.weapons) {
  if (!weapon || !DRAWABLE_WEAPONS.has(weapon.id) || weaponRanges.has(weapon.id)) {
    throw new Error('skeletelWarrior.json weapons must be unique ids of sword, mace, hammer, or bow');
  }
  weaponRanges.set(weapon.id, warriorNumber(weapon.range, `weapons.${weapon.id}.range`));
}

export const SKELETON_NAME = warriorDef.name;
export const SKELETON_HP = warriorNumber(warriorStats.health, 'stats.health');
export const SKELETON_DAMAGE = warriorNumber(warriorStats.damage, 'stats.damage');
export const SKELETON_MOVE_SPEED = warriorNumber(warriorStats.moveSpeed, 'stats.moveSpeed');
export const SKELETON_WANDER_FACTOR = warriorNumber(warriorStats.wanderFactor, 'stats.wanderFactor');
export const SKELETON_ATTACK_RANGE = weaponRanges.get('mace') ?? warriorDef.weapons[0].range;
export const SKELETON_WINDUP = warriorNumber(warriorStats.windup, 'stats.windup');
export const SKELETON_RECOVER = warriorNumber(warriorStats.recover, 'stats.recover');
export const SKELETON_MIN_WINDUP = warriorNumber(warriorStats.minWindup, 'stats.minWindup');
export const SKELETON_MIN_RECOVER = warriorNumber(warriorStats.minRecover, 'stats.minRecover');
export const SKELETON_RADIUS = warriorNumber(warriorStats.radius, 'stats.radius');
export const SKELETON_WEAPONS = warriorDef.weapons.map((weapon) => weapon.id);
export const BOW_RANGE = weaponRanges.get('bow') ?? SKELETON_ATTACK_RANGE;
// A skeleton that has a clear line to the player this close (a doorway, a long passage) notices them.
export const SKELETON_SIGHT_RANGE = warriorNumber(warriorStats.sightRange, 'stats.sightRange');

export function skeletonWeapon(index) {
  const n = Number.isFinite(index) ? Math.abs(Math.floor(index)) : 0;
  return SKELETON_WEAPONS[n % SKELETON_WEAPONS.length];
}

export function skeletonAttackRange(weapon) {
  return weaponRanges.get(weapon) ?? SKELETON_ATTACK_RANGE;
}

export function attackWindup(pace) {
  const scale = Number.isFinite(pace) && pace > 0 ? pace : 1;
  return Math.max(SKELETON_MIN_WINDUP, SKELETON_WINDUP / scale);
}

export function attackRecover(pace) {
  const scale = Number.isFinite(pace) && pace > 0 ? pace : 1;
  return Math.max(SKELETON_MIN_RECOVER, SKELETON_RECOVER / scale);
}

// How close the fighter must be, and how wide the swing, to open a chest. This is not a weapon's reach.
export const SWORD_RANGE = 5.1;
export const SWORD_ARC = 1.2;

// Full right on the ambient slider. Zero leaves whatever the place already uses (pitch black inside).
export const AMBIENT_SLIDER_MAX = 0.85;

// The fill light for a place: the file's own level, or brighter when the slider asks for it.
export function ambientFill(base, slider) {
  const floor = Number.isFinite(base) && base > 0 ? base : 0;
  return Math.max(floor, clampUnit(slider, 0) * AMBIENT_SLIDER_MAX);
}

export function clampUnit(value, fallback = 0.5) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function paceMultiplier(roomIndex, slider, roomCount = ROOM_COUNT) {
  const sliderValue = clampUnit(slider);
  const last = Math.max(1, roomCount - 1);
  const index = Number.isFinite(roomIndex)
    ? Math.min(last, Math.max(0, Math.floor(roomIndex)))
    : 0;
  const progress = index / last;
  const endPace = MIN_END_PACE + (MAX_END_PACE - MIN_END_PACE) * sliderValue;
  return 1 + (endPace - 1) * progress;
}

export function xpRequired(level, slider) {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const sliderValue = clampUnit(slider);
  const scale = XP_SCALE_SLOW + (XP_SCALE_FAST - XP_SCALE_SLOW) * sliderValue;
  return Math.max(1, Math.round(BASE_XP * scale * XP_GROWTH ** (safeLevel - 1)));
}

export function statsForLevel(level, combat) {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const steps = safeLevel - 1;
  const baseDamage = combat && Number.isFinite(combat.damage) ? combat.damage : PLAYER_BASE_DAMAGE;
  const baseInterval = combat && Number.isFinite(combat.attackInterval)
    ? combat.attackInterval
    : PLAYER_BASE_ATTACK_INTERVAL;
  return {
    level: safeLevel,
    maxHealth: PLAYER_BASE_HEALTH + steps * PLAYER_HEALTH_PER_LEVEL,
    damage: baseDamage + steps * PLAYER_DAMAGE_PER_LEVEL,
    attackInterval: Math.max(
      PLAYER_MIN_ATTACK_INTERVAL,
      baseInterval - steps * PLAYER_ATTACK_INTERVAL_PER_LEVEL,
    ),
  };
}

export function mitigatedDamage(raw, blocking) {
  const amount = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const afterArmor = amount * (1 - ARMOR_MITIGATION);
  return blocking ? afterArmor * BLOCK_REMAINING : afterArmor;
}
