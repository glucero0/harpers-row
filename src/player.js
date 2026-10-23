import * as THREE from 'three';
import {
  GUARD_READY,
  PLAYER_BLOCK_SPEED_FACTOR,
  PLAYER_EYE_HEIGHT,
  PLAYER_IFRAMES,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SWORD_ARC,
  SWORD_RANGE,
  inGuardArc,
  mitigatedDamage,
  statsForLevel,
  stepGuardBlend,
  xpRequired,
  XP_PER_KILL,
} from './balance.js';
import { lineOfSight, resolveBody } from './geometry.js';
import { audio } from './audio.js';
import { clearHitStop, triggerHitStop } from './impact.js';
import { PITCH_DOWN, PITCH_UP, PlayerBodyRig } from './player-body.js';
import { createHeldTorch, flickerTorch } from './torch.js';

const LOOK_STICK = 2.35;
const METRE = 3.2;

function hinge(parent, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

function skinnedChain(parent, joints, samples, material) {
  const radial = 8;
  const positions = [];
  const skinIndex = [];
  const skinWeight = [];
  const indices = [];
  const rings = [];
  for (const sample of samples) {
    const start = positions.length / 3;
    for (let spoke = 0; spoke < radial; spoke += 1) {
      const angle = (spoke / radial) * Math.PI * 2;
      positions.push(
        sample.x + Math.cos(angle) * sample.radius,
        sample.y,
        sample.z + Math.sin(angle) * sample.radius,
      );
      skinIndex.push(sample.boneA, sample.boneB, 0, 0);
      skinWeight.push(sample.weightA, sample.weightB, 0, 0);
    }
    rings.push(start);
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let spoke = 0; spoke < radial; spoke += 1) {
      const next = (spoke + 1) % radial;
      const a = rings[ring] + spoke;
      const b = rings[ring] + next;
      const c = rings[ring + 1] + spoke;
      const d = rings[ring + 1] + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(joints[0]);
  mesh.bind(new THREE.Skeleton(joints));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createFighter(materials) {
  const rig = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'FirstPersonBody';
  rig.add(body);

  const torso = hinge(body, 0, 3.45, 0);
  torso.name = 'playerUpperBody';
  const chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.78, 0.52), materials.leather);
  chest.position.set(0, 0.62, -0.08);
  const mailShirt = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.62, 0.46), materials.chain);
  mailShirt.position.set(0, 0.05, -0.02);
  torso.add(chest, mailShirt);

  function pauldron(side) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.46), materials.armor);
    cap.position.set(0.58 * side, 0.95, -0.02);
    cap.layers.set(2);
    torso.add(cap);
  }

  function hangArm(side) {
    const shoulder = new THREE.Bone();
    shoulder.position.set(0.62 * side, 4.35, -0.28);
    const elbow = new THREE.Bone();
    elbow.position.set(0, -0.9, 0.04);
    shoulder.add(elbow);
    const wrist = new THREE.Bone();
    wrist.position.set(0.02 * side, -0.78, 0.02);
    elbow.add(wrist);
    const sx = shoulder.position.x;
    const sy = shoulder.position.y;
    const sz = shoulder.position.z;
    const armMesh = skinnedChain(body, [shoulder, elbow, wrist], [
      { x: sx, y: sy, z: sz, radius: 0.16, boneA: 0, boneB: 1, weightA: 1, weightB: 0 },
      { x: sx, y: sy - 0.45, z: sz, radius: 0.13, boneA: 0, boneB: 1, weightA: 0.7, weightB: 0.3 },
      { x: sx, y: sy - 0.9, z: sz + 0.04, radius: 0.11, boneA: 0, boneB: 1, weightA: 0.25, weightB: 0.75 },
      { x: sx, y: sy - 1.35, z: sz + 0.05, radius: 0.1, boneA: 1, boneB: 2, weightA: 0.65, weightB: 0.35 },
      { x: sx + 0.02 * side, y: sy - 1.68, z: sz + 0.06, radius: 0.09, boneA: 1, boneB: 2, weightA: 0.1, weightB: 0.9 },
    ], side > 0 ? materials.leather : materials.chain);
    armMesh.layers.set(2);
    elbow.rotation.x = -0.4;
    return { shoulder, elbow };
  }

  pauldron(1);
  pauldron(-1);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.46), materials.armor);
  helm.position.set(0, 1.15, -0.02);
  helm.layers.set(2);
  torso.add(helm);
  const armR = hangArm(1);
  const armL = hangArm(-1);
  const eyes = hinge(rig, 0, PLAYER_EYE_HEIGHT, 0);
  rig.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.receiveShadow = true;
    obj.castShadow = true;
  });
  helm.castShadow = false;
  torso.traverse((obj) => {
    if (obj.isMesh) obj.layers.set(2);
  });
  return { rig, body, torso, eyes, armR, armL };
}

const DEG = Math.PI / 180;

const SWING_CONTACT = 0.38;
const SWING_COCK_END = 0.14;
const SWING_FOLLOW_END = 0.7;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const easeInQuad = (t) => t * t;
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

