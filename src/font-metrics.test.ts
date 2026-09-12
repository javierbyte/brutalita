import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Opentype from 'opentype.js';
import decompress from 'woff2-encoder/decompress';
import { MARK_ROWS } from './compose';
import { buildFontBytes, fontMetrics, KERNING } from './font-maker';
import { validateFontSource } from './font-validate';
import { readHints } from './cff-hint';
import { SHIPPED_WEIGHTS, styleName } from './weights';
import source from './font.json';

const { config, chars } = validateFontSource(source);
const parse = (bytes: Uint8Array) => Opentype.parse(Uint8Array.from(bytes).buffer);

test('Regular preserves the original design scale and natural spacing', () => {
  const metrics = fontMetrics({ ...config, weight: 400 });
  assert.equal(metrics.unitsPerEm, 2048);
  assert.equal(metrics.scaleX, 640);
  assert.equal(metrics.row, 320);
  assert.equal(metrics.stem, 160);
  assert.equal(metrics.capHeight, 1440);
  assert.equal(metrics.monospaceAdvance, 1120);
  assert.equal(metrics.ascender, 2104);
  assert.equal(metrics.descender, -440);
  const font = parse(buildFontBytes(chars, { ...config, weight: 400, monospace: false }));
  const bearing = KERNING / 2;
  assert.equal(font.charToGlyph('H').advanceWidth, 800 + KERNING);
  // An accent is drawn over the letter, never beside it: a composed capital
  // keeps its base's advance and reaches the top of the mark band.
  assert.equal(
    font.charToGlyph('Á').advanceWidth,
    font.charToGlyph('A').advanceWidth
  );
  assert.equal(
    font.charToGlyph('Á').getBoundingBox().y2,
    metrics.capHeight + MARK_ROWS * metrics.row
  );
  // A word gap is the space advance plus one bearing from each neighbour, and
  // wants to stay a small multiple of the gap between two flat-sided letters.
  const wordGap = (font.charToGlyph(' ').advanceWidth ?? 0) + KERNING;
  assert.ok(wordGap / KERNING >= 2 && wordGap / KERNING <= 3.5, `word gap ratio ${wordGap / KERNING}`);
  // Every glyph carries the same nominal bearing on both sides; optical
  // spacing is applied by pair kerning, never by moving a single glyph.
  for (let i = 1; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    const xs = glyph.path.commands.flatMap(command => 'x' in command ? [command.x] : []);
    if (!xs.length) continue;
    assert.equal(Math.min(...xs), bearing, `${glyph.name} left bearing`);
    assert.equal(glyph.advanceWidth, Math.max(...xs) + bearing, `${glyph.name} right bearing`);
  }
});

test('both published families contain all weights and round-trip through WOFF2', async () => {
  const metrics = fontMetrics({ ...config, weight: 400 });
  for (const monospace of [false, true]) {
    for (const weight of SHIPPED_WEIGHTS) {
      const family = monospace ? 'Brutalita Mono' : 'Brutalita';
      const base = `public/font/${family}-${styleName({ weight })}`;
      const otfBytes = readFileSync(`${base}.otf`);
      const webBytes = await decompress(readFileSync(`${base}.woff2`));
      const otf = parse(otfBytes);
      const web = parse(webBytes);
      assert.equal(otf.getEnglishName('fontFamily'), family);
      assert.equal(otf.tables.os2.usWeightClass, weight);
      assert.equal(otf.tables.post.isFixedPitch, monospace ? 1 : 0);
      assert.equal(otf.ascender, metrics.ascender);
      assert.equal(otf.descender, metrics.descender);
      assert.equal(otf.tables.hhea.lineGap, 0);
      assert.equal(otf.tables.os2.sTypoAscender, otf.ascender);
      assert.equal(otf.tables.os2.sTypoDescender, otf.descender);
      assert.equal(otf.tables.os2.usWinAscent, otf.ascender);
      assert.equal(otf.tables.os2.usWinDescent, -otf.descender);
      assert.ok(otf.tables.os2.fsSelection & 128);
      assert.deepEqual(web.tables.hhea, otf.tables.hhea);
      assert.deepEqual(web.tables.os2, otf.tables.os2);
      assert.deepEqual(web.names, otf.names);
      assert.deepEqual(readHints(webBytes), readHints(otfBytes));
      for (let i = 0; i < otf.glyphs.length; i++) {
        const glyph = otf.glyphs.get(i);
        const webGlyph = web.glyphs.get(i);
        assert.equal(webGlyph.advanceWidth, glyph.advanceWidth);
        assert.deepEqual(webGlyph.path.commands, glyph.path.commands);
        if (monospace) assert.equal(glyph.advanceWidth, 1120);
        for (const command of glyph.path.commands) {
          if ('y' in command) {
            assert.ok(command.y <= otf.ascender - 64, `${family} ${weight} ${glyph.name} top`);
            assert.ok(command.y >= otf.descender + 64, `${family} ${weight} ${glyph.name} bottom`);
          }
        }
      }
    }
  }
});
