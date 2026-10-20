const HIT_STOP_SECONDS = 0.06;
const HIT_STOP_SCALE = 0.05;

let remaining = 0;

export function triggerHitStop() {
  remaining = Math.max(remaining, HIT_STOP_SECONDS);
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
