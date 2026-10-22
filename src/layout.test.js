import assert from 'node:assert/strict';
import { test } from 'vitest';
import { clearance, pointInPolygon, rectGap, segmentOnBoundary } from './geometry.js';
import ancientRuinsData from './ancientRuinsData.json';
import { buildMountainVista, generateLayout, trailBlocksProp } from './rooms.js';

function chambers(layout) {
  return layout.rooms.filter((room) => room.kind === 'chamber');
}

function passages(layout) {
  return layout.rooms.filter((room) => room.kind === 'corridor');
}

test('a seeded layout is about ten thousand square feet and can be rebuilt', () => {
  const first = generateLayout(11);
  const second = generateLayout(11);
  assert.ok(first.area > 9000 && first.area < 10200, `area ${first.area.toFixed(1)}`);
  assert.deepEqual(
    first.rooms.map((room) => [room.rect.x, room.rect.z, room.rect.w, room.rect.d]),
    second.rooms.map((room) => [room.rect.x, room.rect.z, room.rect.w, room.rect.d]),
  );
  assert.notDeepEqual(
    generateLayout(11).rooms.map((room) => room.rect.w),
    generateLayout(29).rooms.map((room) => room.rect.w),
  );
});

test('rooms, corridors, and doors are different sizes', () => {
  const layout = generateLayout(7);
  const roomAreas = chambers(layout).map((room) => room.rect.w * room.rect.d);
  const runs = passages(layout).map((room) => room.run);
  const spans = passages(layout).map((room) => room.span);
  const doorWidths = layout.doors.map((door) => door.width);
  const doorHeights = layout.doors.map((door) => door.height);
  assert.ok(chambers(layout).length >= 8);
  assert.ok(passages(layout).length >= 7);
  assert.ok(Math.max(...roomAreas) - Math.min(...roomAreas) > 120);
  assert.ok(Math.max(...runs) - Math.min(...runs) > 3);
  assert.ok(Math.max(...spans) - Math.min(...spans) > 0.7);
  assert.ok(Math.max(...doorWidths) - Math.min(...doorWidths) > 0.35);
  assert.ok(Math.max(...doorHeights) - Math.min(...doorHeights) > 0.2);
  const themes = new Set(layout.rooms.map((room) => room.theme));
  assert.deepEqual([...themes], ['stone']);
  assert.equal(layout.areaName, 'The Ancient Ruins');
  assert.equal(layout.enemyName, 'Skeletal Warriors');
  assert.deepEqual(layout.requirements, ['torch', 'mace']);
});

