import * as THREE from 'three';
import {
  LEASH_DISTANCE,
  SKELETON_DAMAGE,
  SKELETON_HP,
  SKELETON_MOVE_SPEED,
  SKELETON_RADIUS,
  SKELETON_WANDER_FACTOR,
  attackRecover,
  attackWindup,
  paceMultiplier,
  skeletonAttackRange,
  skeletonWeapon,
} from './balance.js';
import { closestOnSegment, distanceToPolygon, lineOfSight, pointInPolygon, randomPointInPolygon, resolveBody } from './geometry.js';
import { audio } from './audio.js';

function addPart(parent, geometry, material, x, y, z, isBone = false) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  if (isBone) mesh.userData.bone = true;
  parent.add(mesh);
  return mesh;
}

function paintBones(root, material) {
  root.traverse((obj) => {
    if (obj.isMesh && obj.userData.bone) obj.material = material;
  });
}

function addFist(wrist, bone) {
  addPart(wrist, new THREE.BoxGeometry(0.16, 0.14, 0.16), bone, 0, 0, 0, true);
  addPart(wrist, new THREE.BoxGeometry(0.14, 0.1, 0.1), bone, 0, 0.02, 0.1, true);
  addPart(wrist, new THREE.BoxGeometry(0.12, 0.08, 0.08), bone, 0.02, -0.02, 0.12, true);
}

function addMelee(wrist, materials, kind) {
  const weapon = new THREE.Group();
  weapon.position.set(0, 0.02, 0.05);
  wrist.add(weapon);
  if (kind === 'mace') {
    addPart(weapon, new THREE.BoxGeometry(0.07, 0.26, 0.07), materials.leather, 0, -0.04, 0);
    addPart(weapon, new THREE.SphereGeometry(0.16, 8, 6), materials.rust, 0, -0.28, 0);
    addPart(weapon, new THREE.BoxGeometry(0.3, 0.05, 0.05), materials.metal, 0, -0.28, 0);
    addPart(weapon, new THREE.BoxGeometry(0.05, 0.05, 0.3), materials.metal, 0, -0.28, 0);
    return;
  }
  if (kind === 'hammer') {
    addPart(weapon, new THREE.BoxGeometry(0.065, 0.42, 0.065), materials.leather, 0, -0.06, 0);
    addPart(weapon, new THREE.BoxGeometry(0.16, 0.18, 0.36), materials.rust, 0, -0.36, 0);
    addPart(weapon, new THREE.BoxGeometry(0.24, 0.12, 0.18), materials.metal, 0, -0.36, 0);
    return;
  }
  addPart(weapon, new THREE.BoxGeometry(0.07, 0.26, 0.07), materials.leather, 0, -0.02, 0);
  addPart(weapon, new THREE.BoxGeometry(0.5, 0.07, 0.1), materials.metal, 0, -0.2, 0);
  addPart(weapon, new THREE.BoxGeometry(0.16, 1.45, 0.05), materials.metal, 0, -0.98, 0);
}

const BOW_REACH = 0.92;

function aimBow(bowParts, drawWrist, drawing) {
  const bow = bowParts.stringU.parent;
  const nock = new THREE.Vector3(0, 0, 0.05);
  if (drawing) {
    bow.updateWorldMatrix(true, false);
    drawWrist.getWorldPosition(nock);
    bow.worldToLocal(nock);
  }
  placeSegment(bowParts.stringU, bowParts.tipU, nock);
  placeSegment(bowParts.stringD, bowParts.tipD, nock);
  bowParts.nocked.visible = drawing;
  if (!drawing) return;
  bowParts.nocked.position.copy(nock);
  const aim = new THREE.Vector3(0, 0, -0.2).sub(nock);
  if (aim.lengthSq() > 0.001) {
    bowParts.nocked.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), aim.normalize());
  }
}

