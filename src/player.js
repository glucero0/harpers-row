import * as THREE from 'three';
import {
  PLAYER_BLOCK_SPEED_FACTOR,
  PLAYER_EYE_HEIGHT,
  PLAYER_IFRAMES,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SWORD_ARC,
  SWORD_RANGE,
  mitigatedDamage,
  statsForLevel,
  xpRequired,
  XP_PER_KILL,
} from './balance.js';
import { lineOfSight, resolveBody } from './geometry.js';
import { audio } from './audio.js';
import { clearHitStop, triggerHitStop } from './impact.js';
import { createHeldTorch, flickerTorch } from './torch.js';

const LOOK_STICK = 2.35;
const THIGH = 1.55;
const SHIN = 1.48;

function hinge(parent, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return group;
}

function limb(parent, length, radius, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, length, 7), material);
  mesh.position.y = -length / 2;
  parent.add(mesh);
  return mesh;
}

function createFighter(materials) {
  const rig = new THREE.Group();
  const body = new THREE.Group();
  rig.add(body);

  const torso = hinge(body, 0, 3.15, -0.28);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 0.42), materials.armor);
  chest.position.set(0, 0.58, -0.28);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.32, 0.38), materials.leather);
  belly.position.set(0, 0.08, -0.04);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.42), materials.leather);
  belt.position.set(0, -0.08, -0.02);
  torso.add(chest, belly, belt);

  function pauldron(side) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), materials.armor);
    cap.scale.set(1.15, 0.72, 1.05);
    cap.position.set(0.55 * side, 1.22, 0.02);
    torso.add(cap);
  }

  function leg(side) {
    const hip = hinge(body, 0.32 * side, 3.05, -0.42);
    limb(hip, THIGH, 0.24, materials.leather);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.16), materials.armor);
    plate.position.set(0, -THIGH * 0.45, -0.16);
    hip.add(plate);
    const knee = hinge(hip, 0, -THIGH, 0);
    limb(knee, SHIN, 0.16, materials.armor);
    const ankle = hinge(knee, 0, -SHIN, 0);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.62), materials.leather);
    boot.position.set(0, -0.08, -0.14);
    ankle.add(boot);
    return { hip, knee, ankle };
  }

  pauldron(1);
  pauldron(-1);
  const legR = leg(1);
  const legL = leg(-1);
  const eyes = hinge(rig, 0, PLAYER_EYE_HEIGHT, -0.16);
  rig.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = true;
  });
  return { rig, body, torso, eyes, legR, legL };
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
  cock: { p: [0.2, 0.6, 0.1], r: [0.2, 0.2, -0.2], s: [-0.15, 0, 0.1] },
  reach: { p: [-0.25, 0.45, -0.55], r: [0.2, 0.4, 0.2], s: [0.12, 0.05, -0.08] },
  follow: { p: [-1.0, 0.2, -0.2], r: [-0.2, 1.0, 0], s: [0.28, 0.12, -0.22] },
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

const BOB_X = 0.06;
const BOB_Y = 0.045;
const LAG_GAIN = 0.32;
const LAG_LIMIT = 0.16;
const LAG_RATE = 8;
const FOV_PUNCH = 2.2;
const FOREARM_LENGTH = 0.72;
const FOREARM_PITCH = 35 * DEG;
const FOREARM_YAW = 20 * DEG;

function addFist(socket, materials, side) {
  const fist = new THREE.Group();
  fist.name = side > 0 ? 'rightFist' : 'leftFist';
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.09), materials.leather);
  const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.07), materials.leather);
  bevel.position.set(0.012 * side, 0.05, 0.02);
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.04), materials.leather);
  knuckle.position.set(0.04 * side, 0.055, 0.045);
  const finger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.035), materials.leather);
  finger.position.set(0.03 * side, 0.03, 0.055);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.04), materials.leather);
  thumb.position.set(-0.065 * side, 0.01, 0.02);
  fist.add(palm, bevel, knuckle, finger, thumb);
  socket.add(fist);
}

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
  return mace;
}