// Arm offsets from rest for the three beats of the swing. p: forearm position, r: forearm rotation,
// s: wrist (hand socket) rotation. The cut runs from the upper right of the view, through the
// crosshair, to the lower left, and the arm base stays off the edge of the screen throughout.
const SWING_POSES = {
  cock: { p: [0.1, 0.22, 0.02], r: [-0.7, -0.2, -0.65], s: [-0.35, 0.1, 0.3] },
  reach: { p: [-0.06, 0.04, -0.16], r: [0.25, 0.35, 0.1], s: [0.15, -0.05, -0.12] },
  follow: { p: [-0.28, -0.16, -0.06], r: [0.95, 0.7, 0.4], s: [0.45, -0.15, -0.4] },
};

// Quick anticipation, an accelerating strike that arrives at full extension at SWING_CONTACT,
// a decelerating follow-through, then an eased reset to rest.
function swingWeights(t) {
  if (t <= 0) return { cock: 0, reach: 0, follow: 0 };
  if (t < SWING_COCK_END) return { cock: easeOutQuad(t / SWING_COCK_END), reach: 0, follow: 0 };
  if (t < SWING_CONTACT) {
    const blend = easeInQuad((t - SWING_COCK_END) / (SWING_CONTACT - SWING_COCK_END));
    return { cock: 1 - blend, reach: blend, follow: 0 };
  }
  if (t < SWING_FOLLOW_END) {
    const blend = easeOutQuad((t - SWING_CONTACT) / (SWING_FOLLOW_END - SWING_CONTACT));
    return { cock: 0, reach: 1 - blend, follow: blend };
  }
  const blend = easeInOutQuad(clamp01((t - SWING_FOLLOW_END) / (1 - SWING_FOLLOW_END)));
  return { cock: 0, reach: 0, follow: 1 - blend };
}

function swingOffset(weights, key, index) {
  return weights.cock * SWING_POSES.cock[key][index]
    + weights.reach * SWING_POSES.reach[key][index]
    + weights.follow * SWING_POSES.follow[key][index];
}

// The guard pose: where the left forearm sits (camera space, one unit ahead is straight forward)
// and how the hand and torch are turned once it is raised. The hand ends up just left of centre,
// below the crosshair, with the torch standing up in front of the view.
const GUARD_ARM = { p: [-0.464, -1.1, -0.867], r: [34 * DEG, -11.5 * DEG, 0] };
const GUARD_HAND = { p: [0, 0, 0], r: [0, 0, 0] };
// The torch itself leans across the body toward the right shoulder (z) and tips its burning head
// forward, away from the face (x), once the guard is up.
const TORCH_REST = { x: -15 * DEG, y: 0, z: -10 * DEG };
const TORCH_GUARD = { x: -0.25, y: 0, z: -0.65 };
// The mace stays in the right hand while blocking, eased a touch forward of its ready pose.
const MACE_COIL_Z = -0.05;
// A blow on the torch shoves it back toward the camera and a little to the left, holds it there for
// GUARD_RECOIL_SECONDS, then lets it spring back.
const GUARD_RECOIL = { x: -0.16, z: 0.24 };
const GUARD_RECOIL_SECONDS = 0.06;
const GUARD_RECOIL_RETURN = 18;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

const BOB_X = 0.06;
const BOB_Y = 0.045;
const LAG_GAIN = 0.32;
const LAG_LIMIT = 0.16;
const LAG_RATE = 8;
const FOV_PUNCH = 2.2;
const FOREARM_LENGTH = 0.72;
const FOREARM_PITCH = 35 * DEG;
const FOREARM_YAW = 20 * DEG;

