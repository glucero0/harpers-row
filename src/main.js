import * as THREE from 'three';
import './style.css';
import { audio } from './audio.js';
import { consumeTime } from './impact.js';
import ancientRuinsData from './ancientRuinsData.json';
import { createDungeon, locationLayout } from './dungeon.js';
import { setDustLight } from './dust.js';
import { createGameState } from './game-state.js';
import { createInput } from './input.js';
import { LocationError } from './location.js';
import { areaFileUrl, MASTER_CONFIG_URL, MasterConfigError, loadMasterConfig } from './master-config.js';
import { createMaterials } from './materials.js';
import { cappedPixelRatio } from './pixel-ratio.js';
import { createPlaces } from './places.js';
import { createPlayer } from './player.js';
import { createSkeletons } from './skeleton.js';
import { createUI } from './ui.js';
import { connectWorld, whereabouts, WorldError } from './world.js';
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

// Game-wide state. The master config names the hub and the locations. When a hub is named, the player
// starts there and returns there after dying, and each location is joined to one spoke.
const gameState = createGameState();
// Handy in the browser console: `gameState.hubLocation`, `gameState.spokes`.
window.gameState = gameState;

const materials = createMaterials();
const input = createInput(canvas);
// The location being played when there is no hub: the baked default, or a file the player loaded.
let source = ancientRuinsData;
let places = null;
let worldPlan = null;
let bootError = null;
let dungeon = null;
const idleSkeletons = {
  list: [],
  livingIn() {
    return 0;
  },
  fallen() {
    return 0;
  },
  update() {},
  damage() {
    return false;
  },
};
let skeletons = idleSkeletons;
const player = createPlayer(camera, materials, { x: 0, z: 0, yaw: 0 });

let started = false;
let manualPause = false;
let last = performance.now();

function clearRun() {
  if (places) {
    places.dispose();
    places = null;
  } else if (dungeon) {
    dungeon.dispose();
  }
  dungeon = null;
  skeletons = idleSkeletons;
}

function adopt(nextDungeon, nextSkeletons, start, zoneId) {
  dungeon = nextDungeon;
  skeletons = nextSkeletons;
  player.reset(start);
  player.reconcileXp(ui.experience());
  player.state.room = dungeon.roomAt(player.state.x, player.state.z, null, player.state.y);
  transitions.setRun(dungeon.transitions, dungeon.labels, zoneId);
  manualPause = false;
}

function beginRun(nextLayout = locationLayout(source)) {
  worldPlan = null;
  clearRun();
  const layout = nextLayout;
  const next = createDungeon(scene, materials, layout, renderer);
  adopt(next, createSkeletons(next.group, next, materials), layout.start, 'worn-trail');
}

function beginWorld(plan) {
  worldPlan = plan;
  clearRun();
  places = createPlaces(scene, materials, plan, renderer);
  places.show('hub');
  adopt(places.dungeon(), places.skeletons(), plan.hub.respawn, 'hub');
  dungeon.applyEnvironment(null);
  ui.setLocation({ areaName: plan.hub.areaName });
}

const transitions = createZoneTransitions({
  configs: [],
  labels: {},
  initialZoneId: 'hub',
  canActivate(config) {
    if (!dungeon) return false;
    if (config.requiresGate) return dungeon.isGateOpen();
    return true;
  },
  onFadeStart(config) {
    if (!dungeon) return;
    dungeon.blendEnvironment(config.environmentalPreset, (config.fadeDurationMs || 300) / 1000);
  },
  onCommit(config) {
    if (places && config.placeId !== undefined) {
      places.show(config.placeId);
      dungeon = places.dungeon();
      skeletons = places.skeletons();
      transitions.replaceRun(dungeon.transitions, dungeon.labels);
    }
    const spawn = config.targetSpawnPoint;
    if (!spawn || !dungeon) return;
    player.placeAt(spawn.x, spawn.z, spawn.rotationY, spawn.y || 0);
    dungeon.showZone(config.targetZoneId);
    dungeon.applyEnvironment(config.environmentalPreset);
    player.state.room = dungeon.roomAt(player.state.x, player.state.z, null, player.state.y);
  },
});

const ui = createUI({
  areaName: 'The Hub',
  onRestart() {
    if (bootError) return;
    started = true;
    if (worldPlan) beginWorld(worldPlan);
    else beginRun();
    input.requestLook();
  },
  onEquip(choice) {
    if (!dungeon || dungeon.kind !== 'hub') return;
    player.equip(choice);
    audio.unlock();
  },
});

