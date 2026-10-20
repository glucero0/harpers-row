import * as THREE from 'three';

const TORCH_COLOR = 0xff8936;
const TORCH_DISTANCE = 25;
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
  constructor(particleCount = 45) {
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
      size: 0.18,
      map: createGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });
    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  resetParticle(index, positions, colors, initialRandom = false) {
    const ember = Math.random() > 0.65;
    positions[index * 3] = (Math.random() - 0.5) * 0.06;
    positions[index * 3 + 1] = initialRandom ? Math.random() * 0.3 : 0;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 0.06;
    if (ember) {
      this.velocities[index] = new THREE.Vector3(
        (Math.random() - 0.5) * 0.12,
        0.35 + Math.random() * 0.35,
        (Math.random() - 0.5) * 0.12,
      );
      this.lifespans[index] = 0.8 + Math.random() * 0.7;
      colors[index * 3] = 1;
      colors[index * 3 + 1] = 0.45;
      colors[index * 3 + 2] = 0.05;
    } else {
      this.velocities[index] = new THREE.Vector3(
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
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.001;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.near = 0.08;
  light.shadow.camera.far = TORCH_DISTANCE;
  tip.add(light);

  const particles = new TorchParticleEmitter(40);
  tip.add(particles.mesh);

  return { root, light, particles, tip };
}

function flickerTorch(light, time) {
  const wave = Math.sin(time * 12) * 0.15
    + Math.sin(time * 23.3) * 0.1
    + (Math.random() - 0.5) * 0.08;
  const flicker = wave * (TORCH_BASE / 2.2);
  light.intensity = Math.max(0.2, TORCH_BASE + flicker);
  light.position.x = Math.sin(time * 19.7) * 0.03;
  light.position.z = Math.cos(time * 14.3) * 0.03;
}

export { TorchParticleEmitter, createHeldTorch, flickerTorch };
