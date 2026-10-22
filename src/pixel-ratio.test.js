import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MAX_PIXEL_RATIO, cappedPixelRatio } from './pixel-ratio.js';

test('caps high-DPI displays at 1.5 and leaves lower ratios alone', () => {
  assert.equal(MAX_PIXEL_RATIO, 1.5);
  assert.equal(cappedPixelRatio(3), 1.5);
  assert.equal(cappedPixelRatio(2.5), 1.5);
  assert.equal(cappedPixelRatio(1.5), 1.5);
  assert.equal(cappedPixelRatio(1.25), 1.25);
  assert.equal(cappedPixelRatio(1), 1);
});

test('falls back to 1 when the reported ratio is missing or invalid', () => {
  assert.equal(cappedPixelRatio(undefined), 1);
  assert.equal(cappedPixelRatio(0), 1);
  assert.equal(cappedPixelRatio(-2), 1);
  assert.equal(cappedPixelRatio(Number.NaN), 1);
});
