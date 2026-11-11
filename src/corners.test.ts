import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Opentype from 'opentype.js';
import { anchorEnds, cornerOptions, flattenStroke, sharpGlyph, strokeCommands, strokePath } from './corners';
import type { CornerOptions, StrokeCommand } from './corners';
import type { CharLayer } from './types';
import { buildFontBytes, fontMetrics, CELL_BEARING } from './font-maker';
import { DEFAULT_FONT_CONFIG, fontConfigReducer } from './font-config';
import { validateFontSource } from './font-validate';
import { renderTextToSVG } from './svg-export';
import source from './font.json';
import { editorStrokeWidth } from './weights';
import { SHIPPED_WEIGHTS } from './weights';

type Point = [number, number];
type Curve = Extract<StrokeCommand, { type: 'C' }>;
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const close = (a: Point, b: Point) => {
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-10, `${a} != ${b}`);
};

const continuous: CornerOptions = { continuous: true, radius: 1, unit: 1 };
const round: CornerOptions = { continuous: false, radius: 1, unit: 1 };
const octagon: CharLayer = [[0, 0.5], [0.5, 0], [1.5, 0], [2, 0.5], [2, 3.5], [1.5, 4], [0.5, 4], [0, 3.5], [0, 0.5]];
const curvesOf = (commands: StrokeCommand[]) => commands.filter((c): c is Curve => c.type === 'C');

test('continuous bends meet straight lines at zero curvature and join with matching derivatives', () => {
  for (const end of [[7, 2], [7, -2], [5, 4], [8, 1]] as Point[]) {
    const layer: CharLayer = [[0, 0], [4, 0], end];
    const commands = strokeCommands(layer, continuous);
    const entry = commands[1];
    assert.equal(entry.type, 'L');
    if (entry.type !== 'L') throw new Error('missing entry');
    const [a, b] = curvesOf(commands);
    assert.equal(cross(subtract(a.control1, entry.point), subtract(a.control2, a.control1)), 0);
    assert.ok(Math.abs(cross(subtract(b.point, b.control2), subtract(b.control2, b.control1))) < 1e-10);
    close(subtract(a.point, a.control2), subtract(b.control1, a.point));
    close(
      subtract(subtract(a.point, a.control2), subtract(a.control2, a.control1)),
      subtract(subtract(b.control2, b.control1), subtract(b.control1, a.point)),
    );
    close(subtract(a.control1, entry.point), [(4 - entry.point[0]) / 3, 0]);
    assert.ok(Math.abs(cross(subtract(b.point, b.control2), subtract(end, layer[1]))) < 1e-10);
  }
});

test('a chamfer becomes one curve around the corner it cut', () => {
  const arcs = strokeCommands(octagon, round);
  assert.equal(curvesOf(arcs).length, 4);
  assert.equal(arcs[arcs.length - 1].type, 'Z');
  // Radius 1 on a box 2 wide: the ends are semicircles about (1, 1) and (1, 3).
  for (const [x, y] of flattenStroke(octagon, round, 1e-5)) {
    const centre = y < 1 ? 1 : y > 3 ? 3 : y;
    assert.ok(Math.abs(Math.hypot(x - 1, y - centre) - 1) < 1e-3, `${x},${y} is off the pill`);
  }
  assert.equal(curvesOf(strokeCommands(octagon, continuous)).length, 8);
  const flattened = flattenStroke(octagon, continuous, 0.001);
  assert.deepEqual(flattened[0], flattened[flattened.length - 1]);
  assert.ok(flattened.every(([x, y]) => x >= 0 && x <= 2 && y >= 0 && y <= 4));
});

test('one radius for every curve: a shallow bend takes less of its straights', () => {
  const shoulder = strokeCommands([[0, 4], [0, 1], [1, 0]], round);
  const [arc] = curvesOf(shoulder);
  const entry = shoulder[1];
  if (entry.type !== 'L') throw new Error('missing entry');
  const d = Math.tan(Math.PI / 8);
  close(entry.point, [0, 1 + d]);
  close(arc.point, [d * Math.SQRT1_2, 1 - d * Math.SQRT1_2]);
});

