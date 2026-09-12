import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateKerning } from './kerning';

const rectangle = (key: string) => ({
  key,
  advanceWidth: 896,
  contours: [[[128, 0], [768, 0], [768, 1000], [128, 1000]]] as const,
});

test('parallel sides retain the base spacing without a redundant pair', () => {
  assert.deepEqual(
    calculateKerning([rectangle('H'), rectangle('I')], {
      targetGap: 256,
      sampleStep: 32,
    }),
    []
  );
});

test('open outline profiles move together within the safety limits', () => {
  const wedge = {
    key: 'A',
    advanceWidth: 896,
    contours: [[[128, 0], [768, 500], [128, 1000]]] as const,
  };
  const [pair] = calculateKerning([wedge, rectangle('H')], {
    targetGap: 256,
    sampleStep: 16,
    minimumClearance: 96,
    maximumReduction: 192,
    quantization: 8,
  }).filter(({ left, right }) => left === 'A' && right === 'H');

  assert.ok(pair.value < 0);
  assert.ok(pair.value >= -192);
  assert.equal(Math.abs(pair.value % 8), 0);
});

test('blank glyphs never participate in kerning', () => {
  const blank = { key: ' ', advanceWidth: 896, contours: [] };
  assert.deepEqual(
    calculateKerning([rectangle('H'), blank], { targetGap: 256 }),
    []
  );
});