function createMace(materials) {
  const mace = new THREE.Group();
  mace.name = 'mace';
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.58, 6), materials.leather);
  handle.position.y = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), materials.rust);
  head.position.y = 0.48;
  const flangeA = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.07), materials.metal);
  flangeA.position.y = 0.48;
  const flangeB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.07), materials.metal);
  flangeB.position.y = 0.48;
  mace.add(handle, head, flangeA, flangeB);
  mace.rotation.set(15 * DEG, 0, 25 * DEG);
  const trail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.12),
    new THREE.MeshBasicMaterial({
      color: 0xe7d3a4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  trail.position.set(0.16, 0.42, 0);
  trail.rotation.y = Math.PI / 2;
  mace.add(trail);
  mace.userData.restX = mace.rotation.x;
  mace.userData.restZ = mace.rotation.z;
  mace.userData.trail = trail;
  return mace;
}

function rememberRest(socket) {
  socket.userData.restPosition = socket.position.clone();
  socket.userData.restRotation = socket.rotation.clone();
}

function skinnedViewArm(leather, chain) {
  const length = FOREARM_LENGTH;
  const hand = 0.22;
  const radial = 8;
  const rows = 8;
  const positions = [];
  const skinIndex = [];
  const skinWeight = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    const t = row / rows;
    const onHand = t > 0.78;
    const along = onHand ? -length - ((t - 0.78) / 0.22) * hand : -(t / 0.78) * length;
    const forearmT = Math.min(t, 0.78) / 0.78;
    const handT = onHand ? (t - 0.78) / 0.22 : 0;
    const radius = 0.074 - forearmT * 0.018;
    const radiusX = radius * (1 + handT * 0.45);
    const radiusY = radius * (1 - handT * 0.5);
    let bone = 0;
    let next = 1;
    let weight = 1;
    if (t > 0.72) {
      bone = 2;
      next = 1;
      weight = 1;
    } else if (t > 0.28) {
      bone = 1;
      next = 2;
      weight = 1 - (t - 0.28) / 0.44;
    }
    for (let spoke = 0; spoke < radial; spoke += 1) {
      const angle = (spoke / radial) * Math.PI * 2;
      positions.push(Math.cos(angle) * radiusX, Math.sin(angle) * radiusY, along);
      skinIndex.push(bone, next, 0, 0);
      skinWeight.push(weight, 1 - weight, 0, 0);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let spoke = 0; spoke < radial; spoke += 1) {
      const next = (spoke + 1) % radial;
      const a = row * radial + spoke;
      const b = row * radial + next;
      const c = (row + 1) * radial + spoke;
      const d = (row + 1) * radial + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const root = new THREE.Bone();
  const elbow = new THREE.Bone();
  elbow.position.z = -length * 0.48;
  root.add(elbow);
  const wrist = new THREE.Bone();
  wrist.position.z = -length * 0.52;
  elbow.add(wrist);
  for (const offset of [0.08, -0.12]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.011, 4, 8), leather);
    band.rotation.x = Math.PI / 2;
    band.position.z = offset;
    elbow.add(band);
  }
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 4, 8), chain);
  cuff.rotation.x = Math.PI / 2;
  wrist.add(cuff);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.16), leather);
  plate.position.set(0, 0.04, -0.1);
  wrist.add(plate);
  const mesh = new THREE.SkinnedMesh(geometry, leather);
  mesh.add(root);
  mesh.bind(new THREE.Skeleton([root, elbow, wrist]));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  return { mesh, elbow };
}

function addViewArm(arms, materials, side) {
  const forearm = new THREE.Group();
  forearm.name = side > 0 ? 'rightForearm' : 'leftForearm';
  const tuck = side < 0 ? 0.28 : 0;
  forearm.position.set((1.2 + tuck) * side, -1.19 - tuck, -1);
  forearm.rotation.set(FOREARM_PITCH, FOREARM_YAW * side, 0);
  arms.add(forearm);

  const sleeve = skinnedViewArm(materials.leather, materials.chain);
  forearm.add(sleeve.mesh);
  forearm.userData.elbow = sleeve.elbow;

  const socket = new THREE.Group();
  socket.name = side > 0 ? 'rightHandSocket' : 'leftHandSocket';
  socket.position.set(0, 0, -FOREARM_LENGTH);
  socket.quaternion.copy(forearm.quaternion).invert();
  forearm.add(socket);
  socket.add(new THREE.AxesHelper(0.2));
  return socket;
}

function createViewHands(camera, materials) {
  const arms = new THREE.Group();
  arms.name = 'ArmsRig';
  camera.add(arms);

  const rightHandSocket = addViewArm(arms, materials, 1);
  const mace = createMace(materials);
  rightHandSocket.add(mace);

  const leftHandSocket = addViewArm(arms, materials, -1);
  const torch = createHeldTorch(materials);
  torch.root.rotation.set(-15 * DEG, 0, -10 * DEG);
  leftHandSocket.add(torch.root);

  rememberRest(rightHandSocket);
  rememberRest(leftHandSocket);
  rememberRest(rightHandSocket.parent);
  rememberRest(leftHandSocket.parent);
  arms.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = false;
  });
  return { arms, rightHandSocket, leftHandSocket, mace, torch };
}

function logSocket(socket) {
  const position = socket.userData.restPosition;
  const rotation = socket.userData.restRotation;
  console.info(
    `${socket.name} position ${position.x.toFixed(3)} ${position.y.toFixed(3)} ${position.z.toFixed(3)} rotation ${rotation.x.toFixed(3)} ${rotation.y.toFixed(3)} ${rotation.z.toFixed(3)}`,
  );
}

function bindGripDebug(rightHandSocket, leftHandSocket) {
  let active = rightHandSocket;
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Digit1') {
      active = rightHandSocket;
      logSocket(active);
      return;
    }
    if (event.code === 'Digit2') {
      active = leftHandSocket;
      logSocket(active);
      return;
    }
    const rest = event.shiftKey ? active.userData.restRotation : active.userData.restPosition;
    const amount = event.shiftKey ? 0.05 : 0.02;
    if (event.code === 'ArrowLeft') rest.x -= amount;
    else if (event.code === 'ArrowRight') rest.x += amount;
    else if (event.code === 'ArrowUp') rest.y += amount;
    else if (event.code === 'ArrowDown') rest.y -= amount;
    else if (event.code === 'KeyU') rest.z -= amount;
    else if (event.code === 'KeyO') rest.z += amount;
    else return;
    event.preventDefault();
    logSocket(active);
  });
  console.info('Grip debug: 1 right socket, 2 left socket. Arrows nudge X/Y, U and O nudge Z. Hold Shift to rotate.');
  globalThis.gripSockets = {
    rightHandSocket,
    leftHandSocket,
    log() {
      logSocket(rightHandSocket);
      logSocket(leftHandSocket);
    },
  };
}

