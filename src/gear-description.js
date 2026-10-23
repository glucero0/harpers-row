// Turns the equipment files in src/gear into the plain objects the mesh builder reads.
// Pure: no THREE and no DOM. The files ship with the game, but they are still treated as data.
// Every field is copied onto a new object, numbers have to be finite and in range, and geometry is
// limited to a few small primitives. Nothing in these files is evaluated as code.
// They live under src, not public: Vite refuses to import files from the public directory.
import axeFile from './gear/axe.json';
import bowFile from './gear/bow.json';
import daggerFile from './gear/dagger.json';
import hammerFile from './gear/hammer.json';
import maceFile from './gear/mace.json';
import shieldFile from './gear/shield.json';
import spearFile from './gear/spear.json';
import swordFile from './gear/sword.json';
import torchFile from './gear/torch.json';
import { parseFireEmanation } from './fire-description.js';

const MAX_PARTS = 24;
const MAX_MATERIALS = 8;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const MATERIAL = /^[a-z][a-z0-9]{0,15}$/;

// Shield and torch are the left hand. Everything else is the right hand, even if a file disagrees.
const HANDS = {
  torch: 'left',
  shield: 'left',
  sword: 'right',
  mace: 'right',
  dagger: 'right',
  hammer: 'right',
  spear: 'right',
  axe: 'right',
  bow: 'right',
};
const SOCKETS = { left: 'leftHandSocket', right: 'rightHandSocket' };
const GEOMETRY = new Set(['lathe', 'torus', 'cylinder', 'sphere', 'box', 'cone', 'blade', 'shield', 'tube']);

export class GearDescriptionError extends Error {
  constructor(message) {
    super(String(message).slice(0, 200));
    this.name = 'GearDescriptionError';
  }
}

function fail(message) {
  throw new GearDescriptionError(message);
}

function plain(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  if (Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object.`);
  return value;
}

function num(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function int(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function vec3(value, min, max, label) {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label} must be [x, y, z].`);
  return [
    num(value[0], min, max, `${label}[0]`),
    num(value[1], min, max, `${label}[1]`),
    num(value[2], min, max, `${label}[2]`),
  ];
}

function rotation(value, label) {
  if (value == null) return null;
  const source = plain(value, label);
  const unit = source.unit;
  if (unit !== 'degrees' && unit !== 'radians') fail(`${label}.unit must be degrees or radians.`);
  const scale = unit === 'degrees' ? Math.PI / 180 : 1;
  const limit = unit === 'degrees' ? 360 : Math.PI * 2;
  return {
    x: num(source.x, -limit, limit, `${label}.x`) * scale,
    y: num(source.y, -limit, limit, `${label}.y`) * scale,
    z: num(source.z, -limit, limit, `${label}.z`) * scale,
  };
}

function color(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(`${label} must be a #rrggbb color.`);
  return value.toLowerCase();
}