function rememberRest(socket) {
  socket.userData.restPosition = socket.position.clone();
  socket.userData.restRotation = socket.rotation.clone();
}

function addViewArm(arms, materials, side) {
  const forearm = new THREE.Group();
  forearm.name = side > 0 ? 'rightForearm' : 'leftForearm';
  const tuck = side < 0 ? 0.28 : 0;
  forearm.position.set((1.2 + tuck) * side, -1.19 - tuck, -1);
  forearm.rotation.set(FOREARM_PITCH, FOREARM_YAW * side, 0);
  arms.add(forearm);

  const bone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.066, FOREARM_LENGTH, 6),
    materials.leather,
  );
  bone.rotation.x = -Math.PI / 2;
  bone.position.set(0, 0, -FOREARM_LENGTH / 2);
  forearm.add(bone);

  const socket = new THREE.Group();
  socket.name = side > 0 ? 'rightHandSocket' : 'leftHandSocket';
  socket.position.set(0, 0, -FOREARM_LENGTH);
  socket.quaternion.copy(forearm.quaternion).invert();
  forearm.add(socket);
  socket.add(new THREE.AxesHelper(0.2));
  addFist(socket, materials, side);
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
  const { rig, body, torso, eyes, legR, legL } = fighter;
  camera.parent.add(rig);
  eyes.add(camera);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  const hands = createViewHands(camera, materials);
  const { rightHandSocket, leftHandSocket } = hands;
  bindGripDebug(rightHandSocket, leftHandSocket);
  const baseFov = camera.fov;

  const state = {
    x: start.x,
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
    swayTime: 0,
    torchTime: 0,
    gait: 0,
    room: null,
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
    rig.position.set(state.x, state.gait * (state.blocking ? 0.03 : 0.07), state.z);
    rig.rotation.set(0, state.yaw, state.gait * 0.035);
    camera.rotation.set(state.pitch, 0, 0);
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

  function updateTorch(dt) {
    state.torchTime += dt;
    flickerTorch(hands.torch.light, state.torchTime);
    hands.torch.particles.update(dt);
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
    torso.rotation.x = state.pitch * 0.32;

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
      rightArmRestP.z + swingOffset(weights, 'p', 2),
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

    state.blockBlend += ((state.blocking && state.swing <= 0 ? 1 : 0) - state.blockBlend) * Math.min(1, dt * 10);
    const blend = state.blockBlend;
    const armSway = moving && reach < 0.05 && follow < 0.05 && cock < 0.05 ? stride * 0.04 : 0;
    const leftArm = leftHandSocket.parent;
    const leftArmRestP = leftArm.userData.restPosition;
    const leftArmRestR = leftArm.userData.restRotation;
    const open = Math.max(reach, follow);
    leftArm.position.set(
      leftArmRestP.x - open * 0.08,
      leftArmRestP.y + open * 0.05,
      leftArmRestP.z + open * 0.06,
    );
    leftArm.rotation.set(
      leftArmRestR.x - open * 0.15,
      leftArmRestR.y + open * 0.22,
      leftArmRestR.z + open * 0.12,
    );
    seatSocket(
      leftHandSocket,
      armSway,
      blend * 0.14,
      blend * 0.05,
      -blend * 0.28,
      blend * 0.08,
      blend * 0.1,
    );

    // Walking sway: a figure-8 bob on both arms (one lap per two steps), plus a little roll.
    // Turning the view makes the whole rig trail behind and then catch up.
    state.walkBlend += (moveAmount - state.walkBlend) * (1 - Math.exp(-dt * 7));
    state.bobPhase += dt * (6 + state.walkBlend * 6);
    const walk = state.walkBlend * damp * (1 - blend * 0.6);
    const lap = state.bobPhase;
    const arms = hands.arms;
    arms.position.set(
      Math.sin(lap) * BOB_X * walk + state.lagYaw,
      Math.sin(lap * 2) * BOB_Y * walk - Math.abs(Math.sin(lap)) * 0.012 * walk - state.lagPitch,
      0,
    );
    arms.rotation.set(-state.lagPitch * 0.8, -state.lagYaw * 0.9, Math.sin(lap) * 0.025 * walk);
    leftArm.position.x += Math.sin(lap + 1.1) * 0.02 * walk;
    leftArm.position.y += Math.sin(lap * 2 + 1.1) * 0.015 * walk;

    legR.hip.rotation.x = 0.12 + stride * 0.62;
    legL.hip.rotation.x = 0.12 - stride * 0.62;
    legR.knee.rotation.x = Math.max(0, -legR.hip.rotation.x) * 1.15;
    legL.knee.rotation.x = Math.max(0, -legL.hip.rotation.x) * 1.15;
    legR.ankle.rotation.x = -(legR.hip.rotation.x + legR.knee.rotation.x);
    legL.ankle.rotation.x = -(legL.hip.rotation.x + legL.knee.rotation.x);
  }

  function landBlow() {
    triggerHitStop();
    state.trauma = 1;
    state.traumaDuration = 0.2;
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
    state.pitch = Math.max(-1.42, Math.min(1.15, state.pitch));
    const turn = (state.yaw - state.prevYaw) * LAG_GAIN;
    const tilt = (state.pitch - state.prevPitch) * LAG_GAIN;
    state.prevYaw = state.yaw;
    state.prevPitch = state.pitch;
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
      state.swingTPrev = swingT;
      state.blocking = false;
      pose(dt, 0);
      placeCamera();
      updateTorch(dt);
      return;
    }

    state.blocking = input.block;
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
    let moveAmount = 0;
    if (moving) {
      const speed = PLAYER_SPEED * (state.blocking ? PLAYER_BLOCK_SPEED_FACTOR : 1);
      moveAmount = speed / PLAYER_SPEED;
      state.x += (mx / length) * speed * dt;
      state.z += (mz / length) * speed * dt;
      const resolved = resolveBody(state.x, state.z, PLAYER_RADIUS, world.colliders);
      state.x = resolved.x;
      state.z = resolved.z;
    }
    state.room = world.roomAt(state.x, state.z, state.room?.id);

    if (input.attack && state.attackWait <= 0 && state.swing <= 0) {
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
        const seen = inArc && lineOfSight(state.x, state.z, skeleton.x, skeleton.z, world.colliders);
        if (seen) state.aiming = true;
        if (striking && seen && !state.struck.has(skeleton.id)) {
          state.struck.add(skeleton.id);
          const killed = skeletons.damage(skeleton, state.damage, swingX, swingZ);
          connected = true;
          if (killed) addXp(slider);
        }
      }
    }
    if (connected) {
      state.swing = state.attackInterval * (1 - SWING_CONTACT);
      state.swingTPrev = SWING_CONTACT;
      landBlow();
    } else {
      state.swingTPrev = swingNow;
    }

    pose(dt, moveAmount);
    placeCamera();
    updateTorch(dt);
  }

  function hurt(raw) {
    if (!state.alive || state.iframes > 0) return false;
    const amount = mitigatedDamage(raw, state.blocking);
    state.health = Math.max(0, state.health - amount);
    state.iframes = PLAYER_IFRAMES;
    state.shake = 0.18;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
    return true;
  }

  function reset(nextStart) {
    state.x = nextStart.x;
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
    state.walkBlend = 0;
    state.lagYaw = 0;
    state.lagPitch = 0;
    state.prevYaw = nextStart.yaw;
    state.prevPitch = -0.08;
    clearHitStop();
    state.room = null;
    state.struck.clear();
    state.swingTPrev = 0;
    state.gait = 0;
    state.swayTime = 0;
    body.rotation.x = 0;
    applyStats(0.5);
    pose(0, 0);
    placeCamera();
    updateTorch(0);
  }

  pose(0, 0);
  placeCamera();
  updateTorch(0);

  return {
    state,
    update,
    hurt,
    reset,
    reconcileXp,
    weapons: {
      rightHand: hands.mace,
      leftHand: hands.torch.root,
      rightHandSocket,
      leftHandSocket,
    },
  };
}
