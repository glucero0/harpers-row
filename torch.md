Prompt 1 - Equipping the Torch & Mace to Player Sockets / Hands
Refactor the player character setup in Three.js to equip weapons to each hand:

Attach a mace mesh to the character's right hand bone (or right-hand container if procedural/unrigged). Position and rotate it so the grip aligns naturally with the palm.

Attach a torch mesh (wooden handle cylinder + metal sconce head) to the character's left hand bone/container.

Ensure both weapon meshes are parented to their respective hand transforms so they inherit walking, swinging, and idle animations.

Expose reference hooks player.weapons.rightHand and player.weapons.leftHand so we can easily swap equipment or adjust local offsets (position.set(...), rotation.set(...)).

Prompt 2 - Attaching the Torch Light & Organic Flicker Logic
Update the torch in the player's left hand to serve as the primary dynamic light source for the dungeon:

Attach a THREE.PointLight directly to the tip of the torch mesh:

Color: Warm orange/amber (0xff8936 or similar fire tone).

Distance: Set appropriate dungeon falloff (e.g., 18–25 units) with quadratic decay (decay = 2.0).

Cast shadows: Enable castShadow = true on this point light, configured with a 1024x1024 shadow map.

Implement a natural torch flicker loop in the main game update loop (tick / requestAnimationFrame):

Do NOT use pure random jitter (looks like a broken fluorescent bulb).

Combine two layered Math.sin() waves with slight irrational frequencies plus a small Perlin or pseudo-random jitter for irregular guttering:

JavaScript
const time = clock.getElapsedTime();
const baseIntensity = 2.2;
const flicker = Math.sin(time * 12.0) * 0.15 + Math.sin(time * 23.3) * 0.1 + (Math.random() - 0.5) * 0.08;
torchLight.intensity = Math.max(0.2, baseIntensity + flicker);
Add subtle micro-wobble to the light position offset (±0.03 on X/Z) to simulate the physical flame dancing around the wick.

Prompt 3 - Dungeon Ambient Cleanup & Shadow Bias
Adjust the scene lighting and render settings now that the player's torch is the primary light source:

Strip out or drastically reduce all static room lights to near pitch-black, leaving only a very low ambient light (THREE.AmbientLight color 0x080812, intensity around 0.1 to 0.2) so unlit corners stay deeply shadowed without clipping hard black.

Set up shadow.bias = -0.001 and shadow.normalBias = 0.02 on the torch PointLight to prevent shadow acne on dungeon wall corners and skeleton geometry.

Confirm renderer.shadowMap.type is set to THREE.PCFSoftShadowMap for soft, organic shadow edges cast from the moving flame.

1. Procedural Glow Sprite Helper
Generate a soft circular alpha glow directly in code so you do not have to load external PNGs:

JavaScript
import * as THREE from 'three';

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.2, 'rgba(255, 200, 80, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 80, 20, 0.3)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
2. The Torch Particle Emitter Class
This creates an emitter parented directly to the torch tip. It recycles a small buffer of 45 particles (fast flame core + slow drifting spark embers):

JavaScript
export class TorchParticleEmitter {
  constructor(particleCount = 45) {
    this.count = particleCount;
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(this.count * 3);
    const colors = new Float32Array(this.count * 3);
    this.velocities = [];
    this.lifespans = [];
    this.ages = [];

    const baseColor = new THREE.Color();

    for (let i = 0; i < this.count; i++) {
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
      vertexColors: true
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
  }

  resetParticle(i, posArray, colArray, initialRandom = false) {
    const isEmber = Math.random() > 0.65;

    // Local origin at torch top
    posArray[i * 3 + 0] = (Math.random() - 0.5) * 0.06;
    posArray[i * 3 + 1] = initialRandom ? Math.random() * 0.3 : 0.0;
    posArray[i * 3 + 2] = (Math.random() - 0.5) * 0.06;

    if (isEmber) {
      // Small, buoyant, slow sparks
      this.velocities[i] = new THREE.Vector3(
        (Math.random() - 0.5) * 0.12,
        0.35 + Math.random() * 0.35,
        (Math.random() - 0.5) * 0.12
      );
      this.lifespans[i] = 0.8 + Math.random() * 0.7;
      colArray[i * 3 + 0] = 1.0;  // Red
      colArray[i * 3 + 1] = 0.45; // Green/Amber
      colArray[i * 3 + 2] = 0.05; // Blue
    } else {
      // Fast licking core flame
      this.velocities[i] = new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        0.8 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.08
      );
      this.lifespans[i] = 0.25 + Math.random() * 0.3;
      colArray[i * 3 + 0] = 1.0;
      colArray[i * 3 + 1] = 0.8;
      colArray[i * 3 + 2] = 0.3;
    }

    this.ages[i] = initialRandom ? Math.random() * this.lifespans[i] : 0.0;
  }

  update(delta) {
    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.color.array;

    for (let i = 0; i < this.count; i++) {
      this.ages[i] += delta;

      if (this.ages[i] >= this.lifespans[i]) {
        this.resetParticle(i, pos, col);
        continue;
      }

      // Rise and slight outward turbulent sway
      pos[i * 3 + 0] += this.velocities[i].x * delta + (Math.random() - 0.5) * 0.01;
      pos[i * 3 + 1] += this.velocities[i].y * delta;
      pos[i * 3 + 2] += this.velocities[i].z * delta + (Math.random() - 0.5) * 0.01;

      // Fade out over lifetime (modulate green to pull from hot yellow to dark crimson)
      const lifeRatio = this.ages[i] / this.lifespans[i];
      col[i * 3 + 1] = Math.max(0.0, (1.0 - lifeRatio) * 0.7);
      col[i * 3 + 0] = Math.max(0.0, (1.0 - lifeRatio * 0.6));
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
3. Attaching to the Torch & Render Loop
JavaScript
// Inside your player weapon setup:
const torchTip = torchMesh.getObjectByName('TorchTipSocket') || torchMesh;

const torchFX = new TorchParticleEmitter(40);
torchFX.mesh.position.set(0, 0.45, 0); // Position right at the sconce head
torchTip.add(torchFX.mesh);

// Inside your main requestAnimationFrame update loop:
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  torchFX.update(delta);

  renderer.render(scene, camera);
}
Integration Notes
depthWrite: false - Essential for transparent additive particles so they do not write into the depth buffer and punch square silhouettes into the geometry behind them.

Additive Blending - Where sparks cluster near the wick base, THREE.AdditiveBlending naturally blows them out to intense white-hot yellow without needing multiple textures.

Budget - 40 to 50 particles is more than enough to sell the effect without adding measurable draw overhead.