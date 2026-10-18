import assert from 'node:assert/strict';
import test from 'node:test';
import { clearance, rectGap, segmentOnBoundary } from './geometry.js';
import { generateLayout } from './rooms.js';

function chambers(layout) {
  return layout.rooms.filter((room) => room.kind === 'chamber');
}

function passages(layout) {
  return layout.rooms.filter((room) => room.kind === 'corridor');
}

test('a seeded layout is about ten thousand square feet and can be rebuilt', () => {
  const first = generateLayout(11);
  const second = generateLayout(11);
  assert.ok(first.area > 9900 && first.area < 10100, `area ${first.area.toFixed(1)}`);
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
  const themes = new Set(chambers(layout).map((room) => room.theme));
  assert.ok(themes.has('stone') && themes.has('wood') && themes.has('cave'));
});

test('the path is walkable and nothing is buried in a wall', () => {
  for (const seed of [3, 8, 11, 19]) {
    const layout = generateLayout(seed);
    assert.equal(layout.rooms[0].kind, 'chamber');
    assert.equal(layout.rooms.at(-1).kind, 'chamber');
    assert.equal(layout.rooms.at(-1).id, layout.lastRoomId);
    assert.equal(layout.doors.length, layout.rooms.length - 1);
    assert.ok(clearance(layout.start.x, layout.start.z, layout.rooms[0].polygon) > 1.5, `start ${seed}`);
    const first = layout.rooms[0].rect;
    const last = layout.rooms.at(-1).rect;
    assert.ok(last.z + last.d / 2 < first.z + first.d / 2 - 20, `north ${seed}`);
    const door = layout.doors[0];
    const doorX = (door.a[0] + door.b[0]) / 2;
    const doorZ = (door.a[1] + door.b[1]) / 2;
    const towardX = doorX - layout.start.x;
    const towardZ = doorZ - layout.start.z;
    const toward = Math.hypot(towardX, towardZ) || 1;
    const faceX = -Math.sin(layout.start.yaw);
    const faceZ = -Math.cos(layout.start.yaw);
    assert.ok((faceX * towardX + faceZ * towardZ) / toward > 0.5, `facing ${seed}`);
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
      if (room.kind === 'chamber') assert.ok(room.spawns.length >= 2, `${room.name} ${seed}`);
      else assert.ok(room.spawns.length <= 2);
      for (const [x, z] of room.spawns) {
        assert.ok(clearance(x, z, room.polygon) > 1.2, `${room.id} spawn ${seed}`);
      }
    }
  }
});
