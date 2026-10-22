// @vitest-environment jsdom
//
// jsdom does not implement the Web Audio API, so `window.AudioContext` is undefined here — exactly the
// environment these specs run in under CI. That makes this file a direct regression test for the
// `if (!ctx) return` guards documented in docs/ARCHITECTURE.md: every exported sound effect must stay a
// safe no-op when audio hardware/APIs are unavailable, rather than throwing and interrupting the game
// loop in `main.js`.
import { describe, expect, it } from 'vitest';
import { audio } from './audio.js';

describe('audio (no AudioContext available)', () => {
  it('unlock() is a safe no-op, repeatedly', () => {
    expect(() => {
      audio.unlock();
      audio.unlock();
    }).not.toThrow();
  });

  it('setListener() ignores non-finite positions and otherwise stays silent', () => {
    expect(() => audio.setListener(0, 5.5, 0, 0)).not.toThrow();
    expect(() => audio.setListener(NaN, Infinity, undefined, 0)).not.toThrow();
  });

  it('ambience() toggling indoors/outdoors does not throw', () => {
    expect(() => {
      audio.ambience(true);
      audio.ambience(false);
    }).not.toThrow();
  });

  it('every one-shot effect is callable without a position argument', () => {
    expect(() => {
      audio.swing();
      audio.hurt();
      audio.guard();
      audio.shot();
      audio.level();
      audio.loot();
      audio.ignite();
    }).not.toThrow();
  });

  it('every positional effect tolerates missing or malformed positions', () => {
    expect(() => {
      audio.hit();
      audio.hit({ x: Number.NaN, y: 0, z: 0 });
      audio.gravel();
      audio.gravel({ x: 1, y: 2, z: 3 });
      audio.chestOpen();
      audio.chestOpen({ x: 1, y: 2, z: 3 });
    }).not.toThrow();
  });

  it('startFire()/stopFires() round-trip cleanly with no audio backend', () => {
    expect(() => {
      audio.startFire('sconce-1', 0, 2, 0);
      audio.startFire('sconce-1', 0, 2, 0); // starting the same id twice must not throw or double-register
      audio.stopFires();
      audio.stopFires(); // stopping with nothing playing must also be safe
    }).not.toThrow();
  });
});
