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

const LOOK_STICK = 2.35;
const UPPER_ARM = 1.05;
const FOREARM = 0.96;
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

  function arm(side, weapon) {
    const shoulder = hinge(torso, 0.82 * side, 1.38, -0.02);
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), materials.armor);
    pauldron.scale.set(1.15, 0.72, 1.05);
    shoulder.add(pauldron);
    limb(shoulder, UPPER_ARM, 0.17, materials.armor);
    const elbow = hinge(shoulder, 0, -UPPER_ARM, 0);
    limb(elbow, FOREARM, 0.14, materials.leather);
    const vambrace = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.22), materials.armor);
    vambrace.position.y = -FOREARM * 0.42;
    elbow.add(vambrace);
    const wrist = hinge(elbow, 0, -FOREARM, 0);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.2), materials.leather);
    glove.position.y = -0.1;
    wrist.add(glove);
    if (weapon === 'sword') {
      const sword = new THREE.Group();
      sword.position.set(0, -0.08, -0.05);
      sword.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0.339, -0.702, 0.627).normalize(),
      );
      sword.rotation.z = -2.98;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.42), materials.leather);
      grip.position.z = -0.16;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.1), materials.metal);
      guard.position.z = -0.38;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 1.85), materials.metal);
      blade.position.z = -1.28;
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.012, 1.7),
        new THREE.MeshStandardMaterial({ color: 0xf4f7fa, metalness: 1, roughness: 0.16 }),
      );
      edge.position.set(0.05, 0, -1.28);
      sword.add(grip, guard, blade, edge);
      wrist.add(sword);
    } else {
      const shield = new THREE.Group();
      shield.position.set(-0.15, -0.05, -0.2);
      shield.quaternion.set(-0.612, -0.444, -0.498, 0.425);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.88, 0.08), materials.plank);
      const rimV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.94, 0.1), materials.metal);
      rimV.position.x = -0.34;
      const rimV2 = rimV.clone();
      rimV2.position.x = 0.34;
      const rimH = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.06, 0.1), materials.metal);
      rimH.position.y = 0.43;
      const rimH2 = rimH.clone();
      rimH2.position.y = -0.43;
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), materials.metal);
      boss.scale.z = 0.55;
      boss.position.z = 0.08;
      shield.add(board, rimV, rimV2, rimH, rimH2, boss);
      wrist.add(shield);
      return { shoulder, elbow, shield };
    }
    return { shoulder, elbow, shield: null };
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

  const right = arm(1, 'sword');
  const left = arm(-1, 'shield');
  const legR = leg(1);
  const legL = leg(-1);
  const eyes = hinge(rig, 0, PLAYER_EYE_HEIGHT, -0.16);
  right.shoulder.rotation.set(1.05, 0.15, -0.35);
  right.elbow.rotation.x = 1.85;
  left.shoulder.rotation.set(0.2, 0.65, 1.35);
  left.elbow.rotation.x = 1.5;
  return { rig, body, torso, eyes, right, left, legR, legL };
}

