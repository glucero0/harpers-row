import * as THREE from 'three';
import {
  GUARD_RADIUS,
  inGuardArc,
  SKELETON_DAMAGE,
  SKELETON_HP,
  SKELETON_MOVE_SPEED,
  SKELETON_RADIUS,
  SKELETON_RECOVER,
  SKELETON_SIGHT_RANGE,
  SKELETON_WANDER_FACTOR,
  SKELETON_WINDUP,
  attackRecover,
  attackWindup,
  paceMultiplier,
  skeletonAttackRange,
  skeletonWeapon,
} from './balance.js';
import { closestApproach3, closestOnSegment, lineOfSight, pointInPolygon, randomPointInPolygon, resolveBody } from './geometry.js';
import { audio } from './audio.js';
import { TriggerDustFall } from './dust.js';

function longBone(length, radius) {
  return new THREE.CapsuleGeometry(radius, Math.max(0.08, length - radius * 2), 2, 5);
}

function ribArc() {
  const geometry = new THREE.TorusGeometry(0.38, 0.035, 3, 8, Math.PI * 0.95);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function looseFragment(kind, material) {
  let geometry;
  if (kind === 'femur') geometry = new THREE.CapsuleGeometry(0.07, 0.82, 2, 5);
  else if (kind === 'rib') {
    geometry = new THREE.TorusGeometry(0.3, 0.035, 3, 7, Math.PI * 0.85);
    geometry.rotateX(Math.PI / 2);
  } else {
    geometry = new THREE.TetrahedronGeometry(0.16, 0);
    geometry.scale(1.35, 0.62, 0.9);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.fragment = true;
  mesh.userData.bone = true;
  return mesh;
}

function addPart(parent, geometry, material, x, y, z, isBone = false) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (isBone) {
    mesh.userData.bone = true;
    const uv = geometry.getAttribute('uv');
    if (uv && !geometry.getAttribute('uv2')) geometry.setAttribute('uv2', uv);
  }
  parent.add(mesh);
  return mesh;
}

function paintBones(root, material) {
  root.traverse((obj) => {
    if (obj.isMesh && obj.userData.bone) obj.material = material;
  });
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const easeInQuad = (t) => t * t;
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

// Melee arm keyframes: shoulder xyz, elbow, wrist, plus torso pitch (tx) and twist (ty).
// A negative elbow value folds the forearm up toward the shoulder, which is a real flex.
const MELEE_READY = { sx: -0.9, sy: 0.1, sz: 0.3, ex: -0.8, wx: 0.9, tx: 0, ty: 0 };
const MELEE_WINDUP = { sx: -1.6, sy: 0, sz: 1.1, ex: -1.3, wx: 0.4, tx: -0.1, ty: 0.4 };
const MELEE_CONTACT = { sx: -1.6, sy: -0.2, sz: -0.3, ex: -0.1, wx: 1.7, tx: 0.18, ty: -0.3 };
const MELEE_FOLLOW = { sx: -1.25, sy: -0.45, sz: -0.5, ex: -0.05, wx: 1.7, tx: 0.28, ty: -0.42 };
const OFFHAND_IDLE = { sx: 0.05, sy: 0, sz: -0.2, ex: -0.3, wx: 0, tx: 0, ty: 0 };
const OFFHAND_BRACE = { sx: -0.35, sy: 0, sz: -0.6, ex: -0.55, wx: 0, tx: 0, ty: 0 };
const POSE_KEYS = ['sx', 'sy', 'sz', 'ex', 'wx', 'tx', 'ty'];
const WINDUP_DRAW = 0.68;
const FOLLOW_SHARE = 0.24;
const LEG_LENGTH = 2.48;
const SKULL_REST_Y = 1.16;

// Archer keyframes. The skeleton faces +Z. The bow rides in the arm on the +X side (the skeleton's
// anatomical left) and the other arm draws the string. Aim and draw poses were solved with inverse
// kinematics against the real bone lengths: the torso turns 40 degrees so the drawing shoulder
// swings back, the bow hand sits on the eye line with a 15 degree elbow bend, and the drawing hand
// reaches the string, pulls straight back to the jaw (elbow flexed 105 degrees, out and high), and
// on release snaps back past the ear.
const BOW_TWIST = -0.7;
const BOW_CARRY = { sx: -0.3, sy: 0, sz: 0.3, ex: -0.5, wx: 0, tx: 0, ty: 0 };
const BOW_AIM = { sx: -0.92, sy: -0.9, sz: 1, ex: -0.26, wx: 0, tx: 0, ty: BOW_TWIST };
const BOW_KICK = { sx: -1.02, sy: -1.01, sz: 1.07, ex: -0.2, wx: 0, tx: 0, ty: BOW_TWIST };
const DRAW_CARRY = { sx: 0.05, sy: 0, sz: -0.28, ex: -0.3, wx: 0, tx: 0, ty: 0 };
const DRAW_PATH = [
  { sx: -0.39, sy: 1.97, sz: -1.57, ex: -0.66, wx: 0, tx: 0, ty: 0 },
  { sx: -0.42, sy: 1.84, sz: -1.59, ex: -1.05, wx: 0, tx: 0, ty: 0 },
  { sx: -0.46, sy: 1.73, sz: -1.62, ex: -1.34, wx: 0, tx: 0, ty: 0 },
  { sx: -0.5, sy: 1.62, sz: -1.67, ex: -1.59, wx: 0, tx: 0, ty: 0 },
  { sx: -0.56, sy: 1.51, sz: -1.73, ex: -1.84, wx: 0, tx: 0, ty: 0 },
];
const DRAW_RELEASE = { sx: -0.92, sy: 0.6, sz: -1.79, ex: -2.43, wx: 0, tx: 0, ty: 0 };
const BOW_REACH_END = 0.38;
const BOW_ANCHOR_AT = 0.9;
const BOW_KICK_SECONDS = 0.16;

// Bone debris. The skeleton stands about 4.8 units tall, so a metre is about 3.2 units.
const METER = 3.2;
// Aiming a chop at the raised torch (see solveGuardContact): which joints move, how far each may
// turn, how big the search steps are, and how strongly the pose is held near the ordinary strike.
const SOLVE_KEYS = ['sx', 'sy', 'sz', 'ex', 'wx'];
const SOLVE_STEPS = [0.16, 0.07, 0.03];
const SOLVE_PULL = 0.004;
const SOLVE_LIMITS = {
  sx: [-2.8, 0.5],
  sy: [-1.2, 1.2],
  sz: [-1.1, 1.4],
  ex: [-2.4, 0],
  wx: [-0.5, 2.3],
};
const ARROW_REBOUND = 0.3;
const ARROW_POP = 0.5;
const DOOR_LINEUP = 1.6;
const DOOR_PAST = 1.8;
const DOOR_MARGIN = 1.1;
const SCATTER = 0.5 * METER;
const DEBRIS_GRAVITY = 9.8 * METER;
const DEBRIS_BOUNCE = 0.35;
const DEBRIS_MAX_BOUNCES = 2;
const DEBRIS_MIN_IMPACT = 0.8 * METER;
const DEBRIS_REST_ENERGY = 0.06;
const DEBRIS_RADIUS = 0.25;
const DEBRIS_FADE_SECONDS = 2.5;
// Two bodies are on the same level (can see, reach and shoot each other) when their feet are within
// this height. A stairwell slope stays inside it over a few steps; another story never does.
const SAME_LEVEL = 4.5;

function makePose(source) {
  return { ...source };
}

function zeroVelocity() {
  return { sx: 0, sy: 0, sz: 0, ex: 0, wx: 0, tx: 0, ty: 0 };
}

function mixPose(from, to, amount, out) {
  for (const key of POSE_KEYS) out[key] = from[key] + (to[key] - from[key]) * amount;
}

function clearVelocity(velocity) {
  for (const key of POSE_KEYS) velocity[key] = 0;
}

// Critically damped spring: eases toward the target and settles without a linear snap.
function springPose(pose, velocity, target, omega, dt) {
  const step = Math.min(dt, 1 / 30);
  for (const key of POSE_KEYS) {
    const accel = omega * omega * (target[key] - pose[key]) - 2 * omega * velocity[key];
    velocity[key] += accel * step;
    pose[key] += velocity[key] * step;
  }
}

// 0..1: snaps in, holds about 0.12 s, then eases back to the tracking pose.
function reactAmount(t) {
  if (t >= 99) return 0;
  const snap = easeOutQuad(clamp01(t / 0.025));
  if (t < 0.12) return snap;
  return 1 - easeInOutQuad(clamp01((t - 0.12) / 0.3));
}

function strideAmplitude(speed) {
  return 0.3 + 0.4 * clamp01(speed / 10);
}

// A rounded triangle wave in [-1, 1]. A plain sine has the foot slide under the body at 1.57x
// the ground speed mid-stance, so the hip angle uses a flatter ramp that holds a planted foot
// closer to still (the ground speed matches the body across most of the stance).
const GAIT_FLATNESS = 0.97;
const GAIT_NORM = Math.asin(GAIT_FLATNESS);
function gaitWave(phase) {
  return Math.asin(GAIT_FLATNESS * Math.sin(phase)) / GAIT_NORM;
}

const weaponGripOffset = {
  position: new THREE.Vector3(0, 0, 0),
  rotation: new THREE.Euler(Math.PI / 2, 0, 0),
};

function addGripMesh(parent, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addFist(wrist, bone, side) {
  addPart(wrist, new THREE.BoxGeometry(0.16, 0.14, 0.16), bone, 0, 0, 0, true);
  addPart(wrist, new THREE.BoxGeometry(0.14, 0.1, 0.1), bone, 0, 0.02, 0.1, true);
  addPart(wrist, new THREE.BoxGeometry(0.12, 0.08, 0.08), bone, 0.02, -0.02, 0.12, true);
  addPart(wrist, new THREE.BoxGeometry(0.1, 0.06, 0.06), bone, 0.11 * side, 0.04, 0.02, true);
}

function addHandSocket(wrist, name) {
  const socket = new THREE.Group();
  socket.name = name;
  socket.position.set(0, -0.02, 0.06);
  wrist.add(socket);
  return socket;
}

function seatWeapon(socket) {
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  weapon.position.copy(weaponGripOffset.position);
  weapon.rotation.copy(weaponGripOffset.rotation);
  socket.add(weapon);
  return weapon;
}

function addMelee(socket, materials, kind) {
  const weapon = seatWeapon(socket);
  if (kind === 'mace') {
    const grip = new THREE.BoxGeometry(0.07, 0.3, 0.07);
    grip.translate(0, 0.09, 0);
    addGripMesh(weapon, grip, materials.leather);
    const head = new THREE.SphereGeometry(0.16, 8, 6);
    head.translate(0, 0.36, 0);
    addGripMesh(weapon, head, materials.rust);
    const flangeA = new THREE.BoxGeometry(0.3, 0.05, 0.05);
    flangeA.translate(0, 0.36, 0);
    addGripMesh(weapon, flangeA, materials.metal);
    const flangeB = new THREE.BoxGeometry(0.05, 0.05, 0.3);
    flangeB.translate(0, 0.36, 0);
    addGripMesh(weapon, flangeB, materials.metal);
    return;
  }
  if (kind === 'hammer') {
    const grip = new THREE.BoxGeometry(0.065, 0.36, 0.065);
    grip.translate(0, 0.1, 0);
    addGripMesh(weapon, grip, materials.leather);
    const head = new THREE.BoxGeometry(0.16, 0.18, 0.36);
    head.translate(0, 0.4, 0);
    addGripMesh(weapon, head, materials.rust);
    const face = new THREE.BoxGeometry(0.24, 0.12, 0.18);
    face.translate(0, 0.4, 0);
    addGripMesh(weapon, face, materials.metal);
    return;
  }
  const grip = new THREE.BoxGeometry(0.07, 0.28, 0.07);
  grip.translate(0, 0.084, 0);
  addGripMesh(weapon, grip, materials.leather);
  const guard = new THREE.BoxGeometry(0.46, 0.07, 0.09);
  guard.translate(0, 0.23, 0);
  addGripMesh(weapon, guard, materials.metal);
  const blade = new THREE.BoxGeometry(0.045, 1.4, 0.12);
  blade.translate(0, 0.96, 0);
  addGripMesh(weapon, blade, materials.metal);
}

// Bow local frame: +Y runs along the stave, -Z points at the target, +Z points at the archer. The grip
// sits at the origin; the limbs arch toward the target and the string rests BOW_BRACE behind the grip.
const BOW_REACH = 0.92;
const BOW_BRACE = 0.62;
const BOW_SHELF = new THREE.Vector3(0, 0.05, 0);
const ARROW_OVERSHOOT = 0.3;
const ARROW_LENGTH = 1.9;
const ARROW_SPEED = 46;
const ARROW_AIM_HEIGHT = 4.9;
const ARROW_SHAFT = new THREE.BoxGeometry(0.045, 0.045, 1);
const ARROW_HEAD = new THREE.ConeGeometry(0.075, 0.2, 5);
const ARROW_VANE_A = new THREE.BoxGeometry(0.2, 0.012, 0.3);
const ARROW_VANE_B = new THREE.BoxGeometry(0.012, 0.2, 0.3);
const FACE_TARGET = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_NEG_Z = new THREE.Vector3(0, 0, -1);
const scratch = {
  q1: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  q3: new THREE.Quaternion(),
  nock: new THREE.Vector3(),
  dir: new THREE.Vector3(),
};

// An arrow with its pivot at the middle of the shaft and its head toward -Z.
function makeArrow(materials) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(ARROW_SHAFT, materials.leather);
  const head = new THREE.Mesh(ARROW_HEAD, materials.metal);
  head.rotation.x = -Math.PI / 2;
  const vaneA = new THREE.Mesh(ARROW_VANE_A, materials.rust);
  const vaneB = new THREE.Mesh(ARROW_VANE_B, materials.rust);
  group.add(shaft, head, vaneA, vaneB);
  const arrow = { group, shaft, head, vaneA, vaneB, length: ARROW_LENGTH };
  fitArrow(arrow, ARROW_LENGTH);
  return arrow;
}

function fitArrow(arrow, length) {
  arrow.length = length;
  arrow.shaft.scale.z = length;
  arrow.head.position.z = -length / 2 - 0.04;
  arrow.vaneA.position.z = length / 2 - 0.2;
  arrow.vaneB.position.z = length / 2 - 0.2;
}

function placeSegment(mesh, from, to) {
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  const dir = scratch.dir.copy(to).sub(from);
  const len = dir.length();
  mesh.scale.y = Math.max(0.02, len);
  if (len > 0.001) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function addBow(socket, materials) {
  const group = new THREE.Group();
  group.name = 'bow';
  const tipU = new THREE.Vector3(0, BOW_REACH, BOW_BRACE);
  const tipD = new THREE.Vector3(0, -BOW_REACH, BOW_BRACE);
  const curve = new THREE.QuadraticBezierCurve3(tipU, new THREE.Vector3(0, 0, -BOW_BRACE), tipD);
  const stave = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 6, false), materials.leather);
  stave.castShadow = true;
  group.add(stave);
  addPart(group, new THREE.BoxGeometry(0.09, 0.26, 0.09), materials.leather, 0, 0, 0);
  const stringU = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), materials.metal);
  const stringD = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), materials.metal);
  group.add(stringU, stringD);
  const rest = new THREE.Vector3(0, 0, BOW_BRACE);
  placeSegment(stringU, tipU, rest);
  placeSegment(stringD, tipD, rest);
  const arrow = makeArrow(materials);
  arrow.group.visible = false;
  group.add(arrow.group);
  socket.add(group);
  return { group, arrow, stringU, stringD, tipU, tipD };
}

