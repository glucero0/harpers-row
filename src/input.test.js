// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInput } from './input.js';

function keyEvent(type, code) {
  return new KeyboardEvent(type, { code });
}

let canvas;
let input;

beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  input = createInput(canvas);
});

afterEach(() => {
  input.dispose();
  Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true });
  canvas.remove();
});

describe('createInput', () => {
  it('reports an idle frame when nothing is pressed', () => {
    const frame = input.poll();
    expect(frame.moveX).toBe(0);
    expect(frame.moveY).toBe(0);
    expect(frame.attack).toBe(false);
    expect(frame.use).toBe(false);
    expect(frame.block).toBe(false);
    expect(frame.pointerLocked).toBe(false);
  });

  it('turns WASD keys into a normalized movement vector', () => {
    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    window.dispatchEvent(keyEvent('keydown', 'KeyD'));
    const frame = input.poll();
    expect(frame.moveY).toBeLessThan(0);
    expect(frame.moveX).toBeGreaterThan(0);
    expect(Math.hypot(frame.moveX, frame.moveY)).toBeCloseTo(1, 5);
  });

  it('queues a single attack per K press, consumed by the next poll', () => {
    window.dispatchEvent(keyEvent('keydown', 'KeyK'));
    expect(input.poll().attack).toBe(true);
    expect(input.poll().attack).toBe(false);
  });

  it('queues use on E the same way', () => {
    window.dispatchEvent(keyEvent('keydown', 'KeyE'));
    expect(input.poll().use).toBe(true);
    expect(input.poll().use).toBe(false);
  });

  it('clears held keys and the block flag when the window loses focus', () => {
    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    window.dispatchEvent(new Event('blur'));
    expect(input.poll().moveY).toBe(0);
  });

  it('only accepts mouse attack/block while the pointer is locked to this canvas', () => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(input.poll().attack).toBe(false);

    Object.defineProperty(document, 'pointerLockElement', { value: canvas, configurable: true });
    window.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(input.poll().block).toBe(true);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    expect(input.poll().block).toBe(false);
  });

  it('dispose() removes its listeners so further events and polls are inert', () => {
    input.dispose();
    window.dispatchEvent(keyEvent('keydown', 'KeyW'));
    const frame = input.poll();
    expect(frame.moveY).toBe(0);
    expect(frame.pointerLocked).toBe(false);
  });

  it('dispose() is idempotent', () => {
    expect(() => {
      input.dispose();
      input.dispose();
    }).not.toThrow();
  });
});
