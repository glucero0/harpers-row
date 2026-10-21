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

const fires = new Map();
let bed = null;
let creakAt = 0;

function placeListener(ctx, x, y, z, yaw) {
  const listener = ctx.listener;
  const now = ctx.currentTime;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (listener.positionX) {
    listener.positionX.setValueAtTime(x, now);
    listener.positionY.setValueAtTime(y, now);
    listener.positionZ.setValueAtTime(z, now);
    listener.forwardX.setValueAtTime(fx, now);
    listener.forwardY.setValueAtTime(0, now);
    listener.forwardZ.setValueAtTime(fz, now);
    listener.upX.setValueAtTime(0, now);
    listener.upY.setValueAtTime(1, now);
    listener.upZ.setValueAtTime(0, now);
    return;
  }
  listener.setPosition(x, y, z);
  listener.setOrientation(fx, 0, fz, 0, 1, 0);
}

function pannerAt(ctx, x, y, z) {
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 2.5;
  panner.rolloffFactor = 1.1;
  panner.maxDistance = 40;
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
  return panner;
}

function finitePoint(position, fallback) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  const z = Number(position?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fallback;
  return { x, y, z };
}

function thud(ctx, output, now, start, end, volume, noiseGain) {
  const body = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(start, now);
  body.frequency.exponentialRampToValueAtTime(end, now + 0.09);
  bodyGain.gain.setValueAtTime(volume, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  body.connect(bodyGain);
  bodyGain.connect(output);
  body.start(now);
  body.stop(now + 0.13);

  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx);
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 900;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(noiseGain, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  click.connect(high);
  high.connect(clickGain);
  clickGain.connect(output);
  click.start(now);
  click.stop(now + 0.05);
}

function crackleBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 1.4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const pop = Math.random() > 0.985 ? (Math.random() * 2 - 1) : 0;
    data[i] = pop * (0.4 + Math.random() * 0.6) + (Math.random() * 2 - 1) * 0.04;
  }
  return buffer;
}

function ensureBed() {
  const ctx = getContext();
  if (!ctx || bed) return bed;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const low = ctx.createOscillator();
  const lowGain = ctx.createGain();
  low.type = 'sine';
  low.frequency.value = 52;
  lowGain.gain.value = 0.55;
  low.connect(lowGain);
  lowGain.connect(master);
  low.start();
  const hum = ctx.createOscillator();
  const humGain = ctx.createGain();
  hum.type = 'triangle';
  hum.frequency.value = 78;
  humGain.gain.value = 0.12;
  hum.connect(humGain);
  humGain.connect(master);
  hum.start();
  const air = ctx.createBufferSource();
  const seconds = 2;
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  air.buffer = noise;
  air.loop = true;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 240;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.18;
  air.connect(lowpass);
  lowpass.connect(airGain);
  airGain.connect(master);
  air.start();
  bed = { ctx, master, creak: 0 };
  creakAt = ctx.currentTime + 6;
  return bed;
}

