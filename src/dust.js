import * as THREE from 'three';
import { audio } from './audio.js';

const AMBIENT_COUNT = 220;
const BURST_CAP = 280;

let active = null;
let gravelWait = 0;

function finitePosition(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

export function burstCount(intensityMultiplier) {
  const scale = Math.min(6, Math.max(0, Number(intensityMultiplier) || 0));
  if (scale <= 0) return 0;
  return Math.min(40, Math.max(6, Math.round(12 * scale)));
}

const DUST_GLSL = `
float dustHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 dustCurl(vec3 p) {
  float e = 0.22;
  float nx = dustHash(p + vec3(e, 0.0, 0.0)) - dustHash(p - vec3(e, 0.0, 0.0));
  float ny = dustHash(p + vec3(0.0, e, 0.0)) - dustHash(p - vec3(0.0, e, 0.0));
  float nz = dustHash(p + vec3(0.0, 0.0, e)) - dustHash(p - vec3(0.0, 0.0, e));
  return vec3(nz - ny, nx - nz, ny - nx);
}
vec3 dustBrownian(vec3 seed, float time) {
  return vec3(
    sin(time * 0.65 + seed.x * 12.0) + sin(time * 1.7 + seed.y * 5.0) * 0.45,
    cos(time * 0.5 + seed.y * 9.0) * 0.55,
    sin(time * 0.58 + seed.z * 8.0) + cos(time * 1.3 + seed.x * 4.0) * 0.4
  );
}
`;

const POINT_FRAGMENT = `
varying float vAlpha;
varying vec3 vColor;
varying float vSpin;
varying vec3 vWorld;
uniform vec3 uTorch;
uniform float uTorchPower;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float c = cos(vSpin);
  float s = sin(vSpin);
  coord = mat2(c, -s, s, c) * coord;
  float dist = length(coord);
  if (dist > 0.5) discard;
  float grain = fract(sin(dot(coord * vec2(41.0, 87.0), vec2(12.9898, 78.233)) + vSpin) * 43758.5453);
  float disk = smoothstep(0.5, 0.02, dist);
  float mote = disk * mix(0.28, 1.0, smoothstep(0.18, 0.82, grain));
  float reach = distance(vWorld, uTorch);
  float atten = uTorchPower / (1.0 + 0.07 * reach * reach);
  vec3 lit = vColor * (0.22 + vec3(1.0, 0.56, 0.24) * atten * 1.65);
  gl_FragColor = vec4(lit, mote * vAlpha);
}
`;

const AMBIENT_FRAGMENT = `
varying float vAlpha;
varying vec3 vColor;
varying float vSpin;
varying vec3 vWorld;
uniform vec3 uTorch;
uniform float uTorchPower;
void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float c = cos(vSpin);
  float s = sin(vSpin);
  coord = mat2(c, -s, s, c) * coord;
  float dist = length(coord);
  if (dist > 0.5) discard;
  float disk = smoothstep(0.5, 0.0, dist);
  float grain = fract(sin(dot(gl_PointCoord, vec2(12.9898, 78.233)) + vSpin) * 43758.5453);
  float mote = disk * mix(0.45, 1.0, grain);
  float reach = distance(vWorld, uTorch);
  float atten = uTorchPower / (1.0 + 0.05 * reach * reach);
  vec3 tint = vColor * atten * mote * vAlpha;
  gl_FragColor = vec4(tint, 1.0);
}
`;

function dustMaterial(vertexShader, fragmentShader = POINT_FRAGMENT, blending = THREE.NormalBlending) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmount: { value: 1 },
      uTorch: { value: new THREE.Vector3() },
      uTorchPower: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending,
  });
}

