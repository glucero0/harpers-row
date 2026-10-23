// One held item, built from a parsed gear description. A part that carries the shared fire
// description gets the same flame and point light as a campfire. Only the torch's light casts shadows.
import * as THREE from 'three';
import { fireWobble } from './fire-description.js';
import { createFlamePoints, disposeFlamePoints } from './flame.js';
import { buildItemParts, disposeItemParts } from './item-mesh.js';

export function createGear(description) {
  if (!description?.parsed) throw new Error('createGear needs a parsed gear description.');
  const built = buildItemParts(description);
  const root = built.root;
  const rest = description.grip.restRotation;
  root.rotation.set(rest.x, rest.y, rest.z);

  let light = null;
  let flame = null;
  let tip = null;
  let flicker = null;
  let restIntensity = 0;
  for (const part of description.parts) {
    if (!part.fire) continue;
    tip = built.byName.get(part.name);
    const emanation = part.fire;
    flicker = emanation.light.flicker;
    restIntensity = emanation.light.intensity;
    light = new THREE.PointLight(emanation.light.color, restIntensity, emanation.light.distance, 2);
    light.decay = 2;
    light.castShadow = description.kind === 'torch';
    if (light.castShadow) {
      light.shadow.mapSize.set(512, 512);
      light.shadow.bias = -0.002;
      light.shadow.normalBias = 0.02;
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = Math.max(emanation.light.distance, 0.5);
      light.shadow.camera.layers.enable(1);
      light.shadow.camera.layers.enable(2);
    }
    light.userData.fireFlicker = flicker;
    light.userData.restIntensity = restIntensity;
    tip.add(light);
    flame = createFlamePoints({ emanation });
    flame.mesh.visible = true;
    for (const child of flame.mesh.children) child.visible = true;
    tip.add(flame.mesh);
  }

  let elapsed = 0;
  let flash = 0;
  let disposed = false;

  function update(dt) {
    if (disposed || !light) return;
    const step = dt > 0 ? dt : 0;
    elapsed += step;
    flash *= Math.exp(-step * 8);
    if (flash < 0.01) flash = 0;
    light.intensity = Math.max(0, restIntensity * (1 + fireWobble(flicker.speed, flicker.variance, elapsed)) + flash);
    if (flame) flame.uniforms.uTime.value = elapsed;
  }

  function burst(power) {
    if (disposed) return;
    flash = Math.max(flash, Math.max(0, power) * 4);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (flame) disposeFlamePoints(flame);
    disposeItemParts(built);
    flame = null;
    light = null;
  }

  return {
    root,
    kind: description.kind,
    hand: description.hand,
    id: description.id,
    name: description.name,
    grip: rest,
    combat: description.combat,
    light,
    flame,
    tip,
    update,
    burst,
    dispose,
  };
}
