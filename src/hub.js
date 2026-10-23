// The central hub: a plaza, the structure on it, and one path per location. The player starts here and
// comes back here after dying. A hub owns its meshes and lights, and hides them without disposing when
// the player is off in a location.

import * as THREE from 'three';
import { ambientFill } from './balance.js';
import { fireWobble, parseFireEmanation } from './fire-description.js';
import { createFlamePoints, disposeFlamePoints } from './flame.js';
import { pointInPolygon } from './geometry.js';
import { pathGeometry } from './path-mesh.js';
import { createPropField } from './props.js';
import { exitLoopHeightAt } from './world.js';

const SUN = 2.4;
const SKY = 1.05;
const FILL = 0.55;

function edge(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  return {
    ax,
    az,
    bx,
    bz,
    nx: -dz / length,
    nz: dx / length,
    minX: Math.min(ax, bx),
    maxX: Math.max(ax, bx),
    minZ: Math.min(az, bz),
    maxZ: Math.max(az, bz),
  };
}

function nearMouth(x, z, spokes) {
  return spokes.some((spoke) => Math.hypot(x - spoke.mouth.x, z - spoke.mouth.z) < 7);
}

function emanationOf(part) {
  if (part.fire?.emitter && part.fire.light?.flicker) return part.fire;
  if (part.vfx || part.light) return parseFireEmanation({ vfx: part.vfx, light: part.light });
  return null;
}

function addFire(group, part, emanation, fires) {
  const y = Number.isFinite(part.y) ? part.y : 0;
  const radius = Number.isFinite(part.radius) && part.radius > 0 ? Math.min(part.radius, 4) : 1.1;
  const flame = createFlamePoints({ emanation });
  flame.mesh.name = 'fire-flames';
  flame.mesh.visible = true;
  for (const layer of flame.mesh.children) layer.visible = true;
  flame.mesh.position.set(part.x, y + 0.42, part.z);
  flame.mesh.scale.setScalar(radius / 1.1);
  group.add(flame.mesh);
  const glow = emanation.light;
  const light = new THREE.PointLight(glow.color, glow.intensity, glow.distance, 2);
  light.name = 'fire-light';
  light.castShadow = false;
  light.position.set(part.x, y + 1.2, part.z);
  group.add(light);
  fires.push({
    flame,
    light,
    speed: glow.flicker.speed,
    variance: glow.flicker.variance,
    base: glow.intensity,
  });
}

function addStructure(group, structure) {
  if (!structure) return null;
  const parts = Array.isArray(structure.parts) ? structure.parts : [];
  const fires = [];
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 1 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x3a3834, roughness: 1 });
  const extra = [];
  for (const part of parts) {
    if (!part || !Number.isFinite(part.x) || !Number.isFinite(part.z)) continue;
    if (part.type === 'fire-pit') {
      const radius = Number.isFinite(part.radius) && part.radius > 0 ? part.radius : 1.1;
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.1, 0.35, 10), stone);
      pit.position.set(part.x, 0.18, part.z);
      group.add(pit);
      const emanation = emanationOf(part);
      const emberMat = new THREE.MeshBasicMaterial({ color: emanation ? emanation.emitter.colorStart : 0xff6a2a });
      const ember = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.45, 8, 6), emberMat);
      ember.position.set(part.x, 0.4, part.z);
      group.add(ember);
      extra.push(emberMat);
      if (emanation) addFire(group, part, emanation, fires);
      else {
        const fire = new THREE.PointLight(0xff8a3c, 6, 14, 2);
        fire.castShadow = false;
        fire.position.set(part.x, 1.2, part.z);
        group.add(fire);
      }
    } else if (part.type === 'log-seat') {
      const log = new THREE.Mesh(new THREE.BoxGeometry(part.length || 2, 0.4, 0.45), wood);
      log.position.set(part.x, 0.3, part.z);
      log.rotation.y = part.rotationY || 0;
      group.add(log);
    }
  }
  return { wood, stone, extra, fires };
}

