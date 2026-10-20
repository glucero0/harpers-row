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
export const PLAYER_BASE_DAMAGE = 18;
export const PLAYER_DAMAGE_PER_LEVEL = 6;
export const PLAYER_BASE_ATTACK_INTERVAL = 0.48;
export const PLAYER_ATTACK_INTERVAL_PER_LEVEL = 0.025;
export const PLAYER_MIN_ATTACK_INTERVAL = 0.28;
export const PLAYER_SPEED = 9.5;
export const PLAYER_BLOCK_SPEED_FACTOR = 0.58;
export const PLAYER_RADIUS = 0.8;
export const PLAYER_EYE_HEIGHT = 5.5;
export const PLAYER_IFRAMES = 0.4;

export const ARMOR_MITIGATION = 0.15;
export const BLOCK_REMAINING = 0.25;

export const SKELETON_HP = 36;
export const SKELETON_DAMAGE = 14;
export const SKELETON_MOVE_SPEED = 3.6;
export const SKELETON_WANDER_FACTOR = 0.42;
export const SKELETON_ATTACK_RANGE = 3.35;
export const SKELETON_WINDUP = 0.72;
export const SKELETON_RECOVER = 1.15;
export const SKELETON_MIN_WINDUP = 0.22;
export const SKELETON_MIN_RECOVER = 0.28;
export const SKELETON_RADIUS = 0.7;
export const SKELETON_WEAPONS = ['sword', 'mace', 'hammer', 'bow'];
export const BOW_RANGE = 26;
// A skeleton that has a clear line to the player this close (a doorway, a long passage) notices them.
export const SKELETON_SIGHT_RANGE = 26;

export function skeletonWeapon(index) {
  const n = Number.isFinite(index) ? Math.abs(Math.floor(index)) : 0;
  return SKELETON_WEAPONS[n % SKELETON_WEAPONS.length];
}

export function skeletonAttackRange(weapon) {
  if (weapon === 'bow') return BOW_RANGE;
  if (weapon === 'sword') return 4.4;
  if (weapon === 'hammer') return 3.8;
  return SKELETON_ATTACK_RANGE;
}

export function attackWindup(pace) {
  const scale = Number.isFinite(pace) && pace > 0 ? pace : 1;
  return Math.max(SKELETON_MIN_WINDUP, SKELETON_WINDUP / scale);
}

export function attackRecover(pace) {
  const scale = Number.isFinite(pace) && pace > 0 ? pace : 1;
  return Math.max(SKELETON_MIN_RECOVER, SKELETON_RECOVER / scale);
}

export const SWORD_RANGE = 5.1;
export const SWORD_ARC = 0.95;

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

export function statsForLevel(level) {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const steps = safeLevel - 1;
  return {
    level: safeLevel,
    maxHealth: PLAYER_BASE_HEALTH + steps * PLAYER_HEALTH_PER_LEVEL,
    damage: PLAYER_BASE_DAMAGE + steps * PLAYER_DAMAGE_PER_LEVEL,
    attackInterval: Math.max(
      PLAYER_MIN_ATTACK_INTERVAL,
      PLAYER_BASE_ATTACK_INTERVAL - steps * PLAYER_ATTACK_INTERVAL_PER_LEVEL,
    ),
  };
}

export function mitigatedDamage(raw, blocking) {
  const amount = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const afterArmor = amount * (1 - ARMOR_MITIGATION);
  return blocking ? afterArmor * BLOCK_REMAINING : afterArmor;
}