function geometryOf(source, label) {
  const geometry = plain(source, label);
  const type = geometry.type;
  if (typeof type !== 'string' || !GEOMETRY.has(type)) fail(`${label}.type is not a known shape.`);
  if (type === 'lathe') {
    const points = geometry.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > 32) fail(`${label}.points must be 2 to 32.`);
    return {
      type,
      segments: int(geometry.segments, 3, 24, `${label}.segments`),
      points: points.map((point, index) => {
        if (!Array.isArray(point) || point.length !== 2) fail(`${label}.points[${index}] must be [r, y].`);
        return [
          num(point[0], 0, 2, `${label}.points[${index}][0]`),
          num(point[1], -2, 4, `${label}.points[${index}][1]`),
        ];
      }),
    };
  }
  if (type === 'torus') {
    return {
      type,
      radius: num(geometry.radius, 0.001, 2, `${label}.radius`),
      tube: num(geometry.tube, 0.001, 1, `${label}.tube`),
      radialSegments: int(geometry.radialSegments, 3, 32, `${label}.radialSegments`),
      tubularSegments: int(geometry.tubularSegments, 3, 48, `${label}.tubularSegments`),
    };
  }
  if (type === 'cylinder') {
    return {
      type,
      radiusTop: num(geometry.radiusTop, 0, 2, `${label}.radiusTop`),
      radiusBottom: num(geometry.radiusBottom, 0, 2, `${label}.radiusBottom`),
      height: num(geometry.height, 0.001, 4, `${label}.height`),
      radialSegments: int(geometry.radialSegments, 3, 32, `${label}.radialSegments`),
    };
  }
  if (type === 'sphere') {
    return {
      type,
      radius: num(geometry.radius, 0.001, 2, `${label}.radius`),
      widthSegments: int(geometry.widthSegments, 3, 32, `${label}.widthSegments`),
      heightSegments: int(geometry.heightSegments, 2, 24, `${label}.heightSegments`),
    };
  }
  if (type === 'box') {
    return {
      type,
      width: num(geometry.width, 0.001, 2, `${label}.width`),
      height: num(geometry.height, 0.001, 2, `${label}.height`),
      depth: num(geometry.depth, 0.001, 2, `${label}.depth`),
    };
  }
  if (type === 'cone') {
    return {
      type,
      radius: num(geometry.radius, 0.001, 2, `${label}.radius`),
      height: num(geometry.height, 0.001, 4, `${label}.height`),
      radialSegments: int(geometry.radialSegments, 3, 32, `${label}.radialSegments`),
    };
  }
  if (type === 'blade') {
    return {
      type,
      length: num(geometry.length, 0.02, 3, `${label}.length`),
      baseWidth: num(geometry.baseWidth, 0.001, 1, `${label}.baseWidth`),
      tipWidth: num(geometry.tipWidth, 0, 1, `${label}.tipWidth`),
      thickness: num(geometry.thickness, 0.001, 0.4, `${label}.thickness`),
      fuller: num(geometry.fuller, 0, 1, `${label}.fuller`),
      segments: int(geometry.segments, 1, 24, `${label}.segments`),
    };
  }
  if (type === 'shield') {
    if (geometry.outline !== 'round') fail(`${label}.outline is not a known shield.`);
    return {
      type,
      outline: 'round',
      width: num(geometry.width, 0.05, 2, `${label}.width`),
      height: num(geometry.height, 0.05, 2, `${label}.height`),
      thickness: num(geometry.thickness, 0.005, 0.4, `${label}.thickness`),
    };
  }
  const curve = plain(geometry.curve, `${label}.curve`);
  if (curve.type !== 'quadratic') fail(`${label}.curve.type must be quadratic.`);
  return {
    type,
    radius: num(geometry.radius, 0.001, 0.2, `${label}.radius`),
    tubularSegments: int(geometry.tubularSegments, 3, 48, `${label}.tubularSegments`),
    radialSegments: int(geometry.radialSegments, 3, 16, `${label}.radialSegments`),
    curve: {
      type: 'quadratic',
      from: vec3(curve.from, -4, 4, `${label}.curve.from`),
      control: vec3(curve.control, -4, 4, `${label}.curve.control`),
      to: vec3(curve.to, -4, 4, `${label}.curve.to`),
    },
  };
}

function materialsOf(data) {
  const source = plain(data.materials, 'materials');
  const names = Object.keys(source);
  if (names.length < 1 || names.length > MAX_MATERIALS) fail('materials must name 1 to 8 surfaces.');
  const materials = {};
  for (const name of names) {
    if (!MATERIAL.test(name)) fail('a material name is not allowed.');
    const spec = plain(source[name], `materials.${name}`);
    materials[name] = {
      color: color(spec.color, `materials.${name}.color`),
      roughness: num(spec.roughness, 0, 1, `materials.${name}.roughness`),
      metalness: num(spec.metalness, 0, 1, `materials.${name}.metalness`),
    };
  }
  return materials;
}

