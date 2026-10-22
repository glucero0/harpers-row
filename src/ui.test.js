// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKELETON_NAME } from './balance.js';
import { createUI } from './ui.js';

const HUD_HTML = `
  <input id="pace-slider" type="range" min="0" max="1" step="0.01" value="0.5" />
  <input id="xp-slider" type="range" min="0" max="1" step="0.01" value="0.5" />
  <p id="room-name"></p>
  <p id="undead-count"></p>
  <p id="pace-readout"></p>
  <p id="level-text"></p>
  <div class="bar health"><div id="health-fill"></div></div>
  <p id="health-text"></p>
  <div class="bar xp"><div id="xp-fill"></div></div>
  <p id="xp-text"></p>
  <div id="crosshair"></div>
  <div id="compass-rose"></div>
  <p id="pause-label" hidden></p>
  <div id="overlay"><div class="card"><p id="overlay-text"></p><p id="overlay-prompt"></p></div></div>
  <div id="banner" hidden><div class="card"><h2 id="banner-title"></h2><p id="banner-text"></p><button id="restart" type="button"></button></div></div>
  <div id="hurt"></div>
  <h1 id="area-title"></h1>
  <div id="checklist"><span id="area-name"></span><span id="enemy-name"></span><span id="requirements"></span><span id="check-mark" hidden></span></div>
  <button id="equip" type="button"></button>
  <p id="stat-kills"></p>
  <p id="stat-loot"></p>
  <p id="stat-gold"></p>
`;

function baseState(overrides = {}) {
  return {
    room: { name: 'Antechamber', index: 0 },
    roomCount: 6,
    undead: 0,
    level: 1,
    damage: 18,
    health: 100,
    maxHealth: 100,
    xp: 0,
    aiming: false,
    blocking: false,
    yaw: 0,
    running: true,
    started: true,
    pointerLocked: true,
    banner: null,
    outdoors: false,
    equipped: true,
    denySerial: 0,
    gold: 0,
    enemiesFallen: 0,
    enemiesTotal: 0,
    lootTaken: 0,
    lootTotal: 0,
    ...overrides,
  };
}

let onRestart;
let onEquip;
let ui;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = HUD_HTML;
  onRestart = vi.fn();
  onEquip = vi.fn();
  ui = createUI({
    onRestart,
    onEquip,
    areaName: 'The Ancient Ruins',
    requirements: ['torch', 'mace'],
  });
});

afterEach(() => {
  ui.dispose();
});

describe('createUI', () => {
  it('defaults the pace/experience sliders to 0.5 when nothing is saved', () => {
    expect(ui.pace()).toBe(0.5);
    expect(ui.experience()).toBe(0.5);
    expect(document.querySelector('#enemy-name').textContent).toBe(SKELETON_NAME);
    expect(document.querySelector('#area-name').textContent).toBe('The Ancient Ruins');
    expect(document.querySelector('#requirements').textContent).toBe('Requirements: Torch and Mace');
  });

  it('persists slider changes to localStorage', () => {
    const paceSlider = document.querySelector('#pace-slider');
    paceSlider.value = '0.8';
    paceSlider.dispatchEvent(new Event('input'));
    expect(localStorage.getItem('dungeon-combater.pace')).toBe('0.8');
    expect(ui.pace()).toBeCloseTo(0.8, 5);
  });

  it('writes the active zone into the header', () => {
    ui.sync(baseState({ zoneName: 'Mountain Pass', lighting: 'day', outdoors: true }));
    const title = document.querySelector('#area-title');
    expect(title.textContent).toBe('Mountain Pass');
    expect(title.classList.contains('away')).toBe(false);
    expect(document.body.dataset.lighting).toBe('day');
  });

  it('syncs health/xp/room readouts onto the DOM', () => {
    ui.sync(baseState({ health: 42, maxHealth: 100, xp: 10, level: 1 }));
    expect(document.querySelector('#health-text').textContent).toBe('42 / 100');
    expect(document.querySelector('#health-fill').style.width).toBe('42%');
    expect(document.querySelector('#room-name').textContent).toBe('Antechamber');
  });

  it('shows "The Gate" and keeps the overlay hidden once pointer-locked with no banner', () => {
    ui.sync(baseState({ room: null, pointerLocked: true, banner: null }));
    expect(document.querySelector('#room-name').textContent).toBe('The Gate');
    expect(document.querySelector('#overlay').hidden).toBe(true);
  });

  it('shows the death banner when the run ends', () => {
    ui.sync(baseState({ banner: 'dead' }));
    expect(document.querySelector('#banner').hidden).toBe(false);
    expect(document.querySelector('#banner-title').textContent).toBe('Game over');
  });

  it('shows the victory banner when the crypt is cleared', () => {
    ui.sync(baseState({ banner: 'victory' }));
    expect(document.querySelector('#banner').hidden).toBe(false);
    expect(document.querySelector('#banner-title').textContent).toBe('The crypt is still');
  });

  it('forwards the restart button click to onRestart', () => {
    document.querySelector('#restart').click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('forwards the equip button click to onEquip', () => {
    document.querySelector('#equip').click();
    expect(onEquip).toHaveBeenCalledTimes(1);
  });

  it('dispose() stops forwarding further clicks and is idempotent', () => {
    ui.dispose();
    document.querySelector('#restart').click();
    document.querySelector('#equip').click();
    expect(onRestart).not.toHaveBeenCalled();
    expect(onEquip).not.toHaveBeenCalled();
    expect(() => ui.dispose()).not.toThrow();
  });
});
