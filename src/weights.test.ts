import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STEM_QUANTUM, stemWidth } from './font-maker';
import {
  editorStrokeWidth,
  parseWeight,
  SHIPPED_WEIGHTS,
  strokeFraction,
  styleName,
} from './weights';

// The committed public/font/*.otf and brutalita-cover.svg are compared byte for
// byte elsewhere, which only holds if an anchor weight returns its exact value.
test('the original SVG weight anchors are preserved exactly', () => {
  for (const [weight, width] of [[300, 1.5], [400, 2], [700, 2.5]]) {
    assert.equal(editorStrokeWidth(weight), width);
    assert.equal(strokeFraction(weight) * 8, width);
    assert.equal(stemWidth(weight), width * 80);
  }
});

test('intermediate SVG weights retain the original linear interpolation', () => {
  assert.equal(editorStrokeWidth(350), 1.75);
  assert.equal(editorStrokeWidth(550), 2.25);
  assert.equal(strokeFraction(550), 2.25 / 8);
  let previous = 0;
  for (let weight = 100; weight <= 900; weight += 25) {
    assert.ok(editorStrokeWidth(weight) >= previous);
    previous = editorStrokeWidth(weight);
  }
});

test('weights outside the anchors clamp to the nearest', () => {
  assert.equal(strokeFraction(50), strokeFraction(100));
  assert.equal(strokeFraction(1000), strokeFraction(900));
  assert.equal(editorStrokeWidth(1), editorStrokeWidth(100));
  assert.equal(editorStrokeWidth(1000), editorStrokeWidth(900));
});

test('styleName uses the standard names, else the weight itself', () => {
  assert.equal(styleName({ weight: 300 }), 'Light');
  assert.equal(styleName({ weight: 400 }), 'Regular');
  assert.equal(styleName({ weight: 500 }), 'Medium');
  assert.equal(styleName({ weight: 700 }), 'Bold');
  assert.equal(styleName({ weight: 550 }), '550');
  assert.equal(styleName({ weight: 550, styleName: 'SemiMedium' }), 'SemiMedium');
  // A blank override falls back rather than naming the font "".
  assert.equal(styleName({ weight: 400, styleName: '  ' }), 'Regular');
});

test('parseWeight rounds, range-checks and rejects non-numbers', () => {
  assert.equal(parseWeight(400), 400);
  assert.equal(parseWeight('550'), 550);
  assert.equal(parseWeight(1), 1);
  assert.equal(parseWeight(1000), 1000);
  assert.equal(parseWeight(412.6), 413);

  for (const bad of [0, 1001, -400, 'heavy', '', null, undefined, NaN, {}]) {
    assert.equal(parseWeight(bad), null, `expected ${JSON.stringify(bad)} to fail`);
  }
});

test('every shipped weight has a standard name', () => {
  for (const weight of SHIPPED_WEIGHTS) {
    assert.notEqual(styleName({ weight }), String(weight));
  }
});

// Keep nine distinct weights within the space available in the skeleton.
test('every standard weight is distinct and stays below the collision ceiling', () => {
  let previous = 0;
  for (const weight of SHIPPED_WEIGHTS) {
    const stem = stemWidth(weight);
    assert.equal(stem % STEM_QUANTUM, 0, `${weight} -> ${stem} is off the lattice`);
    assert.ok(stem > previous, `${weight} -> ${stem}`);
    assert.ok(stem <= 224);
    previous = stem;
  }
  assert.equal(stemWidth(400), 160);
});

// Serialization may differ from the SVG stroke by at most one font unit.
test('weights between the stops still quantize', () => {
  for (let weight = 1; weight <= 1000; weight += 7) {
    assert.equal(stemWidth(weight) % STEM_QUANTUM, 0, `weight ${weight}`);
    assert.ok(Math.abs(stemWidth(weight) - editorStrokeWidth(weight) * 80) <= 1);
  }
});