export function createPlayer(camera, materials, start) {
  const fighter = createFighter(materials);
  const { rig, body, torso, eyes, armR, armL } = fighter;
  const bodySpin = new THREE.Quaternion();
  const bodyGoal = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const currentVelocity = new THREE.Vector3();
  let lastX = start.x;
  let lastZ = start.z;
  camera.layers.set(0);
  camera.parent.add(rig);
  eyes.add(camera);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  const playerMesh = rig;
  const bodyRig = new PlayerBodyRig(camera, playerMesh);
  const hands = createViewHands(camera, materials);
  hands.torch.light.shadow.camera.layers.enable(1);
  hands.torch.light.shadow.camera.layers.enable(2);
  const { rightHandSocket, leftHandSocket } = hands;
  bindGripDebug(rightHandSocket, leftHandSocket);
  const baseFov = camera.fov;

  const state = {
    x: start.x,
    y: start.y || 0,
    z: start.z,
    yaw: start.yaw,
    pitch: -0.08,
    health: 100,
    maxHealth: 100,
    level: 1,
    xp: 0,
    damage: 18,
    attackInterval: 0.48,
    attackWait: 0,
    swing: 0,
    blocking: false,
    blockBlend: 0,
    usePressed: false,
    swinging: false,
    // The raised torch: true once the arm is up, and where the torch sits in the world. Archers read
    // this to see whether an arrow lands on it.
    guardUp: false,
    guardX: 0,
    guardY: 0,
    guardZ: 0,
    guardKick: 0,
    guardHold: 0,
    iframes: 0,
    alive: true,
    shake: 0,
    trauma: 0,
    traumaDuration: 0.2,
    traumaX: -1,
    traumaY: -0.28,
    bob: 0,
    bobPhase: 0,
    walkBlend: 0,
    prevYaw: start.yaw,
    prevPitch: -0.08,
    lagYaw: 0,
    lagPitch: 0,
    bodyYaw: 0,
    swayTime: 0,
    torchTime: 0,
    gait: 0,
    room: null,
    equipped: false,
    gold: 0,
    moving: false,
    denySerial: 0,
    denyCooldown: 0,
    aiming: false,
    struck: new Set(),
    swingTPrev: 0,
    gainedLevel: false,
  };

  function applyStats(slider) {
    const stats = statsForLevel(state.level);
    const gained = stats.maxHealth - state.maxHealth;
    state.maxHealth = stats.maxHealth;
    state.damage = stats.damage;
    state.attackInterval = stats.attackInterval;
    if (gained > 0) state.health = Math.min(state.maxHealth, state.health + gained);
    state.health = Math.min(state.health, state.maxHealth);
    return xpRequired(state.level, slider);
  }

  function addXp(slider) {
    state.xp += XP_PER_KILL;
    state.gainedLevel = false;
    let needed = xpRequired(state.level, slider);
    while (state.xp >= needed) {
      state.xp -= needed;
      state.level += 1;
      state.gainedLevel = true;
      needed = applyStats(slider);
    }
    if (state.gainedLevel && state.alive) {
      // A new level is a clean slate: health comes back in full, at the new maximum.
      state.health = state.maxHealth;
      audio.level();
    }
    return state.gainedLevel;
  }

  function reconcileXp(slider) {
    let needed = xpRequired(state.level, slider);
    let leveled = false;
    while (state.xp >= needed) {
      state.xp -= needed;
      state.level += 1;
      state.gainedLevel = true;
      leveled = true;
      needed = applyStats(slider);
    }
    applyStats(slider);
    if (leveled && state.alive) state.health = state.maxHealth;
  }

  applyStats(0.5);
  camera.rotation.order = 'YXZ';

  function placeCamera() {
    rig.position.set(state.x, (state.y || 0) + state.gait * (state.blocking ? 0.03 : 0.07), state.z);
    rig.rotation.set(0, state.yaw, state.gait * 0.035);
    camera.rotation.set(state.pitch, 0, 0);
    camera.rotation.x = Math.max(-PITCH_DOWN, Math.min(PITCH_UP, camera.rotation.x));
    camera.position.set(0, 0, 0);
    if (state.shake > 0) {
      camera.position.x = Math.sin(state.shake * 70) * 0.05;
      camera.position.y = Math.cos(state.shake * 48) * 0.03;
    }
    const kick = state.trauma * state.trauma;
    if (state.trauma > 0) {
      camera.position.x += state.traumaX * kick * 0.07;
      camera.position.y += state.traumaY * kick * 0.04;
      camera.rotation.z = state.traumaX * kick * -0.03;
    }
    // A brief push-in on impact: the field of view narrows a touch, then relaxes.
    const fov = baseFov - kick * FOV_PUNCH;
    if (Math.abs(camera.fov - fov) > 0.002) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function applyGear() {
    hands.mace.visible = state.equipped;
    hands.torch.root.visible = state.equipped;
    if (!state.equipped) hands.torch.light.intensity = 0;
  }

  function updateTorch(dt) {
    if (!state.equipped) {
      hands.torch.light.intensity = 0;
      return;
    }
    state.torchTime += dt;
    hands.torch.impact.update(dt);
    flickerTorch(hands.torch.light, state.torchTime, hands.torch.impact.flash);
    hands.torch.particles.update(dt);
    hands.torch.flame.uniforms.uTime.value = state.torchTime;
  }

  function denyEntry() {
    if (state.denyCooldown > 0) return;
    state.denySerial += 1;
    state.denyCooldown = 0.7;
  }

  // Where the torch is in the world, refreshed after the pose is set. Archers aim their "did it land
  // on the torch" test at this point.
  const tipWorld = new THREE.Vector3();
  function trackGuard() {
    state.guardUp = state.alive && state.blocking && state.blockBlend >= GUARD_READY;
    hands.torch.tip.updateWorldMatrix(true, false);
    tipWorld.setFromMatrixPosition(hands.torch.tip.matrixWorld);
    state.guardX = tipWorld.x;
    state.guardY = tipWorld.y;
    state.guardZ = tipWorld.z;
  }

  // A blow lands on the torch: flash and sparks at the contact, a clang, the torch jolting back, and
  // a small shudder through the view. Melee also freezes the frame for an instant.
  function guardImpact(power, freeze) {
    hands.torch.impact.burst(power);
    flickerTorch(hands.torch.light, state.torchTime, hands.torch.impact.flash);
    state.guardKick = Math.max(state.guardKick, power);
    state.guardHold = GUARD_RECOIL_SECONDS;
    audio.guard();
    state.trauma = Math.max(state.trauma, 0.45 * power);
    state.traumaDuration = 0.14;
    state.traumaX = Math.random() < 0.5 ? -0.8 : 0.8;
    state.traumaY = -0.2;
    if (freeze) triggerHitStop();
  }

  function seatSocket(socket, dx, dy, dz, rx, ry, rz) {
    const restPosition = socket.userData.restPosition;
    const restRotation = socket.userData.restRotation;
    socket.position.set(restPosition.x + dx, restPosition.y + dy, restPosition.z + dz);
    socket.rotation.set(restRotation.x + rx, restRotation.y + ry, restRotation.z + rz);
  }

  function pose(dt, moveAmount) {
    const moving = moveAmount > 0.01;
    state.swayTime += dt;
    state.bob = moving ? state.bob + dt * (8 + moveAmount * 4) : state.bob;
    const headBob = Math.sin(state.bob);
    const stride = moving ? headBob : 0;
    state.gait = stride;
    const lookDown = Math.max(0, -state.pitch);
    torso.rotation.x = Math.min(lookDown, 0.9) * 0.12;

    const swingT = state.swing > 0 ? 1 - state.swing / state.attackInterval : 0;
    const weights = swingWeights(swingT);
    const { cock, reach, follow } = weights;
    const damp = 1 - Math.max(cock, reach, follow);
    const idle = Math.sin(state.swayTime * 1.35);
    const amp = 0.006 + moveAmount * 0.03;
    const rightArm = rightHandSocket.parent;
    const rightArmRestP = rightArm.userData.restPosition;
    const rightArmRestR = rightArm.userData.restRotation;
    rightArm.position.set(
      rightArmRestP.x + swingOffset(weights, 'p', 0),
      rightArmRestP.y + swingOffset(weights, 'p', 1),
      // The mace never crosses the body for a block: it stays low in the right hand, coiled slightly.
      rightArmRestP.z + swingOffset(weights, 'p', 2) + MACE_COIL_Z * state.blockBlend * damp,
    );
    rightArm.rotation.set(
      rightArmRestR.x + swingOffset(weights, 'r', 0),
      rightArmRestR.y + swingOffset(weights, 'r', 1),
      rightArmRestR.z + swingOffset(weights, 'r', 2),
    );
    seatSocket(
      rightHandSocket,
      Math.cos(state.bob * 0.5) * amp * 0.45 * damp,
      (moving ? headBob : idle * 0.45) * amp * damp,
      (moving ? Math.sin(state.bob * 2) * amp * 0.3 : idle * 0.004),
      ((moving ? Math.cos(state.bob) * 0.02 * moveAmount : idle * 0.01) * damp) + swingOffset(weights, 's', 0),
      (moving ? headBob * 0.025 * moveAmount : 0) + swingOffset(weights, 's', 1),
      ((moving ? headBob * 0.02 : idle * 0.012) * damp) + swingOffset(weights, 's', 2),
    );

    // Guard: while the block button is held the whole left arm comes up out of the corner and plants
    // the torch in front of the view, and it stays planted there: no walking sway, no idle drift.
    // blockBlend is linear progress: 0.10 s to raise, 0.18 s to lower. The easing is applied to it.
    state.blockBlend = stepGuardBlend(state.blockBlend, state.blocking, dt);
    const raised = easeOutCubic(clamp01(state.blockBlend));
    const loose = 1 - raised;
    // After a blow the torch stays shoved back for GUARD_RECOIL_SECONDS, then springs home.
    if (state.guardHold > 0) {
      state.guardHold = Math.max(0, state.guardHold - dt);
    } else {
      state.guardKick *= Math.exp(-dt * GUARD_RECOIL_RETURN);
      if (state.guardKick < 0.004) state.guardKick = 0;
    }
    const kick = state.guardKick;
    const armSway = moving && reach < 0.05 && follow < 0.05 && cock < 0.05 ? stride * 0.04 : 0;
    const leftArm = leftHandSocket.parent;
    const leftArmRestP = leftArm.userData.restPosition;
    const leftArmRestR = leftArm.userData.restRotation;
    const open = Math.max(reach, follow) * loose;
    leftArm.position.set(
      leftArmRestP.x - open * 0.08 + (GUARD_ARM.p[0] - leftArmRestP.x) * raised + kick * GUARD_RECOIL.x,
      leftArmRestP.y + open * 0.05 + (GUARD_ARM.p[1] - leftArmRestP.y) * raised - kick * 0.03,
      leftArmRestP.z + open * 0.06 + (GUARD_ARM.p[2] - leftArmRestP.z) * raised + kick * GUARD_RECOIL.z,
    );
    leftArm.rotation.set(
      leftArmRestR.x - open * 0.15 + (GUARD_ARM.r[0] - leftArmRestR.x) * raised + kick * 0.1,
      leftArmRestR.y + open * 0.22 + (GUARD_ARM.r[1] - leftArmRestR.y) * raised,
      leftArmRestR.z + open * 0.12 + (GUARD_ARM.r[2] - leftArmRestR.z) * raised,
    );
    seatSocket(
      leftHandSocket,
      armSway * loose,
      GUARD_HAND.p[1] * raised,
      GUARD_HAND.p[2] * raised,
      GUARD_HAND.r[0] * raised - kick * 0.12,
      GUARD_HAND.r[1] * raised,
      GUARD_HAND.r[2] * raised,
    );

    // Walking sway: a figure-8 bob on both arms (one lap per two steps), plus a little roll.
    // Turning the view makes the whole rig trail behind and then catch up.
    state.walkBlend += (moveAmount - state.walkBlend) * (1 - Math.exp(-dt * 7));
    state.bobPhase += dt * (6 + state.walkBlend * 6);
    const walk = state.walkBlend * damp * loose;
    const lap = state.bobPhase;
    const arms = hands.arms;
    // The raised guard barely trails the view when turning: it is meant to hold still in front.
    const trail = 1 - raised * 0.75;
    const dropArms = Math.max(0, -state.pitch - 0.55);
    arms.position.set(
      Math.sin(lap) * BOB_X * walk + state.lagYaw * trail,
      Math.sin(lap * 2) * BOB_Y * walk - Math.abs(Math.sin(lap)) * 0.012 * walk - state.lagPitch * trail - dropArms * 0.55,
      0,
    );
    arms.rotation.set(-state.lagPitch * 0.8 * trail, -state.lagYaw * 0.9 * trail, Math.sin(lap) * 0.025 * walk);
    leftArm.position.x += Math.sin(lap + 1.1) * 0.02 * walk;
    leftArm.position.y += Math.sin(lap * 2 + 1.1) * 0.015 * walk;
    if (rightArm.userData.elbow) rightArm.userData.elbow.rotation.x = cock * 0.35 + reach * 0.85 + follow * 0.4;
    if (leftArm.userData.elbow) leftArm.userData.elbow.rotation.x = 0.2 + raised * 0.5;
    const mace = hands.mace;
    mace.rotation.x = mace.userData.restX + reach * 0.35 + follow * 0.15;
    mace.rotation.z = mace.userData.restZ + cock * 0.45 - follow * 0.55;
    mace.userData.trail.material.opacity = reach * 0.65 + follow * 0.22;
    armR.shoulder.rotation.x = 0.2 - stride * 0.55;
    armL.shoulder.rotation.x = 0.2 + stride * 0.55;
    hands.torch.root.rotation.set(
      TORCH_REST.x + (TORCH_GUARD.x - TORCH_REST.x) * raised,
      TORCH_REST.y + (TORCH_GUARD.y - TORCH_REST.y) * raised,
      TORCH_REST.z + (TORCH_GUARD.z - TORCH_REST.z) * raised,
    );

  }

  function landBlow() {
    triggerHitStop(0.03);
    state.shake = Math.max(state.shake, 0.12);
    state.trauma = 0.45;
    state.traumaDuration = 0.12;
    state.traumaX = -1;
    state.traumaY = -0.28;
  }

  function update(dt, input, world, skeletons, slider, running, time = {}) {
    const realDt = time.realDt ?? dt;
    state.gainedLevel = false;
    // Looking around never slows with the hit freeze, so the aim stays under your hand.
    state.yaw += input.mouseYaw;
    state.pitch += input.mousePitch;
    state.yaw -= input.lookStickX * realDt * LOOK_STICK;
    state.pitch -= input.lookStickY * realDt * LOOK_STICK;
    camera.rotation.x = Math.max(-PITCH_DOWN, Math.min(PITCH_UP, state.pitch));
    state.pitch = camera.rotation.x;
    const yawDelta = state.yaw - state.prevYaw;
    const turn = yawDelta * LAG_GAIN;
    const tilt = (state.pitch - state.prevPitch) * LAG_GAIN;
    state.bodyYaw -= yawDelta;
    state.prevYaw = state.yaw;
    state.prevPitch = state.pitch;
    bodySpin.setFromAxisAngle(Y_AXIS, state.bodyYaw);
    bodyGoal.identity();
    bodySpin.slerp(bodyGoal, 1 - Math.exp(-realDt * 6));
    state.bodyYaw = Math.max(-0.45, Math.min(0.45, 2 * Math.atan2(bodySpin.y, bodySpin.w)));
    body.rotation.y = state.bodyYaw;
    const lagDecay = Math.exp(-realDt * LAG_RATE);
    state.lagYaw = Math.max(-LAG_LIMIT, Math.min(LAG_LIMIT, (state.lagYaw + turn) * lagDecay));
    state.lagPitch = Math.max(-LAG_LIMIT, Math.min(LAG_LIMIT, (state.lagPitch + tilt) * lagDecay));
    state.iframes = Math.max(0, state.iframes - dt);
    state.shake = Math.max(0, state.shake - realDt);
    if (state.trauma > 0) {
      state.trauma = Math.max(0, state.trauma - realDt / state.traumaDuration);
    }
    state.attackWait = Math.max(0, state.attackWait - dt);
    if (state.swing > 0) state.swing = Math.max(0, state.swing - dt);
    const swingT = state.swing > 0 ? 1 - state.swing / state.attackInterval : 0;

    if (!running || !state.alive) {
      state.moving = false;
      state.swingTPrev = swingT;
      state.blocking = false;
      state.usePressed = false;
      state.swinging = false;
      stepBody(dt);
      pose(dt, 0);
      placeCamera();
      trackGuard();
      updateTorch(dt);
      return;
    }

    state.blocking = input.block && state.equipped;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;
    let mx = forwardX * -input.moveY + rightX * input.moveX;
    let mz = forwardZ * -input.moveY + rightZ * input.moveX;
    const length = Math.hypot(mx, mz);
    const moving = length > 0.01;
    state.moving = moving;
    let moveAmount = 0;
    if (moving) {
      const speed = PLAYER_SPEED * (state.blocking ? PLAYER_BLOCK_SPEED_FACTOR : 1);
      moveAmount = speed / PLAYER_SPEED;
      state.x += (mx / length) * speed * dt;
      state.z += (mz / length) * speed * dt;
      const resolved = resolveBody(state.x, state.z, PLAYER_RADIUS, world.colliders, state.y || 0);
      state.x = resolved.x;
      state.z = resolved.z;
    }
    state.denyCooldown = Math.max(0, state.denyCooldown - dt);
    state.room = world.roomAt(state.x, state.z, state.room?.id, state.y || 0);
    if (world.floorY) state.y = world.floorY(state.room, state.x, state.z);
    if (!state.equipped && world.containsInterior(state.x, state.z, state.y || 0)) {
      const spot = world.threshold();
      state.x = spot.x;
      state.z = spot.z;
      denyEntry();
    } else if (!state.equipped && moving && world.nearGate(state.x, state.z)) {
      const press = (mx / length) * world.gateInward.x + (mz / length) * world.gateInward.z;
      if (press > 0.35) denyEntry();
    }
    state.room = world.roomAt(state.x, state.z, state.room?.id, state.y || 0);
    if (world.floorY) state.y = world.floorY(state.room, state.x, state.z);

    if (state.equipped && input.attack && state.attackWait <= 0 && state.swing <= 0) {
      state.attackWait = state.attackInterval;
      state.swing = state.attackInterval;
      state.struck.clear();
      state.swingTPrev = 0;
      audio.swing();
    }

    const swingNow = state.swing > 0 ? 1 - state.swing / state.attackInterval : 0;
    const striking = state.swingTPrev < SWING_CONTACT && swingNow >= SWING_CONTACT;
    const swingX = forwardX * 0.75 - rightX * 0.55;
    const swingZ = forwardZ * 0.75 - rightZ * 0.55;
    state.aiming = false;
    let connected = false;
    if (skeletons) {
      for (const skeleton of skeletons.list) {
        if (skeleton.dead) continue;
        const dx = skeleton.x - state.x;
        const dz = skeleton.z - state.z;
        const dist = Math.hypot(dx, dz);
        const angle = Math.atan2(forwardX * dz - forwardZ * dx, forwardX * dx + forwardZ * dz);
        const inArc = dist <= SWORD_RANGE && Math.abs(angle) <= SWORD_ARC;
        const dy = Math.abs((skeleton.y || 0) - (state.y || 0));
        const seen = dy < 4 && inArc && lineOfSight(state.x, state.z, skeleton.x, skeleton.z, world.colliders, state.y || 0);
        if (seen) state.aiming = true;
        if (striking && seen && !state.struck.has(skeleton.id)) {
          state.struck.add(skeleton.id);
          const killed = skeletons.damage(skeleton, state.damage, swingX, swingZ);
          connected = true;
          if (killed) addXp(slider);
        }
      }
    }
    state.usePressed = !!input.use;
    state.swinging = striking;
    if (striking && world.openChestAt) {
      const gold = world.openChestAt(state.x, state.z, forwardX, forwardZ, state.y || 0);
      if (gold > 0) {
        state.gold += gold;
        connected = true;
        audio.chestOpen({ x: state.x, y: 1.4, z: state.z });
      }
    }
    if (connected) {
      state.swing = state.attackInterval * (1 - SWING_CONTACT);
      state.swingTPrev = SWING_CONTACT;
      landBlow();
    } else {
      state.swingTPrev = swingNow;
    }

    stepBody(dt);
    pose(dt, moveAmount);
    placeCamera();
    trackGuard();
    updateTorch(dt);
  }

  // A hit on the player. `source` says where it came from: { x, z } for a melee blow, and
  // { kind: 'arrow', deflected } for an arrow, where `deflected` means its path crossed the torch.
  // Returns false (ignored), 'blocked' (caught on the torch), or 'hit'.
  function hurt(raw, source) {
    if (!state.alive) return false;
    const arrow = source?.kind === 'arrow';
    let guarded = false;
    if (state.blocking && state.blockBlend >= GUARD_READY) {
      if (arrow) guarded = source.deflected === true;
      else if (!source) guarded = true;
      else {
        guarded = inGuardArc(-Math.sin(state.yaw), -Math.cos(state.yaw), source.x - state.x, source.z - state.z);
      }
    }
    if (guarded) guardImpact(arrow ? 0.7 : 1, !arrow);
    // An arrow that bounces off the torch is simply gone: no damage and no recovery window used up.
    if (arrow && guarded) return 'blocked';
    if (state.iframes > 0) return guarded ? 'blocked' : false;
    const amount = mitigatedDamage(raw, guarded);
    state.health = Math.max(0, state.health - amount);
    state.iframes = PLAYER_IFRAMES;
    state.shake = guarded ? 0.06 : 0.18;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
    return guarded ? 'blocked' : 'hit';
  }

  function reset(nextStart) {
    state.x = nextStart.x;
    state.y = nextStart.y || 0;
    state.z = nextStart.z;
    state.yaw = nextStart.yaw;
    state.pitch = -0.08;
    state.level = 1;
    state.xp = 0;
    state.health = 100;
    state.maxHealth = 100;
    state.alive = true;
    state.swing = 0;
    state.attackWait = 0;
    state.iframes = 0;
    state.shake = 0;
    state.trauma = 0;
    state.blocking = false;
    state.blockBlend = 0;
    state.guardKick = 0;
    state.guardHold = 0;
    state.walkBlend = 0;
    state.lagYaw = 0;
    state.lagPitch = 0;
    state.bodyYaw = 0;
    body.rotation.y = 0;
    lastX = nextStart.x;
    lastZ = nextStart.z;
    currentVelocity.set(0, 0, 0);
    bodyRig.update(0, currentVelocity);
    state.prevYaw = nextStart.yaw;
    state.prevPitch = -0.08;
    clearHitStop();
    state.room = null;
    state.equipped = false;
    state.gold = 0;
    state.moving = false;
    state.denySerial = 0;
    state.denyCooldown = 0;
    applyGear();
    state.struck.clear();
    state.swingTPrev = 0;
    state.gait = 0;
    state.swayTime = 0;
    body.rotation.x = 0;
    applyStats(0.5);
    pose(0, 0);
    placeCamera();
    trackGuard();
    updateTorch(0);
  }

  function stepBody(delta) {
    const step = Math.max(delta, 1e-4);
    currentVelocity.set((state.x - lastX) / step / METRE, 0, (state.z - lastZ) / step / METRE);
    if (delta <= 0) currentVelocity.set(0, 0, 0);
    lastX = state.x;
    lastZ = state.z;
    bodyRig.update(delta, currentVelocity);
  }

  applyGear();
  stepBody(0);
  pose(0, 0);
  placeCamera();
  trackGuard();
  updateTorch(0);

  function equip() {
    if (state.equipped) return false;
    state.equipped = true;
    applyGear();
    return true;
  }

  function placeAt(x, z, yaw, y = 0) {
    state.x = x;
    state.y = y || 0;
    state.z = z;
    state.yaw = yaw;
    state.prevYaw = yaw;
    lastX = x;
    lastZ = z;
    currentVelocity.set(0, 0, 0);
    placeCamera();
  }

  return {
    state,
    bodyRig,
    update,
    hurt,
    reset,
    equip,
    placeAt,
    reconcileXp,
    weapons: {
      rightHand: hands.mace,
      leftHand: hands.torch.root,
      rightHandSocket,
      leftHandSocket,
    },
  };
}
