import * as THREE from 'three';
import './style.css';
import { audio } from './audio.js';
import { consumeTime } from './impact.js';
import ancientRuinsData from './ancientRuinsData.json';
import { createDungeon, locationLayout } from './dungeon.js';
import { setDustLight } from './dust.js';
import { createInput } from './input.js';
import { LocationError } from './location.js';
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
// The location being played: the baked default, or a file the player loaded. Dying starts the same
// location again; loading another file replaces it.
let source = ancientRuinsData;
let layout = locationLayout(source);
let dungeon = createDungeon(scene, materials, layout, renderer);
let skeletons = createSkeletons(dungeon.group, dungeon, materials);
const player = createPlayer(camera, materials, layout.start);
player.state.room = dungeon.roomAt(layout.start.x, layout.start.z, null, 0);

let started = false;
let manualPause = false;
let last = performance.now();

function clearRun() {
  dungeon.dispose();
  skeletons = null;
}

function beginRun(nextLayout = locationLayout(source)) {
  if (dungeon) clearRun();
  layout = nextLayout;
  dungeon = createDungeon(scene, materials, layout, renderer);
  skeletons = createSkeletons(dungeon.group, dungeon, materials);
  player.reset(layout.start);
  player.reconcileXp(ui.experience());
  player.state.room = dungeon.roomAt(layout.start.x, layout.start.z, null, 0);
  transitions.setRun(layout.transitions, layout.zoneLabels, 'worn-trail');
  manualPause = false;
}

// Location files come from outside the game, so they are untrusted: capped in size, parsed as data
// only, and validated by prepareLocation before anything is built from them. Whatever goes wrong, the
// current run is left as it was and the player is told in plain words.
const MAX_LOCATION_BYTES = 8 * 1024 * 1024;

async function loadLocationFile(file) {
  try {
    if (file.size > MAX_LOCATION_BYTES) throw new LocationError('That file is too large to be a location.');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new LocationError('That file is not valid JSON.');
    }
    const next = locationLayout(data);
    const previous = source;
    try {
      source = data;
      beginRun(next);
    } catch (error) {
      // Valid on paper, but it would not build: put the old location back.
      source = previous;
      beginRun(locationLayout(previous));
      throw error;
    }
    ui.setLocation(next);
    ui.setLocationStatus(`Loaded ${next.areaName}: ${dungeon.rooms.length} rooms on ${dungeon.floors} floors.`);
  } catch (error) {
    if (!(error instanceof LocationError)) console.error(error);
    ui.setLocationStatus(error instanceof LocationError ? error.message : 'That location could not be loaded.');
  }
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
    player.placeAt(spawn.x, spawn.z, spawn.rotationY, spawn.y || 0);
    dungeon.showZone(config.targetZoneId);
    dungeon.applyEnvironment(config.environmentalPreset);
    player.state.room = dungeon.roomAt(player.state.x, player.state.z, null, player.state.y);
  },
});

const ui = createUI({
  areaName: layout.areaName,
  requirements: layout.requirements,
  onRestart() {
    started = true;
    beginRun();
    input.requestLook();
  },
  onLoadLocation: loadLocationFile,
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
      // Clearing every enemy does not end anything: the player stays free to explore, to leave by the
      // arch and to come back. Only dying stops the run.
      if (!player.state.alive) input.releaseLook();
    } else {
      player.update(time.dt, frameInput, dungeon, skeletons, ui.experience(), false, time);
    }

    transitions.update(time.realDt, player.state.x, player.state.z, player.state.y);
    dungeon.tickEnvironment(time.realDt);
    const theme = player.state.room?.theme || 'outdoor';
    dungeon.update(now / 1000, time.dt, theme, player.state.x, player.state.z, player.state.moving, camera, player.state.y);
    const torchPower = player.state.equipped ? 1 : 0;
    materials.ruin.sync({
      x: player.state.guardX,
      y: player.state.guardY,
      z: player.state.guardZ,
      power: torchPower,
      fogLift: theme === 'outdoor' ? 1.35 : 1.05,
      floor: player.state.y,
    });
    setDustLight(player.state.guardX, player.state.guardY, player.state.guardZ, torchPower);
    audio.setListener(player.state.x, player.state.y + 5.5, player.state.z, player.state.yaw);
    audio.ambience(theme !== 'outdoor');
    const enemyTotal = skeletons.list.length;
    const roomId = player.state.room?.id;
    let roomTag = '';
    if (roomId === dungeon.entranceRoomId) roomTag = 'Entrance: the arch leads back out';
    else if (roomId === dungeon.exitRoomId) roomTag = 'Exit chamber';
    ui.sync({
    room: player.state.room,
    roomTag,
    roomCount: dungeon.depthCount,
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
    banner: !player.state.alive ? 'dead' : null,
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
