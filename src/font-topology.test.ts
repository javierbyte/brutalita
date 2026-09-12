import assert from 'node:assert/strict';
import { test } from 'node:test';
import Opentype from 'opentype.js';
import { buildFontBytes } from './font-maker';
import { validateFontSource } from './font-validate';
import source from './font.json';
import { SHIPPED_WEIGHTS } from './weights';

const { chars, config } = validateFontSource(source);

function rings(glyph: Opentype.Glyph) {
  const result: { x: number; y: number }[][] = [];
  for (const command of glyph.path.commands) {
    if (command.type === 'M') result.push([]);
    if (command.type === 'M' || command.type === 'L') {
      result[result.length - 1].push({ x: command.x, y: command.y });
    }
  }
  return result;
}

test('exported weights preserve separate dots, bars and enclosed counters', () => {
  for (const monospace of [false, true]) {
    for (const weight of [...SHIPPED_WEIGHTS, 750, 850, 1000]) {
      const bytes = buildFontBytes(chars, { ...config, weight, monospace });
      const font = Opentype.parse(bytes.slice().buffer);
      for (const [char, count] of Object.entries({
        '!': 2, '%': 3, '?': 2, i: 2, j: 2, '=': 2,
        '0': 3, '8': 3, B: 2, '@': 2,
        // A mark adds its own contours and merges with nothing: the two dots
        // of a diaeresis stay two dots even at Black.
        'í': 2, 'ñ': 2, 'ü': 3, 'Á': 3, 'Ü': 3, '¿': 2,
      })) {
        assert.equal(rings(font.charToGlyph(char)).length, count, `${weight} ${char}`);
      }
      // Accents keep the same clearance as the dot on an "i": the mark is a
      // separate ring, never fused to the letter, at every weight.
      for (const char of '!ijíüñ') {
        const bounds = rings(font.charToGlyph(char))
          .map((ring) => ({
            bottom: Math.min(...ring.map(p => p.y)),
            top: Math.max(...ring.map(p => p.y)),
          }))
          .sort((a, b) => a.bottom - b.bottom);
        assert.ok(bounds[1].bottom - bounds[0].top >= 40,
          `${weight} ${char}: dot must have visible clearance`);
      }
    }
  }
});
