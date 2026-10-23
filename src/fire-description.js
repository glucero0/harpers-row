// The flame that leaves a fire: a particle emitter and a flickering point light.
// Pure: no THREE and no DOM. Campfires, the held torch, and wall sconces all pass through here.
// Known fields are copied onto a new object. Numbers have to be finite and in range. Nothing in the
// description is evaluated as code, and a preset only selects a motion the renderer already knows.

const HEX = /^#[0-9a-fA-F]{6}$/;
const PRESETS = new Set(['campfire_flames', 'torch_flames', 'sconce_flames']);

export class FireDescriptionError extends Error {
  constructor(message) {
    super(String(message).slice(0, 200));
    this.name = 'FireDescriptionError';
  }
}

function fail(message) {
  throw new FireDescriptionError(message);
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

function color(value, label) {
  if (typeof value !== 'string' || !HEX.test(value)) fail(`${label} must be a #rrggbb color.`);
  return value.toLowerCase();
}

function span(value, min, max, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must be [min, max].`);
  const low = num(value[0], min, max, `${label}[0]`);
  const high = num(value[1], min, max, `${label}[1]`);
  if (high < low) fail(`${label} max must be at least min.`);
  return [low, high];
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// How many billboards a fire needs. Rate is particles per second over the average lifetime, capped so
// one fire cannot ask for an unbounded mesh. Smoke and embers stay in the same proportion as the torch.
export function quadsFromEmitter(emitter) {
  const mean = (emitter.lifetime[0] + emitter.lifetime[1]) * 0.5;
  const fire = clampInt(Math.round(emitter.rate * mean), 1, 48);
  return {
    fire,
    smoke: clampInt(Math.round(fire * 6 / 16), 1, 48),
    embers: clampInt(Math.round(fire * 5 / 16), 1, 48),
  };
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

// `data` is `{ vfx, light }` as on a campfire fire-pit, or the same block on a piece of gear.
export function parseFireEmanation(data) {
  const source = plain(data, 'fire');
  const vfx = plain(source.vfx, 'vfx');
  if (vfx.type !== 'particle-system') fail('vfx.type must be particle-system.');
  if (typeof vfx.preset !== 'string' || !PRESETS.has(vfx.preset)) fail('vfx.preset is not a known fire.');
  const emitterSource = plain(vfx.emitter, 'vfx.emitter');
  const blendMode = emitterSource.blendMode;
  if (blendMode !== 'additive' && blendMode !== 'normal') fail('vfx.emitter.blendMode must be additive or normal.');
  const emitter = {
    rate: num(emitterSource.rate, 1, 80, 'vfx.emitter.rate'),
    lifetime: span(emitterSource.lifetime, 0.05, 8, 'vfx.emitter.lifetime'),
    colorStart: color(emitterSource.colorStart, 'vfx.emitter.colorStart'),
    colorEnd: color(emitterSource.colorEnd, 'vfx.emitter.colorEnd'),
    blendMode,
  };
  const lightSource = plain(source.light, 'light');
  if (lightSource.type !== 'point') fail('light.type must be point.');
  const flickerSource = plain(lightSource.flicker, 'light.flicker');
  return freeze({
    preset: vfx.preset,
    emitter,
    light: {
      color: color(lightSource.color, 'light.color'),
      intensity: num(lightSource.intensity, 0, 200, 'light.intensity'),
      distance: num(lightSource.distance, 0.5, 40, 'light.distance'),
      flicker: {
        speed: num(flickerSource.speed, 0, 40, 'light.flicker.speed'),
        variance: num(flickerSource.variance, 0, 1, 'light.flicker.variance'),
      },
    },
    quads: quadsFromEmitter(emitter),
  });
}

// Intensity wobble shared by every fire. The result stays inside ±variance. `time` may include a
// per-fire phase so a row of sconces does not pulse together. No allocation.
export function fireWobble(speed, variance, time) {
  const primary = Math.sin(time * speed);
  const secondary = Math.sin(time * speed * 1.9 + 2.1);
  return (primary * 0.75 + secondary * 0.25) * variance;
}
