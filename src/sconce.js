import * as THREE from 'three';
import { audio } from './audio.js';

const FLAME_OFFSET = 1.2;
const SCONCE_RANGE = 10;
const SCONCE_COLOR = 0xffa036;
const SCONCE_INTENSITY = 1.8;
const SCONCE_RISE = 0.3;
const SHAFT_RADIUS = 0.15;

const FLAME_FRAGMENT = `
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  float dist = length(vUv);
  if (dist > 1.0) discard;
  float soft = smoothstep(1.0, 0.12, dist);
  vec3 flame = mix(vec3(1.0, 0.96, 0.72), vec3(1.0, 0.42, 0.05), smoothstep(0.05, 0.85, dist));
  gl_FragColor = vec4(mix(flame, vColor, 0.35) * soft * vAlpha, soft * vAlpha);
}
`;

function flameQuads(count, mode, uniforms) {
  const seeds = new Float32Array(count * 4 * 3);
  const corners = new Float32Array(count * 4 * 2);
  const indices = [];
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let index = 0; index < count; index += 1) {
    const seed = [Math.random(), Math.random(), Math.random()];
    for (let point = 0; point < 4; point += 1) {
      const vertex = index * 4 + point;
      seeds[vertex * 3] = seed[0];
      seeds[vertex * 3 + 1] = seed[1];
      seeds[vertex * 3 + 2] = seed[2];
      corners[vertex * 2] = corner[point][0];
      corners[vertex * 2 + 1] = corner[point][1];
    }
    const base = index * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: mode === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aSeed;
      attribute vec2 aCorner;
      uniform float uTime;
      varying float vAlpha;
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float kind = ${mode === 'fire' ? '0.0' : mode === 'smoke' ? '1.0' : '2.0'};
        float lifeTime = kind < 0.5 ? mix(0.4, 0.6, aSeed.x) : (kind < 1.5 ? mix(1.3, 1.8, aSeed.x) : mix(0.45, 0.7, aSeed.x));
        float life = fract(uTime / lifeTime + aSeed.y);
        float rare = kind > 1.5 ? step(0.62, aSeed.z) : 1.0;
        float rise = kind < 0.5 ? 0.72 : (kind < 1.5 ? 1.15 : 0.95);
        float curl = sin(uTime * 3.4 + aSeed.y * 13.0) * cos(uTime * 1.7 + aSeed.z * 9.0);
        float tongue = sin(uTime * 6.2 + aSeed.x * 17.0) * 0.045;
        vec3 local = vec3(
          (aSeed.z - 0.5) * (kind < 0.5 ? 0.1 : 0.16) + curl * 0.07 + tongue,
          life * rise,
          (aSeed.y - 0.5) * 0.1 + curl * 0.05
        );
        vec4 mv = modelViewMatrix * vec4(local, 1.0);
        float startSize = kind < 0.5 ? mix(0.48, 0.8, aSeed.x) : (kind < 1.5 ? mix(0.28, 0.46, aSeed.y) : 0.08);
        float size = kind < 1.5 ? mix(startSize, startSize * (kind < 0.5 ? 0.22 : 1.35), life) : startSize;
        mv.xy += aCorner * size * 0.5;
        gl_Position = projectionMatrix * mv;
        vUv = aCorner;
        float fade = smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.62, life);
        vAlpha = fade * rare * (kind < 0.5 ? 0.9 : (kind < 1.5 ? 0.28 : 0.85));
        if (kind < 0.5) vColor = mix(vec3(1.0, 0.95, 0.62), vec3(0.95, 0.28, 0.04), life);
        else if (kind < 1.5) vColor = vec3(0.16, 0.15, 0.14);
        else vColor = vec3(1.0, 0.62, 0.16);
      }
    `,
    fragmentShader: mode === 'smoke' ? `
      varying float vAlpha;
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float dist = length(vUv);
        if (dist > 1.0) discard;
        float soft = smoothstep(1.0, 0.2, dist);
        gl_FragColor = vec4(vColor, soft * vAlpha);
      }
    ` : FLAME_FRAGMENT,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  mesh.renderOrder = mode === 'smoke' ? 3 : 4;
  return { mesh, geometry, material };
}

function createFlamePoints() {
  const uniforms = { uTime: { value: 0 } };
  const fire = flameQuads(16, 'fire', uniforms);
  const smoke = flameQuads(6, 'smoke', uniforms);
  const embers = flameQuads(5, 'embers', uniforms);
  const mesh = new THREE.Group();
  mesh.add(fire.mesh, smoke.mesh, embers.mesh);
  mesh.visible = false;
  mesh.traverse((obj) => {
    obj.castShadow = false;
    obj.receiveShadow = false;
    obj.frustumCulled = false;
  });
  return { mesh, uniforms, fire, smoke, embers };
}

export class SconceInteractable {
  constructor(spec) {
    this.lit = false;
    this.lightLevel = 0;
    this.x = spec.x;
    this.z = spec.z;
    this.light = spec.light;
    this.flame = spec.flame;
    this.glow = spec.glow;
    this.particles = spec.particles;
    this.roomId = spec.roomId;
    this.rise = 0;
  }

  near(playerX, playerZ, torchX, torchZ) {
    const body = Math.hypot(this.x - playerX, this.z - playerZ);
    const torch = Math.hypot(this.x - torchX, this.z - torchZ);
    return body < 2.75 || torch < 2.15;
  }

  facing(playerX, playerZ, yaw) {
    const dx = this.x - playerX;
    const dz = this.z - playerZ;
    const dist = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    return (fx * dx + fz * dz) / dist > 0.2;
  }

  // swing, use, or a raised torch while standing at the sconce.
  tryIgnite(intent) {
    if (this.lit || !intent?.clear) return false;
    if (!this.near(intent.x, intent.z, intent.torchX, intent.torchZ)) return false;
    if (!this.facing(intent.x, intent.z, intent.yaw)) return false;
    if (!intent.swing && !intent.use && !intent.block) return false;
    this.ignite();
    return true;
  }

  ignite() {
    if (this.lit) return;
    this.lit = true;
    this.flame.visible = true;
    this.glow.visible = true;
    this.particles.mesh.visible = true;
    for (const layer of this.particles.mesh.children) layer.visible = true;
    this.light.visible = true;
    this.light.color.set(SCONCE_COLOR);
    this.light.distance = SCONCE_RANGE;
    this.light.castShadow = false;
    this.light.intensity = 0;
    this.rise = 0;
    audio.ignite();
    audio.startFire(this.fireId, this.x, this.lightY, this.z);
  }

  cullLight(hidden) {
    if (!this.lit) return;
    this.light.visible = !hidden;
    this.particles.mesh.visible = !hidden;
  }

  update(dt, time) {
    this.particles.uniforms.uTime.value = time;
    if (!this.lit) return;
    this.rise = Math.min(SCONCE_RISE, this.rise + dt);
    if (!this.light.visible) return;
    const warmed = 1 - (1 - this.rise / SCONCE_RISE) ** 3;
    const noise = perlin(time * 1.7 + this.x * 0.17) * 0.65
      + perlin(time * 3.4 + this.z * 0.13) * 0.35;
    const flicker = Math.max(-1, Math.min(1, noise));
    this.light.intensity = warmed * (SCONCE_INTENSITY + flicker * 0.25);
  }
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function perlin(x) {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = Math.sin(i * 127.1 + 311.7);
  const g1 = Math.sin((i + 1) * 127.1 + 311.7);
  return g0 + (g1 - g0) * fade(f);
}

function ragMaterial() {
  const size = 128;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const hatch = Math.abs(((u + v) * 8) % 1 - 0.5) < 0.08 || Math.abs(((u - v + 1) * 8) % 1 - 0.5) < 0.08;
      const tar = Math.abs(Math.sin(u * 18.4) * Math.cos(v * 15.2));
      height[y * size + x] = (hatch ? 0.85 : 0.35) - tar * 0.25;
    }
  }
  const color = document.createElement('canvas');
  color.width = size;
  color.height = size;
  const ctx = color.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < height.length; i += 1) {
    const shade = Math.floor(18 + height[i] * 42);
    image.data[i * 4] = shade + 6;
    image.data[i * 4 + 1] = shade;
    image.data[i * 4 + 2] = shade - 4;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;

  const normals = document.createElement('canvas');
  normals.width = size;
  normals.height = size;
  const normalCtx = normals.getContext('2d');
  const normalImage = normalCtx.createImageData(size, size);
  const sample = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      const nx = -dx * 3.2;
      const ny = -dy * 3.2;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      const pixel = (y * size + x) * 4;
      normalImage.data[pixel] = (nx / length * 0.5 + 0.5) * 255;
      normalImage.data[pixel + 1] = (ny / length * 0.5 + 0.5) * 255;
      normalImage.data[pixel + 2] = (nz / length * 0.5 + 0.5) * 255;
      normalImage.data[pixel + 3] = 255;
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  const normalMap = new THREE.CanvasTexture(normals);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;

  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    color: 0x241e1a,
    roughness: 0.96,
    metalness: 0.02,
  });
  material.userData.shared = true;
  return material;
}

const RAG = ragMaterial();

function ironBar(material, x, y, z, w, h, d, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rx;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createWallSconce(materials, anchor) {
  const iron = materials.iron || materials.brazier;
  const group = new THREE.Group();
  const plate = ironBar(iron, 0.06, 0.15, 0, 0.12, 1.7, 0.62);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.08), iron);
  arm.position.set(0.62, 0.22, 0);
  arm.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.032, 6, 14), iron);
  ring.position.set(FLAME_OFFSET, 0.5, 0);
  ring.castShadow = true;
  const cage = [
    ironBar(iron, FLAME_OFFSET, 0.86, 0.2, 0.028, 0.5, 0.028),
    ironBar(iron, FLAME_OFFSET, 0.86, -0.2, 0.028, 0.5, 0.028),
    ironBar(iron, FLAME_OFFSET + 0.2, 0.86, 0, 0.028, 0.5, 0.028),
    ironBar(iron, FLAME_OFFSET - 0.2, 0.86, 0, 0.028, 0.5, 0.028),
    ironBar(iron, FLAME_OFFSET, 1.1, 0, 0.42, 0.028, 0.42),
  ];
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS + 0.012, 0.86, 10), materials.plank);
  torch.position.set(FLAME_OFFSET, 0.46, 0);
  torch.castShadow = true;
  const pitch = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), RAG);
  pitch.scale.set(1.05, 1.28, 1.05);
  pitch.position.set(FLAME_OFFSET, 0.98, 0);
  pitch.castShadow = true;
  const rags = [
    [0.35, 0.2, 0.7],
    [-0.8, 1.1, 0.4],
    [1.2, 0.55, -0.5],
    [0.15, 1.7, 1.05],
  ].map(([rx, ry, rz]) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.11), RAG);
    strip.position.set(FLAME_OFFSET, 0.96, 0);
    strip.rotation.set(rx, ry, rz);
    strip.castShadow = true;
    return strip;
  });
  const straps = [0.42, 0.62].map((height) => {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(SHAFT_RADIUS + 0.02, 0.014, 4, 10), materials.leather);
    strap.position.set(FLAME_OFFSET, height, 0);
    strap.castShadow = true;
    return strap;
  });
  const flamePos = new THREE.Vector3(FLAME_OFFSET, 1.18, 0);
  const light = new THREE.PointLight(SCONCE_COLOR, 0, SCONCE_RANGE, 2);
  light.position.copy(flamePos);
  light.visible = false;
  light.decay = 2;
  light.castShadow = false;
  const particles = createFlamePoints();
  particles.mesh.position.copy(flamePos);
  group.add(plate, arm, ring, torch, pitch, ...rags, ...straps, ...cage, light, particles.mesh);
  group.position.set(anchor.x, 5.6, anchor.z);
  group.rotation.y = Math.atan2(-anchor.nz, anchor.nx);
  const interactable = new SconceInteractable({
    x: anchor.x + anchor.nx * FLAME_OFFSET,
    z: anchor.z + anchor.nz * FLAME_OFFSET,
    light,
    flame: particles.mesh,
    glow: particles.mesh,
    particles,
    roomId: anchor.roomId,
  });
  interactable.fireId = `${anchor.x.toFixed(2)}:${anchor.z.toFixed(2)}`;
  interactable.lightY = 6.7;
  return { group, interactable, particles };
}