test('the path is walkable and nothing is buried in a wall', () => {
  for (const seed of [3, 8, 11, 19]) {
    const layout = generateLayout(seed);
    assert.equal(layout.rooms[0].kind, 'chamber');
    assert.equal(layout.rooms[0].role, 'antechamber');
    assert.equal(layout.rooms[0].name, 'Antechamber');
    assert.equal(layout.rooms.at(-1).kind, 'chamber');
    assert.equal(layout.rooms.at(-1).id, layout.lastRoomId);
    assert.equal(layout.doors.length, layout.rooms.length - 1);
    assert.ok(!pointInPolygon(layout.start.x, layout.start.z, layout.rooms[0].polygon), `outside ${seed}`);
    assert.ok(pointInPolygon(layout.start.x, layout.start.z, layout.exterior), `path ${seed}`);
    const gate = layout.entrance;
    const gateX = (gate.a[0] + gate.b[0]) / 2;
    const gateZ = (gate.a[1] + gate.b[1]) / 2;
    assert.ok(layout.start.z > gateZ + 8, `approach ${seed}`);
    assert.ok(segmentOnBoundary(gate.a[0], gate.a[1], gate.b[0], gate.b[1], layout.rooms[0].polygon, 0.3), `gate ${seed}`);
    const towardX = gateX - layout.start.x;
    const towardZ = gateZ - layout.start.z;
    const toward = Math.hypot(towardX, towardZ) || 1;
    const faceX = -Math.sin(layout.start.yaw);
    const faceZ = -Math.cos(layout.start.yaw);
    assert.ok((faceX * towardX + faceZ * towardZ) / toward > 0.5, `facing ${seed}`);
    const first = layout.rooms[0].rect;
    const last = layout.rooms.at(-1).rect;
    assert.ok(last.z + last.d / 2 < first.z + first.d / 2 - 20, `north ${seed}`);
    const door = layout.doors[0];
    const doorZ = (door.a[1] + door.b[1]) / 2;
    assert.ok(doorZ < first.z + first.d * 0.5, `first door ${seed}`);

    for (let index = 0; index < layout.rooms.length; index += 1) {
      for (let other = index + 1; other < layout.rooms.length; other += 1) {
        const gap = rectGap(layout.rooms[index].rect, layout.rooms[other].rect);
        if (other === index + 1) assert.ok(gap <= 0.08, `join ${seed} ${index}`);
        else assert.ok(gap >= 1.5, `gap ${seed} ${index}-${other} ${gap.toFixed(2)}`);
      }
    }

    layout.doors.forEach((door, index) => {
      assert.equal(door.from, layout.rooms[index].id);
      assert.equal(door.to, layout.rooms[index + 1].id);
      assert.ok(door.width >= 3.4, `door ${seed} ${index} width ${door.width}`);
      assert.ok(door.width <= door.openingWidth + 0.05);
      assert.ok(segmentOnBoundary(door.a[0], door.a[1], door.b[0], door.b[1], layout.rooms[index].polygon, 0.3));
      assert.ok(segmentOnBoundary(door.a[0], door.a[1], door.b[0], door.b[1], layout.rooms[index + 1].polygon, 0.3));
    });

    for (const room of layout.rooms) {
      assert.equal(room.theme, 'stone');
      assert.equal(room.brazier, null);
      assert.deepEqual(room.rocks, []);
      if (room.role === 'antechamber') assert.equal(room.spawns.length, 0);
      else if (room.kind === 'chamber') assert.ok(room.spawns.length >= 2, `${room.name} ${seed}`);
      else assert.ok(room.spawns.length <= 2);
      if (room.kind === 'chamber' && room.spawns.length > 0) {
        assert.equal(typeof room.sconce.x, 'number', `${room.id} sconce ${seed}`);
        assert.equal(room.sconce.nx === 0 || room.sconce.nz === 0, true);
        assert.ok(clearance(room.chest.x, room.chest.z, room.polygon) > 0.4, `${room.id} chest ${seed}`);
        const side = Math.abs(
          (room.chest.x - room.sconce.x) * -room.sconce.nz
          + (room.chest.z - room.sconce.z) * room.sconce.nx,
        );
        assert.ok(side > 2.3, `${room.id} chest off the torch ${seed} ${side.toFixed(2)}`);
        const beside = Math.hypot(room.chest.x - room.sconce.x, room.chest.z - room.sconce.z);
        assert.ok(beside < 6.2, `${room.id} chest beside sconce ${seed} ${beside.toFixed(2)}`);
      } else {
        assert.equal(room.sconce, null, `${room.id} hallway sconce ${seed}`);
        assert.equal(room.chest, null, `${room.id} hallway chest ${seed}`);
      }
      for (const [x, z] of room.spawns) {
        assert.ok(clearance(x, z, room.polygon) > 1.2, `${room.id} spawn ${seed}`);
      }
    }
  }
});