export const audio = {
  unlock() {
    getContext();
  },
  setListener(x, y, z, yaw) {
    const ctx = getContext();
    if (!ctx) return;
    const px = Number(x);
    const py = Number(y);
    const pz = Number(z);
    const pyaw = Number(yaw);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) || !Number.isFinite(pyaw)) return;
    placeListener(ctx, px, py, pz, pyaw);
  },
  ambience(indoors) {
    const loop = ensureBed();
    if (!loop) return;
    const now = loop.ctx.currentTime;
    loop.master.gain.setTargetAtTime(indoors ? 0.045 : 0, now, 0.6);
    if (!indoors || now < creakAt) return;
    creakAt = now + 7 + Math.random() * 9;
    const creak = loop.ctx.createOscillator();
    const gain = loop.ctx.createGain();
    const spot = pannerAt(loop.ctx, (Math.random() - 0.5) * 14, 6 + Math.random() * 3, (Math.random() - 0.5) * 14);
    creak.type = 'triangle';
    creak.frequency.setValueAtTime(140 + Math.random() * 80, now);
    creak.frequency.exponentialRampToValueAtTime(70, now + 0.4);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    creak.connect(gain);
    gain.connect(spot);
    spot.connect(loop.master);
    creak.start(now);
    creak.stop(now + 0.46);
  },
  swing() {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    thud(ctx, ctx.destination, now, 180, 70, 0.09, 0.07);
  },
  hit(position) {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const spot = finitePoint(position, null);
    const output = spot ? pannerAt(ctx, spot.x, spot.y, spot.z) : ctx.destination;
    if (spot) output.connect(ctx.destination);
    thud(ctx, output, now, 210, 64, 0.14, 0.11);
  },
  gravel(position) {
    const ctx = getContext();
    if (!ctx) return;
    const spot = finitePoint(position, { x: 0, y: 4, z: 0 });
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400 + Math.random() * 600;
    band.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    const panner = pannerAt(ctx, spot.x, spot.y, spot.z);
    source.connect(band);
    band.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.16);
  },
  startFire(id, x, y, z) {
    const ctx = getContext();
    if (!ctx || fires.has(id)) return;
    const px = Number(x);
    const py = Number(y);
    const pz = Number(z);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    const source = ctx.createBufferSource();
    source.buffer = crackleBuffer(ctx);
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0.045;
    const panner = pannerAt(ctx, px, py, pz);
    source.connect(band);
    band.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);
    source.start();
    fires.set(id, { source, gain });
  },
  stopFires() {
    for (const fire of fires.values()) {
      try { fire.source.stop(); } catch { /* already stopped */ }
    }
    fires.clear();
  },
  hurt() {
    tone(90, 0.16, 'sawtooth', 0.04);
  },
  // A blow caught on the torch: a bright strike over a dull wooden knock.
  guard() {
    tone(1380, 0.1, 'square', 0.022);
    tone(2140, 0.07, 'triangle', 0.02);
    tone(150, 0.1, 'triangle', 0.05);
  },
  shot() {
    tone(520, 0.05, 'triangle', 0.03);
    tone(180, 0.09, 'square', 0.02);
  },
  level() {
    tone(440, 0.08, 'sine', 0.04);
    tone(660, 0.14, 'sine', 0.03);
  },
  loot() {
    tone(523, 0.07, 'sine', 0.045);
    tone(784, 0.14, 'sine', 0.035);
  },
  ignite() {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = noiseBuffer(ctx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1800, now);
    band.frequency.exponentialRampToValueAtTime(240, now + 0.32);
    band.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    whoosh.connect(band);
    band.connect(gain);
    gain.connect(ctx.destination);
    whoosh.start(now);
    whoosh.stop(now + 0.38);
    tone(90, 0.16, 'sine', 0.04);
  },
  chestOpen(position) {
    const ctx = getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const spot = finitePoint(position, { x: 0, y: 1.2, z: 0 });
    const output = pannerAt(ctx, spot.x, spot.y, spot.z);
    const creak = ctx.createOscillator();
    creak.type = 'triangle';
    creak.frequency.setValueAtTime(210, now);
    creak.frequency.exponentialRampToValueAtTime(48, now + 0.42);
    const grit = ctx.createBufferSource();
    grit.buffer = noiseBuffer(ctx);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 700;
    const creakGain = ctx.createGain();
    creakGain.gain.setValueAtTime(0.07, now);
    creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    creak.connect(creakGain);
    grit.connect(low);
    low.connect(creakGain);
    creakGain.connect(output);
    creak.start(now);
    creak.stop(now + 0.5);
    grit.start(now);
    grit.stop(now + 0.28);
    const chimeAt = now + 0.22;
    const chime = ctx.createOscillator();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(880, chimeAt);
    const chimeGain = ctx.createGain();
    chimeGain.gain.setValueAtTime(0.0001, now);
    chimeGain.gain.setValueAtTime(0.05, chimeAt);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, chimeAt + 0.35);
    chime.connect(chimeGain);
    chimeGain.connect(output);
    chime.start(chimeAt);
    chime.stop(chimeAt + 0.36);
    for (let index = 0; index < 5; index += 1) {
      const tickAt = chimeAt + index * 0.045;
      const tick = ctx.createOscillator();
      tick.type = 'triangle';
      tick.frequency.value = 1400 + Math.random() * 800;
      const tickGain = ctx.createGain();
      tickGain.gain.setValueAtTime(0.0001, now);
      tickGain.gain.setValueAtTime(0.03, tickAt);
      tickGain.gain.exponentialRampToValueAtTime(0.001, tickAt + 0.08);
      tick.connect(tickGain);
      tickGain.connect(output);
      tick.start(tickAt);
      tick.stop(tickAt + 0.09);
    }
    output.connect(ctx.destination);
  },
};
