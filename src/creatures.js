// The species a dungeon can name in options.creature. Pure: no THREE, no DOM.
// Each file contributes stats, size, and a body color. The skeletal warrior file is the
// skeleton. Anything the file does not say is filled in here, and nothing in it is run as code.
import bearDef from '../content/creatures/bear.json';
import boarDef from '../content/creatures/boar.json';
import deerDef from '../content/creatures/deer.json';
import dwarfDef from '../content/creatures/dwarf.json';
import elfDef from '../content/creatures/elf.json';
import goblinDef from '../content/creatures/goblin.json';
import horseDef from '../content/creatures/horse.json';
import humanDef from '../content/creatures/human.json';
import orcDef from '../content/creatures/orc.json';
import ratDef from '../content/creatures/rat.json';
import warriorDef from '../content/creatures/skeletelWarrior.json';
import wolfDef from '../content/creatures/wolf.json';
import zombieDef from '../content/creatures/zombie.json';

const PLANS = new Set(['humanoid', 'quadruped']);
const WEAPONS = new Set(['sword', 'mace', 'hammer', 'bow']);
const COLOR = /^#[0-9a-f]{6}$/;
const SKELETON_RADIUS = 0.7;

export class CreatureError extends Error {
  constructor(message) {
    super(String(message).slice(0, 200));
    this.name = 'CreatureError';
  }
}

function fail(message) {
  throw new CreatureError(message);
}

function num(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a finite number`);
  return n;
}

function readCreature(raw, species) {
  if (!raw || typeof raw !== 'object') fail(`${species} is missing`);
  if (raw.species !== undefined && raw.species !== species) fail(`${species} does not match its file`);
  const plan = raw.plan === undefined ? 'humanoid' : raw.plan;
  if (!PLANS.has(plan)) fail(`${species} plan must be humanoid or quadruped`);
  const fileScale = raw.scale === undefined ? 1 : num(raw.scale, `${species} scale`);
  if (!(fileScale > 0.05 && fileScale < 4)) fail(`${species} scale is out of range`);
  const stats = raw.stats;
  if (!stats || typeof stats !== 'object') fail(`${species} needs stats`);
  const health = num(stats.health, `${species} health`);
  const damage = num(stats.damage, `${species} damage`);
  const moveSpeed = num(stats.moveSpeed, `${species} moveSpeed`);
  const wanderFactor = num(stats.wanderFactor, `${species} wanderFactor`);
  const radius = num(stats.radius, `${species} radius`);
  const sightRange = num(stats.sightRange, `${species} sightRange`);
  const windup = num(stats.windup, `${species} windup`);
  const recover = num(stats.recover, `${species} recover`);
  const minWindup = num(stats.minWindup, `${species} minWindup`);
  const minRecover = num(stats.minRecover, `${species} minRecover`);
  if (!(health > 0 && damage >= 0 && moveSpeed > 0 && radius > 0 && sightRange > 0)) {
    fail(`${species} stats must be positive`);
  }
  if (!(windup > 0 && recover > 0 && minWindup > 0 && minRecover > 0)) fail(`${species} timing must be positive`);
  if (!(wanderFactor >= 0 && wanderFactor <= 1)) fail(`${species} wanderFactor must be from 0 to 1`);
  const weapons = [];
  if (raw.weapons !== undefined) {
    if (!Array.isArray(raw.weapons)) fail(`${species} weapons must be a list`);
    for (const weapon of raw.weapons) {
      if (!weapon || !WEAPONS.has(weapon.id)) fail(`${species} weapon must be sword, mace, hammer, or bow`);
      const range = num(weapon.range, `${species} weapon range`);
      if (!(range > 0)) fail(`${species} weapon range must be positive`);
      weapons.push({ id: weapon.id, range });
    }
  }
  let color = null;
  if (typeof raw.color === 'string') {
    const hex = raw.color.toLowerCase();
    if (!COLOR.test(hex)) fail(`${species} color must be #rrggbb`);
    color = hex;
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : species;
  // A humanoid uses the file's scale. A quadruped's size is its radius against the warrior rig.
  const scale = plan === 'humanoid' ? fileScale : Math.max(0.2, Math.min(1.8, radius / SKELETON_RADIUS));
  return Object.freeze({
    id: species,
    name,
    plan,
    scale,
    color: species === 'skeleton' ? null : color,
    stats: Object.freeze({
      health, damage, moveSpeed, wanderFactor, radius, sightRange, windup, recover, minWindup, minRecover,
    }),
    weapons: Object.freeze(weapons),
    reach: weapons.length ? weapons[0].range : Math.max(1.4, radius * 2.6),
  });
}

const byId = new Map([
  ['skeleton', warriorDef],
  ['human', humanDef],
  ['goblin', goblinDef],
  ['orc', orcDef],
  ['elf', elfDef],
  ['dwarf', dwarfDef],
  ['zombie', zombieDef],
  ['wolf', wolfDef],
  ['bear', bearDef],
  ['boar', boarDef],
  ['horse', horseDef],
  ['deer', deerDef],
  ['rat', ratDef],
].map(([id, raw]) => [id, readCreature(raw, id)]));

export function creatureById(id) {
  return byId.get(id) || null;
}

export function defaultCreature() {
  return byId.get('skeleton');
}

export function creatureWeapon(creature, index) {
  const weapons = creature.weapons;
  if (!weapons.length) return null;
  const n = Number.isFinite(index) ? Math.abs(Math.floor(index)) : 0;
  return weapons[n % weapons.length].id;
}

export function creatureAttackRange(creature, weapon) {
  if (!weapon) return creature.reach;
  for (let i = 0; i < creature.weapons.length; i += 1) {
    if (creature.weapons[i].id === weapon) return creature.weapons[i].range;
  }
  return creature.reach;
}
