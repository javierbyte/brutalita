import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  insertPoint,
  movePoints,
  nearestSegment,
  pointsAt,
  replaceStroke,
  sameStrokes,
} from './glyph-edit';
import type { CharLayers } from './types';

const zero: CharLayers = [
  [[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]],
  [[2, 0], [0, 4]],
];

test('a closed stroke is grabbed by both of its ends and stays closed when moved', () => {
  const grabbed = pointsAt(zero[0], [0, 0]);
  assert.deepEqual(grabbed, [0, 4]);
  const moved = movePoints(zero, 0, grabbed, [0, 0.5]);
  assert.deepEqual(moved[0], [[0, 0.5], [2, 0], [2, 4], [0, 4], [0, 0.5]]);
});

test('editing one stroke hands the others back untouched', () => {
  const moved = movePoints(zero, 0, [1], [1.5, 0]);
  assert.equal(moved[1], zero[1]);
  assert.deepEqual(zero[0][1], [2, 0]);
});

test('a point dropped on its neighbour merges with it', () => {
  const moved = movePoints(zero, 0, [1], [2, 4]);
  assert.deepEqual(moved[0], [[0, 0], [2, 4], [0, 4], [0, 0]]);
});

test('removing points keeps the rest, and removing the last one drops the stroke', () => {
  assert.deepEqual(movePoints(zero, 1, [0], null), [zero[0], [[0, 4]]]);
  assert.deepEqual(movePoints([[[1, 1]]], 0, [0], null), []);
  assert.deepEqual(replaceStroke(zero, 1, []), [zero[0]]);
});

test('removing the point between two visits of the same spot leaves one of them', () => {
  const there: CharLayers = [[[0, 0], [1, 1], [0, 0], [2, 0]]];
  assert.deepEqual(movePoints(there, 0, [1], null), [[[0, 0], [2, 0]]]);
});

test('a point is inserted into the segment that passes closest', () => {
  const hit = nearestSegment(zero[0], [2.1, 2]);
  assert.equal(hit?.index, 2);
  assert.ok(Math.abs(hit!.distance - 0.1) < 1e-9);
  const bent = insertPoint(zero, 0, hit!.index, [2, 2]);
  assert.deepEqual(bent[0].slice(1, 4), [[2, 0], [2, 2], [2, 4]]);
  assert.equal(nearestSegment([[1, 1]], [1, 1]), null);
});

test('a bend that is let go where it started changes nothing', () => {
  const bent = insertPoint(zero, 1, 1, [1, 2]);
  assert.ok(sameStrokes(movePoints(bent, 1, [1], null), zero));
});
