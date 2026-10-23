import { describe, expect, it } from 'vitest';
import { generateLayout } from './rooms.js';
import hubFile from '../public/campfireHub.json';
import smRuins from '../public/smRuins.json';
import lgRuins from '../public/lgRuins.json';
import medRuins from '../public/medRuins.json';
import { connectWorld, exitLoopHeightAt, prepareHub, whereabouts, WorldError } from './world.js';

function corridor(samples) {
  const polygon = [];
  for (const sample of samples) polygon.push([sample.x + sample.nx * sample.half, sample.z + sample.nz * sample.half]);
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    polygon.push([sample.x - sample.nx * sample.half, sample.z - sample.nz * sample.half]);
  }
  return polygon;
}

function syntheticHub(count) {
  const spokes = [];
  const transitions = [];
  const day = {
    clearColor: '#c5d0d6',
    ambientLightIntensity: 0.55,
    fog: { color: '#c5d0d6', near: 28, far: 110, density: 0.009 },
    skyboxVisible: true,
  };
  for (let index = 0; index < count; index += 1) {
    const name = `path-${index}`;
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    const samples = [];
    for (let step = 0; step <= 6; step += 1) {
      const t = step / 6;
      samples.push({
        x: Math.cos(angle) * (12 + t * 18),
        z: Math.sin(angle) * (12 + t * 18),
        half: 4,
        t,
        nx: -Math.sin(angle),
        nz: Math.cos(angle),
      });
    }
    const end = samples[samples.length - 1];
    spokes.push({
      id: `spoke-${index}`,
      name,
      index,
      samples,
      polygon: corridor(samples),
      end: { x: end.x, z: end.z, yaw: 0 },
      transitionOut: `to-${name}`,
      transitionIn: `from-${name}`,
    });
    transitions.push({
      id: `to-${name}`,
      sourceZoneId: 'hub',
      targetZoneId: name,
      targetSpawnPoint: null,
      environmentalPreset: day,
      volume: { minX: end.x - 3, maxX: end.x + 3, minZ: end.z - 3, maxZ: end.z + 3 },
    });
    transitions.push({
      id: `from-${name}`,
      sourceZoneId: name,
      targetZoneId: 'hub',
      targetSpawnPoint: { x: samples[3].x, y: 0, z: samples[3].z, rotationY: 0 },
      environmentalPreset: day,
      volume: null,
    });
  }
  return {
    areaName: 'The Hub',
    hubArea: {
      radius: 14,
      plaza: [[-14, -14], [14, -14], [14, 14], [-14, 14]],
      respawn: { x: 0, y: 0, z: 4, yaw: 0 },
      spokes,
    },
    transitions,
    trees: [],
    scenery: [],
  };
}

function rectDistance(x, z, rect) {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dz = Math.max(rect.z - z, 0, z - (rect.z + rect.d));
  return Math.hypot(dx, dz);
}

describe('prepareHub', () => {
  it('reads the campfire hub respawn and its spokes', () => {
    const hub = prepareHub(hubFile);
    expect(hub.areaName).toBe('The Hub');
    expect(hub.respawn).toMatchObject({ x: 1.17, z: -6.86, yaw: 0 });
    expect(hub.spokes.map((spoke) => spoke.name)).toEqual(['smallruins', 'largeruins', 'medruins']);
    const pit = hub.structure.parts.find((part) => part.type === 'fire-pit');
    expect(pit.fire.emitter.colorStart).toBe('#ffaa22');
    expect(pit.fire.light).toMatchObject({ color: '#ff7a18', intensity: 2.5, distance: 8 });
    expect(pit.vfx).toBeUndefined();
  });

  it('rejects a campfire whose flame color is not a color', () => {
    const data = structuredClone(hubFile);
    data.structure.parts[0].vfx.emitter.colorStart = 'orange';
    expect(() => prepareHub(data)).toThrow(WorldError);
  });
});

