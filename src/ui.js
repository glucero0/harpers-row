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

export function createUI(onRestart) {
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
  let shownLevel = 1;
  let shownHealth = 100;

  paceSlider.value = String(readSlider(PACE_KEY));
  xpSlider.value = String(readSlider(XP_KEY));
  paceSlider.addEventListener('input', () => writeSlider(PACE_KEY, paceSlider.value));
  xpSlider.addEventListener('input', () => writeSlider(XP_KEY, xpSlider.value));
  document.querySelector('#restart').addEventListener('click', (event) => {
    event.stopPropagation();
    onRestart();
  });

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
      if (!state.started) {
        overlayText.textContent = 'Each descent builds a new dungeon of about ten thousand square feet. Rooms, passages, and doors are never the same twice.';
        overlayPrompt.textContent = 'Click to enter';
      } else if (!state.pointerLocked) {
        overlayText.textContent = 'The mouse is free, so the fight waits. Drag the sliders, then click to continue.';
        overlayPrompt.textContent = 'Click to continue';
      }
    },
  };
}
