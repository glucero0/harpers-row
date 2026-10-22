import { clampUnit, paceMultiplier, xpRequired } from './balance.js';

const PACE_KEY = 'dungeon-combater.pace';
const XP_KEY = 'dungeon-combater.experience';

function readSlider(key) {
  try {
    return clampUnit(localStorage.getItem(key));
  } catch {
    return 0.5;
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

export function createUI({ onRestart, onEquip }) {
  const paceSlider = document.querySelector('#pace-slider');
  const xpSlider = document.querySelector('#xp-slider');
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
  const checklist = document.querySelector('#checklist');
  const checkMark = document.querySelector('#check-mark');
  const equipButton = document.querySelector('#equip');
  const statKills = document.querySelector('#stat-kills');
  const statLoot = document.querySelector('#stat-loot');
  const statGold = document.querySelector('#stat-gold');
  let shownLevel = 1;
  let shownHealth = 100;
  let shownDeny = 0;

  paceSlider.value = String(readSlider(PACE_KEY));
  xpSlider.value = String(readSlider(XP_KEY));
  const restartButton = document.querySelector('#restart');

  function onPaceInput() {
    writeSlider(PACE_KEY, paceSlider.value);
  }
  function onXpInput() {
    writeSlider(XP_KEY, xpSlider.value);
  }
  function onRestartClick(event) {
    event.stopPropagation();
    onRestart();
  }
  function onEquipClick(event) {
    event.stopPropagation();
    event.preventDefault();
    onEquip();
  }

  paceSlider.addEventListener('input', onPaceInput);
  xpSlider.addEventListener('input', onXpInput);
  restartButton.addEventListener('click', onRestartClick);
  equipButton.addEventListener('click', onEquipClick);
  let disposed = false;

  return {
    pace() {
      return clampUnit(paceSlider.value);
    },
    experience() {
      return clampUnit(xpSlider.value);
    },
    sync(state) {
      const room = state.room;
      const pace = room ? paceMultiplier(room.index, this.pace(), state.roomCount) : 1;
      const needed = xpRequired(state.level, this.experience());
      roomName.textContent = room ? room.name : 'The Gate';
      undeadCount.textContent = `Undead here: ${state.undead}`;
      paceReadout.textContent = `Pace ×${pace.toFixed(2)}`;
      levelText.textContent = `Level ${state.level} · Mace ${state.damage}`;
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

      const showBanner = state.banner === 'dead' || state.banner === 'victory';
      banner.hidden = !showBanner;
      if (state.banner === 'dead') {
        bannerTitle.textContent = 'Game over';
        bannerText.textContent = 'Your health is gone. Descend again and the dungeon is built anew.';
      } else if (state.banner === 'victory') {
        bannerTitle.textContent = 'The crypt is still';
        bannerText.textContent = 'The last of them is down. Another descent will raise a different dungeon.';
      }
      overlay.hidden = showBanner || state.pointerLocked;
      areaTitle.classList.toggle('away', state.outdoors === false);
      checkMark.hidden = !state.equipped;
      equipButton.disabled = !!state.equipped;
      equipButton.textContent = state.equipped ? 'Equipped' : 'Equip';
      statKills.textContent = `Enemies killed ${percent(state.enemiesFallen, state.enemiesTotal)}%`;
      statLoot.textContent = `Loot collected ${percent(state.lootTaken, state.lootTotal)}%`;
      statGold.textContent = `Gold ${state.gold || 0}`;
      if (state.denySerial && state.denySerial !== shownDeny) {
        shownDeny = state.denySerial;
        checklist.classList.remove('flash');
        void checklist.offsetWidth;
        checklist.classList.add('flash');
      }

      if (!state.started) {
        overlayText.textContent = state.equipped
          ? 'The door is open. Click the view, then walk inside.'
          : 'The door ahead is open. Equip a torch and a mace before you step inside.';
        overlayPrompt.textContent = 'Click to look';
      } else if (!state.pointerLocked) {
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
      restartButton.removeEventListener('click', onRestartClick);
      equipButton.removeEventListener('click', onEquipClick);
    },
  };
}
