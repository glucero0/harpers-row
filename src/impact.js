const HIT_STOP_SECONDS = 0.04;
const HIT_STOP_SCALE = 0;

let remaining = 0;

export function triggerHitStop(seconds = HIT_STOP_SECONDS) {
  const duration = Number(seconds);
  const clamped = Number.isFinite(duration) ? Math.min(0.2, Math.max(0, duration)) : HIT_STOP_SECONDS;
  remaining = Math.max(remaining, clamped);
}

export function clearHitStop() {
  remaining = 0;
}

export function consumeTime(realDt) {
  if (remaining <= 0 || realDt <= 0) return { dt: realDt, realDt, scale: 1 };
  const stopped = Math.min(realDt, remaining);
  remaining -= stopped;
  const dt = stopped * HIT_STOP_SCALE + (realDt - stopped);
  return { dt, realDt, scale: dt / realDt };
}