// Keep the stave upright (canted a little toward the draw side) with the limbs arching at the target,
// whatever the hand is doing. Then draw the string to the drawing hand and lay the arrow along it.
function rigBow(mesh, aim, nocked) {
  const bow = mesh.bow;
  const { q1, q2, q3, nock, dir } = scratch;
  mesh.armR.socket.getWorldQuaternion(q1);
  mesh.root.getWorldQuaternion(q2);
  q1.premultiply(q2.invert());
  q3.setFromAxisAngle(AXIS_Z, 0.05 + 0.28 * aim).multiply(FACE_TARGET);
  bow.group.quaternion.copy(q1).invert().multiply(q3);
  bow.group.updateWorldMatrix(true, false);

  mesh.armL.socket.getWorldPosition(nock);
  bow.group.worldToLocal(nock);
  if (nocked) {
    const pull = clamp01((nock.z - BOW_BRACE) / 0.4);
    nock.set(nock.x * pull, nock.y * pull, Math.max(BOW_BRACE, nock.z));
  } else {
    nock.set(0, 0, BOW_BRACE);
  }
  placeSegment(bow.stringU, bow.tipU, nock);
  placeSegment(bow.stringD, bow.tipD, nock);
  bow.arrow.group.visible = nocked;
  if (!nocked) return;

  dir.copy(BOW_SHELF).sub(nock);
  const reach = dir.length();
  if (reach < 0.05) return;
  dir.divideScalar(reach);
  const length = reach + ARROW_OVERSHOOT;
  fitArrow(bow.arrow, length);
  bow.arrow.group.position.copy(nock).addScaledVector(dir, length / 2);
  bow.arrow.group.quaternion.setFromUnitVectors(AXIS_NEG_Z, dir);
}

function nasalCavityGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.075);
  shape.bezierCurveTo(0.05, 0.04, 0.055, -0.01, 0.032, -0.07);
  shape.lineTo(0, -0.018);
  shape.lineTo(-0.032, -0.07);
  shape.bezierCurveTo(-0.055, -0.01, -0.05, 0.04, 0, 0.075);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  geometry.translate(0, 0, -0.1);
  return geometry;
}

