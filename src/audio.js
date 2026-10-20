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

let crunchBuffer;

function noiseBuffer(ctx) {
  if (crunchBuffer && crunchBuffer.sampleRate === ctx.sampleRate) return crunchBuffer;
  const length = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  crunchBuffer = buffer;
  return buffer;
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
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(48, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.12);
    subGain.gain.setValueAtTime(0.1, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.15);

    const crunch = ctx.createBufferSource();
    crunch.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1600;
    band.Q.value = 0.8;
    const crunchGain = ctx.createGain();
    crunchGain.gain.setValueAtTime(0.055, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    crunch.connect(band);
    band.connect(crunchGain);
    crunchGain.connect(ctx.destination);
    crunch.start(now);
    crunch.stop(now + 0.07);
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
