// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { generateLayout } from './rooms.js';
import { createZoneTransitions } from './zone-transition.js';

function center(volume) {
  return {
    x: (volume.minX + volume.maxX) / 2,
    z: (volume.minZ + volume.maxZ) / 2,
  };
}

function runTransition(config, labels) {
  const events = [];
  const transitions = createZoneTransitions({
    configs: [config],
    labels: labels || {
      [config.sourceZoneId]: config.sourceZoneId,
      [config.targetZoneId]: config.targetZoneId,
    },
    initialZoneId: config.sourceZoneId,
    canActivate: () => true,
    onFadeStart: (item) => events.push(['fade', item.id]),
    onCommit: (item) => events.push(['commit', item.id, item.targetZoneId, item.targetSpawnPoint.x]),
  });
  const point = center(config.volume);
  transitions.update(0.016, point.x, point.z);
  const duration = (config.fadeDurationMs || 300) / 1000;
  transitions.update(duration + 0.01, point.x, point.z);
  const lockedDuring = transitions.blocksMovement();
  transitions.update(duration + 0.01, point.x, point.z);
  const after = {
    events: events.slice(),
    lockedDuring,
    unlocked: transitions.blocksMovement(),
    zoneId: transitions.zoneId(),
    zoneName: transitions.zoneName(),
  };
  transitions.dispose();
  transitions.dispose();
  return after;
}

describe('createZoneTransitions', () => {
  afterEach(() => {
    document.getElementById('zone-fade')?.remove();
  });

  it('fades, commits once, then unlocks, and dispose is safe twice', () => {
    const layout = generateLayout(4);
    const entry = layout.transitions.find((item) => item.id === 'ruin-entry');
    const point = center(entry.volume);
    const events = [];
    let moved = null;
    const transitions = createZoneTransitions({
      configs: layout.transitions,
      labels: layout.zoneLabels,
      initialZoneId: 'worn-trail',
      canActivate: (config) => !config.requiresGate,
      onCommit: (config) => {
        events.push(config.id);
        moved = { ...config.targetSpawnPoint };
      },
    });

    transitions.update(0.05, point.x, point.z);
    expect(transitions.blocksMovement()).toBe(false);
    expect(events).toEqual([]);

    const open = createZoneTransitions({
      configs: [entry],
      labels: layout.zoneLabels,
      initialZoneId: 'worn-trail',
      canActivate: () => true,
      onCommit: (config) => {
        events.push(config.id);
        moved = { ...config.targetSpawnPoint };
      },
    });
    open.update(0.016, point.x, point.z);
    expect(open.blocksMovement()).toBe(true);
    expect(events).toEqual([]);
    open.update(0.7, point.x, point.z);
    expect(events).toEqual(['ruin-entry']);
    expect(moved.z).toBe(entry.targetSpawnPoint.z);
    expect(open.zoneId()).toBe('ancient-ruins');
    expect(open.zoneName()).toBe('The Ancient Ruins');
    expect(open.blocksMovement()).toBe(true);
    open.update(0.7, point.x, point.z);
    expect(open.blocksMovement()).toBe(false);
    open.update(0.2, point.x, point.z);
    expect(events).toEqual(['ruin-entry']);
    open.dispose();
    expect(document.getElementById('zone-fade')).toBeNull();
    expect(() => open.dispose()).not.toThrow();
    expect(() => open.update(0.1, point.x, point.z)).not.toThrow();
    transitions.dispose();
  });

  it('runs the ruin threshold and the mountain pass through the same lifecycle', () => {
    const layout = generateLayout(11);
    const entry = runTransition(layout.transitions.find((item) => item.id === 'ruin-entry'), layout.zoneLabels);
    const pass = runTransition(layout.transitions.find((item) => item.id === 'mountain-pass'), layout.zoneLabels);
    expect(entry.events.map((item) => item[0])).toEqual(['fade', 'commit']);
    expect(pass.events.map((item) => item[0])).toEqual(['fade', 'commit']);
    expect(entry.lockedDuring).toBe(true);
    expect(pass.lockedDuring).toBe(true);
    expect(entry.unlocked).toBe(false);
    expect(pass.unlocked).toBe(false);
    expect(entry.zoneName).toBe('The Ancient Ruins');
    expect(pass.zoneName).toBe('Mountain Pass');
  });

  it('commits an instant transition in the same step', () => {
    const events = [];
    const transitions = createZoneTransitions({
      configs: [{
        id: 'blink',
        sourceZoneId: 'worn-trail',
        targetZoneId: 'ancient-ruins',
        targetSpawnPoint: { x: 1, y: 0, z: 2, rotationY: 0 },
        transitionType: 'instant',
        environmentalPreset: {
          clearColor: '#000000',
          ambientLightIntensity: 0,
          fog: null,
          skyboxVisible: false,
        },
        volume: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      }],
      labels: { 'ancient-ruins': 'The Ancient Ruins' },
      initialZoneId: 'worn-trail',
      onCommit: (config) => events.push(config.transitionType),
    });
    transitions.update(0.016, 1, 1);
    expect(events).toEqual(['instant']);
    expect(transitions.blocksMovement()).toBe(false);
    expect(transitions.zoneId()).toBe('ancient-ruins');
    transitions.dispose();
  });
});
