import assert from 'node:assert/strict';
import test from 'node:test';
import * as Opentype from 'opentype.js';

import source from './font.json';
import { buildFontBytes, fontKerning } from './font-maker';
import { fontConfigReducer } from './font-config';
import { validateFontSource } from './font-validate';
import { resolveSpacing } from './spacing';
import type { FontConfig } from './types';

const { config, chars } = validateFontSource(source);
const proportional: FontConfig = { ...config, weight: 400, monospace: false };

function parse(overrides: object) {
  const bytes = buildFontBytes(chars, { ...proportional, ...overrides });
  return Opentype.parse(bytes.slice().buffer);
}

test('unset spacing builds the same bytes as the explicit defaults', () => {
  const options = { createdTimestamp: 0 };
  assert.deepEqual(
    buildFontBytes(chars, proportional, options),
    buildFontBytes(chars, { ...proportional, ...resolveSpacing({}) }, options)
  );
});

test('spacing sets the letter gap and, unless overridden, the word gap', () => {
  const base = parse({});
  const wide = parse({ spacing: 640 });
  const advance = (font: Opentype.Font, char: string) =>
    font.charToGlyph(char).advanceWidth ?? 0;

  assert.equal(advance(base, 'H'), 800 + 480);
  assert.equal(advance(wide, 'H'), 800 + 640);
  assert.equal(advance(base, ' '), 720);
  assert.equal(advance(wide, ' '), 960);
  assert.equal(advance(parse({ spacing: 480, wordSpacing: 400 }), ' '), 400);
});

test('kerning caps how far a pair closes, and zero writes no pairs', () => {
  const strongest = (kerning: number) =>
    Math.min(0, ...fontKerning(chars, { ...proportional, kerning }).map((p) => p.value));

  assert.equal(strongest(80), -80);
  assert.equal(strongest(160), -160);
  assert.deepEqual(fontKerning(chars, { ...proportional, kerning: 0 }), []);
});

test('monospace ignores spacing', () => {
  const options = { createdTimestamp: 0 };
  const mono = { ...proportional, monospace: true };
  assert.deepEqual(
    buildFontBytes(chars, mono, options),
    buildFontBytes(chars, { ...mono, spacing: 640, wordSpacing: 240, kerning: 0 }, options)
  );
});

test('the validator rejects out-of-range spacing and keeps valid values', () => {
  const result = validateFontSource({
    config: { spacing: 480, wordSpacing: 4000, kerning: 'lots' },
    chars: source.chars,
    marks: source.marks,
  });
  assert.equal(result.config.spacing, 480);
  assert.deepEqual(
    result.errors.map((issue) => issue.field),
    ['config.wordSpacing', 'config.kerning']
  );
});

test('resetting spacing drops the keys from the config', () => {
  const changed = fontConfigReducer(proportional, {
    type: 'change-spacing',
    payload: { key: 'spacing', value: 480 },
  });
  assert.equal(changed.spacing, 480);
  const reset = fontConfigReducer(changed, { type: 'reset-spacing' });
  assert.equal('spacing' in reset, false);
});

test('every proportional advance and kerning pair is a whole device pixel', () => {
  // Half a design pixel is one device pixel at 2x; Regular, whose stem is two
  // design pixels, also lands on whole ones at 1x.
  for (const weight of [100, 300, 400, 500, 700, 900]) {
    const font = parse({ weight });
    const quantum = weight === 400 ? 80 : 40;
    for (let i = 1; i < font.glyphs.length; i++) {
      const glyph = font.glyphs.get(i);
      assert.equal((glyph.advanceWidth ?? 0) % quantum, 0, `${weight} ${glyph.name}`);
    }
    for (const pair of fontKerning(chars, { ...proportional, weight })) {
      assert.equal(Math.abs(pair.value % 80), 0);
    }
  }
});

test('an odd letter gap keeps the ink on a whole pixel', () => {
  const font = parse({ spacing: 400 });
  assert.equal(font.charToGlyph('H').getBoundingBox().x1, 160);
  assert.equal(font.charToGlyph('H').advanceWidth, 800 + 400);
});