function buildSkull(materials) {
  const bone = materials.bone;
  const cavity = materials.socket;
  const cranium = new THREE.Group();
  const vault = new THREE.IcosahedronGeometry(0.25, 0);
  vault.scale(1.18, 0.92, 1.22);
  addPart(cranium, vault, bone, 0, 0.18, -0.02, true);
  const occiput = new THREE.OctahedronGeometry(0.11, 0);
  occiput.scale(1.15, 0.85, 1.45);
  addPart(cranium, occiput, bone, 0, 0.1, -0.2, true);
  const brow = new THREE.CylinderGeometry(0.18, 0.22, 0.09, 5);
  brow.rotateX(Math.PI / 2);
  brow.scale(1.2, 0.62, 0.5);
  addPart(cranium, brow, bone, 0, 0.13, 0.16, true);
  for (const side of [-1, 1]) {
    const arch = new THREE.TorusGeometry(0.1, 0.016, 3, 6, Math.PI * 0.9);
    arch.rotateY(side * Math.PI / 2);
    arch.rotateX(0.35);
    addPart(cranium, arch, bone, 0.16 * side, 0.02, 0.05, true);
    const cheek = new THREE.OctahedronGeometry(0.055, 0);
    cheek.scale(1.35, 0.65, 1.05);
    addPart(cranium, cheek, bone, 0.2 * side, -0.02, 0.12, true);
    addPart(cranium, new THREE.BoxGeometry(0.1, 0.08, 0.14), cavity, 0.1 * side, 0.07, 0.07);
    addPart(
      cranium,
      new THREE.SphereGeometry(0.012, 4, 3),
      materials.ember,
      0.1 * side,
      0.065,
      0.015,
      false,
    );
  }
  const maxilla = new THREE.CylinderGeometry(0.04, 0.13, 0.15, 4);
  maxilla.scale(1.35, 1, 0.8);
  addPart(cranium, maxilla, bone, 0, -0.06, 0.12, true);
  addPart(cranium, new THREE.BoxGeometry(0.2, 0.022, 0.035), bone, 0, -0.14, 0.16, true);
  addPart(cranium, nasalCavityGeometry(), cavity, 0, -0.01, 0.2);

  const jaw = new THREE.Group();
  jaw.position.set(0, -0.2, -0.01);
  const mandible = new THREE.TorusGeometry(0.12, 0.032, 3, 7, Math.PI);
  mandible.rotateX(Math.PI * 0.5);
  addPart(jaw, mandible, bone, 0, 0.01, 0.02, true);
  const chin = new THREE.OctahedronGeometry(0.055, 0);
  chin.scale(0.85, 0.6, 1.25);
  addPart(jaw, chin, bone, 0, -0.02, 0.13, true);
  addPart(jaw, new THREE.BoxGeometry(0.16, 0.02, 0.03), bone, 0, 0.045, 0.11, true);
  const eyes = cranium.children.filter((child) => child.material === materials.ember);
  return { cranium, jaw, eyeL: eyes[0], eyeR: eyes[1] };
}

function pieceOf(node, ball = 0) {
  return {
    node,
    ball,
    home: {
      parent: node.parent,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    },
  };
}

function buildMesh(materials, weapon) {
  const bone = materials.bone;
  const root = new THREE.Group();
  const fall = new THREE.Group();
  root.add(fall);

  const pelvis = addPart(fall, new THREE.BoxGeometry(0.62, 0.22, 0.32), bone, 0, 2.95, 0, true);
  const spine = new THREE.Group();
  spine.position.y = 3.05;
  fall.add(spine);
  const column = addPart(spine, new THREE.BoxGeometry(0.22, 0.85, 0.2), bone, 0, 0.45, 0, true);
  const ribs = [];
  for (let rib = 0; rib < 4; rib += 1) {
    ribs.push(addPart(spine, ribArc(), bone, 0, 0.28 + rib * 0.18, 0.04, true));
  }
  addPart(spine, new THREE.BoxGeometry(0.5, 0.36, 0.08), materials.socket, 0, 0.55, 0.12);

  const skull = new THREE.Group();
  skull.position.set(0, SKULL_REST_Y, 0.03);
  spine.add(skull);
  addPart(spine, new THREE.CapsuleGeometry(0.07, 0.28, 2, 5), bone, 0, 0.98, 0.03, true);
  const { cranium, jaw, eyeL, eyeR } = buildSkull(materials);
  skull.add(cranium, jaw);

  function limb(side) {
    const shoulder = new THREE.Group();
    shoulder.name = side > 0 ? 'SkeletonArm_R' : 'SkeletonArm_L';
    shoulder.position.set(0.48 * side, 0.85, 0);
    spine.add(shoulder);
    const upper = addPart(shoulder, longBone(0.95, 0.07), bone, 0, -0.5, 0, true);
    const elbow = new THREE.Group();
    elbow.name = side > 0 ? 'Forearm_R' : 'Forearm_L';
    elbow.position.y = -0.98;
    shoulder.add(elbow);
    const fore = addPart(elbow, longBone(0.85, 0.055), bone, 0, -0.42, 0, true);
    const wrist = new THREE.Group();
    wrist.name = side > 0 ? 'WristJoint_R' : 'WristJoint_L';
    wrist.position.y = -0.86;
    elbow.add(wrist);
    addFist(wrist, bone, side);
    const socket = addHandSocket(wrist, side > 0 ? 'HandSocket_R' : 'HandSocket_L');
    return { shoulder, elbow, wrist, socket, upper, fore };
  }

  function leg(side) {
    const hip = new THREE.Group();
    hip.position.set(0.18 * side, 2.9, 0);
    fall.add(hip);
    const thigh = addPart(hip, longBone(1.25, 0.08), bone, 0, -0.65, 0, true);
    const knee = new THREE.Group();
    knee.position.y = -1.28;
    hip.add(knee);
    const shin = addPart(knee, longBone(1.2, 0.06), bone, 0, -0.6, 0, true);
    return { hip, knee, thigh, shin };
  }

  const armL = limb(-1);
  const armR = limb(1);
  const legL = leg(-1);
  const legR = leg(1);

  let bow = null;
  let held = null;
  if (weapon === 'bow') {
    bow = addBow(armR.socket, materials);
    held = bow.group;
    armR.shoulder.rotation.set(BOW_CARRY.sx, BOW_CARRY.sy, BOW_CARRY.sz);
    armR.elbow.rotation.x = BOW_CARRY.ex;
    armL.shoulder.rotation.set(DRAW_CARRY.sx, DRAW_CARRY.sy, DRAW_CARRY.sz);
    armL.elbow.rotation.x = DRAW_CARRY.ex;
  } else {
    addMelee(armR.socket, materials, weapon);
    held = armR.socket.getObjectByName('weapon');
    armR.shoulder.rotation.set(MELEE_READY.sx, MELEE_READY.sy, MELEE_READY.sz);
    armR.elbow.rotation.x = MELEE_READY.ex;
    armR.wrist.rotation.x = MELEE_READY.wx;
    armL.shoulder.rotation.set(OFFHAND_IDLE.sx, OFFHAND_IDLE.sy, OFFHAND_IDLE.sz);
    armL.elbow.rotation.x = OFFHAND_IDLE.ex;
  }

  // Every distinct bone, plus whatever is held, can come apart on death.
  const pieces = [
    pelvis, column, ...ribs,
    armL.upper, armL.fore, armL.wrist, armR.upper, armR.fore, armR.wrist,
    legL.thigh, legL.shin, legR.thigh, legR.shin,
  ].map((node) => pieceOf(node));
  pieces.push(pieceOf(cranium));
  pieces.push(pieceOf(jaw));
  if (held) pieces.push(pieceOf(held));
  return { root, fall, spine, skull, eyeL, eyeR, armL, armR, legL, legR, bow, held, pieces };
}

