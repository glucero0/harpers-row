import * as THREE from 'three';
import './style.css';
import { audio } from './audio.js';
import { consumeTime } from './impact.js';
import { ancientRuinsLayout, createDungeon } from './dungeon.js';
import { setDustLight } from './dust.js';
import { createInput } from './input.js';
import { createMaterials } from './materials.js';
import { cappedPixelRatio } from './pixel-ratio.js';
import { createPlayer } from './player.js';
import { createSkeletons } from './skeleton.js';
import { createUI } from './ui.js';
import { createZoneTransitions } from './zone-transition.js';

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio));

function fit() {
  // Re-apply on resize: dragging the window onto a sharper panel must not lift the cap.
  renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio));
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';
scene.add(camera);

const materials = createMaterials();
const input = createInput(canvas);
let layout = ancientRuinsLayout();
let dungeon = createDungeon(scene, materials, layout, renderer);
let skeletons = createSkeletons(dungeon.group, dungeon, materials);
const player = createPlayer(camera, materials, layout.start);
player.state.room = dungeon.roomAt(layout.start.x, layout.start.z, null);

let started = false;
let manualPause = false;
let victory = false;
let last = performance.now();

function clearRun() {
  dungeon.dispose();
  skeletons = null;
}

function beginRun() {
  if (dungeon) clearRun();
  layout = ancientRuinsLayout();
  dungeon = createDungeon(scene, materials, layout, renderer);
  skeletons = createSkeletons(dungeon.group, dungeon, materials);
  player.reset(layout.start);
  player.reconcileXp(ui.experience());
  player.state.room = dungeon.roomAt(layout.start.x, layout.start.z, null);
  transitions.setRun(layout.transitions, layout.zoneLabels, 'worn-trail');
  victory = false;
  manualPause = false;
}

const transitions = createZoneTransitions({
  configs: layout.transitions,
  labels: layout.zoneLabels,
  initialZoneId: 'worn-trail',
  canActivate(config) {
    if (config.requiresGate) return dungeon.isGateOpen();
    return true;
  },
  onFadeStart(config) {
    dungeon.blendEnvironment(config.environmentalPreset, (config.fadeDurationMs || 300) / 1000);
  },
  onCommit(config) {
    const spawn = config.targetSpawnPoint;
    player.placeAt(spawn.x, spawn.z, spawn.rotationY);
    dungeon.showZone(config.targetZoneId);
    dungeon.applyEnvironment(config.environmentalPreset);
    player.state.room = dungeon.roomAt(player.state.x, player.state.z, null);
  },
});

const ui = createUI({
  onRestart() {
    started = true;
    beginRun();
    input.requestLook();
  },
  onEquip() {
    if (!player.equip()) return;
    dungeon.openGate();
    audio.unlock();
  },
});

window.addEventListener('resize', fit);
fit();

document.querySelector('#overlay').addEventListener('click', () => {
  audio.unlock();
  started = true;
  input.requestLook();
});

let reportedFault = false;
let loggedCalls = -1;

function frame(now) {
  if (canvas.width !== Math.floor(window.innerWidth * renderer.getPixelRatio())) fit();
  const realDt = Math.min(0.05, (now - last) / 1000 || 0);
  const time = consumeTime(realDt);
  last = now;
  try {
    const frameInput = input.poll();
    if (frameInput.pausePressed) manualPause = !manualPause;

    const running = started
      && player.state.alive
      && !victory
      && !manualPause
      && (frameInput.pointerLocked || frameInput.gamepadConnected);

    if (transitions.blocksMovement()) {
      frameInput.moveX = 0;
      frameInput.moveY = 0;
    }

    if (running) {
      player.reconcileXp(ui.experience());
      player.update(time.dt, frameInput, dungeon, skeletons, ui.experience(), true, time);
      skeletons.update(time.dt, player.state, player.hurt, ui.pace(), true, time.realDt);
      dungeon.offerSconce(player.state, (roomId) => skeletons.livingIn(roomId));
      if (skeletons.cryptCleared()) {
        victory = true;
        input.releaseLook();
      }
      if (!player.state.alive) input.releaseLook();
    } else {
      player.update(time.dt, frameInput, dungeon, skeletons, ui.experience(), false, time);
    }

    transitions.update(time.realDt, player.state.x, player.state.z);
    dungeon.tickEnvironment(time.realDt);
    const theme = player.state.room?.theme || 'outdoor';
    dungeon.update(now / 1000, time.dt, theme, player.state.x, player.state.z, player.state.moving, camera);
    const torchPower = player.state.equipped ? 1 : 0;
    materials.ruin.sync({
      x: player.state.guardX,
      y: player.state.guardY,
      z: player.state.guardZ,
      power: torchPower,
      fogLift: theme === 'outdoor' ? 1.35 : 1.05,
    });
    setDustLight(player.state.guardX, player.state.guardY, player.state.guardZ, torchPower);
    audio.setListener(player.state.x, 5.5, player.state.z, player.state.yaw);
    audio.ambience(theme !== 'outdoor');
    const enemyTotal = skeletons.list.length;
    ui.sync({
    room: player.state.room,
    roomCount: dungeon.rooms.length,
    undead: player.state.room ? skeletons.livingIn(player.state.room.id) : 0,
    level: player.state.level,
    damage: player.state.damage,
    health: player.state.health,
    maxHealth: player.state.maxHealth,
    xp: player.state.xp,
    aiming: player.state.aiming,
    blocking: player.state.blocking,
    yaw: player.state.yaw,
    running,
    started,
    pointerLocked: frameInput.pointerLocked,
    banner: !player.state.alive ? 'dead' : victory ? 'victory' : null,
    outdoors: player.state.room?.kind === 'exterior',
    zoneName: transitions.zoneName(),
    lighting: transitions.lighting(),
    equipped: player.state.equipped,
    denySerial: player.state.denySerial,
    gold: player.state.gold,
    enemiesFallen: skeletons.fallen(),
    enemiesTotal: enemyTotal,
    lootTaken: dungeon.lootTaken(),
    lootTotal: dungeon.lootTotal(),
    });
  } catch (error) {
    if (!reportedFault) {
      reportedFault = true;
      console.error(error);
    }
  }
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls;
  if (calls !== loggedCalls) {
    loggedCalls = calls;
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
