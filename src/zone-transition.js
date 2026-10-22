// Data-driven zone changes. One factory drives every doorway and trail edge: lock movement,
// fade the screen, hand the caller a spawn and a preset, then fade back in. No classes —
// the same closure shape as the rest of the game. The caller owns meshes and lights.

const DEFAULT_FADE_MS = 300;

function volumeContains(volume, x, z) {
  return x >= volume.minX && x <= volume.maxX && z >= volume.minZ && z <= volume.maxZ;
}

function ensureVeil() {
  if (typeof document === 'undefined') return null;
  let veil = document.getElementById('zone-fade');
  if (!veil) {
    veil = document.createElement('div');
    veil.id = 'zone-fade';
    document.body.appendChild(veil);
  }
  veil.style.opacity = '0';
  return veil;
}

/**
 * @param {object} options
 * @param {Array<object>} options.configs ZoneTransitionConfig records, plus a `volume` box.
 * @param {Record<string, string>} [options.labels] Zone id → header text.
 * @param {string} [options.initialZoneId]
 * @param {(config: object) => boolean} [options.canActivate]
 * @param {(config: object) => void} [options.onFadeStart] Fired when the fade to black begins.
 * @param {(config: object) => void} [options.onCommit] Teleport, cull, and apply the preset.
 */
export function createZoneTransitions({
  configs = [],
  labels = {},
  initialZoneId = 'worn-trail',
  canActivate = () => true,
  onFadeStart = () => {},
  onCommit = () => {},
} = {}) {
  let runs = configs;
  let names = labels;
  let zoneId = initialZoneId;
  let phase = 'idle';
  let active = null;
  let fade = 0;
  let duration = DEFAULT_FADE_MS / 1000;
  let hold = null;
  let cooldown = 0;
  let disposed = false;
  const veil = ensureVeil();

  function paint() {
    if (veil) veil.style.opacity = String(fade);
  }

  function commit(config) {
    zoneId = config.targetZoneId;
    hold = config.volume;
    onCommit(config);
  }

  function begin(config) {
    active = config;
    duration = Math.max(0.05, (config.fadeDurationMs || DEFAULT_FADE_MS) / 1000);
    if (config.transitionType === 'instant') {
      commit(config);
      phase = 'idle';
      active = null;
      fade = 0;
      paint();
      cooldown = 0.35;
      return;
    }
    phase = 'fadeOut';
    fade = 0;
    paint();
    onFadeStart(config);
  }

  return {
    zoneId() {
      return zoneId;
    },
    zoneName() {
      return names[zoneId] || zoneId;
    },
    lighting() {
      return zoneId === 'ancient-ruins' ? 'interior' : 'day';
    },
    blocksMovement() {
      return phase !== 'idle';
    },
    phase() {
      return phase;
    },
    setRun(nextConfigs, nextLabels, nextZoneId = 'worn-trail') {
      runs = nextConfigs || [];
      if (nextLabels) names = nextLabels;
      zoneId = nextZoneId;
      phase = 'idle';
      active = null;
      fade = 0;
      hold = null;
      cooldown = 0;
      paint();
    },
    update(dt, x, z) {
      if (disposed) return;
      if (phase === 'fadeOut') {
        fade = Math.min(1, fade + dt / duration);
        paint();
        if (fade >= 1) {
          commit(active);
          phase = 'fadeIn';
        }
        return;
      }
      if (phase === 'fadeIn') {
        fade = Math.max(0, fade - dt / duration);
        paint();
        if (fade <= 0) {
          phase = 'idle';
          active = null;
          cooldown = 0.35;
        }
        return;
      }
      if (cooldown > 0) {
        cooldown = Math.max(0, cooldown - dt);
        return;
      }
      if (hold && volumeContains(hold, x, z)) return;
      hold = null;
      for (let i = 0; i < runs.length; i += 1) {
        const config = runs[i];
        if (config.sourceZoneId !== zoneId) continue;
        if (!config.volume || !volumeContains(config.volume, x, z)) continue;
        if (!canActivate(config)) continue;
        begin(config);
        return;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      phase = 'idle';
      active = null;
      fade = 0;
      if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
    },
  };
}
