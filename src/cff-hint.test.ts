import assert from 'node:assert/strict';
import { test } from 'node:test';

import Opentype from 'opentype.js';

import { readHints } from './cff-hint';
import { buildFont, buildFontBytes, fontMetrics, stemWidth } from './font-maker';
import { validateFontSource } from './font-validate';
import source from './font.json';
import { SHIPPED_WEIGHTS } from './weights';

const { config, chars } = validateFontSource(source);

function parse(bytes: Uint8Array): Opentype.Font {
  return Opentype.parse(bytes.slice().buffer);
}

/** Every glyph's outline, so hinting can be proved not to move any of it. */
function outlines(font: Opentype.Font): string {
  const rows: string[] = [];
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    const path = glyph.path.commands
      .map((command) => {
        const point = command as unknown as { type: string; x?: number; y?: number };
        return `${point.type}${point.x},${point.y}`;
      })
      .join(' ');
    rows.push(`${glyph.name}|${glyph.advanceWidth}|${path}`);
  }
  return rows.join('\n');
}

// A hint that moved an outline would be a bug, not a hint: hinting instructs the
// rasterizer, it does not redraw the glyph.
test('hinting leaves every outline and advance untouched', () => {
  for (const weight of SHIPPED_WEIGHTS) {
    const cfg = { ...config, weight };
    const plain = Opentype.parse(buildFont(chars, cfg).toArrayBuffer());
    const hinted = parse(buildFontBytes(chars, cfg));
    assert.equal(outlines(hinted), outlines(plain), `weight ${weight}`);
  }
});

test('the hinted font is still a font every parser accepts', () => {
  for (const weight of SHIPPED_WEIGHTS) {
    const font = parse(buildFontBytes(chars, { ...config, weight }));
    assert.equal(font.glyphs.length, Object.keys(chars).length + 1);
    assert.equal(font.unitsPerEm, 2048);
    // charToGlyph walking the cmap and the CharStrings INDEX exercises the
    // offsets the CFF rebuild recomputes.
    assert.ok(font.charToGlyph('H').path.commands.length > 0);
  }
});

test('the Private DICT carries the alignment zones and stem widths', () => {
  for (const weight of SHIPPED_WEIGHTS) {
    const cfg = { ...config, weight };
    const metrics = fontMetrics(cfg);
    const stem = stemWidth(weight);
    const { private: dict } = readHints(buildFontBytes(chars, cfg));

    // BlueValues and the StemSnap arrays are stored delta-encoded.
    const undelta = (values: number[]) => {
      let previous = 0;
      return values.map((value) => (previous += value));
    };

    assert.deepEqual(undelta(dict.get(6) ?? []), [
      0,
      0,
      metrics.capHeight - metrics.row,
      metrics.capHeight - metrics.row,
      metrics.capHeight,
      metrics.capHeight,
    ]);
    assert.deepEqual(undelta(dict.get(7) ?? []), [-metrics.row, -metrics.row]);
    assert.deepEqual(dict.get(10), [stem], 'StdHW');
    assert.deepEqual(dict.get(11), [stem], 'StdVW');
    assert.deepEqual(undelta(dict.get(1212) ?? []), [stem], 'StemSnapH');
    assert.deepEqual(undelta(dict.get(1213) ?? []), [stem], 'StemSnapV');
    assert.deepEqual(dict.get(1211), [0], 'BlueFuzz');
    assert.deepEqual(dict.get(1214), weight >= 700 ? [1] : undefined, 'ForceBold');
  }
});

// The zones are only worth anything if the ink actually lands on them.
test('the alignment zones sit on real ink', () => {
  for (const weight of SHIPPED_WEIGHTS) {
    const cfg = { ...config, weight };
    const metrics = fontMetrics(cfg);
    const font = parse(buildFontBytes(chars, cfg));

    const extremes = (char: string) => {
      const ys = font
        .charToGlyph(char)
        .path.commands.map((command) => (command as unknown as { y?: number }).y)
        .filter((y): y is number => y !== undefined);
      return { min: Math.min(...ys), max: Math.max(...ys) };
    };

    assert.equal(extremes('H').min, 0, `weight ${weight} baseline`);
    assert.equal(extremes('H').max, metrics.capHeight, `weight ${weight} cap height`);
    assert.equal(extremes('o').max, metrics.capHeight - metrics.row, `weight ${weight} x-height`);
    assert.equal(extremes('p').min, -metrics.row, `weight ${weight} descender`);
  }
});

test('stems are hinted where there are stems, and nowhere else', () => {
  const { stems } = readHints(buildFontBytes(chars, config));
  const index = (char: string) => Object.keys(chars).indexOf(char) + 1; // +1 for .notdef

  // H has a crossbar and two stems; I has two serif bars and one stem.
  assert.deepEqual(stems[index('H')], { h: 1, v: 1 });
  assert.deepEqual(stems[index('I')], { h: 1, v: 1 });
  // x is nothing but diagonals — there is nothing a rasterizer could snap.
  assert.deepEqual(stems[index('x')], { h: 0, v: 0 });
  // .notdef is empty.
  assert.deepEqual(stems[0], { h: 0, v: 0 });

  const hinted = stems.filter((stem) => stem.h || stem.v).length;
  assert.ok(hinted > 70, `only ${hinted} glyphs carry hints`);
});
