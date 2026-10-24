import { clampUnit, paceMultiplier, SKELETON_NAME, xpRequired } from './balance.js';
import { leftGear, rightGear } from './gear-description.js';
import { completionPercent } from './location.js';

const PACE_KEY = 'harpers-row.pace';
const XP_KEY = 'harpers-row.experience';
const LIGHT_KEY = 'harpers-row.ambient';

function readSlider(key, fallback = 0.5) {
  try {
    return clampUnit(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function writeSlider(key, value) {
  try {
    localStorage.setItem(key, String(clampUnit(value)));
  } catch {
    // Private browsing can reject storage. The slider still works for this visit.
  }
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function createUI({ onRestart, onEquip, areaName }) {
  const paceSlider = document.querySelector('#pace-slider');
  const xpSlider = document.querySelector('#xp-slider');
  const lightSlider = document.querySelector('#light-slider');
  const roomName = document.querySelector('#room-name');
  const undeadCount = document.querySelector('#undead-count');
  const paceReadout = document.querySelector('#pace-readout');
  const levelText = document.querySelector('#level-text');
  const healthFill = document.querySelector('#health-fill');
  const healthText = document.querySelector('#health-text');
  const xpFill = document.querySelector('#xp-fill');
  const xpText = document.querySelector('#xp-text');
  const crosshair = document.querySelector('#crosshair');
  const compassRose = document.querySelector('#compass-rose');
  const pauseLabel = document.querySelector('#pause-label');
  const overlay = document.querySelector('#overlay');
  const overlayText = document.querySelector('#overlay-text');
  const overlayPrompt = document.querySelector('#overlay-prompt');
  const banner = document.querySelector('#banner');
  const bannerTitle = document.querySelector('#banner-title');
  const bannerText = document.querySelector('#banner-text');
  const hurt = document.querySelector('#hurt');
  const areaTitle = document.querySelector('#area-title');
  const enemyName = document.querySelector('#enemy-name');
  if (enemyName) enemyName.textContent = SKELETON_NAME;
  const areaLabel = document.querySelector('#area-name');
  if (areaLabel && areaName) areaLabel.textContent = areaName;
  const equipButton = document.querySelector('#equip');
  const gear = document.querySelector('#gear');
  const gearLeft = document.querySelector('#gear-left');
  const gearRight = document.querySelector('#gear-right');
  const statKills = document.querySelector('#stat-kills');
  const statLoot = document.querySelector('#stat-loot');
  const statGold = document.querySelector('#stat-gold');
  const statComplete = document.querySelector('#stat-complete');
  const roomTag = document.querySelector('#room-tag');
  const completeNote = document.querySelector('#complete-note');
  let shownLevel = 1;
  let shownHealth = 100;
  let carriedLeft = null;
  let carriedRight = null;

  function addChoice(container, group, id, label) {
    const row = document.createElement('label');
    row.className = 'gear-item';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = group;
    input.value = id;
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    container.append(row);
  }

  function fillHand(container, group, items) {
    if (!container) return;
    for (const label of [...container.querySelectorAll(':scope > label')]) label.remove();
    addChoice(container, group, '', 'None');
    for (const item of items) addChoice(container, group, item.id, item.name);
  }

  fillHand(gearLeft, 'left-hand', leftGear);
  fillHand(gearRight, 'right-hand', rightGear);

  function selectHand(group, value) {
    if (!gear) return;
    const wanted = value || '';
    for (const input of gear.querySelectorAll(`input[name="${group}"]`)) {
      input.checked = input.value === wanted;
    }
  }

  function chosen(group) {
    const input = gear && gear.querySelector(`input[name="${group}"]:checked`);
    return input && input.value ? input.value : null;
  }

  paceSlider.value = String(readSlider(PACE_KEY));
  xpSlider.value = String(readSlider(XP_KEY));
  if (lightSlider) lightSlider.value = String(readSlider(LIGHT_KEY, 0));
  const restartButton = document.querySelector('#restart');

  function onPaceInput() {
    writeSlider(PACE_KEY, paceSlider.value);
  }
  function onXpInput() {
    writeSlider(XP_KEY, xpSlider.value);
  }
  function onLightInput() {
    writeSlider(LIGHT_KEY, lightSlider.value);
  }
  function onRestartClick(event) {
    event.stopPropagation();
    onRestart();
  }
  function onEquipClick(event) {
    event.stopPropagation();
    event.preventDefault();
    if (!equipButton || equipButton.hidden || !gear) return;
    if (gearLeft) selectHand('left-hand', carriedLeft);
    if (gearRight) selectHand('right-hand', carriedRight);
    gear.hidden = false;
  }
  function onGearExit(event) {
    event.stopPropagation();
    event.preventDefault();
    if (gear) gear.hidden = true;
    if (onEquip) {
      onEquip({ left: chosen('left-hand'), right: chosen('right-hand') });
    }
  }
  function onGearClick(event) {
    event.stopPropagation();
  }

  paceSlider.addEventListener('input', onPaceInput);
  xpSlider.addEventListener('input', onXpInput);
  if (lightSlider) lightSlider.addEventListener('input', onLightInput);
  restartButton.addEventListener('click', onRestartClick);
  if (equipButton) equipButton.addEventListener('click', onEquipClick);
  const gearExit = document.querySelector('#gear-exit');
  if (gearExit) gearExit.addEventListener('click', onGearExit);
  if (gear) gear.addEventListener('click', onGearClick);
  let disposed = false;

  return {
    // The place being played changed: show its name.
    setLocation(next) {
      if (areaLabel && next.areaName) areaLabel.textContent = next.areaName;
      if (enemyName && next.enemyName) enemyName.textContent = next.enemyName;
    },
    // Plain text only: the message may quote a short label from the file, never markup.
    pace() {
      return clampUnit(paceSlider.value);
    },
    experience() {
      return clampUnit(xpSlider.value);
    },
    // 0 matches the place's own darkness. Further right raises the fill light.
    ambient() {
      return lightSlider ? clampUnit(lightSlider.value, 0) : 0;
    },
    sync(state) {
      const room = state.room;
      // Pace follows how deep a room is from the entrance, not where it sits in the file.
      const pace = room ? paceMultiplier(room.depth ?? room.index, this.pace(), state.roomCount) : 1;
      const needed = xpRequired(state.level, this.experience());
      roomName.textContent = room ? room.name : 'The Gate';
      if (roomTag) {
        roomTag.textContent = state.roomTag || '';
        roomTag.hidden = !state.roomTag;
      }
      undeadCount.textContent = `Undead here: ${state.undead}`;
      paceReadout.textContent = `Pace ×${pace.toFixed(2)}`;
      const weapon = state.weaponName || 'Unarmed';
      levelText.textContent = `Level ${state.level} · ${weapon} ${Math.round(state.damage)}`;
      if (state.level > shownLevel) levelText.classList.add('up');
      else levelText.classList.remove('up');
      shownLevel = state.level;
      const healthPct = state.maxHealth > 0 ? Math.max(0, Math.min(100, (state.health / state.maxHealth) * 100)) : 0;
      healthFill.style.width = `${healthPct}%`;
      healthText.textContent = `${Math.ceil(state.health)} / ${state.maxHealth}`;
      const xpPct = needed > 0 ? Math.max(0, Math.min(100, (state.xp / needed) * 100)) : 0;
      xpFill.style.width = `${xpPct}%`;
      xpText.textContent = `${state.xp} / ${needed} XP`;
      const yaw = Number.isFinite(state.yaw) ? state.yaw : 0;
      compassRose.style.transform = `rotate(${yaw}rad)`;
      crosshair.classList.toggle('hot', state.aiming);
      crosshair.classList.toggle('blocking', state.blocking);
      pauseLabel.hidden = state.running || !state.started || state.banner;
      if (state.health < shownHealth) {
        hurt.classList.add('on');
        window.setTimeout(() => hurt.classList.remove('on'), 160);
      }
      shownHealth = state.health;

      // Nothing a player does here ends the run but dying. Clearing a place is reported, never forced.
      const showBanner = state.banner === 'dead';
      banner.hidden = !showBanner;
      if (state.banner === 'dead') {
        bannerTitle.textContent = 'Game over';
        bannerText.textContent = state.hubWorld
          ? 'Your health is gone. Return to the hub and the locations are built anew.'
          : 'Your health is gone. Descend again and the dungeon is built anew.';
        if (restartButton) restartButton.textContent = state.hubWorld ? 'Return to the hub' : 'Descend again';
      }
      overlay.hidden = state.bootError ? false : showBanner || state.pointerLocked;
      if (state.zoneName) areaTitle.textContent = state.zoneName;
      if (areaLabel && state.placeName) areaLabel.textContent = state.placeName;
      if (state.lighting) document.body.dataset.lighting = state.lighting;
      areaTitle.classList.toggle('away', state.outdoors === false);
      if (state.inHub) {
        carriedLeft = state.left || null;
        carriedRight = state.right || null;
      }
      if (equipButton) equipButton.hidden = !state.inHub;
      if (gear && !state.inHub) gear.hidden = true;
      statKills.textContent = `Enemies killed ${percent(state.enemiesFallen, state.enemiesTotal)}%`;
      statLoot.textContent = `Loot collected ${percent(state.lootTaken, state.lootTotal)}%`;
      statGold.textContent = `Gold ${state.gold || 0}`;
      const complete = completionPercent(state);
      if (statComplete) statComplete.textContent = `Location complete ${complete}%`;
      if (completeNote) completeNote.hidden = complete < 100;

      if (state.bootError) {
        overlayText.textContent = state.bootError;
        overlayPrompt.hidden = true;
      } else if (!state.started) {
        overlayPrompt.hidden = false;
        overlayText.textContent = state.hubWorld
          ? 'Paths leave the hub for each location. Equip a shield or a torch in the left hand, and a weapon in the right, or go with neither.'
          : 'A worn trail ends at the stone arch. Click the view, then walk inside.';
        overlayPrompt.textContent = 'Click to look';
      } else if (!state.pointerLocked) {
        overlayPrompt.hidden = false;
        overlayText.textContent = 'The mouse is free, so the fight waits. Drag the sliders, then click to continue.';
        overlayPrompt.textContent = 'Click to continue';
      }
    },
    // Removes every DOM listener createUI() attached, per the module lifecycle contract in
    // docs/ARCHITECTURE.md. Idempotent: safe to call more than once.
    dispose() {
      if (disposed) return;
      disposed = true;
      paceSlider.removeEventListener('input', onPaceInput);
      xpSlider.removeEventListener('input', onXpInput);
      if (lightSlider) lightSlider.removeEventListener('input', onLightInput);
      restartButton.removeEventListener('click', onRestartClick);
      if (equipButton) equipButton.removeEventListener('click', onEquipClick);
      if (gearExit) gearExit.removeEventListener('click', onGearExit);
      if (gear) gear.removeEventListener('click', onGearClick);
    },
  };
}