test('drawn corners, apexes, dots, straights and reversals stay as they are', () => {
  for (const options of [round, continuous]) {
    for (const layer of [[], [[0, 0]], [[0, 0], [4, 0]], [[0, 0], [2, 0], [4, 0]],
      [[0, 0], [4, 0], [0, 0]], [[0, 0], [0, 0], [4, 0]],
      [[2, 0], [0, 0], [0, 4], [2, 4]], [[0, 0], [0, 4], [2, 4], [2, 0], [0, 0]],
      [[0, 4], [0, 0], [2, 4], [2, 0]], [[0, 0], [1, 4], [2, 0]],
      [[0, 1], [1, 0], [2, 1]]] as CharLayer[]) {
      assert.doesNotMatch(strokePath(layer, options), /C|NaN|Infinity/, JSON.stringify(layer));
      assert.deepEqual(flattenStroke(layer, options), layer.filter((p, i) => !i || p.join() !== layer[i - 1].join()));
    }
  }
  const tiny: CharLayer = [[0, 0], [0.01, 0], [0.02, 0.01], [0.02, 0.02]];
  const points = flattenStroke(tiny, continuous, 0.00001);
  assert.ok(points.every(([x, y]) => x >= 0 && x <= 0.02 && y >= 0 && y <= 0.02));
  assert.ok(points.every(p => p.every(Number.isFinite)));
  assert.deepEqual(points[0], tiny[0]);
  assert.deepEqual(points[points.length - 1], tiny[tiny.length - 1]);
});

test('a stroke that ended on a chamfer is moved onto the curve', () => {
  const { chars } = validateFontSource(source);
  const distance = (p: Point, line: CharLayer) => Math.min(...line.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])));
  for (const options of [round, continuous]) {
    for (const char of ['0', 'y']) {
      const moved = anchorEnds(chars[char], options);
      assert.notDeepEqual(moved, chars[char]);
      moved.forEach((layer, i) => {
        if (layer === chars[char][i]) return;
        const curve = flattenStroke(moved[i ? 0 : 1], options, 1e-4);
        const ends = [layer[0], layer[layer.length - 1]].filter((p, j) =>
          !(p[0] === chars[char][i][j ? chars[char][i].length - 1 : 0][0]
            && p[1] === chars[char][i][j ? chars[char][i].length - 1 : 0][1]));
        assert.ok(ends.length > 0);
        for (const p of ends) assert.ok(distance(p, curve) < 0.01, `${char} end ${p}`);
      });
    }
    assert.equal(anchorEnds(chars.H, options).every((layer, i) => layer === chars.H[i]), true);
  }
});

test('corner settings survive JSON save/load and reject invalid values', () => {
  let config = fontConfigReducer(DEFAULT_FONT_CONFIG, { type: 'change-corners', payload: 'continuous' });
  config = fontConfigReducer(config, { type: 'change-corner-radius', payload: 60 });
  assert.equal(fontConfigReducer(config, { type: 'change-corner-radius', payload: 0 }), config);
  const restored = validateFontSource(JSON.parse(JSON.stringify({ ...source, config })));
  assert.equal(restored.ok, true);
  assert.equal(restored.config.corners, 'continuous');
  assert.equal(restored.config.cornerRadius, 60);
  assert.deepEqual(restored.warnings, []);
  assert.equal(validateFontSource(source).config.corners, undefined);
  assert.equal(cornerOptions(validateFontSource(source).config, 1), undefined);
  assert.equal(cornerOptions({ corners: 'chamfer', cornerRadius: 60 }, 1), undefined);
  assert.deepEqual(cornerOptions({ corners: 'round', cornerRadius: 60 }, 4), { continuous: false, radius: 2.4, unit: 4 });
  for (const bad of [{ corners: 'soft' }, { corners: true }, { cornerRadius: 0 }, { cornerRadius: 101 }, { cornerRadius: '60' }]) {
    assert.equal(validateFontSource({ ...source, config: bad }).ok, false, JSON.stringify(bad));
  }
  // Sources saved while the setting was a single switch.
  const legacy = validateFontSource({ ...source, config: { continuousCorners: true } });
  assert.equal(legacy.config.corners, 'continuous');
  assert.deepEqual(legacy.warnings, []);
});

test('SVG export only curves when asked and preserves dots and straight strokes', () => {
  const { chars } = validateFontSource(source);
  assert.doesNotMatch(renderTextToSVG(chars, 'ASO').svg, / C /);
  assert.equal(renderTextToSVG(chars, 'ASO', { corners: 'chamfer' }).svg, renderTextToSVG(chars, 'ASO').svg);
  for (const corners of ['round', 'continuous'] as const) {
    assert.match(renderTextToSVG(chars, 'ASO', { corners }).svg, / C /);
    assert.notEqual(
      renderTextToSVG(chars, 'O', { corners, cornerRadius: 40 }).svg,
      renderTextToSVG(chars, 'O', { corners }).svg,
    );
    for (const char of ['.', 'I', 'H', '-', 'E', 'N', 'M']) {
      const paths = (svg: string) => svg.replace(/ L /g, ' ');
      assert.equal(
        paths(renderTextToSVG(chars, char, { corners }).svg),
        paths(renderTextToSVG(chars, char).svg),
      );
    }
  }
});