function placeSegment(mesh, from, to) {
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from);
  const len = dir.length();
  mesh.scale.y = Math.max(0.02, len);
  if (len > 0.001) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function addBow(wrist, materials) {
  const bow = new THREE.Group();
  bow.position.set(0.02, -0.02, 0.06);
  bow.rotation.x = -Math.PI / 2;
  const stave = new THREE.Mesh(new THREE.TorusGeometry(BOW_REACH, 0.04, 6, 18, Math.PI), materials.leather);
  stave.rotation.z = Math.PI / 2;
  bow.add(stave);
  addPart(bow, new THREE.BoxGeometry(0.08, 0.2, 0.08), materials.leather, 0, 0, 0);
  const stringU = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), materials.metal);
  const stringD = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), materials.metal);
  bow.add(stringU);
  bow.add(stringD);
  const tipU = new THREE.Vector3(0, BOW_REACH, 0.03);
  const tipD = new THREE.Vector3(0, -BOW_REACH, 0.03);
  const rest = new THREE.Vector3(0, 0, 0.05);
  placeSegment(stringU, tipU, rest);
  placeSegment(stringD, tipD, rest);
  const nocked = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.15), materials.metal);
  shaft.position.z = -0.58;
  nocked.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), materials.rust);
  head.rotation.x = -Math.PI / 2;
  head.position.z = -1.2;
  nocked.add(head);
  nocked.visible = false;
  bow.add(nocked);
  wrist.add(bow);
  return { nocked, stringU, stringD, tipU, tipD };
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
  addPart(spine, new THREE.BoxGeometry(0.22, 0.85, 0.2), bone, 0, 0.45, 0, true);
  for (let rib = 0; rib < 3; rib += 1) {
    addPart(spine, new THREE.BoxGeometry(0.78, 0.08, 0.34), bone, 0, 0.35 + rib * 0.22, 0.02, true);
  }

  const skull = new THREE.Group();
  skull.position.set(0, 1.15, 0);
  spine.add(skull);
  addPart(skull, new THREE.SphereGeometry(0.34, 8, 6), bone, 0, 0.28, 0, true);
  addPart(skull, new THREE.BoxGeometry(0.28, 0.12, 0.22), bone, 0, 0.02, 0.12, true);
  addPart(skull, new THREE.BoxGeometry(0.1, 0.08, 0.06), materials.socket, -0.12, 0.3, 0.28);
  addPart(skull, new THREE.BoxGeometry(0.1, 0.08, 0.06), materials.socket, 0.12, 0.3, 0.28);
  const eyeL = addPart(skull, new THREE.SphereGeometry(0.035, 6, 6), materials.eye, -0.12, 0.3, 0.32);
  const eyeR = addPart(skull, new THREE.SphereGeometry(0.035, 6, 6), materials.eye, 0.12, 0.3, 0.32);

  function limb(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.48 * side, 0.85, 0);
    spine.add(shoulder);
    addPart(shoulder, new THREE.BoxGeometry(0.12, 0.95, 0.12), bone, 0, -0.5, 0, true);
    const elbow = new THREE.Group();
    elbow.position.y = -0.98;
    shoulder.add(elbow);
    addPart(elbow, new THREE.BoxGeometry(0.1, 0.85, 0.1), bone, 0, -0.42, 0, true);
    const wrist = new THREE.Group();
    wrist.position.y = -0.86;
    elbow.add(wrist);
    addFist(wrist, bone);
    return { shoulder, elbow, wrist };
  }

  function leg(side) {
    const hip = new THREE.Group();
    hip.position.set(0.18 * side, 2.9, 0);
    fall.add(hip);
    addPart(hip, new THREE.BoxGeometry(0.14, 1.25, 0.14), bone, 0, -0.65, 0, true);
    const knee = new THREE.Group();
    knee.position.y = -1.28;
    hip.add(knee);
    addPart(knee, new THREE.BoxGeometry(0.12, 1.2, 0.12), bone, 0, -0.6, 0, true);
    return { hip, knee };
  }

  const armL = limb(-1);
  const armR = limb(1);
  const legL = leg(-1);
  const legR = leg(1);
  let nocked = null;
  let bow = null;
  if (weapon === 'bow') {
    bow = addBow(armL.wrist, materials);
    nocked = bow.nocked;
    const carry = { sx: 0.45, sy: 0.05, sz: -0.55, ex: 0.55, wx: 0 };
    armL.shoulder.rotation.set(carry.sx, carry.sy, carry.sz);
    armL.elbow.rotation.x = carry.ex;
    armR.shoulder.rotation.set(0.3, 0, -0.25);
    armR.elbow.rotation.x = 0.4;
  } else {
    addMelee(armR.wrist, materials, weapon);
    const raised = meleePose('ready');
    armR.shoulder.rotation.set(raised.sx, raised.sy, raised.sz);
    armR.elbow.rotation.x = raised.ex;
    armR.wrist.rotation.x = raised.wx;
    armL.shoulder.rotation.set(0.25, 0, -0.22);
    armL.elbow.rotation.x = 0.45;
  }
  return { root, fall, spine, skull, eyeL, eyeR, armL, armR, legL, legR, nocked, bow };
}