function angleDiff(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

const restPose = (weapon) => (weapon === 'bow' ? BOW_CARRY : MELEE_READY);
const restPoseL = (weapon) => (weapon === 'bow' ? DRAW_CARRY : OFFHAND_IDLE);

// Samples a keyframe path (evenly spaced) at t in 0..1 so the hand follows it in a near-straight line.
function samplePath(path, t, out) {
  const scaled = clamp01(t) * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  mixPose(path[index], path[index + 1], scaled - index, out);
}

export { weaponGripOffset };

export function createSkeletons(parent, dungeon, materials) {
  const list = [];
  const arrows = [];
  let spawnId = 0;
  for (const room of dungeon.rooms) {
    room.spawns.forEach((spawn, slot) => {
      const weapon = skeletonWeapon(spawnId);
      const mesh = buildMesh(materials, weapon);
      const floorY = dungeon.floorY ? dungeon.floorY(spawn[0], spawn[1], room) : 0;
      mesh.root.position.set(spawn[0], floorY, spawn[1]);
      parent.add(mesh.root);
      mesh.root.visible = false;
      list.push({
        id: spawnId,
        room,
        at: room,
        slot,
        spawnX: spawn[0],
        spawnZ: spawn[1],
        spawnY: floorY,
        x: spawn[0],
        y: floorY,
        z: spawn[1],
        yaw: Math.random() * Math.PI * 2,
        hp: SKELETON_HP,
        dead: false,
        aggro: false,
        state: 'wander',
        timer: 0.4 + Math.random() * 1.2,
        wander: { x: spawn[0], z: spawn[1] },
        weapon,
        phase: Math.random() * Math.PI * 2,
        flashFrames: 0,
        tint: 0,
        paint: materials.bone,
        knockX: 0,
        knockZ: 0,
        dustWait: 0,
        reactT: 99,
        speed: 0,
        stride: 0,
        pose: makePose(restPose(weapon)),
        vel: zeroVelocity(),
        poseL: makePose(restPoseL(weapon)),
        velL: zeroVelocity(),
        windupTotal: SKELETON_WINDUP,
        recoverTotal: SKELETON_RECOVER,
        windupFrom: makePose(restPose(weapon)),
        windupFromL: makePose(restPoseL(weapon)),
        nocked: false,
        caught: false,
        contact: makePose(MELEE_CONTACT),
        guardMix: 0,
        debris: null,
        fadeSwap: null,
        shattered: false,
        mesh,
        struck: false,
      });
      spawnId += 1;
    });
  }

  // Where to walk next to reach `goal` in the space numbered `goalIndex`. Rooms and passages form a
  // tree joined by doors (branches, stairs and all), so the way is the shortest path through it: the
  // next door on that path. The skeleton lines up a short way in front of the doorway first, then
  // walks straight through it, so it never grinds along the door frame. In the goal's own space it
  // walks straight at the goal.
  const lead = { x: 0, z: 0 };
  function routeTarget(skeleton, goalIndex, goal) {
    const space = skeleton.at;
    if (space.index === goalIndex) return goal;
    const hop = dungeon.nextHop(space.index, goalIndex);
    if (hop < 0) return goal;
    const door = dungeon.doorBetween(space.index, hop);
    if (!door) return goal;
    const next = dungeon.rooms[hop];
    const midX = (door.a[0] + door.b[0]) / 2;
    const midZ = (door.a[1] + door.b[1]) / 2;
    let nx = -(door.b[1] - door.a[1]);
    let nz = door.b[0] - door.a[0];
    const length = Math.hypot(nx, nz) || 1;
    nx /= length;
    nz /= length;
    if (nx * (next.rect.x + next.rect.w / 2 - midX) + nz * (next.rect.z + next.rect.d / 2 - midZ) < 0) {
      nx = -nx;
      nz = -nz;
    }
    // Sideways offset from the doorway's centre. Lined up (or already through) means walk straight on;
    // otherwise first go to the spot square in front of the door, which is lined up by construction.
    const along = (skeleton.x - midX) * nx + (skeleton.z - midZ) * nz;
    const side = Math.abs((skeleton.x - midX) * -nz + (skeleton.z - midZ) * nx);
    const lined = along > 0 || side < Math.max(0.3, Math.hypot(door.b[0] - door.a[0], door.b[1] - door.a[1]) / 2 - DOOR_MARGIN);
    const reach = lined ? DOOR_PAST : -DOOR_LINEUP;
    lead.x = midX + nx * reach;
    lead.z = midZ + nz * reach;
    return lead;
  }

  function living() {
    return list.filter((skeleton) => !skeleton.dead);
  }

  // Looses the arrow from where it sits on the string, flying at the player. It leaves the bow already
  // pointing at the target and rises or falls so it arrives at chest height.
  function looseArrow(skeleton, player) {
    const nocked = skeleton.mesh.bow.arrow;
    nocked.group.updateWorldMatrix(true, false);
    const origin = new THREE.Vector3().setFromMatrixPosition(nocked.group.matrixWorld);
    const dx = player.x - origin.x;
    const dz = player.z - origin.z;
    const dist = Math.hypot(dx, dz) || 1;
    const travel = Math.max(0.05, dist / ARROW_SPEED);
    const vx = (dx / dist) * ARROW_SPEED;
    const vz = (dz / dist) * ARROW_SPEED;
    const vy = (ARROW_AIM_HEIGHT + (player.y || 0) - origin.y) / travel;
    const flight = makeArrow(materials);
    fitArrow(flight, nocked.length);
    flight.group.position.copy(origin);
    flight.group.quaternion.setFromUnitVectors(AXIS_NEG_Z, new THREE.Vector3(vx, vy, vz).normalize());
    parent.add(flight.group);
    arrows.push({
      x: origin.x,
      y: origin.y,
      z: origin.z,
      vx,
      vy,
      vz,
      age: 0,
      // Pivot-to-head distance, used to seat the head on whatever it strikes.
      half: nocked.length / 2 + 0.14,
      bounced: false,
      // The arrow is spent when it drops to the floor it was shot over.
      floor: skeleton.y + 0.1,
      mesh: flight.group,
    });
    skeleton.nocked = false;
    audio.shot();
  }

  function removeArrow(index) {
    const arrow = arrows[index];
    parent.remove(arrow.mesh);
    arrows.splice(index, 1);
  }

  // An arrow caught on the torch. It is placed so its head touches the torch, then thrown back off
  // the guard the way a glancing hit would send it: reflected about a slightly tilted face, slowed,
  // lifted, and tumbling, so it clearly skips away instead of simply vanishing.
  const bounceDir = new THREE.Vector3();
  const bounceNormal = new THREE.Vector3();
  const bounceSpin = new THREE.Quaternion();
  function bounceArrow(arrow, player) {
    bounceDir.set(arrow.vx, arrow.vy, arrow.vz).normalize();
    const back = arrow.half;
    arrow.x = player.guardX - bounceDir.x * back;
    arrow.y = player.guardY - bounceDir.y * back;
    arrow.z = player.guardZ - bounceDir.z * back;
    bounceNormal.set(
      -bounceDir.x + (Math.random() - 0.5) * 0.9,
      -bounceDir.y + 0.25 + Math.random() * 0.5,
      -bounceDir.z + (Math.random() - 0.5) * 0.9,
    ).normalize();
    const along = arrow.vx * bounceNormal.x + arrow.vy * bounceNormal.y + arrow.vz * bounceNormal.z;
    arrow.vx = (arrow.vx - 2 * along * bounceNormal.x) * ARROW_REBOUND;
    arrow.vy = (arrow.vy - 2 * along * bounceNormal.y) * ARROW_REBOUND + ARROW_POP * METER;
    arrow.vz = (arrow.vz - 2 * along * bounceNormal.z) * ARROW_REBOUND;
    arrow.bounced = true;
    arrow.age = 0;
    arrow.spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    arrow.spinRate = (10 + Math.random() * 8) * (Math.random() < 0.5 ? -1 : 1);
    arrow.mesh.position.set(arrow.x, arrow.y, arrow.z);
  }

  function updateArrows(dt, player, hurt) {
    for (let index = arrows.length - 1; index >= 0; index -= 1) {
      const arrow = arrows[index];
      if (arrow.bounced) arrow.vy -= DEBRIS_GRAVITY * dt;
      const nextX = arrow.x + arrow.vx * dt;
      const nextY = arrow.y + arrow.vy * dt;
      const nextZ = arrow.z + arrow.vz * dt;

      if (!arrow.bounced && player.alive) {
        // The torch comes first: it is out in front of the player. Only an arrow flying toward the
        // player, whose path passes close to the torch, is caught; one that slips by it hits the body.
        const toGuardX = player.guardX - player.x;
        const toGuardZ = player.guardZ - player.z;
        if (player.guardUp && arrow.vx * toGuardX + arrow.vz * toGuardZ < 0
          && closestApproach3(arrow.x, arrow.y, arrow.z, nextX, nextY, nextZ, player.guardX, player.guardY, player.guardZ).distance <= GUARD_RADIUS
          && hurt(0, { kind: 'arrow', deflected: true })) {
          bounceArrow(arrow, player);
          arrow.mesh.quaternion.setFromUnitVectors(AXIS_NEG_Z, arrowAim.set(arrow.vx, arrow.vy, arrow.vz).normalize());
          continue;
        }
        const closest = closestOnSegment(player.x, player.z, arrow.x, arrow.z, nextX, nextZ);
        const level = Math.abs(arrow.y - ((player.y || 0) + ARROW_AIM_HEIGHT)) < SAME_LEVEL;
        if (level && Math.hypot(player.x - closest.x, player.z - closest.z) < 0.9) {
          if (hurt(SKELETON_DAMAGE, { kind: 'arrow', x: arrow.x, z: arrow.z }) === 'hit') audio.hurt();
          removeArrow(index);
          continue;
        }
      }

      const blocked = !lineOfSight(arrow.x, arrow.z, nextX, nextZ, dungeon.colliders, arrow.y);
      arrow.x = nextX;
      arrow.y = nextY;
      arrow.z = nextZ;
      arrow.age += dt;
      arrow.mesh.position.set(arrow.x, arrow.y, arrow.z);
      if (arrow.bounced) {
        bounceSpin.setFromAxisAngle(arrow.spinAxis, arrow.spinRate * dt);
        arrow.mesh.quaternion.premultiply(bounceSpin);
      }
      if (blocked || arrow.age > (arrow.bounced ? 1.8 : 1.4) || arrow.y < arrow.floor) removeArrow(index);
    }
  }

  // ---- Bone debris -------------------------------------------------------------------------------

  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const UP = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const tmpAxis = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();

  // The bounding box of everything visible under a node, expressed in the node's own space.
  function localBounds(node) {
    node.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const matrix = new THREE.Matrix4();
    const part = new THREE.Box3();
    const box = new THREE.Box3();
    node.traverseVisible((object) => {
      if (!object.isMesh) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      part.copy(object.geometry.boundingBox).applyMatrix4(matrix);
      box.union(part);
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
    return box;
  }

  function boxCorners(box) {
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    return corners;
  }

  // Every bone comes apart: unparent each piece into a debris group at its current world transform,
  // then throw it away from the blow with its own spin.
  function shatter(skeleton, dirX, dirZ) {
    const mesh = skeleton.mesh;
    const support = debrisSupport(skeleton);
    mesh.root.updateWorldMatrix(true, true);
    const group = new THREE.Group();
    group.name = 'bone-debris';
    parent.add(group);
    mesh.eyeL.visible = false;
    mesh.eyeR.visible = false;
    if (mesh.bow) mesh.bow.arrow.group.visible = false;
    for (const spec of mesh.pieces) group.attach(spec.node);

    const impact = new THREE.Vector3(skeleton.x - dirX * 0.6, skeleton.y + 3.6, skeleton.z - dirZ * 0.6);
    const pieces = mesh.pieces.map((spec) => {
      const node = spec.node;
      const box = localBounds(node);
      let radialX = node.position.x - impact.x;
      let radialZ = node.position.z - impact.z;
      const radial = Math.hypot(radialX, radialZ);
      if (radial < 0.05) {
        const angle = Math.random() * Math.PI * 2;
        radialX = Math.cos(angle);
        radialZ = Math.sin(angle);
      } else {
        radialX /= radial;
        radialZ /= radial;
      }
      const burst = 0.4 + Math.random() * 0.5;
      const push = 0.5 + Math.random() * 0.5;
      const jitter = () => (Math.random() - 0.5) * 2.5;
      const lift = 1.5 + Math.random() * 2 + (spec.ball ? 0.8 : 0);
      const spin = () => (Math.random() - 0.5) * 16;
      return {
        node,
        ball: spec.ball,
        dims: box.getSize(new THREE.Vector3()),
        corners: boxCorners(box),
        // Lift uses the full metre scale so the pop reads against gravity; sideways speed is kept
        // lower so the bones land in a heap rather than across the room.
        vel: new THREE.Vector3(
          (radialX * burst + dirX * push + jitter()) * SCATTER,
          lift * METER,
          (radialZ * burst + dirZ * push + jitter()) * SCATTER,
        ),
        spin: new THREE.Vector3(spin(), spin(), spin()),
        bounces: 0,
        mode: 'fly',
        target: null,
      };
    });
    const kinds = ['femur', 'femur', 'rib', 'rib', 'rib', 'skull', 'skull'];
    for (const kind of kinds) {
      const meshBit = looseFragment(kind, materials.bone);
      meshBit.position.set(
        skeleton.x + (Math.random() - 0.5) * 0.8,
        skeleton.y + 2.4 + Math.random() * 2.2,
        skeleton.z + (Math.random() - 0.5) * 0.8,
      );
      group.add(meshBit);
      const box = localBounds(meshBit);
      const angle = Math.random() * Math.PI * 2;
      pieces.push({
        node: meshBit,
        ball: 0,
        dims: box.getSize(new THREE.Vector3()),
        corners: boxCorners(box),
        vel: new THREE.Vector3(
          (Math.cos(angle) * 0.6 + dirX) * SCATTER,
          (1.2 + Math.random() * 1.8) * METER,
          (Math.sin(angle) * 0.6 + dirZ) * SCATTER,
        ),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        bounces: 0,
        mode: 'fly',
        target: null,
      });
    }
    mesh.root.visible = false;
    skeleton.shattered = true;
    skeleton.debris = {
      group,
      pieces,
      // The floor the bones land on: the one the skeleton fell over.
      floor: skeleton.y,
      age: 0,
      life: 15 + Math.random() * 5,
      resting: false,
      fade: null,
      floorY: support.floor,
      ceilingY: support.ceiling,
    };
  }

  function lowestPoint(piece) {
    const node = piece.node;
    if (piece.ball) return node.position.y - piece.ball;
    let low = Infinity;
    for (const corner of piece.corners) {
      tmp.copy(corner).applyQuaternion(node.quaternion);
      if (tmp.y < low) low = tmp.y;
    }
    return node.position.y + low;
  }

  function highestPoint(piece) {
    const node = piece.node;
    if (piece.ball) return node.position.y + piece.ball;
    let high = -Infinity;
    for (const corner of piece.corners) {
      tmp.copy(corner).applyQuaternion(node.quaternion);
      if (tmp.y > high) high = tmp.y;
    }
    return node.position.y + high;
  }

  // The orientation a tumbling bone settles into: lying on its broadest face, a long thin bone on its side.
  function flatOrientation(piece) {
    const q = piece.node.quaternion;
    const size = [piece.dims.x, piece.dims.y, piece.dims.z];
    const order = [0, 1, 2].sort((a, b) => size[a] - size[b]);
    let candidates = [0, 1, 2];
    if (size[order[0]] < 0.6 * size[order[1]]) candidates = [order[0]];
    else if (size[order[2]] > 1.6 * size[order[1]]) candidates = [order[0], order[1]];
    let best = candidates[0];
    let bestUp = -1;
    for (const index of candidates) {
      const up = Math.abs(tmpAxis.copy(AXES[index]).applyQuaternion(q).y);
      if (up > bestUp) {
        bestUp = up;
        best = index;
      }
    }
    tmpAxis.copy(AXES[best]).applyQuaternion(q);
    if (tmpAxis.y < 0) tmpAxis.negate();
    return tmpQuat.setFromUnitVectors(tmpAxis, UP).multiply(q).clone();
  }

  function restPiece(piece) {
    piece.mode = 'rest';
    piece.vel.set(0, 0, 0);
    piece.spin.set(0, 0, 0);
    piece.node.updateMatrix();
    piece.node.matrixAutoUpdate = false;
  }

  function stepPiece(piece, step, floor) {
    const node = piece.node;
    const ground = restingFloor(floorY, floorY, ceilingY);
    const slab = ceilingY - 0.05;
    piece.vel.y -= DEBRIS_GRAVITY * step;
    node.position.addScaledVector(piece.vel, step);
    if (piece.mode === 'settle' && piece.target) {
      node.quaternion.slerp(piece.target, 1 - Math.exp(-12 * step));
    } else {
      const speed = piece.spin.length();
      if (speed > 0.0001) {
        tmpQuat.setFromAxisAngle(tmpAxis.copy(piece.spin).divideScalar(speed), speed * step);
        node.quaternion.premultiply(tmpQuat);
      }
    }

    const high = highestPoint(piece);
    if (high > slab) {
      node.position.y -= high - slab;
      if (piece.vel.y > 0) piece.vel.y = 0;
    }

    let grounded = false;
    const low = lowestPoint(piece);
    if (low < floor) {
      node.position.y += floor - low;
      if (piece.vel.y < -DEBRIS_MIN_IMPACT && piece.bounces < DEBRIS_MAX_BOUNCES) {
        piece.vel.y *= -DEBRIS_BOUNCE;
        piece.vel.x *= 0.6;
        piece.vel.z *= 0.6;
        piece.spin.multiplyScalar(0.6);
        piece.bounces += 1;
      } else {
        piece.vel.y = 0;
        grounded = true;
      }
    }
    if (grounded) {
      const drag = Math.exp(-(piece.ball ? 3.2 : 9) * step);
      piece.vel.x *= drag;
      piece.vel.z *= drag;
      if (piece.ball) {
        piece.spin.set(piece.vel.z / piece.ball, 0, -piece.vel.x / piece.ball);
      } else {
        piece.spin.multiplyScalar(Math.exp(-10 * step));
        if (piece.mode === 'fly') {
          piece.mode = 'settle';
          piece.target = flatOrientation(piece);
        }
      }
    }

    if (piece.vel.x * piece.vel.x + piece.vel.z * piece.vel.z > 0.01) {
      const resolved = resolveBody(node.position.x, node.position.z, DEBRIS_RADIUS, dungeon.colliders, floor);
      if (resolved.x !== node.position.x || resolved.z !== node.position.z) {
        node.position.x = resolved.x;
        node.position.z = resolved.z;
        piece.vel.x *= 0.3;
        piece.vel.z *= 0.3;
      }
    }

    if (!grounded) return;
    const energy = 0.5 * piece.vel.lengthSq() + 0.025 * piece.spin.lengthSq();
    const flat = piece.ball || (piece.target && node.quaternion.angleTo(piece.target) < 0.03);
    if (energy < DEBRIS_REST_ENERGY && flat) restPiece(piece);
  }

  // Swaps each material for a transparent twin so one skeleton can fade without touching the rest.
  function beginFade(skeleton) {
    const swaps = [];
    const twins = new Map();
    skeleton.debris.group.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const original = object.material;
      let twin = twins.get(original);
      if (!twin) {
        twin = materials.fadeVariant(original);
        twins.set(original, twin);
      }
      swaps.push([object, original]);
      object.material = twin;
    });
    skeleton.fadeSwap = swaps;
    skeleton.debris.fade = [...twins.values()];
  }

  function dropDebris(skeleton) {
    const debris = skeleton.debris;
    if (!debris) return;
    debris.group.traverse((object) => {
      if (object.userData?.fragment) object.geometry?.dispose();
    });
    parent.remove(debris.group);
    if (debris.fade) for (const twin of debris.fade) twin.dispose();
    skeleton.debris = null;
  }

  // Dead skeletons cost nothing but this: the bones tumble for a moment, freeze where they land, and
  // fade out after 15 to 20 seconds.
  function tickDebris(skeleton, dt) {
    const debris = skeleton.debris;
    if (!debris) return;
    debris.age += dt;
    if (!debris.resting) {
      const step = Math.min(dt, 1 / 30);
      let moving = 0;
      for (const piece of debris.pieces) {
        if (piece.mode === 'rest') continue;
        stepPiece(piece, step, debris.floor);
        if (piece.mode !== 'rest') moving += 1;
      }
      if (moving === 0 || debris.age > 6) {
        for (const piece of debris.pieces) if (piece.mode !== 'rest') restPiece(piece);
        debris.resting = true;
      }
    }
    if (debris.age > debris.life) {
      if (!debris.fade) beginFade(skeleton);
      const fade = clamp01((debris.age - debris.life) / DEBRIS_FADE_SECONDS);
      for (const twin of debris.fade) twin.opacity = 1 - fade;
      if (fade >= 1) dropDebris(skeleton);
    }
  }

  function damage(skeleton, amount, dirX = 0, dirZ = 1) {
    if (skeleton.dead) return false;
    skeleton.hp -= amount;
    skeleton.flashFrames = 2;
    skeleton.tint = 0.08;
    skeleton.reactT = 0;
    const len = Math.hypot(dirX, dirZ) || 1;
    skeleton.knockX = (dirX / len) * 12;
    skeleton.knockZ = (dirZ / len) * 12;
    skeleton.aggro = true;
    audio.hit({ x: skeleton.x, y: skeleton.y + 3.3, z: skeleton.z });
    TriggerDustFall(skeleton.hp > 0 ? 1.15 : 2.5, { x: skeleton.x, y: skeleton.y + 3.4, z: skeleton.z });
    if (skeleton.hp > 0) return false;
    skeleton.hp = 0;
    skeleton.dead = true;
    skeleton.state = 'dead';
    skeleton.knockX = 0;
    skeleton.knockZ = 0;
    shatter(skeleton, dirX / len, dirZ / len);
    return true;
  }


  // Aim the chop at the raised torch. The normal strike ends at chest height, below a torch held up
  // at eye level, so while the guard is up the strike pose is solved for each frame: the five arm
  // joints are nudged (coordinate descent, warm-started from last frame) until the weapon touches
  // the torch, while staying close to the ordinary strike so it still reads as the same chop.
  const guardBox = new THREE.Box3();
  const guardPoint = new THREE.Vector3();
  function weaponGap(mesh, pose) {
    mesh.spine.rotation.set(pose.tx, pose.ty, 0);
    mesh.armR.shoulder.rotation.set(pose.sx, pose.sy, pose.sz);
    mesh.armR.elbow.rotation.x = pose.ex;
    mesh.armR.wrist.rotation.x = pose.wx;
    mesh.held.updateWorldMatrix(true, false);
    guardBox.setFromObject(mesh.held);
    return guardBox.distanceToPoint(guardPoint);
  }

  function guardCost(mesh, pose) {
    const gap = weaponGap(mesh, pose);
    let drift = 0;
    for (const key of SOLVE_KEYS) drift += (pose[key] - MELEE_CONTACT[key]) ** 2;
    return gap * gap + SOLVE_PULL * drift;
  }

  function solveGuardContact(skeleton, player) {
    const mesh = skeleton.mesh;
    if (!mesh.held) return;
    guardPoint.set(player.guardX, player.guardY, player.guardZ);
    const pose = skeleton.contact;
    let best = guardCost(mesh, pose);
    for (const step of SOLVE_STEPS) {
      for (const key of SOLVE_KEYS) {
        const home = pose[key];
        for (const sign of [1, -1]) {
          const limit = SOLVE_LIMITS[key];
          pose[key] = Math.min(limit[1], Math.max(limit[0], home + sign * step));
          const cost = guardCost(mesh, pose);
          if (cost < best - 1e-6) {
            best = cost;
            break;
          }
          pose[key] = home;
        }
      }
    }
  }

  // A blow that lands on the torch throws the attacker back a step and jolts its spine.
  function rebound(skeleton, player) {
    const dx = skeleton.x - player.x;
    const dz = skeleton.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    skeleton.knockX = (dx / len) * 8;
    skeleton.knockZ = (dz / len) * 8;
    skeleton.reactT = 0;
  }

  function puffDust(skeleton, x, y, z, power) {
    if (skeleton.dustWait > 0) return;
    skeleton.dustWait = 0.4;
    TriggerDustFall(power, { x, y, z });
  }

  function slideKnock(skeleton, dt) {
    if (!skeleton.knockX && !skeleton.knockZ) return;
    skeleton.x += skeleton.knockX * dt;
    skeleton.z += skeleton.knockZ * dt;
    const knockedX = skeleton.x;
    const knockedZ = skeleton.z;
    const resolved = resolveBody(skeleton.x, skeleton.z, SKELETON_RADIUS, dungeon.colliders, skeleton.y);
    skeleton.x = resolved.x;
    skeleton.z = resolved.z;
    if (Math.hypot(resolved.x - knockedX, resolved.z - knockedZ) > 0.12) {
      puffDust(skeleton, resolved.x, skeleton.y + 3.6, resolved.z, 1.6);
    }
    const decay = Math.exp(-8 * dt);
    skeleton.knockX *= decay;
    skeleton.knockZ *= decay;
    if (skeleton.knockX * skeleton.knockX + skeleton.knockZ * skeleton.knockZ < 0.04) {
      skeleton.knockX = 0;
      skeleton.knockZ = 0;
    }
  }

  // Two pure white frames on impact, then a pale red tint for 0.08 s of real time.
  function paintFlash(skeleton, realDt) {
    const debris = skeleton.debris;
    // Once the bones are strewn the paint follows them; once they fade, the fade owns the materials.
    if (skeleton.dead && (!debris || debris.fade)) return;
    let wanted = materials.bone;
    if (skeleton.flashFrames > 0) {
      wanted = materials.boneFlash;
      skeleton.flashFrames -= 1;
    } else if (skeleton.tint > 0) {
      wanted = materials.boneHot;
      skeleton.tint -= realDt;
    }
    if (skeleton.paint !== wanted) {
      paintBones(debris ? debris.group : skeleton.mesh.root, wanted);
      skeleton.paint = wanted;
    }
  }

  // Draw back deliberately, strike explosively, carry through, then settle with a damped spring.
  // The pose the chop arrives at: the ordinary strike, or the solved one that lands on the raised
  // torch, blended by how long the guard has been up during this windup.
  const contactPose = makePose(MELEE_CONTACT);
  function contactFor(skeleton) {
    if (skeleton.guardMix < 0.005) return MELEE_CONTACT;
    mixPose(MELEE_CONTACT, skeleton.contact, skeleton.guardMix, contactPose);
    return contactPose;
  }

  function driveMeleeArms(skeleton, dt) {
    const pose = skeleton.pose;
    if (skeleton.state === 'windup') {
      const u = clamp01(1 - skeleton.timer / skeleton.windupTotal);
      if (u < WINDUP_DRAW) {
        mixPose(skeleton.windupFrom, MELEE_WINDUP, easeInOutQuad(u / WINDUP_DRAW), pose);
      } else {
        mixPose(MELEE_WINDUP, contactFor(skeleton), easeInQuad((u - WINDUP_DRAW) / (1 - WINDUP_DRAW)), pose);
      }
      clearVelocity(skeleton.vel);
    } else if (skeleton.state === 'recover' && !skeleton.caught
      && 1 - skeleton.timer / skeleton.recoverTotal < FOLLOW_SHARE) {
      const v = clamp01(1 - skeleton.timer / skeleton.recoverTotal);
      mixPose(contactFor(skeleton), MELEE_FOLLOW, easeOutQuad(v / FOLLOW_SHARE), pose);
      clearVelocity(skeleton.vel);
    } else {
      springPose(pose, skeleton.vel, MELEE_READY, 9, dt);
    }
    const stridePhase = Math.sin(skeleton.phase) * skeleton.stride;
    const braced = skeleton.state === 'windup';
    const offhand = braced
      ? OFFHAND_BRACE
      : { ...OFFHAND_IDLE, sx: OFFHAND_IDLE.sx - stridePhase * 0.3 };
    springPose(skeleton.poseL, skeleton.velL, offhand, 8, dt);
  }

  // Archer: raise the bow and reach for the string, draw straight back to the jaw, hold, then on release
  // the string hand snaps back past the ear while the bow hand kicks up, and both ease back to carry.
  function driveBowArms(skeleton, dt) {
    const bowPose = skeleton.pose;
    const drawPose = skeleton.poseL;
    skeleton.nocked = false;
    if (skeleton.state === 'windup') {
      const u = clamp01(1 - skeleton.timer / skeleton.windupTotal);
      if (u < BOW_REACH_END) {
        const k = easeInOutQuad(u / BOW_REACH_END);
        mixPose(skeleton.windupFrom, BOW_AIM, k, bowPose);
        mixPose(skeleton.windupFromL, DRAW_PATH[0], k, drawPose);
      } else {
        Object.assign(bowPose, BOW_AIM);
        const k = easeInOutQuad(clamp01((u - BOW_REACH_END) / (BOW_ANCHOR_AT - BOW_REACH_END)));
        samplePath(DRAW_PATH, k, drawPose);
        skeleton.nocked = true;
      }
      clearVelocity(skeleton.vel);
      clearVelocity(skeleton.velL);
      return;
    }
    const sinceShot = skeleton.state === 'recover' ? skeleton.recoverTotal - skeleton.timer : Infinity;
    if (sinceShot < BOW_KICK_SECONDS) {
      const k = easeOutQuad(sinceShot / BOW_KICK_SECONDS);
      mixPose(BOW_AIM, BOW_KICK, k, bowPose);
      mixPose(DRAW_PATH[DRAW_PATH.length - 1], DRAW_RELEASE, k, drawPose);
      clearVelocity(skeleton.vel);
      clearVelocity(skeleton.velL);
      return;
    }
    const stridePhase = Math.sin(skeleton.phase) * skeleton.stride;
    springPose(bowPose, skeleton.vel, { ...BOW_CARRY, sx: BOW_CARRY.sx - stridePhase * 0.1 }, 6, dt);
    springPose(drawPose, skeleton.velL, { ...DRAW_CARRY, sx: DRAW_CARRY.sx + stridePhase * 0.3 }, 6, dt);
  }

  const paceByRoom = new Map();
  const arrowAim = new THREE.Vector3();
  function update(dt, player, hurt, slider, running, realDt = dt) {
    paceByRoom.clear();
    // Pace grows with how far a room is from the entrance, in rooms, not with its place in the file.
    const depthCount = dungeon.depthCount ?? dungeon.rooms.length;
    for (const room of dungeon.rooms) {
      paceByRoom.set(room.id, paceMultiplier(room.depth ?? room.index, slider, depthCount));
    }
    const playerY = player.y || 0;
    for (const skeleton of list) {
      const pace = paceByRoom.get(skeleton.room.id);
      const mesh = skeleton.mesh;
      paintFlash(skeleton, realDt);
      if (skeleton.dead) {
        // No AI, no collision, no pose: only the loose bones still move.
        tickDebris(skeleton, dt);
        continue;
      }

      const startX = skeleton.x;
      const startZ = skeleton.z;
      const home = pointInPolygon(skeleton.x, skeleton.z, skeleton.room.polygon);
      const shown = dungeon.roomVisible ? dungeon.roomVisible(skeleton.room.id) : true;
      mesh.root.visible = shown;
      if (!shown) {
        tickDebris(skeleton, dt);
        continue;
      }
      skeleton.at = home && !skeleton.aggro
        ? skeleton.room
        : dungeon.roomAt(skeleton.x, skeleton.z, skeleton.at.id, skeleton.y);
      skeleton.y = dungeon.floorY ? dungeon.floorY(skeleton.x, skeleton.z, skeleton.at) : 0;
      // Only a body on the same level can be seen, reached or shot: another story is a floor away.
      const level = Math.abs(skeleton.y - playerY) < SAME_LEVEL;
      // Seeing the player is what starts the hunt: standing in the skeleton's room, or a clear line to
      // them through a doorway or down a passage. Once started it never ends on its own. The only way
      // out is the player's death, so a skeleton cannot lose interest and wander back to its circuit.
      if (running && player.alive && !skeleton.aggro && dungeon.intruded) {
        const sameRoom = player.room && player.room.id === skeleton.room.id;
        const dx = player.x - skeleton.x;
        const dz = player.z - skeleton.z;
        if (sameRoom || (level && dx * dx + dz * dz < SKELETON_SIGHT_RANGE ** 2
          && lineOfSight(skeleton.x, skeleton.z, player.x, player.z, dungeon.colliders, skeleton.y))) {
          skeleton.aggro = true;
        }
      }
      if (skeleton.aggro && running && !player.alive) {
        skeleton.aggro = false;
        skeleton.state = 'wander';
      }

      let target = skeleton.wander;
      let moving = false;
      let watching = false;
      if (!skeleton.aggro) {
        if (!home) {
          // Displaced (a knock through a doorway): go back through the doors to the post.
          target = routeTarget(skeleton, skeleton.room.index, { x: skeleton.spawnX, z: skeleton.spawnZ });
          moving = true;
        } else if (skeleton.state !== 'idle') {
          const dist = Math.hypot(target.x - skeleton.x, target.z - skeleton.z);
          if (dist < 0.4) {
            skeleton.state = 'idle';
            skeleton.timer = 0.8 + Math.random() * 1.6;
          } else moving = true;
        } else {
          skeleton.timer -= dt;
          if (skeleton.timer <= 0) {
            skeleton.wander = randomPointInPolygon(skeleton.room.polygon, 1.6);
            skeleton.state = 'wander';
            target = skeleton.wander;
            moving = true;
          }
        }
      } else if (running) {
        // Hunting: wherever the player goes, follow. In another space the skeleton takes the doors
        // toward them; in the same space it closes in (melee) or squares up to shoot (archer).
        const ring = skeleton.slot * 1.7;
        target = routeTarget(skeleton, player.room?.index ?? skeleton.at.index, {
          x: player.x + Math.cos(ring) * 1.35,
          z: player.z + Math.sin(ring) * 1.35,
        });
        const dist = Math.hypot(player.x - skeleton.x, player.z - skeleton.z);
        const seen = level && lineOfSight(skeleton.x, skeleton.z, player.x, player.z, dungeon.colliders, skeleton.y);
        watching = seen;
        const range = skeletonAttackRange(skeleton.weapon);
        if (skeleton.state === 'windup') {
          skeleton.timer -= dt;
          moving = dist > range * 1.15;
          if (dist > range * 1.5 || !seen) skeleton.state = 'chase';
          else if (skeleton.timer <= 0) {
            skeleton.caught = false;
            if (seen && dist <= range + 0.35) {
              if (skeleton.weapon === 'bow') looseArrow(skeleton, player);
              else {
                const result = hurt(SKELETON_DAMAGE, { x: skeleton.x, z: skeleton.z });
                if (result === 'hit') audio.hurt();
                else if (result === 'blocked') {
                  rebound(skeleton, player);
                  // The weapon stops dead on the torch and springs back from there.
                  skeleton.caught = true;
                }
              }
            }
            skeleton.state = 'recover';
            skeleton.recoverTotal = attackRecover(pace);
            skeleton.timer = skeleton.recoverTotal;
          }
        } else if (skeleton.state === 'recover') {
          skeleton.timer -= dt;
          if (skeleton.timer <= 0) skeleton.state = 'chase';
        } else if (dist <= range && seen) {
          skeleton.state = 'windup';
          skeleton.windupTotal = attackWindup(pace);
          skeleton.timer = skeleton.windupTotal;
          skeleton.guardMix = 0;
          Object.assign(skeleton.contact, MELEE_CONTACT);
          Object.assign(skeleton.windupFrom, skeleton.pose);
          Object.assign(skeleton.windupFromL, skeleton.poseL);
        } else {
          skeleton.state = 'chase';
          moving = true;
        }
      }

      const speedScale = skeleton.state === 'windup' ? 0.25 : skeleton.state === 'recover' ? 0.12 : 1;
      const wanderScale = skeleton.aggro ? 1 : SKELETON_WANDER_FACTOR;
      if (moving && running) {
        const dx = target.x - skeleton.x;
        const dz = target.z - skeleton.z;
        const dist = Math.hypot(dx, dz) || 1;
        const step = SKELETON_MOVE_SPEED * pace * speedScale * wanderScale * dt;
        skeleton.x += (dx / dist) * step;
        skeleton.z += (dz / dist) * step;
      }

      if (running && (moving || skeleton.aggro)) {
        for (const other of list) {
          if (other === skeleton || other.dead || Math.abs(other.y - skeleton.y) > SAME_LEVEL) continue;
          const dx = skeleton.x - other.x;
          const dz = skeleton.z - other.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.7 && dist > 0.001) {
            skeleton.x += (dx / dist) * (1.7 - dist) * 2.2 * dt;
            skeleton.z += (dz / dist) * (1.7 - dist) * 2.2 * dt;
          }
        }
        const intendedX = skeleton.x;
        const intendedZ = skeleton.z;
        const resolved = resolveBody(skeleton.x, skeleton.z, SKELETON_RADIUS, dungeon.colliders, skeleton.y);
        skeleton.x = resolved.x;
        skeleton.z = resolved.z;
        if (Math.hypot(resolved.x - intendedX, resolved.z - intendedZ) > 0.1) {
          puffDust(skeleton, resolved.x, skeleton.y + 4.2, resolved.z, 1.35);
        }
      }
      if (skeleton.dustWait > 0) skeleton.dustWait = Math.max(0, skeleton.dustWait - dt);

      // Stride follows the ground actually covered (walls, doors, and crowding included),
      // so the feet never skate. Knockback slides are excluded on purpose.
      if (dt > 0.0005) {
        const measured = Math.hypot(skeleton.x - startX, skeleton.z - startZ) / dt;
        skeleton.speed += (Math.min(measured, 30) - skeleton.speed) * (1 - Math.exp(-dt * 14));
      }
      slideKnock(skeleton, dt);

      // Eyes on the player while there is a line to them; otherwise face the way being walked.
      const faceX = (watching ? player.x : target.x) - skeleton.x;
      const faceZ = (watching ? player.z : target.z) - skeleton.z;
      if (faceX * faceX + faceZ * faceZ > 0.05) {
        const desired = Math.atan2(faceX, faceZ);
        // An archer squares up quickly while drawing so the arrow leaves pointing at the target.
        const turn = skeleton.weapon === 'bow' && skeleton.state === 'windup' ? 9 : 2.2 + pace;
        skeleton.yaw += angleDiff(skeleton.yaw, desired) * Math.min(1, dt * turn);
      }
      // Stand on the floor under the new spot: a slope in a stairwell, the room's floor elsewhere.
      if (skeleton.x !== startX || skeleton.z !== startZ) {
        skeleton.y = dungeon.floorY ? dungeon.floorY(skeleton.x, skeleton.z, skeleton.at) : 0;
      }
      mesh.root.position.set(skeleton.x, skeleton.y, skeleton.z);
      mesh.root.rotation.y = skeleton.yaw;
      const away = (skeleton.x - player.x) ** 2 + (skeleton.z - player.z) ** 2;
      mesh.root.visible = away < 8100;
      if (!mesh.root.visible) continue;

      // Gait: the phase advances at the rate that keeps a planted foot still on the floor.
      const walking = skeleton.speed > 0.25;
      skeleton.stride += ((walking ? 1 : 0) - skeleton.stride) * (1 - Math.exp(-dt * 10));
      const amplitude = strideAmplitude(skeleton.speed);
      if (walking) {
        skeleton.phase += dt * (skeleton.speed * Math.PI) / (2 * LEG_LENGTH * amplitude);
      }
      const swing = gaitWave(skeleton.phase) * skeleton.stride;
      const react = reactAmount(skeleton.reactT);
      skeleton.reactT = Math.min(99, skeleton.reactT + dt);
      const rattle = Math.exp(-skeleton.reactT * 6) * Math.sin(skeleton.reactT * 50);
      // A leg is planted while it travels backward under the body and the knee folds only while
      // it swings forward. The body dips at each step so the planted foot stays on the floor.
      const kneeBend = 1.3 * amplitude * skeleton.stride;
      const swingCos = Math.cos(skeleton.phase);
      const hipAngle = swing * amplitude;
      mesh.legL.hip.rotation.x = hipAngle;
      mesh.legR.hip.rotation.x = -hipAngle;
      mesh.legL.knee.rotation.x = Math.max(0, -swingCos) * kneeBend + react * 0.3;
      mesh.legR.knee.rotation.x = Math.max(0, swingCos) * kneeBend + react * 0.3;
      mesh.fall.position.y = -LEG_LENGTH * (1 - Math.cos(hipAngle)) * 0.9;

      // A melee skeleton winding up against a raised torch aims its chop at the torch.
      if (skeleton.weapon !== 'bow') {
        const guarding = skeleton.state === 'windup' && player.guardUp
          && inGuardArc(-Math.sin(player.yaw), -Math.cos(player.yaw), skeleton.x - player.x, skeleton.z - player.z);
        if (skeleton.state !== 'recover') {
          skeleton.guardMix += ((guarding ? 1 : 0) - skeleton.guardMix) * Math.min(1, dt * 14);
        }
        if (guarding) solveGuardContact(skeleton, player);
      }

      // Arm +X carries the weapon (or the bow); arm -X is the off-hand (or the string hand).
      if (skeleton.weapon === 'bow') driveBowArms(skeleton, dt);
      else driveMeleeArms(skeleton, dt);
      const p = skeleton.pose;
      const q = skeleton.poseL;
      mesh.armR.shoulder.rotation.set(
        p.sx + react * 0.35 + rattle * 0.14,
        p.sy + rattle * 0.06,
        p.sz - react * 0.15 + rattle * 0.1,
      );
      mesh.armR.elbow.rotation.x = p.ex - react * 0.3 + rattle * 0.22;
      mesh.armR.wrist.rotation.x = p.wx - react * 0.4 + rattle * 0.3;
      mesh.armL.shoulder.rotation.set(q.sx + react * 0.5 - rattle * 0.14, q.sy, q.sz + rattle * 0.1);
      mesh.armL.elbow.rotation.x = q.ex - react * 0.3 - rattle * 0.2;
      mesh.armL.wrist.rotation.x = q.wx;
      const torsoPitch = p.tx;
      const torsoTwist = p.ty;
      // Hit flinch: the spine snaps back about 18 degrees and the head deflects, then both ease home.
      mesh.spine.rotation.set(torsoPitch - react * 0.31, torsoTwist, react * 0.14 + rattle * 0.05);
      mesh.spine.position.y = 3.05 - react * 0.08;
      // An archer turns the torso side-on to draw but keeps the eyes on the target.
      const headTurn = skeleton.weapon === 'bow' ? -torsoTwist : 0;
      mesh.skull.rotation.set(-react * 0.35 + rattle * 0.08, headTurn, rattle * 0.05);
      if (mesh.bow) rigBow(mesh, clamp01(torsoTwist / BOW_TWIST), skeleton.nocked);

      const glow = 0.85 + Math.sin(performance.now() * 0.004 + skeleton.phase) * 0.15;
      mesh.eyeL.scale.setScalar(glow);
      mesh.eyeR.scale.setScalar(glow);
    }
    if (running && typeof hurt === 'function') updateArrows(dt, player, hurt);
  }

  function reset() {
    for (const skeleton of list) {
      skeleton.x = skeleton.spawnX;
      skeleton.y = skeleton.spawnY;
      skeleton.z = skeleton.spawnZ;
      skeleton.hp = SKELETON_HP;
      skeleton.dead = false;
      skeleton.aggro = false;
      skeleton.at = skeleton.room;
      skeleton.state = 'wander';
      skeleton.timer = 0.5;
      skeleton.flashFrames = 0;
      skeleton.tint = 0;
      skeleton.knockX = 0;
      skeleton.knockZ = 0;
      skeleton.reactT = 99;
      skeleton.speed = 0;
      skeleton.stride = 0;
      skeleton.nocked = false;
      skeleton.caught = false;
      skeleton.guardMix = 0;
      skeleton.pose = makePose(restPose(skeleton.weapon));
      skeleton.vel = zeroVelocity();
      skeleton.poseL = makePose(restPoseL(skeleton.weapon));
      skeleton.velL = zeroVelocity();
      skeleton.wander = { x: skeleton.spawnX, z: skeleton.spawnZ };
      const mesh = skeleton.mesh;
      if (skeleton.fadeSwap) {
        for (const [object, original] of skeleton.fadeSwap) object.material = original;
        skeleton.fadeSwap = null;
      }
      dropDebris(skeleton);
      if (skeleton.shattered) {
        // Put every bone back where it was built.
        for (const { node, home } of mesh.pieces) {
          home.parent.add(node);
          node.position.copy(home.position);
          node.quaternion.copy(home.quaternion);
          node.scale.copy(home.scale);
          node.matrixAutoUpdate = true;
        }
        mesh.root.visible = true;
        mesh.eyeL.visible = true;
        mesh.eyeR.visible = true;
        skeleton.shattered = false;
      }
      mesh.skull.rotation.set(0, 0, 0);
      mesh.spine.rotation.set(0, 0, 0);
      mesh.fall.position.set(0, 0, 0);
      mesh.fall.rotation.set(0, 0, 0);
      mesh.root.position.set(skeleton.x, skeleton.y, skeleton.z);
      paintBones(mesh.root, materials.bone);
      skeleton.paint = materials.bone;
    }
  }

  return {
    list,
    update,
    reset,
    damage,
    livingIn(roomId) {
      return living().filter((skeleton) => skeleton.room.id === roomId).length;
    },
    fallen() {
      return list.filter((skeleton) => skeleton.dead).length;
    },
    cryptCleared() {
      const last = list.filter((skeleton) => skeleton.room.id === dungeon.lastRoomId);
      return last.length > 0 && last.every((skeleton) => skeleton.dead);
    },
  };
}