// Independent dense Bézier evaluation and distance-to-segment reference for
// checking the serialized font's pen sweep, including overlapping strokes.
function referenceLayers(layers: CharLayer[], options: CornerOptions): CharLayer[] {
  const scaled = layers.map(layer => layer.map(([x, y]): Point => [x * 4, y * 4]));
  return anchorEnds(scaled, options).map(layer => {
    const points: CharLayer = [];
    for (const command of strokeCommands(layer, options)) {
      if (command.type === 'Z') points.push(points[0]);
      else if (command.type !== 'C') points.push(command.point);
      else {
        const start = points[points.length - 1];
        for (let i = 1; i <= 80; i++) {
          const t = i / 80, s = 1 - t;
          points.push([0, 1].map(axis => s ** 3 * start[axis]
            + 3 * s ** 2 * t * command.control1[axis]
            + 3 * s * t ** 2 * command.control2[axis]
            + t ** 3 * command.point[axis]) as Point);
        }
      }
    }
    return points;
  });
}

function inkDistance(layers: CharLayer[], x: number, y: number, stroke: number) {
  let ink = -Infinity;
  for (const layer of layers) {
    if (layer.length === 1) ink = Math.max(ink, stroke * 0.75 - Math.hypot(x - layer[0][0], y - layer[0][1]));
    for (let i = 1; i < layer.length; i++) {
      const [ax, ay] = layer[i - 1], [bx, by] = layer[i];
      const dx = bx - ax, dy = by - ay;
      const denominator = dx * dx + dy * dy;
      if (!denominator) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / denominator));
      ink = Math.max(ink, stroke / 2 - Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return ink;
}

function contains(rings: CharLayer[], x: number, y: number) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
  }
  return inside;
}

test('curved font outlines match the SVG pen sweep across all glyphs', () => {
  const { chars, config } = validateFontSource(source);
  for (const [corners, cornerRadius, weight] of [
    ['continuous', 100, 100], ['continuous', 60, 400], ['continuous', 100, 900],
    ['round', 100, 400], ['round', 20, 900],
  ] as const) {
    const options = cornerOptions({ corners, cornerRadius }, 4);
    if (!options) throw new Error('missing options');
    const references = Object.fromEntries(Object.entries(chars).map(([char, layers]) => [char, referenceLayers(layers, options)]));
    const cfg = { ...config, weight, monospace: true, corners, cornerRadius };
    const metrics = fontMetrics(cfg);
    const bytes = buildFontBytes(chars, cfg);
    const font = Opentype.parse(bytes.slice().buffer);
    for (const char of Object.keys(chars)) {
      const rings: CharLayer[] = [];
      for (const command of font.charToGlyph(char).path.commands) {
        if (command.type === 'M') rings.push([]);
        if (command.type === 'M' || command.type === 'L') rings[rings.length - 1].push([
          (command.x - metrics.inkOffset - CELL_BEARING - metrics.stem / 2) / 80,
          (metrics.capHeight - metrics.stem / 2 - command.y) / 80,
        ]);
      }
      for (let y = -7.827; y <= 23; y += 0.5) {
        for (let x = -2.827; x <= 11; x += 0.5) {
          const distance = inkDistance(references[char], x, y, editorStrokeWidth(weight));
          // Flattening, pen-circle approximation and CFF integer rounding.
          if (Math.abs(distance) <= 3 / 80) continue;
          assert.equal(contains(rings, x, y), distance > 0,
            `${corners} ${cornerRadius} ${weight} ${JSON.stringify(char)} differs from SVG at ${x},${y}`);
        }
      }
    }
  }
});

test('curved fonts preserve counters and separate dots at every offered weight', () => {
  const { chars, config } = validateFontSource(source);
  for (const corners of ['round', 'continuous'] as const) {
    for (const weight of [...SHIPPED_WEIGHTS, 1, 1000]) {
      const monospace = corners === 'round';
      const bytes = buildFontBytes(chars, { ...config, weight, monospace, corners });
      const font = Opentype.parse(bytes.slice().buffer);
      for (const [char, count] of Object.entries({
        O: 2, B: 2, '8': 3, '0': 3, '!': 2, i: 2, ü: 3, Á: 3,
      })) {
        assert.equal(font.charToGlyph(char).path.commands.filter(c => c.type === 'M').length,
          count, `${weight} ${char}: counters and dots must stay separate`);
      }
    }
  }
});

