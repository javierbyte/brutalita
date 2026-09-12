import assert from 'node:assert/strict';
import { test } from 'node:test';
import Opentype from 'opentype.js';
import { buildFontBytes, fontMetrics, KERNING } from './font-maker';
import { validateFontSource } from './font-validate';
import source from './font.json';

const { chars, config } = validateFontSource(source);

type Point = { x: number; y: number };

// Independent SVG reference: round strokes are the union of capsules and dots
// on the original 8×16px grid. No font-builder metrics enter this calculation.
function svgInkDistance(char: string, x: number, y: number, stroke: number) {
  let ink = -Infinity;
  for (const layer of chars[char]) {
    if (layer.length === 1) {
      ink = Math.max(ink, stroke * 0.75 - Math.hypot(x - layer[0][0] * 4, y - layer[0][1] * 4));
    }
    for (let i = 1; i < layer.length; i++) {
      const [ax, ay] = layer[i - 1].map(v => v * 4);
      const [bx, by] = layer[i].map(v => v * 4);
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      ink = Math.max(ink, stroke / 2 - Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return ink;
}

function contains(rings: Point[][], x: number, y: number) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

test('serialized font ink matches the original SVG strokes across the character set', () => {
  for (const [weight, stroke] of [[300, 1.5], [400, 2], [700, 2.5], [900, 2.8]]) {
    const cfg = { ...config, weight, monospace: true };
    const metrics = fontMetrics(cfg);
    assert.equal(metrics.row, 320, 'SVG rows stay 4px apart at every weight');
    assert.equal(metrics.monospaceAdvance, 14 * 80);
    const bytes = buildFontBytes(chars, cfg);
    const font = Opentype.parse(bytes.slice().buffer);
    for (const char of Object.keys(chars)) {
      const rings: Point[][] = [];
      for (const command of font.charToGlyph(char).path.commands) {
        if (command.type === 'M') rings.push([]);
        if (command.type === 'M' || command.type === 'L') {
          rings[rings.length - 1].push({
            x: (command.x - KERNING / 2 - metrics.stem / 2) / 80,
            y: (metrics.capHeight - metrics.stem / 2 - command.y) / 80,
          });
        }
      }
      // Offset samples avoid repeatedly landing exactly on grid-aligned edges.
      for (let y = -2.827; y <= 23; y += 0.5) {
        for (let x = -2.827; x <= 11; x += 0.5) {
          const distance = svgInkDistance(char, x, y, stroke);
          // Ignore the <=1.5 font-unit band affected by polygon/CFF rounding.
          if (Math.abs(distance) <= 1.5 / 80) continue;
          assert.equal(contains(rings, x, y), distance > 0,
            `${weight} ${JSON.stringify(char)} differs from SVG at ${x},${y}`);
        }
      }
    }
  }
});
