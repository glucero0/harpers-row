import * as THREE from 'three';

// The core flame visual assembly (fire + smoke + embers billboard quads) shared by every open flame in
// the game: the hub campfire (hub.js), wall sconces (sconce.js), and the player's held torch (torch.js).
// Color, lifetime, size, and blending come from a fire description (fire-description.js). The preset
// only picks a motion this file already knows. See docs/ARCHITECTURE.md.
const PRESETS = {
  campfire_flames: { rise: 1.55, spread: 0.55, size0: 0.95, size1: 1.55, endScale: 0.34, alpha: 0.95 },
  torch_flames: { rise: 0.72, spread: 0.1, size0: 0.48, size1: 0.8, endScale: 0.22, alpha: 0.9 },
  sconce_flames: { rise: 0.72, spread: 0.1, size0: 0.48, size1: 0.8, endScale: 0.22, alpha: 0.9 },
};

const FLAME_FRAGMENT = `
varying float vAlpha;
varying vec3 vColor;
varying vec2 vUv;
void main() {
  float dist = length(vUv);
  if (dist > 1.0) discard;
  float soft = smoothstep(1.0, 0.12, dist);
  vec3 hot = vec3(1.0, 0.97, 0.82);
  vec3 flame = mix(hot, vColor, smoothstep(0.05, 0.75, dist));
  gl_FragColor = vec4(flame * soft * vAlpha, soft * vAlpha);
}
`;

function flameQuads(count, mode, uniforms, blending) {
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
    blending: mode === 'smoke' ? THREE.NormalBlending : blending,
    vertexShader: `
      attribute vec3 aSeed;
      attribute vec2 aCorner;
      uniform float uTime;
      uniform vec2 uFireLife;
      uniform vec3 uFireColor0;
      uniform vec3 uFireColor1;
      uniform float uFireRise;
      uniform float uFireSpread;
      uniform vec2 uFireSize;
      uniform float uFireEndScale;
      uniform float uFireAlpha;
      varying float vAlpha;
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float kind = ${mode === 'fire' ? '0.0' : mode === 'smoke' ? '1.0' : '2.0'};
        float lifeTime = kind < 0.5 ? mix(uFireLife.x, uFireLife.y, aSeed.x) : (kind < 1.5 ? mix(1.3, 1.8, aSeed.x) : mix(0.45, 0.7, aSeed.x));
        float life = fract(uTime / lifeTime + aSeed.y);
        float rare = kind > 1.5 ? step(0.62, aSeed.z) : 1.0;
        float rise = kind < 0.5 ? uFireRise : (kind < 1.5 ? 1.15 : 0.95);
        float curl = sin(uTime * 3.4 + aSeed.y * 13.0) * cos(uTime * 1.7 + aSeed.z * 9.0);
        float tongue = sin(uTime * 6.2 + aSeed.x * 17.0) * 0.045;
        float spread = kind < 0.5 ? uFireSpread : (kind < 1.5 ? 0.16 : 0.1);
        vec3 local = vec3(
          (aSeed.z - 0.5) * spread + curl * (kind < 0.5 ? 0.12 : 0.07) + tongue,
          life * rise,
          (aSeed.y - 0.5) * spread + curl * 0.05
        );
        vec4 mv = modelViewMatrix * vec4(local, 1.0);
        float startSize = kind < 0.5 ? mix(uFireSize.x, uFireSize.y, aSeed.x) : (kind < 1.5 ? mix(0.28, 0.46, aSeed.y) : 0.08);
        float size = kind < 0.5 ? mix(startSize, startSize * uFireEndScale, life) : (kind < 1.5 ? mix(startSize, startSize * 1.35, life) : startSize);
        mv.xy += aCorner * size * 0.5;
        gl_Position = projectionMatrix * mv;
        vUv = aCorner;
        float fade = smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.62, life);
        vAlpha = fade * rare * (kind < 0.5 ? uFireAlpha : (kind < 1.5 ? 0.28 : 0.85));
        if (kind < 0.5) vColor = mix(uFireColor0, uFireColor1, life);
        else if (kind < 1.5) vColor = vec3(0.16, 0.15, 0.14);
        else vColor = uFireColor0;
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

// Builds a fire + smoke + embers billboard assembly. The group and each of its three children start
// hidden (`visible = false`) so a caller can light it on demand (see `SconceInteractable.ignite()`) or
// show it immediately for an always-lit source (see `createHeldTorch()`); either way, set `.visible`
// on the group *and* on each child, since each quad mesh starts hidden independently.
function quadCount(value, fallback) {
  return Number.isInteger(value) && value >= 1 && value <= 48 ? value : fallback;
}

function flameUniforms(preset, emitter) {
  const life = emitter?.lifetime || [0.4, 0.6];
  return {
    uTime: { value: 0 },
    uFireLife: { value: new THREE.Vector2(life[0], life[1]) },
    uFireColor0: { value: new THREE.Color(emitter?.colorStart || '#fff29e') },
    uFireColor1: { value: new THREE.Color(emitter?.colorEnd || '#f2470a') },
    uFireRise: { value: preset.rise },
    uFireSpread: { value: preset.spread },
    uFireSize: { value: new THREE.Vector2(preset.size0, preset.size1) },
    uFireEndScale: { value: preset.endScale },
    uFireAlpha: { value: preset.alpha },
  };
}

// `counts.emanation` is a parsed fire description. Its emitter sets color, lifetime, and blending, and
// its quad counts size the meshes. Explicit `fire` / `smoke` / `embers` counts still win when passed.
// Anything outside 1..48 falls back to the description, then to the torch default.
export function createFlamePoints(counts = {}) {
  const emanation = counts.emanation;
  const preset = PRESETS[emanation?.preset] || PRESETS.torch_flames;
  const emitter = emanation?.emitter;
  const derived = emanation?.quads;
  const uniforms = flameUniforms(preset, emitter);
  const blending = emitter?.blendMode === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
  const fire = flameQuads(quadCount(counts.fire, derived?.fire ?? 16), 'fire', uniforms, blending);
  const smoke = flameQuads(quadCount(counts.smoke, derived?.smoke ?? 6), 'smoke', uniforms, blending);
  const embers = flameQuads(quadCount(counts.embers, derived?.embers ?? 5), 'embers', uniforms, blending);
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

// Disposes the geometry and (non-shared) ShaderMaterial for every quad mesh this assembly owns. Safe to
// call once the assembly is no longer in use; not idempotent-guarded itself since callers (torch.js,
// sconce.js's future dispose paths) own that bookkeeping the same way `disposeMaterial` callers do
// elsewhere in the codebase.
export function disposeFlamePoints(flame) {
  for (const layer of [flame.fire, flame.smoke, flame.embers]) {
    layer.geometry.dispose();
    layer.material.dispose();
  }
}