const MAX_WORLD_BYTES = 8 * 1024 * 1024;

async function fetchJson(name) {
  const url = areaFileUrl(name, import.meta.env.BASE_URL);
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  } catch {
    throw new WorldError(`Could not reach ${name}.`);
  }
  if (!response?.ok) throw new WorldError(`Could not load ${name}.`);
  const text = await response.text();
  if (text.length > MAX_WORLD_BYTES) throw new WorldError(`${name} is too large.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new WorldError(`${name} is not valid JSON.`);
  }
}

async function boot() {
  gameState.beginMasterConfigLoad();
  try {
    const config = await loadMasterConfig(`${import.meta.env.BASE_URL}${MASTER_CONFIG_URL}`);
    gameState.setMasterConfig(config);
    if (config.rejected > 0) console.warn(`Master config: ${config.rejected} invalid location entries were ignored.`);
    console.log('Master config loaded. Hub:', gameState.hubLocation, 'Available locations:', gameState.locations);
  } catch (error) {
    gameState.failMasterConfig(error instanceof MasterConfigError ? error.message : 'The master config could not be loaded.');
    console.warn(gameState.masterConfigError);
    beginRun();
    return;
  }
  if (!gameState.hubLocation) {
    beginRun();
    return;
  }
  try {
    const hubData = await fetchJson(gameState.hubLocation);
    const entries = [];
    for (const name of gameState.locations) entries.push({ name, data: await fetchJson(name) });
    const plan = connectWorld(hubData, entries);
    gameState.setSpokes(plan.bindings.map((binding) => ({ name: binding.spoke, location: binding.location })));
    console.log('Hub ready. Spawn:', plan.hub.respawn, 'Spokes:', gameState.spokes);
    beginWorld(plan);
  } catch (error) {
    const message = error instanceof WorldError || error instanceof LocationError
      ? error.message
      : 'The hub could not be loaded.';
    if (!(error instanceof WorldError) && !(error instanceof LocationError)) console.error(error);
    bootError = message;
    gameState.setWorldError(message);
    console.error(message);
  }
}
boot();

window.addEventListener('resize', fit);
fit();

document.querySelector('#overlay').addEventListener('click', () => {
  if (bootError || !dungeon) return;
  audio.unlock();
  started = true;
  input.requestLook();
});

let reportedFault = false;
let loggedCalls = -1;

function frame(now) {
  if (canvas.width !== Math.floor(window.innerWidth * renderer.getPixelRatio())) fit();
  if (!dungeon) {
    ui.sync({
      room: null,
      roomCount: 1,
      undead: 0,
      level: player.state.level,
      damage: player.state.damage,
      health: player.state.health,
      maxHealth: player.state.maxHealth,
      xp: player.state.xp,
      yaw: player.state.yaw,
      running: false,
      started: false,
      pointerLocked: false,
      banner: null,
      bootError,
      hubWorld: false,
      inHub: false,
      left: player.state.left,
      right: player.state.right,
      weaponName: player.state.weaponName,
      torch: false,
      mace: false,
      enemiesFallen: 0,
      enemiesTotal: 0,
      lootTaken: 0,
      lootTotal: 0,
      gold: 0,
    });
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
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
    dungeon.setAmbient(ui.ambient());
    dungeon.tickEnvironment(time.realDt);
    const theme = player.state.room?.theme || 'outdoor';
    dungeon.update(now / 1000, time.dt, theme, player.state.x, player.state.z, player.state.moving, camera, player.state.y);
    const torchPower = player.state.torch ? 1 : 0;
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
    const here = whereabouts({
      kind: dungeon.kind,
      placeName: dungeon.placeName,
      room: player.state.room,
      torch: !!player.state.torch,
      entranceRoomId: dungeon.entranceRoomId,
      exitRoomId: dungeon.exitRoomId,
    });
    ui.sync({
    room: player.state.room,
    roomTag: here.tag,
    placeName: here.title,
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
    bootError: null,
    hubWorld: !!worldPlan,
    outdoors: player.state.room?.kind === 'exterior',
    zoneName: here.title,
    lighting: transitions.lighting(),
    inHub: dungeon.kind === 'hub',
    left: player.state.left,
    right: player.state.right,
    weaponName: player.state.weaponName,
    torch: player.state.torch,
    mace: player.state.mace,
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