describe('connectWorld', () => {
  it('refuses to start when the path count and the location count differ', () => {
    const hub = syntheticHub(2);
    expect(() => connectWorld(hub, [{ name: 'only.json', data: generateLayout(1) }])).toThrow(WorldError);
    expect(() => connectWorld(hub, [{ name: 'only.json', data: generateLayout(1) }])).toThrow(/2 paths/);
  });

  it('pairs locations to spokes in config order and sends each trail back to the hub', () => {
    const world = connectWorld(syntheticHub(2), [
      { name: 'dungeon1.json', data: generateLayout(1) },
      { name: 'dungeon2.json', data: generateLayout(2) },
    ]);
    expect(world.bindings.map((binding) => `${binding.spoke}->${binding.location}`)).toEqual([
      'path-0->dungeon1.json',
      'path-1->dungeon2.json',
    ]);
    expect(world.bindings[0].layout.placeName).toBe('Path 0');
    const outbound = world.hub.transitions.find((item) => item.id === 'to-path-0');
    expect(outbound.placeId).toBe(0);
    expect(outbound.targetZoneId).toBe('worn-trail');
    expect(outbound.targetSpawnPoint.x).toBe(world.bindings[0].layout.start.x);
    const returning = world.bindings[0].layout.transitions.find((item) => item.id === 'mountain-pass');
    const back = world.hub.transitions.find((item) => item.id === 'from-path-0');
    expect(returning.placeId).toBe('hub');
    expect(returning.targetZoneId).toBe('hub');
    expect(returning.targetSpawnPoint).toMatchObject({ x: back.targetSpawnPoint.x, z: back.targetSpawnPoint.z });
  });

  it('routes the exit path around the outside and down to the entrance trail', () => {
    const world = connectWorld(syntheticHub(1), [{ name: 'one.json', data: generateLayout(4) }]);
    const layout = world.bindings[0].layout;
    const loop = layout.exitLoop;
    const exitRoom = layout.rooms.find((room) => room.id === layout.exitRoomId);
    expect(loop.samples[0].y).toBeCloseTo(exitRoom.y, 5);
    expect(loop.samples[loop.samples.length - 1].y).toBe(0);
    expect(loop.samples[loop.samples.length - 1].x).toBeCloseTo(loop.join.x, 3);
    for (const sample of loop.samples) {
      if (sample.s <= 12) continue;
      for (const room of layout.rooms) {
        expect(rectDistance(sample.x, sample.z, room.rect)).toBeGreaterThan(3);
      }
    }
    const mid = loop.samples[Math.floor(loop.samples.length / 2)];
    expect(exitLoopHeightAt(loop, mid.x, mid.z)).toBeCloseTo(mid.y, 5);
    expect(exitLoopHeightAt(loop, mid.x + 40, mid.z + 40)).toBeNull();
    const out = layout.transitions.find((item) => item.id === 'exit-door-out');
    expect(out.volume.minY).toBeCloseTo(exitRoom.y - 2, 5);
    expect(out.volume.maxY).toBeCloseTo(exitRoom.y + 4, 5);
  });

  it('connects the shipped hub to the location files', () => {
    const world = connectWorld(hubFile, [
      { name: 'smRuins.json', data: smRuins },
      { name: 'lgRuins.json', data: lgRuins },
      { name: 'medRuins.json', data: medRuins },
    ]);
    expect(world.bindings.map((binding) => binding.spoke)).toEqual(['smallruins', 'largeruins', 'medruins']);
    expect(world.bindings.map((binding) => binding.layout.placeName)).toEqual([
      'Small Ruins',
      'Large Ruins',
      'Medium Ruins',
    ]);
    expect(world.hub.respawn.x).toBe(1.17);
    for (const binding of world.bindings) {
      expect(binding.layout.exitLoop.samples.length).toBeGreaterThan(4);
    }
  });
});

describe('whereabouts', () => {
  it('names the ruin on its trail and points at the arch', () => {
    const outside = whereabouts({
      placeName: 'Small Ruins',
      room: { id: 'worn-trail', kind: 'exterior', theme: 'outdoor' },
    });
    expect(outside).toEqual({ title: 'Small Ruins', tag: 'The stone arch is the way in.' });
    const farEnd = whereabouts({
      placeName: 'Small Ruins',
      room: { id: 'world-hub', kind: 'exterior', theme: 'outdoor' },
    });
    expect(farEnd.tag).toBe('This end of the trail returns to the hub.');
  });

  it('says the inside is dark until a torch is equipped', () => {
    const dark = whereabouts({
      placeName: 'Small Ruins',
      room: { id: 'space-0', kind: 'chamber', theme: 'stone' },
      torch: false,
      entranceRoomId: 'space-0',
    });
    expect(dark.tag).toBe('It is dark. Raise Ambient light, or equip a torch, to see.');
    const lit = whereabouts({
      placeName: 'Small Ruins',
      room: { id: 'space-0', kind: 'chamber', theme: 'stone' },
      torch: true,
      entranceRoomId: 'space-0',
    });
    expect(lit.tag).toBe('The arch leads back out to the trail.');
  });

  it('names the hub and its paths', () => {
    expect(whereabouts({ kind: 'hub', placeName: 'The Hub' })).toEqual({
      title: 'The Hub',
      tag: 'Paths lead out from the hub.',
    });
  });
});