function meleePose(state) {
  if (state === 'windup') return { sx: 1.65, sy: -0.5, sz: 1.05, ex: 2.2, wx: -0.3 };
  if (state === 'recover') return { sx: 1, sy: -0.8, sz: 0, ex: 0.65, wx: -0.4 };
  return { sx: 0.8, sy: -0.6, sz: 0.6, ex: 2.2, wx: 0.4 };
}

function poseArm(arm, pose, dt) {
  arm.shoulder.rotation.x = approach(arm.shoulder.rotation.x, pose.sx, 7, dt);
  arm.shoulder.rotation.y = approach(arm.shoulder.rotation.y, pose.sy, 7, dt);
  arm.shoulder.rotation.z = approach(arm.shoulder.rotation.z, pose.sz, 7, dt);
  arm.elbow.rotation.x = approach(arm.elbow.rotation.x, pose.ex, 8, dt);
  arm.wrist.rotation.x = approach(arm.wrist.rotation.x, pose.wx, 8, dt);
}

function angleDiff(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function approach(current, target, speed, dt) {
  const diff = target - current;
  const step = Math.max(-speed * dt, Math.min(speed * dt, diff));
  return current + step;
}

export function createSkeletons(parent, dungeon, materials) {
  const list = [];
  const arrows = [];
  const arrowGeo = new THREE.BoxGeometry(0.035, 0.035, 0.72);
  const arrowHeadGeo = new THREE.ConeGeometry(0.055, 0.16, 5);
  let spawnId = 0;
  for (const room of dungeon.rooms) {
    room.spawns.forEach((spawn, slot) => {
      const weapon = skeletonWeapon(spawnId);
      const mesh = buildMesh(materials, weapon);
      mesh.root.position.set(spawn[0], 0, spawn[1]);
      parent.add(mesh.root);
      list.push({
        id: spawnId,
        room,
        slot,
        spawnX: spawn[0],
        spawnZ: spawn[1],
        x: spawn[0],
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
        flash: 0,
        hot: false,
        fall: 0,
        mesh,
        struck: false,
      });
      spawnId += 1;
    });
  }

  const doorFromIndex = new Map();
  for (const door of dungeon.doors) {
    const from = dungeon.rooms.find((room) => room.id === door.from);
    const to = dungeon.rooms.find((room) => room.id === door.to);
    if (!from || !to) continue;
    doorFromIndex.set(`${from.index}:${to.index}`, door);
    doorFromIndex.set(`${to.index}:${from.index}`, door);
  }

  function doorToward(fromRoom, toIndex) {
    const toward = toIndex > fromRoom.index ? fromRoom.index + 1 : fromRoom.index - 1;
    return doorFromIndex.get(`${fromRoom.index}:${toward}`) || null;
  }

  function living() {
    return list.filter((skeleton) => !skeleton.dead);
  }

  function looseArrow(skeleton) {
    const fx = -Math.sin(skeleton.yaw);
    const fz = -Math.cos(skeleton.yaw);
    const mesh = new THREE.Mesh(arrowGeo, materials.metal);
    const head = new THREE.Mesh(arrowHeadGeo, materials.rust);
    head.rotation.x = Math.PI / 2;
    head.position.z = -0.42;
    mesh.add(head);
    mesh.position.set(skeleton.x + fx * 0.7, 4.15, skeleton.z + fz * 0.7);
    mesh.rotation.y = skeleton.yaw;
    parent.add(mesh);
    arrows.push({
      x: mesh.position.x,
      z: mesh.position.z,
      vx: fx * 46,
      vz: fz * 46,
      age: 0,
      mesh,
    });
    audio.shot();
  }

  function removeArrow(index) {
    const arrow = arrows[index];
    parent.remove(arrow.mesh);
    arrows.splice(index, 1);
  }

  function updateArrows(dt, player, hurt) {
    for (let index = arrows.length - 1; index >= 0; index -= 1) {
      const arrow = arrows[index];
      const nextX = arrow.x + arrow.vx * dt;
      const nextZ = arrow.z + arrow.vz * dt;
      const closest = closestOnSegment(player.x, player.z, arrow.x, arrow.z, nextX, nextZ);
      const hit = player.alive && Math.hypot(player.x - closest.x, player.z - closest.z) < 0.9;
      const blocked = !lineOfSight(arrow.x, arrow.z, nextX, nextZ, dungeon.colliders);
      arrow.x = nextX;
      arrow.z = nextZ;
      arrow.age += dt;
      arrow.mesh.position.set(arrow.x, 4.15, arrow.z);
      if (hit) {
        if (hurt(SKELETON_DAMAGE)) audio.hurt();
        removeArrow(index);
      } else if (blocked || arrow.age > 1.4) {
        removeArrow(index);
      }
    }
  }

  function damage(skeleton, amount) {
    if (skeleton.dead) return false;
    skeleton.hp -= amount;
    skeleton.flash = 0.12;
    skeleton.aggro = true;
    if (skeleton.hp > 0) return false;
    skeleton.hp = 0;
    skeleton.dead = true;
    skeleton.state = 'dead';
    audio.hit();
    return true;
  }

  function update(dt, player, hurt, slider, running) {
    const paceByRoom = new Map(
      dungeon.rooms.map((room) => [room.id, paceMultiplier(room.index, slider, dungeon.rooms.length)]),
    );
    for (const skeleton of list) {
      const pace = paceByRoom.get(skeleton.room.id);
      const mesh = skeleton.mesh;
      if (skeleton.dead) {
        const away = (skeleton.x - player.x) ** 2 + (skeleton.z - player.z) ** 2;
        mesh.root.visible = away < 8100;
        if (!mesh.root.visible) continue;
        skeleton.fall = Math.min(1.35, skeleton.fall + dt * 2.4);
        mesh.fall.rotation.z = skeleton.fall;
        if (skeleton.hot) {
          paintBones(mesh.root, materials.bone);
          skeleton.hot = false;
        }
        continue;
      }

      if (running && player.alive && player.room && player.room.id === skeleton.room.id) skeleton.aggro = true;
      if (skeleton.aggro && running) {
        const roomsAway = Math.abs((player.room?.index ?? skeleton.room.index) - skeleton.room.index);
        const outside = distanceToPolygon(player.x, player.z, skeleton.room.polygon);
        if (!player.alive || roomsAway > 1 || (player.room?.id !== skeleton.room.id && outside > LEASH_DISTANCE)) {
          skeleton.aggro = false;
          skeleton.state = 'wander';
        }
      }

      let target = skeleton.wander;
      let moving = false;
      if (!skeleton.aggro) {
        if (!pointInPolygon(skeleton.x, skeleton.z, skeleton.room.polygon)) {
          target = { x: skeleton.spawnX, z: skeleton.spawnZ };
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
        const sameRoom = player.room?.id === skeleton.room.id;
        const insideHome = pointInPolygon(skeleton.x, skeleton.z, skeleton.room.polygon);
        if (!sameRoom && insideHome) {
          const door = doorToward(skeleton.room, player.room.index);
          if (door) target = { x: (door.a[0] + door.b[0]) / 2, z: (door.a[1] + door.b[1]) / 2 };
          else target = { x: player.x, z: player.z };
        } else {
          const ring = skeleton.slot * 1.7;
          target = {
            x: player.x + Math.cos(ring) * 1.35,
            z: player.z + Math.sin(ring) * 1.35,
          };
        }
        const dist = Math.hypot(player.x - skeleton.x, player.z - skeleton.z);
        const seen = lineOfSight(skeleton.x, skeleton.z, player.x, player.z, dungeon.colliders);
        const range = skeletonAttackRange(skeleton.weapon);
        if (skeleton.state === 'windup') {
          skeleton.timer -= dt;
          moving = dist > range * 1.15;
          if (dist > range * 1.5 || !seen) skeleton.state = 'chase';
          else if (skeleton.timer <= 0) {
            if (seen && dist <= range + 0.35) {
              if (skeleton.weapon === 'bow') looseArrow(skeleton);
              else if (hurt(SKELETON_DAMAGE)) audio.hurt();
            }
            skeleton.state = 'recover';
            skeleton.timer = attackRecover(pace);
          }
        } else if (skeleton.state === 'recover') {
          skeleton.timer -= dt;
          if (skeleton.timer <= 0) skeleton.state = 'chase';
        } else if (dist <= range && seen) {
          skeleton.state = 'windup';
          skeleton.timer = attackWindup(pace);
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
          if (other === skeleton || other.dead) continue;
          const dx = skeleton.x - other.x;
          const dz = skeleton.z - other.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.7 && dist > 0.001) {
            skeleton.x += (dx / dist) * (1.7 - dist) * 2.2 * dt;
            skeleton.z += (dz / dist) * (1.7 - dist) * 2.2 * dt;
          }
        }
        const resolved = resolveBody(skeleton.x, skeleton.z, SKELETON_RADIUS, dungeon.colliders);
        skeleton.x = resolved.x;
        skeleton.z = resolved.z;
      }

      const faceX = (skeleton.aggro ? player.x : target.x) - skeleton.x;
      const faceZ = (skeleton.aggro ? player.z : target.z) - skeleton.z;
      if (faceX * faceX + faceZ * faceZ > 0.05) {
        const desired = Math.atan2(faceX, faceZ);
        skeleton.yaw += angleDiff(skeleton.yaw, desired) * Math.min(1, dt * (2.2 + pace));
      }
      mesh.root.position.set(skeleton.x, 0, skeleton.z);
      mesh.root.rotation.y = skeleton.yaw;
      const away = (skeleton.x - player.x) ** 2 + (skeleton.z - player.z) ** 2;
      mesh.root.visible = away < 8100;
      if (!mesh.root.visible) continue;

      const gait = moving ? 1 : 0;
      skeleton.phase += dt * (4.5 + pace * 1.4) * gait;
      const swing = Math.sin(skeleton.phase) * gait;
      mesh.legL.hip.rotation.x = approach(mesh.legL.hip.rotation.x, swing * 0.7, 6, dt);
      mesh.legR.hip.rotation.x = approach(mesh.legR.hip.rotation.x, -swing * 0.7, 6, dt);
      mesh.legL.knee.rotation.x = Math.max(0, -swing) * 0.9;
      mesh.legR.knee.rotation.x = Math.max(0, swing) * 0.9;

      const idle = { sx: 0.35 + swing * 0.2, sy: 0, sz: 0.28, ex: 0.45, wx: 0 };
      if (skeleton.weapon === 'bow') {
        const drawing = skeleton.state === 'windup';
        poseArm(mesh.armL, drawing
          ? { sx: 1.5, sy: 0, sz: -0.2, ex: 0.1, wx: 0 }
          : { sx: 0.45, sy: 0.05, sz: -0.55, ex: 0.55, wx: 0 }, dt);
        poseArm(mesh.armR, drawing
          ? { sx: 1.4, sy: 0, sz: -1.4, ex: 2.2, wx: 0 }
          : { sx: 0.3 + swing * 0.15, sy: 0, sz: -0.25, ex: 0.4, wx: 0 }, dt);
        if (mesh.bow) aimBow(mesh.bow, mesh.armR.wrist, drawing);
      } else {
        poseArm(mesh.armR, meleePose(skeleton.state), dt);
        poseArm(mesh.armL, { ...idle, sz: -0.22, sx: 0.25 - swing * 0.25 }, dt);
      }
      mesh.spine.position.y = 3.05 + Math.sin(skeleton.phase * 0.5) * 0.02;

      if (skeleton.flash > 0) {
        skeleton.flash -= dt;
        if (!skeleton.hot) {
          paintBones(mesh.root, materials.boneHot);
          skeleton.hot = true;
        }
      } else if (skeleton.hot) {
        paintBones(mesh.root, materials.bone);
        skeleton.hot = false;
      }
      const glow = 0.85 + Math.sin(performance.now() * 0.004 + skeleton.phase) * 0.15;
      mesh.eyeL.scale.setScalar(glow);
      mesh.eyeR.scale.setScalar(glow);
    }
    if (running && typeof hurt === 'function') updateArrows(dt, player, hurt);
  }

  function reset() {
    for (const skeleton of list) {
      skeleton.x = skeleton.spawnX;
      skeleton.z = skeleton.spawnZ;
      skeleton.hp = SKELETON_HP;
      skeleton.dead = false;
      skeleton.aggro = false;
      skeleton.state = 'wander';
      skeleton.timer = 0.5;
      skeleton.fall = 0;
      skeleton.flash = 0;
      skeleton.wander = { x: skeleton.spawnX, z: skeleton.spawnZ };
      skeleton.mesh.fall.rotation.z = 0;
      skeleton.mesh.root.position.set(skeleton.x, 0, skeleton.z);
      skeleton.hot = false;
      paintBones(skeleton.mesh.root, materials.bone);
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
    cryptCleared() {
      const last = list.filter((skeleton) => skeleton.room.id === dungeon.lastRoomId);
      return last.length > 0 && last.every((skeleton) => skeleton.dead);
    },
  };
}
