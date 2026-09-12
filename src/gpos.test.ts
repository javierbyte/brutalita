import assert from 'node:assert/strict';
import { test } from 'node:test';

import Opentype from 'opentype.js';

import { buildFontBytes, fontKerning } from './font-maker';
import { validateFontSource } from './font-validate';
import source from './font.json';

const { chars, config } = validateFontSource(source);

test('proportional builds ship the calculated pairs as GPOS kerning', () => {
  const pairs = fontKerning(chars, { ...config, weight: 400, monospace: false });
  assert.ok(pairs.length > 0);
  const expected = pairs.find(({ left, right }) => left === 'A' && right === 'V');
  assert.ok(expected, 'the optical profiles should identify AV');

  const bytes = buildFontBytes(chars, { ...config, weight: 400, monospace: false });
  const font = Opentype.parse(bytes.slice().buffer);
  assert.ok(font.tables.gpos);
  assert.equal(
    font.getKerningValue(font.charToGlyph('A'), font.charToGlyph('V')),
    expected.value
  );
});

test('monospace builds contain no positioning table', () => {
  const bytes = buildFontBytes(chars, { ...config, weight: 400, monospace: true });
  const font = Opentype.parse(bytes.slice().buffer);
  assert.equal(font.tables.gpos, undefined);
  assert.equal(font.getKerningValue(font.charToGlyph('A'), font.charToGlyph('V')), 0);
});

