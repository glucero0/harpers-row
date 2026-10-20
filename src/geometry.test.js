import assert from 'node:assert/strict';
import test from 'node:test';
import { closestApproach3 } from './geometry.js';

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