function partsOf(data, materials) {
  if (!Array.isArray(data.parts) || data.parts.length < 1 || data.parts.length > MAX_PARTS) {
    fail('parts must be a list of 1 to 24.');
  }
  const seen = new Set();
  return data.parts.map((part, index) => {
    const source = plain(part, `parts[${index}]`);
    if (typeof source.name !== 'string' || !NAME.test(source.name) || seen.has(source.name)) {
      fail('each part needs its own short name.');
    }
    seen.add(source.name);
    const position = vec3(source.position, -4, 4, `parts[${index}].position`);
    const spin = rotation(source.rotation, `parts[${index}].rotation`);
    if (source.type === 'group') {
      const hasFire = source.vfx != null || source.light != null;
      return {
        name: source.name,
        type: 'group',
        position,
        rotation: spin,
        fire: hasFire ? parseFireEmanation({ vfx: source.vfx, light: source.light }) : null,
      };
    }
    if (typeof source.material !== 'string' || !Object.hasOwn(materials, source.material)) {
      fail(`parts[${index}] names a material that is not declared.`);
    }
    return {
      name: source.name,
      type: 'mesh',
      material: source.material,
      geometry: geometryOf(source.geometry, `parts[${index}].geometry`),
      position,
      rotation: spin,
      fire: null,
    };
  });
}

function combatOf(data, hand) {
  if (data.combat == null) {
    if (hand === 'right') fail('a right-hand weapon needs combat.');
    return null;
  }
  const combat = plain(data.combat, 'combat');
  return {
    range: num(combat.range, 0.2, 30, 'combat.range'),
    arcRadians: num(combat.arcRadians, 0.05, Math.PI, 'combat.arcRadians'),
    damage: num(combat.damage, 0, 500, 'combat.damage'),
    attackInterval: num(combat.attackInterval, 0.05, 3, 'combat.attackInterval'),
  };
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

export function parseGearDescription(data) {
  const source = plain(data, 'gear');
  if (source.version !== 1) fail('gear version must be 1.');
  if (typeof source.kind !== 'string' || !Object.hasOwn(HANDS, source.kind)) fail('gear kind is not known.');
  if (source.id !== source.kind) fail('gear id must match its kind.');
  if (typeof source.name !== 'string' || source.name.length < 1 || source.name.length > 80) {
    fail('gear name must be 1 to 80 characters.');
  }
  const hand = HANDS[source.kind];
  if (source.hand !== hand) fail(`a ${source.kind} is held in the ${hand} hand.`);
  if (source.parent !== SOCKETS[hand]) fail('gear parent must be the socket for its hand.');
  if (typeof source.castShadow !== 'boolean') fail('castShadow must be true or false.');
  const options = plain(source.options, 'options');
  if (options.kind !== source.kind) fail('options.kind must match the gear kind.');
  const seed = int(source.seed, 0, 1_000_000_000, 'seed');
  if (options.seed !== seed) fail('options.seed must match seed.');
  int(options.tier, 1, 20, 'options.tier');
  const grip = plain(source.grip, 'grip');
  const restRotation = rotation(grip.restRotation, 'grip.restRotation');
  if (!restRotation) fail('grip.restRotation is required.');
  const materials = materialsOf(source);
  const parts = partsOf(source, materials);
  return freeze({
    parsed: true,
    version: 1,
    kind: source.kind,
    id: source.kind,
    name: source.name,
    seed,
    hand,
    parent: SOCKETS[hand],
    castShadow: source.castShadow,
    tier: options.tier,
    materials,
    parts,
    grip: { restRotation },
    combat: combatOf(source, hand),
  });
}

const FILES = [torchFile, shieldFile, swordFile, maceFile, daggerFile, hammerFile, spearFile, axeFile, bowFile];

export const gearCatalog = Object.freeze(FILES.map((file) => parseGearDescription(file)));
export const gearById = Object.freeze(Object.fromEntries(gearCatalog.map((item) => [item.id, item])));
export const leftGear = Object.freeze(gearCatalog.filter((item) => item.hand === 'left'));
export const rightGear = Object.freeze(gearCatalog.filter((item) => item.hand === 'right'));
export const torchDescription = gearById.torch;
export const maceDescription = gearById.mace;