test('the worn trail is a seeded daytime approach, not a cliff edge', () => {
  const first = generateLayout(11);
  const second = generateLayout(11);
  assert.equal(first.approach.lighting, 'day');
  assert.match(first.approach.description, /pale/i);
  assert.match(first.rooms[0].description, /threshold/i);
  assert.equal(first.rooms[0].lighting, 'underground');
  assert.ok(first.approach.samples.at(-1).z - first.approach.samples[0].z > 40);
  assert.ok(first.approach.samples.some((sample) => Math.abs(sample.x - first.approach.midX) > 0.4));
  assert.ok(first.approach.samples[0].half > 5.2);
  const gateZ = first.entrance.a[1];
  const end = first.approach.samples.at(-1);
  assert.ok(first.start.z > gateZ + 8);
  assert.ok(end.z - first.start.z > 15, 'spawn sits on the trail, short of the pass');
  assert.deepEqual(first.trees, second.trees);
  assert.ok(first.trees.length >= 12);
  const variants = new Set(first.trees.map((tree) => tree.variant));
  const branches = new Set(first.trees.map((tree) => tree.branches));
  assert.ok(variants.size >= 2);
  assert.ok(branches.size >= 2);
  const laterals = first.trees.map((tree) => trailBlocksProp(first.approach.samples, tree.x, tree.z));
  assert.ok(laterals.every((blocked) => blocked === false));
  for (const tree of first.trees) {
    assert.ok(tree.scale >= 0.7 && tree.scale <= 1.3);
    assert.ok(tree.rotationY >= 0 && tree.rotationY < Math.PI * 2);
    const degrees = Math.abs(tree.lean) * (180 / Math.PI);
    assert.ok(degrees >= 5 && degrees <= 10);
  }
  const distances = first.trees.map((tree) => {
    let best = Infinity;
    for (const sample of first.approach.samples) best = Math.min(best, Math.hypot(tree.x - sample.x, tree.z - sample.z));
    return best;
  });
  assert.ok(Math.max(...distances) - Math.min(...distances) > 1.2);

  const entry = first.transitions.find((item) => item.id === 'ruin-entry');
  const pass = first.transitions.find((item) => item.id === 'mountain-pass');
  assert.ok(entry.volume.maxZ < first.approach.southZ - 0.8);
  assert.equal(entry.environmentalPreset.skyboxVisible, false);
  assert.equal(entry.environmentalPreset.fog.near, 8);
  assert.equal(entry.environmentalPreset.fog.far, 20);
  assert.equal(entry.fadeDurationMs, 600);
  assert.ok(pass.volume.minZ > end.z - 3);
  assert.equal(pass.targetZoneId, 'world-hub');
  assert.equal(pass.environmentalPreset.skyboxVisible, true);
  assert.equal(first.zoneLabels['world-hub'], 'Mountain Pass');
  assert.equal(first.approach.vestibule.d > 2 && first.approach.vestibule.d < 3.2, true);

  const far = first.approach.vista.path.at(-1);
  assert.ok(far.z - end.z > 100, 'the pass path keeps going after the hub');
  assert.equal(first.approach.vista.path[0].x, end.x);
  assert.equal(first.approach.vista.path[0].z, end.z);
  const hubFar = first.approach.hub.z + first.approach.hub.d;
  assert.ok(first.approach.vista.trees.length >= 12);
  assert.ok(first.approach.vista.scrub.length >= 24);
  for (const tree of first.approach.vista.trees) assert.ok(tree.z > hubFar);
  for (const bush of first.approach.vista.scrub) assert.ok(bush.z > hubFar);
  assert.ok(first.approach.vista.mountains.some((peak) => peak.x < far.x - 40));
  assert.ok(first.approach.vista.mountains.some((peak) => peak.x > far.x + 40));
  assert.ok(first.approach.vista.mountains.some((peak) => Math.abs(peak.x - far.x) < 6 && peak.z > far.z));
});

test('the baked ruins use the same mountain vista as the generator', () => {
  const end = ancientRuinsData.approach.samples.at(-1);
  assert.deepEqual(ancientRuinsData.approach.vista, buildMountainVista(end, ancientRuinsData.approach.hub));
  assert.match(ancientRuinsData.approach.description, /mountain range/i);
});
