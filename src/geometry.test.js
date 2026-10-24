import assert from 'node:assert/strict';
import { test } from 'vitest';
import { closestApproach3, resolveBody } from './geometry.js';
import { floorHeightAt } from './location.js';

test('closestApproach3 measures the 3D distance from a point to a segment', () => {
  const mid = closestApproach3(0, 0, 0, 10, 0, 0, 5, 3, 4);
  assert.ok(Math.abs(mid.distance - 5) < 1e-9);
  assert.ok(Math.abs(mid.t - 0.5) < 1e-9);
  // Past either end the nearest point is the end itself, never an extension of the line.
  const before = closestApproach3(0, 0, 0, 10, 0, 0, -3, 4, 0);
  assert.ok(Math.abs(before.distance - 5) < 1e-9);
  assert.equal(before.t, 0);
  const after = closestApproach3(0, 0, 0, 10, 0, 0, 14, 0, 3);
  assert.ok(Math.abs(after.distance - 5) < 1e-9);
  assert.equal(after.t, 1);
  // A zero length segment is just a point.
  const point = closestApproach3(1, 1, 1, 1, 1, 1, 4, 5, 1);
  assert.ok(Math.abs(point.distance - 5) < 1e-9);
});

test('resolveBody ignores a wall on another story', () => {
  const lowerWall = {
    ax: -2, az: 0, bx: 2, bz: 0, nx: 0, nz: 1,
    minX: -2, maxX: 2, minZ: 0, maxZ: 0,
    story: 0,
  };
  const blocked = resolveBody(0, 0.2, 0.5, [lowerWall], 0);
  assert.ok(Math.abs(blocked.z) > 0.4);
  const above = resolveBody(0, 0.2, 0.5, [lowerWall], 10);
  assert.ok(Math.abs(above.x) < 1e-9);
  assert.ok(Math.abs(above.z - 0.2) < 1e-9);
});

test('floorHeightAt ramps a stairwell from the lower sill to the upper sill', () => {
  const stair = {
    y: 0,
    stair: { fromY: 0, toY: 10, low: [0, 0], high: [0, -16] },
  };
  assert.ok(Math.abs(floorHeightAt(stair, 0, 0) - 0) < 1e-9);
  assert.ok(Math.abs(floorHeightAt(stair, 0, -16) - 10) < 1e-9);
  assert.ok(Math.abs(floorHeightAt(stair, 0, -8) - 5) < 1e-9);
  assert.equal(floorHeightAt({ y: 10 }, 1, 1), 10);
  assert.equal(floorHeightAt({ theme: 'outdoor' }, 1, 1), 0);
});
