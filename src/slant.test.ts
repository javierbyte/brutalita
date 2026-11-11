import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Opentype from 'opentype.js';
import { fontConfigReducer, DEFAULT_FONT_CONFIG } from './font-config';
import { buildFontBytes, fontMetrics, fontFileName } from './font-maker';
import { validateFontSource } from './font-validate';
import { slantFactor } from './slant';
import { renderTextToSVG } from './svg-export';
import source from './font.json';

const { config, chars } = validateFontSource(source);
const sample = Object.fromEntries([..."AHgÁi. "].map(char => [char, chars[char]]));
const parse = (bytes: Uint8Array) => Opentype.parse(bytes.slice().buffer);

test('slant survives JSON save/load and older sources stay upright', () => {
  const changed = fontConfigReducer(DEFAULT_FONT_CONFIG, { type: 'change-slant', payload: 12 });
  const restored = validateFontSource(JSON.parse(JSON.stringify({ config: changed, chars: sample })));
  assert.equal(restored.ok, true);
  assert.equal(restored.config.slant, 12);
  assert.equal(restored.warnings.some(issue => issue.field === 'config.slant'), false);
  assert.equal(validateFontSource(source).config.slant, 0);
  for (const bad of [-1, 21, NaN, Infinity, '12', null]) {
    assert.equal(validateFontSource({ config: { slant: bad }, chars: sample }).ok, false);
  }
  assert.equal(fontConfigReducer(changed, { type: 'change-slant', payload: 21 }), changed);
});

test('serialized italic outlines shear caps, accents, descenders and dots while preserving advances', () => {
  for (const monospace of [true, false]) {
    for (const [corners, stroke] of [
      ['chamfer', 'round'], ['round', 'round'], ['continuous', 'round'], ['chamfer', 'sharp'], ['round', 'sharp'],
    ] as const) {
      const cfg = { ...config, monospace, corners, stroke };
      const upright = parse(buildFontBytes(sample, cfg));
      const baseline = fontMetrics(cfg).stem / 2;
      for (const slant of [10, 20]) {
        const italic = parse(buildFontBytes(sample, { ...cfg, slant }));
        for (const char of Object.keys(sample)) {
          const before = upright.charToGlyph(char);
          const after = italic.charToGlyph(char);
          assert.equal(after.advanceWidth, before.advanceWidth, `${char} advance`);
          assert.equal(after.path.commands.length, before.path.commands.length);
          before.path.commands.forEach((command, index) => {
            const transformed = after.path.commands[index];
            assert.equal(transformed.type, command.type);
            if ((command.type === 'M' || command.type === 'L') &&
                (transformed.type === 'M' || transformed.type === 'L')) {
              assert.equal(transformed.y, command.y);
              assert.ok(Math.abs(transformed.x - command.x - slantFactor(slant) * (command.y - baseline)) <= 1);
            }
          });
        }
        assert.equal(italic.tables.post.italicAngle, -slant);
        assert.ok(italic.tables.os2.fsSelection & 1);
        assert.equal(italic.tables.os2.fsSelection & 64, 0);
        assert.ok(italic.tables.head.macStyle & 2);
        const names = italic.names as unknown as { windows: { fontSubfamily: { en: string } } };
        assert.equal(names.windows.fontSubfamily.en, 'Italic');
      }
    }
  }
  assert.equal(fontFileName({ ...config, slant: 12 }), 'Brutalita-Italic.otf');
});

test('SVG slants each line around its own baseline and keeps dots and curves', () => {
  assert.equal(renderTextToSVG(sample, 'Ai').svg, renderTextToSVG(sample, 'Ai', { slant: 0 }).svg);
  const svg = renderTextToSVG(sample, 'Ai\nAi', { slant: 20, corners: 'continuous', padding: 0 }).svg;
  const transforms = [...svg.matchAll(/transform="matrix\(1 0 ([^ ]+) 1 ([^ ]+) 0\)"/g)];
  assert.equal(transforms.length, 2);
  assert.equal(Number(transforms[0][1]), -slantFactor(20));
  assert.ok(Math.abs(Number(transforms[1][2]) - Number(transforms[0][2]) - 30 * slantFactor(20)) < 1e-10);
  assert.match(svg, /<circle/);
  assert.match(svg, / C /);
});
