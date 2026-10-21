import * as THREE from 'three';

const TORCH_COLOR = 0xff8936;
const TORCH_DISTANCE = 12;
const TORCH_DECAY = 2;
const TORCH_BASE = 90;

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 200, 80, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 80, 20, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class TorchParticleEmitter {
  constructor(particleCount = 18) {
    this.count = particleCount;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    this.velocities = [];
    this.lifespans = [];
    this.ages = [];
    for (let i = 0; i < this.count; i += 1) {
      this.resetParticle(i, positions, colors, true);
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.1,
      map: createGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });
    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  resetParticle(index, positions, colors, initialRandom = false) {
    const ember = Math.random() > 0.65;
    positions[index * 3] = (Math.random() - 0.5) * 0.06;
    positions[index * 3 + 1] = initialRandom ? Math.random() * 0.3 : 0;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 0.06;
    if (!this.velocities[index]) this.velocities[index] = new THREE.Vector3();
    if (ember) {
      this.velocities[index].set(
        (Math.random() - 0.5) * 0.12,
        0.35 + Math.random() * 0.35,
        (Math.random() - 0.5) * 0.12,
      );
      this.lifespans[index] = 0.8 + Math.random() * 0.7;
      colors[index * 3] = 1;
      colors[index * 3 + 1] = 0.45;
      colors[index * 3 + 2] = 0.05;
    } else {
      this.velocities[index].set(
        (Math.random() - 0.5) * 0.08,
        0.8 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.08,
      );
      this.lifespans[index] = 0.25 + Math.random() * 0.3;
      colors[index * 3] = 1;
      colors[index * 3 + 1] = 0.8;
      colors[index * 3 + 2] = 0.3;
    }
    this.ages[index] = initialRandom ? Math.random() * this.lifespans[index] : 0;
  }

  update(delta) {
    const positions = this.geometry.attributes.position.array;
    const colors = this.geometry.attributes.color.array;
    for (let i = 0; i < this.count; i += 1) {
      this.ages[i] += delta;
      if (this.ages[i] >= this.lifespans[i]) {
        this.resetParticle(i, positions, colors);
        continue;
      }
      positions[i * 3] += this.velocities[i].x * delta + (Math.random() - 0.5) * 0.01;
      positions[i * 3 + 1] += this.velocities[i].y * delta;
      positions[i * 3 + 2] += this.velocities[i].z * delta + (Math.random() - 0.5) * 0.01;
      const life = this.ages[i] / this.lifespans[i];
      colors[i * 3 + 1] = Math.max(0, (1 - life) * 0.7);
      colors[i * 3] = Math.max(0, 1 - life * 0.6);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}

const SPARK_COUNT = 12;
const FLASH_SECONDS = 0.16;
const SPARK_GRAVITY = 2.6;
const EMBER_COUNT = 12;
const EMBER_DRAG = 1.8;
const EMBER_RISE = 0.9;

let sparkTexture;
function glowTexture() {
  if (!sparkTexture) sparkTexture = createGlowTexture();
  return sparkTexture;
}

// What a blow landing on the torch looks like: a hot flash at the point of contact, a spray of
// sparks, and a short pulse of extra light (read through `flash`). It lives on the torch tip, so it
// rides the torch wherever the guard holds it. Everything is additive and fades on its own.
class GuardImpact {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'GuardImpact';
    this.flashAge = FLASH_SECONDS;
    this.flashPower = 1;
    this.positions = new Float32Array(SPARK_COUNT * 3);
    this.colors = new Float32Array(SPARK_COUNT * 3);
    this.velocities = Array.from({ length: SPARK_COUNT }, () => new THREE.Vector3());
    this.lifespans = new Float32Array(SPARK_COUNT);
    this.ages = new Float32Array(SPARK_COUNT).fill(Infinity);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.sparks = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.11,
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
    }));
    this.sparks.frustumCulled = false;
    this.sparks.castShadow = false;
    this.sparks.receiveShadow = false;
    this.sparks.renderOrder = 11;
    this.sparks.visible = false;

    // Embers: bigger, redder and slower than the sparks. They are flung off the head, slow quickly,
    // and drift upward as they die, like burning bits jarred out of the fire.
    this.emberPositions = new Float32Array(EMBER_COUNT * 3);
    this.emberColors = new Float32Array(EMBER_COUNT * 3);
    this.emberVelocities = Array.from({ length: EMBER_COUNT }, () => new THREE.Vector3());
    this.emberLifespans = new Float32Array(EMBER_COUNT);
    this.emberAges = new Float32Array(EMBER_COUNT).fill(Infinity);
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(this.emberPositions, 3));
    emberGeometry.setAttribute('color', new THREE.BufferAttribute(this.emberColors, 3));
    this.embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({
      size: 0.12,
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
    }));
    this.embers.frustumCulled = false;
    this.embers.castShadow = false;
    this.embers.receiveShadow = false;
    this.embers.renderOrder = 11;
    this.embers.visible = false;

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xfff1c8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }));
    this.glow.renderOrder = 12;
    this.glow.visible = false;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xff9a3c,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }));
    this.halo.renderOrder = 10;
    this.halo.visible = false;
    this.group.add(this.embers, this.sparks, this.halo, this.glow);
  }

  // power 0..1: how hard the blow landed.
  burst(power = 1) {
    this.flashAge = 0;
    this.flashPower = power;
    this.glow.visible = true;
    this.halo.visible = true;
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const lift = Math.random() * 2 - 0.6;
      const speed = (0.7 + Math.random() * 1.6) * (0.6 + power * 0.6);
      const flat = Math.sqrt(Math.max(0, 1 - Math.min(1, lift * lift * 0.25)));
      this.velocities[i].set(Math.cos(angle) * flat * speed, lift * speed * 0.7, Math.sin(angle) * flat * speed);
      this.lifespans[i] = 0.14 + Math.random() * 0.22;
      this.ages[i] = 0;
      this.positions.fill(0, i * 3, i * 3 + 3);
    }
    this.sparks.visible = true;
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const lift = Math.random() * 1.6 - 0.4;
      const speed = (1 + Math.random() * 2.2) * (0.6 + power * 0.5);
      const flat = Math.sqrt(Math.max(0, 1 - Math.min(1, lift * lift * 0.4)));
      this.emberVelocities[i].set(Math.cos(angle) * flat * speed, lift * speed * 0.6, Math.sin(angle) * flat * speed);
      this.emberLifespans[i] = 0.35 + Math.random() * 0.45;
      this.emberAges[i] = 0;
      this.emberPositions.fill(0, i * 3, i * 3 + 3);
    }
    this.embers.visible = true;
    // Show the flash on the very frame of contact rather than waiting for the next update.
    this.update(0);
  }

  // 1 at the instant of contact, falling to 0 over FLASH_SECONDS. Drives the torch light pulse.
  get flash() {
    const t = this.flashAge / FLASH_SECONDS;
    return t >= 1 ? 0 : (1 - t) * (1 - t) * this.flashPower;
  }

  update(delta) {
    this.flashAge = Math.min(FLASH_SECONDS, this.flashAge + delta);
    const f = this.flash;
    // A hot core that blooms outward as it fades, with a wider halo behind it.
    this.glow.material.opacity = Math.min(1, f * 1.6);
    this.glow.scale.setScalar(0.5 + 1.3 * (this.flashAge / FLASH_SECONDS) * this.flashPower + 0.5 * f);
    this.halo.material.opacity = Math.min(1, f * 0.9);
    this.halo.scale.setScalar(1.1 + 2 * (this.flashAge / FLASH_SECONDS) * this.flashPower + 0.6 * f);
    if (f <= 0) {
      this.glow.visible = false;
      this.halo.visible = false;
    }

    let alive = false;
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      this.ages[i] += delta;
      if (this.ages[i] >= this.lifespans[i]) {
        this.colors.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      alive = true;
      this.velocities[i].y -= SPARK_GRAVITY * delta;
      this.positions[i * 3] += this.velocities[i].x * delta;
      this.positions[i * 3 + 1] += this.velocities[i].y * delta;
      this.positions[i * 3 + 2] += this.velocities[i].z * delta;
      const life = 1 - this.ages[i] / this.lifespans[i];
      this.colors[i * 3] = life;
      this.colors[i * 3 + 1] = life * (0.55 + 0.4 * life);
      this.colors[i * 3 + 2] = life * life * 0.5;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
    this.sparks.visible = alive;

    let emberAlive = false;
    const drag = Math.exp(-EMBER_DRAG * delta);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      this.emberAges[i] += delta;
      if (this.emberAges[i] >= this.emberLifespans[i]) {
        this.emberColors.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      emberAlive = true;
      const velocity = this.emberVelocities[i];
      velocity.multiplyScalar(drag);
      velocity.y += EMBER_RISE * delta;
      this.emberPositions[i * 3] += velocity.x * delta;
      this.emberPositions[i * 3 + 1] += velocity.y * delta;
      this.emberPositions[i * 3 + 2] += velocity.z * delta;
      const life = 1 - this.emberAges[i] / this.emberLifespans[i];
      // Orange to deep red as each ember cools.
      this.emberColors[i * 3] = Math.min(1, life * 1.4);
      this.emberColors[i * 3 + 1] = life * life * 0.42;
      this.emberColors[i * 3 + 2] = life * life * life * 0.08;
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
    this.embers.geometry.attributes.color.needsUpdate = true;
    this.embers.visible = emberAlive;
  }

  dispose() {
    this.sparks.geometry.dispose();
    this.sparks.material.dispose();
    this.embers.geometry.dispose();
    this.embers.material.dispose();
    this.glow.material.dispose();
    this.halo.material.dispose();
  }
}

function createHeldTorch(materials) {
  const root = new THREE.Group();
  root.name = 'torch';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.62, 8), materials.plank);
  handle.position.y = 0.16;
  handle.castShadow = false;
  const sconce = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.055, 0.14, 8), materials.metal);
  sconce.position.y = 0.5;
  sconce.castShadow = false;
  const tip = new THREE.Group();
  tip.name = 'TorchTipSocket';
  tip.position.y = 0.58;
  root.add(handle, sconce, tip);

  const light = new THREE.PointLight(TORCH_COLOR, TORCH_BASE, TORCH_DISTANCE, TORCH_DECAY);
  light.decay = TORCH_DECAY;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.0008;
  light.shadow.normalBias = 0.04;
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 12;
  tip.add(light);
  tip.add(createTorchVolume());

  const particles = new TorchParticleEmitter(18);
  tip.add(particles.mesh);

  const impact = new GuardImpact();
  tip.add(impact.group);

  return { root, light, particles, tip, impact };
}

