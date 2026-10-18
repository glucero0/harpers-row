let context;

function getContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!context) context = new Ctx();
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  return context;
}

function tone(frequency, duration, type, volume) {
  const ctx = getContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration);
}

export const audio = {
  unlock() {
    getContext();
  },
  swing() {
    tone(210, 0.09, 'triangle', 0.035);
  },
  hit() {
    tone(120, 0.08, 'square', 0.04);
    tone(70, 0.12, 'triangle', 0.03);
  },
  hurt() {
    tone(90, 0.16, 'sawtooth', 0.04);
  },
  shot() {
    tone(520, 0.05, 'triangle', 0.03);
    tone(180, 0.09, 'square', 0.02);
  },
  level() {
    tone(440, 0.08, 'sine', 0.04);
    tone(660, 0.14, 'sine', 0.03);
  },
};