test('a sharp stroke is flat at its ends and stops its points at the stroke box', () => {
  const box = (pieces: CharLayer[]) => {
    const xs = pieces.flat().map(p => p[0]), ys = pieces.flat().map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  // A stem, a diagonal, an acute point and a dot all fill the same band.
  assert.deepEqual(box(sharpGlyph([[[0, 0], [0, 16]]], 1)), [-1, -1, 1, 17]);
  assert.deepEqual(box(sharpGlyph([[[0, 0], [8, 16]]], 1)), [-1, -1, 9, 17]);
  assert.deepEqual(box(sharpGlyph([[[0, 0], [4, 16], [8, 0]]], 1)), [-1, -1, 9, 17]);
  assert.deepEqual(box(sharpGlyph([[[0, 0], [0, 16], [8, 16]]], 1)), [-1, -1, 9, 17]);
  const [dot] = sharpGlyph([[[4, 4]]], 1.5);
  assert.deepEqual(box([dot]), [2, 2, 6, 6]);
  // An end that lands on another stroke gets no square of its own.
  const stem: CharLayer = [[0, 0], [0, 16]];
  const arm: CharLayer = [[8, 0], [0, 8]];
  assert.equal(sharpGlyph([stem, arm], 1).length, sharpGlyph([stem], 1).length + sharpGlyph([arm], 1).length - 1);
  assert.equal(box(sharpGlyph([stem, arm], 1))[0], -1);
});

test('sharp font outlines match the sharp SVG pieces across all glyphs', () => {
  const { chars, config } = validateFontSource(source);
  for (const [corners, weight] of [['chamfer', 400], ['chamfer', 900], ['round', 400], ['continuous', 100]] as const) {
    const cfg = { ...config, weight, monospace: true, stroke: 'sharp' as const, corners };
    const metrics = fontMetrics(cfg);
    const font = Opentype.parse(buildFontBytes(chars, cfg).slice().buffer);
    const half = editorStrokeWidth(weight) / 2;
    for (const [char, layers] of Object.entries(chars)) {
      const pieces = sharpGlyph(
        layers.map(layer => layer.map(([x, y]): Point => [x * 4, y * 4])), half, cornerOptions(cfg, 4), 0.005);
      const rings: CharLayer[] = [];
      for (const command of font.charToGlyph(char).path.commands) {
        if (command.type === 'M') rings.push([]);
        if (command.type === 'M' || command.type === 'L') rings[rings.length - 1].push([
          (command.x - metrics.inkOffset - CELL_BEARING - metrics.stem / 2) / 80,
          (metrics.capHeight - metrics.stem / 2 - command.y) / 80,
        ]);
      }
      for (let y = -7.827; y <= 23; y += 0.5) {
        for (let x = -2.827; x <= 11; x += 0.5) {
          // Signed distance to the union of convex pieces, wound one way.
          let inside = -Infinity;
          for (const piece of pieces) {
            let depth = Infinity;
            piece.forEach((a, i) => {
              const b = piece[(i + 1) % piece.length];
              const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
              if (length) depth = Math.min(depth, ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / length);
            });
            inside = Math.max(inside, depth);
          }
          if (Math.abs(inside) <= 3 / 80) continue;
          assert.equal(contains(rings, x, y), inside > 0,
            `${corners} ${weight} ${JSON.stringify(char)} differs from SVG at ${x},${y}`);
        }
      }
    }
  }
});

test('stroke setting survives JSON save/load and rejects invalid values', () => {
  const config = fontConfigReducer(DEFAULT_FONT_CONFIG, { type: 'change-stroke', payload: 'sharp' });
  const restored = validateFontSource(JSON.parse(JSON.stringify({ ...source, config })));
  assert.equal(restored.config.stroke, 'sharp');
  assert.deepEqual(restored.warnings, []);
  assert.equal(validateFontSource(source).config.stroke, undefined);
  assert.equal(validateFontSource({ ...source, config: { stroke: 'pointy' } }).ok, false);
  const { chars } = validateFontSource(source);
  assert.equal(renderTextToSVG(chars, 'Ai', { stroke: 'round' }).svg, renderTextToSVG(chars, 'Ai').svg);
  const svg = renderTextToSVG(chars, 'Ai', { stroke: 'sharp' }).svg;
  assert.doesNotMatch(svg, /<circle/);
  assert.match(svg, /<path d="M [^"]+ Z" fill="#fff" stroke="none" \/>/);
});