function addTrees(group, trees) {
  if (!trees.length) return null;
  const material = new THREE.MeshStandardMaterial({ color: 0x4a433c, roughness: 1 });
    const trunk = new THREE.CylinderGeometry(0.28, 0.42, 1, 6);
  trunk.translate(0, 0.5, 0);
  const mesh = new THREE.BatchedMesh(trees.length, 1024, 1024, material);
  mesh.name = 'hub-trees';
  const id = mesh.addGeometry(trunk);
  trunk.dispose();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const tree of trees) {
    const height = tree.height || 5;
    scale.set(tree.scale || 1, height, tree.scale || 1);
    position.set(tree.x, 0, tree.z);
    matrix.compose(position, quaternion, scale);
    const instance = mesh.addInstance(id);
    mesh.setMatrixAt(instance, matrix);
  }
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);
  return material;
}

export function createHub(scene, materials, hub) {
  const root = new THREE.Group();
  root.name = 'hub';
  scene.add(root);
  const owned = [];
  const colliders = [];

  const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(40, hub.radius * 3), 24), materials.dirt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  root.add(ground);

  if (hub.plaza.length >= 3) {
    const shape = new THREE.Shape();
    shape.moveTo(hub.plaza[0][0], hub.plaza[0][1]);
    for (let index = 1; index < hub.plaza.length; index += 1) shape.lineTo(hub.plaza[index][0], hub.plaza[index][1]);
    shape.closePath();
    const plaza = new THREE.Mesh(new THREE.ShapeGeometry(shape), materials.dirt);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    plaza.name = 'hub-plaza';
    root.add(plaza);
    for (let index = 0; index < hub.plaza.length; index += 1) {
      const a = hub.plaza[index];
      const b = hub.plaza[(index + 1) % hub.plaza.length];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      if (nearMouth(mx, mz, hub.spokes)) continue;
      colliders.push(edge(a[0], a[1], b[0], b[1]));
    }
  }

  const pathMat = materials.dirt.clone();
  pathMat.color.set(0xc4a06a);
  pathMat.userData.shared = true;
  owned.push(pathMat);
  for (const spoke of hub.spokes) {
    const mesh = new THREE.Mesh(pathGeometry(spoke.samples), pathMat);
    mesh.name = `spoke-${spoke.name}`;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (let index = 1; index < spoke.samples.length - 2; index += 1) {
      const a = spoke.samples[index];
      const b = spoke.samples[index + 1];
      for (const sign of [-1, 1]) {
        const off = a.half + 0.35;
        colliders.push(edge(
          a.x + a.nx * sign * off,
          a.z + a.nz * sign * off,
          b.x + b.nx * sign * off,
          b.z + b.nz * sign * off,
        ));
      }
    }
  }

  const structureMaterials = addStructure(root, hub.structure);
  const fires = structureMaterials?.fires ?? [];
  if (structureMaterials) owned.push(structureMaterials.wood, structureMaterials.stone, ...structureMaterials.extra);
  const treeMaterial = addTrees(root, hub.trees);
  if (treeMaterial) owned.push(treeMaterial);

  const propMaterials = {
    stone: materials.surface('stone'),
    cave: materials.surface('cave'),
    wood: materials.plank,
    dark: materials.brazier,
    bone: materials.bone,
    scrub: materials.dirt,
  };
  const scenery = createPropField(
    root,
    (key) => propMaterials[key] || propMaterials.stone,
    hub.scenery.map((item) => ({ ...item, theme: 'outdoor', y: 0 })),
    { castShadow: false },
  );
  colliders.push(...scenery.colliders);

  const sun = new THREE.DirectionalLight(0xfff3dc, SUN);
  sun.castShadow = false;
  sun.position.set(-16, 62, -8);
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(2, 2, 8);
  sun.target = sunTarget;
  const sky = new THREE.HemisphereLight(0xe7eef3, 0xa08b6c, SKY);
  const fill = new THREE.AmbientLight(0xe4d7c2, FILL);
  scene.add(sun, sunTarget, sky, fill);

  const room = {
    id: 'hub',
    index: 0,
    depth: 0,
    kind: 'exterior',
    name: hub.areaName,
    theme: 'outdoor',
    lighting: 'day',
    polygon: hub.plaza,
    spawns: [],
    y: 0,
  };

  let shown = true;
  let disposed = false;
  let ambientSlider = 0;
  let fillBase = FILL;
  const lights = [sun, sunTarget, sky, fill];
  const background = new THREE.Color('#c5d0d6');
  const fog = new THREE.FogExp2('#c5d0d6', 0.009);

  function applyEnvironment(preset) {
    const source = preset || {};
    const day = source.skyboxVisible !== false;
    sun.intensity = shown && day ? SUN : 0;
    sky.intensity = shown && day ? SKY : 0;
    fillBase = source.ambientLightIntensity ?? FILL;
    fill.intensity = shown ? ambientFill(fillBase, ambientSlider) : 0;
    background.set(source.clearColor || source.fog?.color || '#c5d0d6');
    fog.color.copy(background);
    fog.density = source.fog?.density || 0.009;
    scene.background = background;
    scene.fog = fog;
  }

  function setShown(next) {
    if (disposed || next === shown) return;
    shown = next;
    root.visible = next;
    if (next) scene.add(sun, sunTarget, sky, fill);
    else scene.remove(sun, sunTarget, sky, fill);
  }

  applyEnvironment(null);

  return {
    kind: 'hub',
    rooms: [room],
    doors: [],
    colliders,
    transitions: hub.transitions,
    labels: hub.labels,
    placeName: hub.areaName,
    respawn: hub.respawn,
    depthCount: 1,
    floors: 1,
    totals: { enemies: 0, chests: 0 },
    entranceRoomId: null,
    exitRoomId: null,
    exits: [],
    lastRoomId: null,
    group: root,
    gateInward: { x: 0, z: -1 },
    intruded: false,
    activeRooms: new Set(),
    roomVisible() {
      return false;
    },
    roomAt(x, z) {
      if (hub.plaza.length > 2 && pointInPolygon(x, z, hub.plaza)) return room;
      for (const spoke of hub.spokes) {
        if (spoke.polygon.length > 2 && pointInPolygon(x, z, spoke.polygon)) return room;
        if (exitLoopHeightAt({ samples: spoke.samples }, x, z) !== null) return room;
      }
      return room;
    },
    floorY() {
      return 0;
    },
    setAmbient(slider) {
      ambientSlider = slider;
      fill.intensity = shown ? ambientFill(fillBase, ambientSlider) : 0;
    },
    nextHop() {
      return -1;
    },
    doorBetween() {
      return undefined;
    },
    containsInterior() {
      return false;
    },
    threshold() {
      return { x: hub.respawn.x, z: hub.respawn.z };
    },
    nearGate() {
      return false;
    },
    openGate() {},
    isGateOpen() {
      return true;
    },
    showZone() {},
    applyEnvironment,
    blendEnvironment() {},
    tickEnvironment() {},
    currentZone() {
      return 'hub';
    },
    offerSconce() {
      return false;
    },
    openChestAt() {
      return 0;
    },
    lootTaken() {
      return 0;
    },
    lootTotal() {
      return 0;
    },
    setShown,
    update(time) {
      if (!Number.isFinite(time)) return;
      for (let index = 0; index < fires.length; index += 1) {
        const fire = fires[index];
        fire.flame.uniforms.uTime.value = time;
        fire.light.intensity = Math.max(0, fire.base * (1 + fireWobble(fire.speed, fire.variance, time)));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let index = 0; index < fires.length; index += 1) disposeFlamePoints(fires[index].flame);
      scenery.dispose();
      for (const material of owned) material.dispose();
      root.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry?.dispose();
        if (obj.isBatchedMesh) obj.dispose();
      });
      scene.remove(root);
      for (const light of lights) scene.remove(light);
    },
  };
}