export function createPlayer(camera, materials, start) {
  const fighter = createFighter(materials);
  const { rig, body, torso, eyes, right, left, legR, legL } = fighter;
  camera.parent.add(rig);
  eyes.add(camera);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);

  const lamp = new THREE.PointLight(0xffd2a8, 34, 22, 2);
  const viewLight = new THREE.PointLight(0xffe6cc, 8, 6, 2);
  camera.add(viewLight);
  rig.parent.add(lamp);

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
    bob: 0,
    gait: 0,
    room: null,
    aiming: false,
    struck: new Set(),
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
    if (state.gainedLevel) audio.level();
    return state.gainedLevel;
  }

  function reconcileXp(slider) {
    let needed = xpRequired(state.level, slider);
    while (state.xp >= needed) {
      state.xp -= needed;
      state.level += 1;
      state.gainedLevel = true;
      needed = applyStats(slider);
    }
    applyStats(slider);
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
    const aheadX = -Math.sin(state.yaw);
    const aheadZ = -Math.cos(state.yaw);
    lamp.position.set(state.x + aheadX * 1.6, 4.4, state.z + aheadZ * 1.6);
  }

  function pose(dt, moving) {
    state.bob = moving ? state.bob + dt * 10 : state.bob;
    const stride = moving ? Math.sin(state.bob) : 0;
    state.gait = stride;
    torso.rotation.x = state.pitch * 0.32;

    const swingT = state.swing > 0 ? 1 - state.swing / state.attackInterval : 0;
    const slash = Math.sin(Math.min(swingT, 1) * Math.PI);
    const armSway = moving && slash < 0.05 ? stride * 0.14 : 0;
    right.shoulder.rotation.x = 1.05 - slash * 0.4 + armSway;
    right.shoulder.rotation.y = 0.15 + slash * 0.95;
    right.shoulder.rotation.z = -0.35 + slash * 0.5;
    right.elbow.rotation.x = 1.85 - slash * 0.55;

    state.blockBlend += ((state.blocking && state.swing <= 0 ? 1 : 0) - state.blockBlend) * Math.min(1, dt * 10);
    const blend = state.blockBlend;
    left.shoulder.rotation.x = THREE.MathUtils.lerp(0.2 - armSway, 1.05, blend);
    left.shoulder.rotation.y = THREE.MathUtils.lerp(0.65, 0.15, blend);
    left.shoulder.rotation.z = THREE.MathUtils.lerp(1.35, 0.4, blend);
    left.elbow.rotation.x = THREE.MathUtils.lerp(1.5, 0.85, blend);

    legR.hip.rotation.x = 0.12 + stride * 0.62;
    legL.hip.rotation.x = 0.12 - stride * 0.62;
    legR.knee.rotation.x = Math.max(0, -legR.hip.rotation.x) * 1.15;
    legL.knee.rotation.x = Math.max(0, -legL.hip.rotation.x) * 1.15;
    legR.ankle.rotation.x = -(legR.hip.rotation.x + legR.knee.rotation.x);
    legL.ankle.rotation.x = -(legL.hip.rotation.x + legL.knee.rotation.x);
  }

  function update(dt, input, world, skeletons, slider, running) {
    state.gainedLevel = false;
    state.yaw += input.mouseYaw;
    state.pitch += input.mousePitch;
    state.yaw -= input.lookStickX * dt * LOOK_STICK;
    state.pitch -= input.lookStickY * dt * LOOK_STICK;
    state.pitch = Math.max(-1.42, Math.min(1.15, state.pitch));
    state.iframes = Math.max(0, state.iframes - dt);
    state.shake = Math.max(0, state.shake - dt);
    state.attackWait = Math.max(0, state.attackWait - dt);
    if (state.swing > 0) state.swing = Math.max(0, state.swing - dt);

    if (!running || !state.alive) {
      state.blocking = false;
      pose(dt, false);
      placeCamera();
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
    if (moving) {
      const speed = PLAYER_SPEED * (state.blocking ? PLAYER_BLOCK_SPEED_FACTOR : 1);
      state.x += (mx / length) * speed * dt;
      state.z += (mz / length) * speed * dt;
      const resolved = resolveBody(state.x, state.z, PLAYER_RADIUS, world.colliders);
      state.x = resolved.x;
      state.z = resolved.z;
    }
    state.room = world.roomAt(state.x, state.z, state.room?.id);

    if (input.attack && state.attackWait <= 0) {
      state.attackWait = state.attackInterval;
      state.swing = state.attackInterval;
      state.struck.clear();
      audio.swing();
    }

    const swingT = state.swing > 0 ? 1 - state.swing / state.attackInterval : 0;
    const hitting = swingT >= 0.18 && swingT <= 0.52;
    state.aiming = false;
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
        if (hitting && seen && !state.struck.has(skeleton.id)) {
          state.struck.add(skeleton.id);
          const killed = skeletons.damage(skeleton, state.damage);
          if (killed) addXp(slider);
          else audio.hit();
        }
      }
    }

    pose(dt, moving);
    placeCamera();
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
    state.blocking = false;
    state.room = null;
    state.struck.clear();
    state.gait = 0;
    body.rotation.x = 0;
    applyStats(0.5);
    pose(0, false);
    placeCamera();
  }

  pose(0, false);
  placeCamera();

  return {
    state,
    update,
    hurt,
    reset,
    reconcileXp,
  };
}