// `flash` (0..1) briefly drives the light up when something strikes the torch.
function createTorchVolume() {
  const geometry = new THREE.ConeGeometry(0.62, 3.4, 14, 1, true);
  geometry.translate(0, 1.7, 0);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0xff7a2a) },
    },
    vertexShader: `
      varying float vAlong;
      varying float vRadial;
      void main() {
        vAlong = clamp(position.y / 3.4, 0.0, 1.0);
        vRadial = length(position.xz) / max(0.08, 0.2 + vAlong * 0.62);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlong;
      varying float vRadial;
      uniform vec3 uColor;
      void main() {
        float beam = smoothstep(1.15, 0.15, vRadial);
        beam *= smoothstep(0.0, 0.12, vAlong) * smoothstep(1.0, 0.35, vAlong);
        gl_FragColor = vec4(uColor, beam * 0.16);
      }
    `,
  });
  const cone = new THREE.Mesh(geometry, material);
  cone.name = 'torchVolume';
  cone.frustumCulled = false;
  cone.renderOrder = 1;
  return cone;
}

function flickerTorch(light, time, flash = 0) {
  const wobble = Math.sin(time * 9.2) * 0.1
    + Math.sin(time * 17.4) * 0.07
    + (Math.random() - 0.5) * 0.14;
  light.intensity = Math.max(8, TORCH_BASE * (0.78 + wobble)) + flash * TORCH_BASE * 2.4;
  const jitter = Math.random() - 0.5;
  light.position.x = Math.sin(time * 13.2) * 0.05 + jitter * 0.02;
  light.position.y = Math.sin(time * 8.1) * 0.035 + jitter * 0.015;
  light.position.z = Math.cos(time * 11.6) * 0.05;
}

export { GuardImpact, TorchParticleEmitter, createHeldTorch, flickerTorch };