function createAmbient(parent) {
  const seeds = new Float32Array(AMBIENT_COUNT * 3);
  for (let index = 0; index < AMBIENT_COUNT; index += 1) {
    seeds[index * 3] = Math.random();
    seeds[index * 3 + 1] = Math.random();
    seeds[index * 3 + 2] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AMBIENT_COUNT * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const uniforms = {
    uTime: { value: 0 },
    uAmount: { value: 1 },
    uTorch: { value: new THREE.Vector3() },
    uTorchPower: { value: 0 },
  };
  const material = dustMaterial(`
    ${DUST_GLSL}
    attribute vec3 aSeed;
    uniform float uTime;
    uniform float uAmount;
    varying float vAlpha;
    varying vec3 vColor;
    varying float vSpin;
    varying vec3 vWorld;
    void main() {
      float lifeTime = mix(6.0, 8.0, aSeed.z);
      float life = fract(uTime / lifeTime + aSeed.y);
      float age = life * lifeTime;
      vec3 seed = aSeed * vec3(8.0, 4.0, 8.0);
      vec3 drift = dustCurl(seed + vec3(uTime * 0.15)) * 0.25;
      float fall = mix(0.32, 0.96, aSeed.x) * age;
      vec3 local;
      local.x = (aSeed.x - 0.5) * 25.6 + drift.x;
      local.y = (aSeed.z - 0.5) * 19.2 - fall + drift.y;
      local.z = (aSeed.y - 0.5) * 25.6 + drift.z;
      vec4 world = modelMatrix * vec4(local, 1.0);
      vWorld = world.xyz;
      vec4 mv = viewMatrix * world;
      gl_Position = projectionMatrix * mv;
      float size = 3.2 + aSeed.x * 4.2;
      gl_PointSize = size * (8.0 / max(1.0, -mv.z));
      float fade = smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.82, life);
      vAlpha = fade * uAmount;
      vColor = vec3(0.78, 0.64, 0.42);
      vSpin = uTime * (0.08 + aSeed.x * 0.2) + aSeed.z * 6.2;
    }
  `, AMBIENT_FRAGMENT, THREE.AdditiveBlending);
  material.uniforms = uniforms;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 2;
  parent.add(points);
  return { points, uniforms, geometry, material };
}

function createBursts(parent) {
  const count = BURST_CAP;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const origin = new Float32Array(count * 3);
  const seed = new Float32Array(count * 3);
  const birth = new Float32Array(count);
  const life = new Float32Array(count);
  const speed = new Float32Array(count);
  const crumb = new Float32Array(count);
  birth.fill(-1);
  for (let index = 0; index < count; index += 1) {
    seed[index * 3] = Math.random();
    seed[index * 3 + 1] = Math.random();
    seed[index * 3 + 2] = Math.random();
    life[index] = 1.4;
    speed[index] = 1;
  }
  geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geometry.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
  geometry.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute('aCrumb', new THREE.BufferAttribute(crumb, 1));
  const uniforms = {
    uTime: { value: 0 },
    uTorch: { value: new THREE.Vector3() },
    uTorchPower: { value: 0 },
  };
  const material = dustMaterial(`
    ${DUST_GLSL}
    attribute vec3 aOrigin;
    attribute vec3 aSeed;
    attribute float aBirth;
    attribute float aLife;
    attribute float aSpeed;
    attribute float aCrumb;
    uniform float uTime;
    varying float vAlpha;
    varying vec3 vColor;
    varying float vSpin;
    varying vec3 vWorld;
    void main() {
      float age = uTime - aBirth;
      if (aBirth < 0.0 || age < 0.0 || age > aLife) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vAlpha = 0.0;
        vColor = vec3(0.0);
        vSpin = 0.0;
        vWorld = vec3(0.0);
        return;
      }
      float drag = mix(0.4, 1.15, aCrumb);
      float terminal = mix(0.22, 1.55, aCrumb) * aSpeed;
      float fall = terminal * (age - (1.0 - exp(-drag * age)) / drag);
      vec3 drift = dustCurl(aOrigin * 0.17 + aSeed * 4.0 + vec3(age * 0.2)) * mix(0.85, 0.25, aCrumb);
      drift += dustBrownian(aSeed, age) * mix(0.38, 0.12, aCrumb);
      vec3 pos = aOrigin + drift;
      pos.y -= fall;
      vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
      vec4 mv = viewMatrix * vec4(vWorld, 1.0);
      gl_Position = projectionMatrix * mv;
      float size = mix(2.6 + aSeed.x * 4.8, 5.5 + aSeed.y * 3.0, aCrumb);
      gl_PointSize = size * (8.0 / max(1.0, -mv.z));
      float t = age / aLife;
      float fade = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.62, t);
      vAlpha = fade * mix(mix(0.12, 0.25, aSeed.z), 0.42, aCrumb);
      vColor = mix(vec3(0.5, 0.44, 0.36), vec3(0.38, 0.33, 0.28), aCrumb);
      vSpin = age * mix(0.4, 1.6, aCrumb) + aSeed.x * 5.0;
    }
  `);
  material.uniforms = uniforms;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  parent.add(points);
  return {
    points,
    uniforms,
    geometry,
    material,
    origin,
    birth,
    life,
    speed,
    crumb,
    cursor: 0,
    count,
  };
}

function applyTorch(uniforms, x, y, z, power) {
  uniforms.uTorch.value.set(x, y, z);
  uniforms.uTorchPower.value = power;
}

export function createDustField(parent) {
  const ambient = createAmbient(parent);
  const bursts = createBursts(parent);
  const field = {
    time: 0,
    ambient,
    bursts,
    setTorch(x, y, z, power) {
      const px = Number(x);
      const py = Number(y);
      const pz = Number(z);
      const lit = Number(power);
      const safePower = Number.isFinite(lit) ? Math.max(0, Math.min(3, lit)) : 0;
      const sx = Number.isFinite(px) ? px : 0;
      const sy = Number.isFinite(py) ? py : 0;
      const sz = Number.isFinite(pz) ? pz : 0;
      applyTorch(ambient.uniforms, sx, sy, sz, safePower);
      applyTorch(bursts.uniforms, sx, sy, sz, safePower);
    },
    burst(intensityMultiplier, position) {
      const spot = finitePosition(position);
      const amount = burstCount(intensityMultiplier);
      if (!spot || amount <= 0) return 0;
      for (let index = 0; index < amount; index += 1) {
        const slot = (bursts.cursor + index) % bursts.count;
        const crumb = Math.random() < 0.38 ? 1 : 0;
        bursts.origin[slot * 3] = spot.x + (Math.random() - 0.5) * (0.8 + crumb);
        bursts.origin[slot * 3 + 1] = spot.y + Math.random() * (1.2 + crumb * 0.8);
        bursts.origin[slot * 3 + 2] = spot.z + (Math.random() - 0.5) * (0.8 + crumb);
        bursts.birth[slot] = field.time;
        bursts.life[slot] = (crumb ? 1.3 : 2.4) + Math.random() * 1.4;
        bursts.speed[slot] = 0.75 + Math.random() * 0.5;
        bursts.crumb[slot] = crumb;
      }
      bursts.cursor = (bursts.cursor + amount) % bursts.count;
      bursts.geometry.attributes.aOrigin.needsUpdate = true;
      bursts.geometry.attributes.aBirth.needsUpdate = true;
      bursts.geometry.attributes.aLife.needsUpdate = true;
      bursts.geometry.attributes.aSpeed.needsUpdate = true;
      bursts.geometry.attributes.aCrumb.needsUpdate = true;
      return amount;
    },
    update(time, indoors, camera) {
      const step = Math.max(0, time - field.time);
      field.time = time;
      if (gravelWait > 0) gravelWait = Math.max(0, gravelWait - (step > 0 && step < 1 ? step : 0.016));
      ambient.uniforms.uTime.value = time;
      bursts.uniforms.uTime.value = time;
      ambient.points.visible = !!indoors;
      if (camera) {
        camera.getWorldPosition(ambient.points.position);
        ambient.points.quaternion.identity();
      }
      ambient.uniforms.uAmount.value = indoors ? 1 : 0;
      bursts.points.position.set(0, 0, 0);
    },
    dispose() {
      ambient.geometry.dispose();
      ambient.material.dispose();
      bursts.geometry.dispose();
      bursts.material.dispose();
      if (active === field) active = null;
    },
  };
  active = field;
  return field;
}

export function clearDustField(field) {
  if (active === field) active = null;
}

export function setDustLight(x, y, z, power) {
  if (!active) return;
  active.setTorch(x, y, z, power);
}

// Heavier dust and stone crumbs. intensityMultiplier scales the burst.
// position is a world point with x, y, and z, such as a THREE.Vector3.
export function TriggerDustFall(intensityMultiplier, position) {
  if (!active) return 0;
  const amount = active.burst(intensityMultiplier, position);
  const scale = Math.min(6, Math.max(0, Number(intensityMultiplier) || 0));
  if (amount > 0 && scale >= 0.9 && gravelWait <= 0) {
    gravelWait = 0.55;
    audio.gravel(position);
  }
  return amount;
}
