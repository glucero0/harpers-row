// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKELETON_NAME } from './balance.js';
import { createUI } from './ui.js';

const HUD_HTML = `
  <input id="pace-slider" type="range" min="0" max="1" step="0.01" value="0.5" />
  <input id="xp-slider" type="range" min="0" max="1" step="0.01" value="0.5" />
  <input id="light-slider" type="range" min="0" max="1" step="0.01" value="0" />
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
  <div id="checklist"><span id="area-name"></span><span id="enemy-name"></span></div>
  <button id="equip" type="button" hidden></button>
  <div id="gear" hidden>
    <div id="gear-left"></div>
    <div id="gear-right"></div>
    <button id="gear-exit" type="button">Exit</button>
  </div>
  <p id="stat-kills"></p>
  <p id="stat-loot"></p>
  <p id="stat-gold"></p>
  <p id="stat-complete"></p>
  <p id="room-tag" hidden></p>
  <p id="complete-note" hidden></p>
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
    inHub: false,
    left: null,
    right: null,
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
  });
});

afterEach(() => {
  ui.dispose();
});

describe('createUI', () => {
  it('defaults the pace/experience sliders to 0.5 when nothing is saved', () => {
    expect(ui.pace()).toBe(0.5);
    expect(ui.experience()).toBe(0.5);
    expect(ui.ambient()).toBe(0);
    expect(document.querySelector('#enemy-name').textContent).toBe(SKELETON_NAME);
    expect(document.querySelector('#area-name').textContent).toBe('The Ancient Ruins');
    expect(document.querySelector('#equip').hidden).toBe(true);
  });

  it('persists slider changes to localStorage', () => {
    const paceSlider = document.querySelector('#pace-slider');
    paceSlider.value = '0.8';
    paceSlider.dispatchEvent(new Event('input'));
    expect(localStorage.getItem('harpers-row.pace')).toBe('0.8');
    expect(ui.pace()).toBeCloseTo(0.8, 5);
    const lightSlider = document.querySelector('#light-slider');
    lightSlider.value = '0.4';
    lightSlider.dispatchEvent(new Event('input'));
    expect(localStorage.getItem('harpers-row.ambient')).toBe('0.4');
    expect(ui.ambient()).toBeCloseTo(0.4, 5);
  });

  it('writes the active zone into the header', () => {
    ui.sync(baseState({ zoneName: 'Mountain Pass', lighting: 'day', outdoors: true }));
    const title = document.querySelector('#area-title');
    expect(title.textContent).toBe('Mountain Pass');
    expect(title.classList.contains('away')).toBe(false);
    expect(document.body.dataset.lighting).toBe('day');
    ui.sync(baseState({ zoneName: 'Small Ruins', placeName: 'Small Ruins', outdoors: true }));
    expect(document.querySelector('#area-name').textContent).toBe('Small Ruins');
    expect(title.textContent).toBe('Small Ruins');
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

  it('never ends the run just because everything is cleared', () => {
    ui.sync(baseState({ banner: null, enemiesFallen: 28, enemiesTotal: 28, lootTaken: 8, lootTotal: 8 }));
    expect(document.querySelector('#banner').hidden).toBe(true);
    expect(document.querySelector('#stat-complete').textContent).toBe('Location complete 100%');
    expect(document.querySelector('#complete-note').hidden).toBe(false);
  });

  it('reports how much of the location is done, enemies and chests together', () => {
    ui.sync(baseState({ enemiesFallen: 14, enemiesTotal: 28, lootTaken: 4, lootTotal: 8 }));
    expect(document.querySelector('#stat-complete').textContent).toBe('Location complete 50%');
    expect(document.querySelector('#complete-note').hidden).toBe(true);
  });

  it('tags the entrance and exit rooms', () => {
    ui.sync(baseState({ roomTag: 'Exit chamber' }));
    expect(document.querySelector('#room-tag').textContent).toBe('Exit chamber');
    expect(document.querySelector('#room-tag').hidden).toBe(false);
    ui.sync(baseState({ roomTag: '' }));
    expect(document.querySelector('#room-tag').hidden).toBe(true);
  });

  it('sets pace from how deep a room is, not where it sits in the file', () => {
    ui.sync(baseState({ room: { name: 'Far branch', index: 20, depth: 0 }, roomCount: 6 }));
    expect(document.querySelector('#pace-readout').textContent).toBe('Pace ×1.00');
  });

  it('shows the name of a newly loaded location', () => {
    ui.setLocation({ areaName: 'Sunken Vault' });
    expect(document.querySelector('#area-name').textContent).toBe('Sunken Vault');
  });

  it('shows the creature named by the location', () => {
    ui.setLocation({ areaName: 'Large Ruins', enemyName: 'Goblin' });
    expect(document.querySelector('#area-name').textContent).toBe('Large Ruins');
    expect(document.querySelector('#enemy-name').textContent).toBe('Goblin');
  });

  it('offers every weapon at the hub, one choice per hand, and applies the radios on Exit', () => {
    ui.sync(baseState({ inHub: false }));
    document.querySelector('#equip').click();
    expect(onEquip).not.toHaveBeenCalled();
    expect(document.querySelector('#gear').hidden).toBe(true);

    ui.sync(baseState({ inHub: true, left: 'torch', right: null }));
    expect(document.querySelector('#equip').hidden).toBe(false);
    document.querySelector('#equip').click();
    const gear = document.querySelector('#gear');
    expect(gear.hidden).toBe(false);
    const left = [...gear.querySelectorAll('input[name="left-hand"]')].map((input) => input.value);
    const right = [...gear.querySelectorAll('input[name="right-hand"]')].map((input) => input.value);
    expect(left).toEqual(['', 'torch', 'shield']);
    expect(right).toEqual(['', 'sword', 'mace', 'dagger', 'hammer', 'spear', 'axe', 'bow']);
    expect(gear.querySelector('input[name="left-hand"][value="torch"]').checked).toBe(true);
    expect(gear.querySelector('input[name="right-hand"][value=""]').checked).toBe(true);
    expect(gear.querySelector('label').textContent).toBe('None');
    gear.querySelector('input[name="left-hand"][value="shield"]').checked = true;
    gear.querySelector('input[name="right-hand"][value="mace"]').checked = true;
    document.querySelector('#gear-exit').click();
    expect(onEquip).toHaveBeenCalledTimes(1);
    expect(onEquip).toHaveBeenCalledWith({ left: 'shield', right: 'mace' });
    expect(gear.hidden).toBe(true);

    ui.sync(baseState({ inHub: false }));
    expect(document.querySelector('#equip').hidden).toBe(true);
  });

  it('forwards the restart button click to onRestart', () => {
    document.querySelector('#restart').click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('dispose() stops forwarding further clicks and is idempotent', () => {
    ui.sync(baseState({ inHub: true }));
    ui.dispose();
    document.querySelector('#restart').click();
    document.querySelector('#equip').click();
    document.querySelector('#gear-exit').click();
    expect(onRestart).not.toHaveBeenCalled();
    expect(onEquip).not.toHaveBeenCalled();
    expect(() => ui.dispose()).not.toThrow();
  });
});
