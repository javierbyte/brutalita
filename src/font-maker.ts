// Namespace import, not default: opentype.js ships only named ESM exports, so
// a default import resolves through interop that the RSC bundler does not
// apply. This form works for the CLI, the browser bundle and Server Components.
import * as Opentype from 'opentype.js';
import polygonClipping from 'polygon-clipping';
import { addHints } from './cff-hint';
import type { FontHints, GlyphHints, StemHint } from './cff-hint';
import { MARK_ROWS } from './compose';
import { anchorEnds, cornerOptions, flattenStroke, sharpGlyph, strokeCommands, strokeOutline } from './corners';
import { glyphName } from './glyph-names';
import { addKerning } from './gpos';
import { calculateKerning } from './kerning';
import type { KerningGlyph, KerningOptions, KerningPair } from './kerning';
import { FontConfig, FontDefinition, FontWeightType } from './types';
import { patchSfntTable } from './sfnt';
import { strokeFraction, styleLink, styleName } from './weights';
import { slantFactor } from './slant';
import { PIXEL, resolveSpacing, sideBearings as splitBearings } from './spacing';

// Approximate SVG round caps/joins to sub-unit accuracy at shipped weights.
// Sixteen sides visibly faceted the curves when enlarged.
const CIRCLE_SEGMENTS = 64;

/**
 * The design grid. Sources place points on x 0..CHAR_X and y -MARK_ROWS..CHAR_Y
 * + 1 in half-unit steps: row 0 is the cap height, row CHAR_Y the baseline, row
 * CHAR_Y + 1 the descender, and the rows above 0 are the mark band, where the
 * accent of a composed glyph such as "Á" sits.
 */
const CHAR_X = 2;
const CHAR_Y = 4;

/** Font units spanned by the x grid, and the em those units sit in. */
export const SCALE_X = 640;
export const UNITS_PER_EM = 2048;
/**
 * Where the first grid column's stroke starts before a family positions the
 * glyph: the monospace cell shifts it by MONO_LATTICE_OFFSET, the proportional
 * family replaces it with the glyph's own bearing (see ./spacing).
 */
export const CELL_BEARING = 192;

// Any letter, not just the ASCII ones: "Ó" has to kern like the "O" it is
// built from, and "¿" opens a clause the way "(" opens a parenthesis.
const LETTER = /^\p{L}$/u;
const OPENING_PUNCTUATION = new Set([...`'"\`([{¿¡`]);
const CLOSING_PUNCTUATION = new Set([...`'".,:;!?)]}`]);

function includeLatinKerningPair(left: string, right: string): boolean {
  return (
    (LETTER.test(left) && LETTER.test(right)) ||
    (OPENING_PUNCTUATION.has(left) && LETTER.test(right)) ||
    (LETTER.test(left) && CLOSING_PUNCTUATION.has(right))
  );
}

const KERNING_MINIMUM_ADJUSTMENT = PIXEL;

/**
 * The single kerning configuration. The OTF's GPOS table and the SVG renderer
 * both lay text out from this, so they must never drift apart.
 */
function latinKerningOptions(config: GeometryConfig): KerningOptions<string> {
  const { spacing, kerning } = resolveSpacing(config);
  return {
    targetGap: spacing,
    sampleStep: 32,
    minimumClearance: 96,
    // Whole pixels, like every other advance: a pair that closed a fraction of
    // one would knock the rest of its line off the pixel grid.
    quantization: PIXEL,
    minimumAdjustment: KERNING_MINIMUM_ADJUSTMENT,
    maximumReduction: kerning,
    includePair: includeLatinKerningPair,
  };
}

/** Pair adjustments for already-built glyphs; none for a monospace font. */
function latinKerning(
  glyphs: KerningGlyph<string>[],
  config: GeometryConfig
): KerningPair<string>[] {
  // A cap below the smallest adjustment worth writing can produce no pair, so
  // skip measuring every combination just to discard them all.
  if (config.monospace) return [];
  if (resolveSpacing(config).kerning < KERNING_MINIMUM_ADJUSTMENT) return [];
  return calculateKerning(glyphs, latinKerningOptions(config));
}

/**
 * Only round enough to serialize integral CFF coordinates. An even stem keeps
 * its half-width integral; the maximum deviation from the SVG is 1/80px.
 * Preserve the design scale and spacing. Hints may help the rasterizer, but
 * the outlines themselves are not quantized to a screen-pixel grid.
 */
export const STEM_QUANTUM = 2;

/**
 * Every design-grid position is a multiple of 160 units — half a grid column —
 * and so is every stem drawn on one. The nominal bearing then puts the leftmost
 * ink at CELL_BEARING = 192, which is 1.2 of those steps, so at the sizes where a
 * step lands on a whole device pixel the vertical stems still straddle two: a
 * 3-pixel stem rasterizes as four columns with a gray fringe on each side.
 * Moving the monospace ink 32 units left puts it back on the lattice. Measured
 * over the sizes where the step is whole (12.8n / DPR), it cuts vertical-edge
 * blur by 59% at Regular — where the stem is exactly one step — and by 15-38%
 * at the other weights, and changes nothing at the sizes in between.
 *
 * Advances are untouched, so the monospace grid and every gap are unchanged;
 * the ink sits 32 units further left inside the same box, which also evens out
 * the bearings (160/160 at Regular, against 192/128 before). Leftwards, not
 * right: the ink edge is as close to 160 as to 320, and at Black the rightward
 * landing would hang the ink 64 units past its own advance.
 *
 * The proportional family needs no offset: its bearings, its space and its
 * kerning pairs are all whole pixels (see ./spacing), so every glyph starts on
 * the lattice wherever it falls in a line.
 */
const MONO_LATTICE_OFFSET = -32;

export function stemWidth(weight: FontWeightType): number {
  return Math.round((strokeFraction(weight) * SCALE_X) / STEM_QUANTUM) * STEM_QUANTUM;
}

/** The SVG editor uses a fixed 14px advance on its 8px-wide skeleton. */
export function monospaceAdvance(_weight: FontWeightType): number {
  return (SCALE_X / 8) * 14;
}

// Square font units. A period is some 40,000; a pixel at 16px is 3,900.
const SLIVER_AREA = 32;

type GeometryConfig = Pick<
  FontConfig,
  | 'weight'
  | 'height'
  | 'monospace'
  | 'stroke'
  | 'corners'
  | 'cornerRadius'
  | 'slant'
  | 'spacing'
  | 'wordSpacing'
  | 'kerning'
>;

function configToMetrics(config: GeometryConfig) {
  const stem = stemWidth(config.weight);
  const halfStem = stem / 2;
  // SVG grid points do not move as the stroke gets heavier. Keep the row
  // spacing fixed; translating the entire outline to baseline zero is harmless,
  // compressing its skeleton is not. The shipped aspect ratio is 8×16 = 2.
  const row = Math.round((SCALE_X * (config.height || 2)) / CHAR_Y / 2) * 2;
  const cap = row * CHAR_Y + stem;
  return {
    cap,
    // Weight-independent layout metrics bound the supported grid, including
    // oversized dots, with 64 units of clearance. These are not ink heights.
    // The mark band is part of that grid: a line of accented capitals has to
    // fit inside its own line box, as it does in every other Latin font, so
    // the ascender carries it even though most text never reaches up there.
    ascender:
      row * (CHAR_Y + MARK_ROWS) + Math.ceil(stemWidth(900) * 1.25) + 64,
    descender: -(row + Math.ceil(stemWidth(900) * 0.25) + 64),
    stem,
    halfStem,
    row,
    monospaceAdvance: monospaceAdvance(config.weight),
  };
}

type Metrics = ReturnType<typeof configToMetrics>;

/**
 * A design-grid point to font units, as the centre of the stroke that will be
 * drawn through it. Ink then extends halfStem in every direction, which puts
 * the leftmost edge on CELL_BEARING and the baseline row's lower edge on 0.
 */
function gridToUnits(x: number, y: number, metrics: Metrics): [number, number] {
  return [
    (x * SCALE_X) / CHAR_X + CELL_BEARING + metrics.halfStem,
    metrics.cap - metrics.halfStem - y * metrics.row,
  ];
}

function polar2cartesian({
  distance,
  angle,
}: {
  distance: number;
  angle: number;
}) {
  return {
    x: distance * Math.cos(angle),
    y: distance * Math.sin(angle),
  };
}

function cartesian2polar({ x, y }: { x: number; y: number }) {
  return {
    distance: Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)),
    angle: Math.atan2(y, x),
  };
}

type polygon = [number, number][];

function definePolygon() {
  let multiPolygon: polygon[] = [];
  let currentPolygon: polygon = [];

  // Corners are snapped to whole font units on the way in. polygon-clipping
  // 0.15 cannot reliably close a ring built from raw floats ("Unable to
  // complete output ring"), and integer input is what the sweep line needs to
  // agree with itself about which segments touch. Axis-aligned corners are
  // already integral here; this only bites on diagonals and circle vertices.
  return {
    start(x: number, y: number) {
      currentPolygon = [[Math.round(x), Math.round(y)]];
    },
    line(x: number, y: number) {
      currentPolygon.push([Math.round(x), Math.round(y)]);
    },
    close() {
      currentPolygon.push(currentPolygon[0]);
      multiPolygon.push(currentPolygon);
    },
    getUnion() {
      const arrMulti = multiPolygon.map((e) => [e]);
      return polygonClipping.union(arrMulti);
    },
  };
}

function makeGlyph(char: string, path: polygon[] = [], config: GeometryConfig) {
  const metrics = configToMetrics(config);
  const { halfStem, stem, monospaceAdvance } = metrics;
  const shear = slantFactor(config.slant);
  const glyphPolygon = definePolygon();

  // Stems for the CFF hints, taken from the skeleton rather than recovered from
  // the outline: a segment that is axis-aligned in the design grid is a stem,
  // and its width is the stroke. Diagonals and dots get none, which is correct —
  // there is nothing for a rasterizer to snap them to.
  const hHints: StemHint[] = [];
  const vHints: StemHint[] = [];

  // clean path and layers from empty arrays
  path = path
    .filter((layer) => layer.length)
    .map((layer) => layer.filter((coord) => coord.length));

  // The span of the stroke itself, a stem wide around every skeleton point.
  // Spacing is measured from this rather than from the ink: a dot is drawn
  // half a stem wider than its stroke, and a curved corner
  // sits inside the one it replaces, and neither may move the skeleton off the lattice.
  let strokeMinX = Infinity;
  let strokeMaxX = -Infinity;
  for (const layer of path) {
    for (const [x, y] of layer) {
      const [centre] = gridToUnits(x, y, metrics);
      strokeMinX = Math.min(strokeMinX, centre - halfStem);
      strokeMaxX = Math.max(strokeMaxX, centre + halfStem);
    }
  }

  const curves = cornerOptions(config, metrics.row);
  const sharp = config.stroke === 'sharp';
  if (sharp) {
    const drawn = path.map((layer) => layer.map(([x, y]) => gridToUnits(x, y, metrics)));
    drawn.forEach((units) => {
      let previous: [number, number] | undefined;
      for (const command of strokeCommands(units, curves)) {
        if (command.type === 'Z') continue;
        if (command.type === 'L' && previous) {
          if (previous[0] === command.point[0] && previous[1] !== command.point[1]) {
            vHints.push({ edge: previous[0] - halfStem, width: stem });
          }
          if (previous[1] === command.point[1] && previous[0] !== command.point[0]) {
            hHints.push({ edge: previous[1] - halfStem, width: stem });
          }
        }
        previous = command.point;
      }
    });
    // As with the round pen, one ring per curved stroke: its flattened bends
    // as separate pieces are more near-coincident edges than polygon-clipping's
    // sweep line survives.
    const ring = (points: [number, number][]) =>
      strokeOutline(points, halfStem, CIRCLE_SEGMENTS, false);
    for (const piece of sharpGlyph(drawn, halfStem, curves, 0.5, ring)) {
      piece.forEach(([x, y], i) => {
        if (i === 0) glyphPolygon.start(x, y);
        else glyphPolygon.line(x, y);
      });
      glyphPolygon.close();
    }
    path = [];
  } else if (curves) {
    // Blend after scaling so the curve stays isotropic at any aspect ratio.
    // One ring per curved stroke avoids thousands of overlapping capsules and
    // near-coincident intersections in polygon-clipping's sweep line.
    const drawn = path.map((layer) => layer.map(([x, y]) => gridToUnits(x, y, metrics)));
    const anchored = anchorEnds(drawn, curves);
    path = path.filter((_, index) => {
      const units = anchored[index];
      const commands = strokeCommands(units, curves);
      // A straight stroke whose end moved onto a curve has left the grid too.
      if (units === drawn[index] && !commands.some(c => c.type === 'C')) return true;
      let previous: [number, number] | undefined;
      for (const command of commands) {
        if (command.type === 'Z') continue;
        // Hint only the straight portions, never the flattened bend segments.
        if (command.type === 'L' && previous) {
          if (previous[0] === command.point[0] && previous[1] !== command.point[1]) {
            vHints.push({ edge: previous[0] - halfStem, width: stem });
          }
          if (previous[1] === command.point[1] && previous[0] !== command.point[0]) {
            hHints.push({ edge: previous[1] - halfStem, width: stem });
          }
        }
        previous = command.point;
      }
      const outline = strokeOutline(flattenStroke(units, curves), halfStem, CIRCLE_SEGMENTS);
      outline.forEach(([x, y], i) => {
        if (i === 0) glyphPolygon.start(x, y);
        else glyphPolygon.line(x, y);
      });
      glyphPolygon.close();
      return false;
    });
  }

  if (path.length) {
    for (const layer of path) {
      const dotTotal = layer.length;

      let i = 0;
      while (i < dotTotal - 1) {
        // Expand the stroke in font units, not grid units. The two axes are
        // scaled differently (SCALE_X across CHAR_X columns vs `row` down the
        // rows), so offsetting before the scale drew an elliptical pen: stems
        // came out 160 units wide while the bars they met were 151.
        const [x1, y1] = gridToUnits(layer[i][0], layer[i][1], metrics);
        const [x2, y2] = gridToUnits(layer[i + 1][0], layer[i + 1][1], metrics);

        if (layer[i][0] === layer[i + 1][0]) {
          vHints.push({ edge: x1 - halfStem, width: stem });
        }
        if (layer[i][1] === layer[i + 1][1]) {
          hHints.push({ edge: y1 - halfStem, width: stem });
        }

        const polar = cartesian2polar({ x: x2 - x1, y: y2 - y1 });
        const newCoord = polar2cartesian({
          distance: halfStem,
          angle: polar.angle - Math.PI / 2,
        });

        glyphPolygon.start(x1 - newCoord.x, y1 - newCoord.y);
        glyphPolygon.line(x1 + newCoord.x, y1 + newCoord.y);
        glyphPolygon.line(x2 + newCoord.x, y2 + newCoord.y);
        glyphPolygon.line(x2 - newCoord.x, y2 - newCoord.y);

        glyphPolygon.close();

        i++;
      }
    }
  }

  let uniqueDots: { [key: string]: [number, number] } = {};
  let uniqueCoords: { [key: string]: [number, number] } = {};
  for (const layer of path) {
    for (const coord of layer) {
      // only one coord per layer means this is a dot
      if (layer.length === 1) {
        uniqueDots[coord.join(',')] = coord;
      } else {
        /* I'll try to find this point as an intersection of two different lines */
        let found = false;

        for (const layer of path) {
          let i = 0;
          while (i < layer.length - 1 && !found) {
            const j = i + 1;

            if (layer[i][0] === layer[j][0] && layer[j][0] === coord[0]) {
              if (
                Math.min(layer[i][1], layer[j][1]) < coord[1] &&
                Math.max(layer[i][1], layer[j][1]) > coord[1]
              ) {
                found = true;
              }
            }

            if (layer[i][1] === layer[j][1] && layer[j][1] === coord[1]) {
              if (
                Math.min(layer[i][0], layer[j][0]) < coord[0] &&
                Math.max(layer[i][0], layer[j][0]) > coord[0]
              ) {
                found = true;
              }
            }

            if (layer[i][1] !== layer[j][1] && layer[j][0] !== coord[0]) {
              const diff0 = layer[j][0] - layer[i][0];
              const diff1 = layer[j][1] - layer[i][1];

              const progress0 = (coord[0] - layer[i][0]) / diff0;

              if (progress0 * diff1 === coord[1] - layer[i][1]) {
                if (
                  Math.min(layer[i][0], layer[j][0]) < coord[0] &&
                  Math.max(layer[i][0], layer[j][0]) > coord[0]
                ) {
                  found = true;
                }
              }
            }
            i++;
          }
        }

        if (!found) uniqueCoords[coord.join(',')] = coord;
      }
    }
  }

  // Round joins and dots, likewise swept in font units so they stay circular.
  const circle = (grid: [number, number], radius: number) => {
    const [cx, cy] = gridToUnits(grid[0], grid[1], metrics);
    let j = 0;
    while (j < CIRCLE_SEGMENTS) {
      const newCoord = polar2cartesian({
        distance: radius,
        angle: (2 * Math.PI * j) / CIRCLE_SEGMENTS,
      });

      // first point of the circle, move
      if (j === 0) {
        glyphPolygon.start(cx + newCoord.x, cy + newCoord.y);
      } else {
        glyphPolygon.line(cx + newCoord.x, cy + newCoord.y);
      }
      j++;
    }
    glyphPolygon.close();
  };

  for (const uniqueCoordKey of Object.keys(uniqueCoords)) {
    circle(uniqueCoords[uniqueCoordKey], halfStem);
  }
  for (const dotCoordKey of Object.keys(uniqueDots)) {
    circle(uniqueDots[dotCoordKey], halfStem * 1.5);
  }

  const unionPolygon = glyphPolygon.getUnion();

  // Normalize every union ring once. Optical spacing consumes these contours
  // before positioning, while the path writer below applies the chosen LSB.
  const rawContours: [number, number][][] = [];
  let globalMinX = Infinity;
  let globalMaxX = -Infinity;
  for (const polygon of unionPolygon) {
    for (const ring of polygon) {
      const contour = ring.map(([x, y]): [number, number] => [
        Math.round(x),
        Math.round(y),
      ]);
      if (curves || sharp) {
        // Offset joins can leave microscopic rings where their intersections
        // round onto the same CFF coordinates, or where a curve grazes the
        // stroke beside it. They have no representable ink.
        const area = contour.reduce((sum, [x, y], i) => {
          const [nx, ny] = contour[(i + 1) % contour.length];
          return sum + x * ny - nx * y;
        }, 0) / 2;
        if (Math.abs(area) <= SLIVER_AREA) continue;
      }
      rawContours.push(contour);
      for (const [x] of contour) {
        globalMinX = Math.min(globalMinX, x);
        globalMaxX = Math.max(globalMaxX, x);
      }
    }
  }

  if (Number.isFinite(strokeMinX)) {
    globalMinX = strokeMinX;
    globalMaxX = strokeMaxX;
  }

  // Every proportional glyph keeps the same nominal bearing on both sides.
  // Brutalita is drawn almost entirely from vertical stems, so per-glyph
  // optical bearings had no true diagonal to act on and only tightened the
  // shelved letters (T, I, L, F). Optical spacing is pair kerning's job.
  const { spacing, wordSpacing } = resolveSpacing(config);
  const sideBearings = config.monospace
    ? { left: 0, right: 0 }
    : splitBearings(spacing);
  const remainingSpaceTranslation = config.monospace
    ? MONO_LATTICE_OFFSET
    : Number.isFinite(globalMinX)
      ? sideBearings.left - globalMinX
      : 0;

  // Round here and nowhere else. The union's intersection vertices are
  // fractional however clean its inputs were, and leaving them for opentype.js
  // to round on the way into the charstring made the final outline a property
  // of the serializer rather than of this build.
  const tmpPath = new Opentype.Path();
  const contours: [number, number][][] = [];
  for (const ring of rawContours) {
      const contour: [number, number][] = [];
      ring.forEach(([x, y], index) => {
        // Shear the finished outline about the skeleton's baseline, including
        // round caps and dots. Advances stay fixed as the angle changes.
        const px = Math.round(x + remainingSpaceTranslation + shear * (y - halfStem));
        const py = y;
        contour.push([px, py]);
        if (index === 0) {
          tmpPath.moveTo(px, py);
        } else {
          tmpPath.lineTo(px, py);
        }
      });
      contours.push(contour);
  }

  const xs = tmpPath.commands.map((command) => (command as { x: number }).x);
  const baseDynamicSpacing = xs.length ? globalMaxX - globalMinX : 0;
  const finalSpacing = config.monospace
    ? monospaceAdvance
    : char === ' ' || !xs.length
      ? wordSpacing
      : // To half a pixel, which is a whole device pixel on a 2x screen. The
        // weights whose stem is not a whole number of them (500, 600, 800,
        // 900) would otherwise push each following glyph off the lattice.
        // Regular's stem is two whole pixels, so it needs no rounding at all.
        Math.round(
          (baseDynamicSpacing + sideBearings.left + sideBearings.right) /
            (PIXEL / 2)
        ) *
        (PIXEL / 2);

  const tmpGlyph = new Opentype.Glyph({
    name: glyphName(char),
    unicode: char.codePointAt(0),
    advanceWidth: finalSpacing,
    path: tmpPath,
  });

  // Vertical stems move with the glyph's left side bearing; horizontal ones do
  // not, since the translation is horizontal only.
  const hints: GlyphHints = {
    h: hHints,
    // Slanted stems cannot use axis-aligned vertical CFF hints.
    v: config.slant ? [] : vHints.map(({ edge, width }) => ({
      edge: edge + remainingSpaceTranslation,
      width,
    })),
  };

  return {
    char,
    glyph: tmpGlyph,
    hints,
    contours,
    /** Whether the glyph draws anything; a blank one advances like a space. */
    blank: !xs.length,
    /**
     * Where the stroke through grid column 0 is centred, from the glyph's
     * origin and before any slant: what a stroke renderer needs to put the
     * skeleton exactly where the outline has it.
     */
    skeletonOrigin: CELL_BEARING + halfStem + remainingSpaceTranslation,
  };
}

function kerningGlyph(built: ReturnType<typeof makeGlyph>): KerningGlyph<string> {
  return {
    key: built.char,
    advanceWidth: built.glyph.advanceWidth ?? 0,
    contours: built.contours,
  };
}

/**
 * Calculate the proportional font's optical pair adjustments. Kept public so
 * non-font renderers can use exactly the same layout without knowing how the
 * algorithm measures outlines.
 */
export function fontKerning(
  definition: FontDefinition,
  config: GeometryConfig
): KerningPair<string>[] {
  if (config.monospace) return [];
  return latinKerning(
    Object.keys(definition).map((char) =>
      kerningGlyph(makeGlyph(char, definition[char], config))
    ),
    config
  );
}

export type FontLayout = {
  /** Per character, in font units. Blank glyphs are left out. */
  glyphs: Map<string, { advance: number; skeletonOrigin: number }>;
  /** Advance of the space, and of any character with nothing to draw. */
  spaceAdvance: number;
  kerning: KerningPair<string>[];
};

/**
 * Horizontal layout exactly as the built font has it — advances, where each
 * skeleton sits inside its advance, and the kerning pairs — for renderers that
 * draw the strokes themselves. Pass only the characters being set: kerning is
 * measured between every pair of them.
 */
export function fontLayout(
  definition: FontDefinition,
  config: GeometryConfig
): FontLayout {
  const built = Object.keys(definition).map((char) =>
    makeGlyph(char, definition[char], config)
  );
  const glyphs: FontLayout['glyphs'] = new Map();
  for (const entry of built) {
    if (entry.blank) continue;
    glyphs.set(entry.char, {
      advance: entry.glyph.advanceWidth ?? 0,
      skeletonOrigin: entry.skeletonOrigin,
    });
  }
  return {
    glyphs,
    spaceAdvance: config.monospace
      ? monospaceAdvance(config.weight)
      : resolveSpacing(config).wordSpacing,
    kerning: latinKerning(built.map(kerningGlyph), config),
  };
}

/** Family name as written into the font: "Brutalita" / "Brutalita Mono". */
export function fontName(config: Pick<FontConfig, 'name' | 'monospace'>): string {
  return `${config.name} ${config.monospace ? 'Mono' : ''}`.trim();
}

/**
 * Family name plus version, for specimens and UI copy: "Brutalita v0.9".
 * Sources written before `config.version` existed simply get the bare name.
 */
export function fontDisplayName(
  config: Pick<FontConfig, 'name' | 'monospace' | 'version'>
): string {
  return [fontName(config), config.version && `v${config.version}`]
    .filter(Boolean)
    .join(' ');
}

/** The metrics a build will use, for `brutalita info`. */
export function fontMetrics(config: FontConfig) {
  const metrics = configToMetrics(config);
  return {
    unitsPerEm: UNITS_PER_EM,
    ascender: metrics.ascender,
    descender: metrics.descender,
    kerning: resolveSpacing(config).spacing,
    scaleX: SCALE_X,
    /** Baseline to cap height. */
    capHeight: metrics.cap,
    /** Distance between skeleton rows; ink cap height also includes the stem. */
    row: metrics.row,
    /** Stroke width in font units, always a multiple of STEM_QUANTUM. */
    stem: metrics.stem,
    monospaceAdvance: metrics.monospaceAdvance,
    /**
     * How far the whole outline sits from where the skeleton alone would put
     * it, so a renderer working back to design coordinates can undo it.
     */
    inkOffset: config.monospace ? MONO_LATTICE_OFFSET : 0,
  };
}

// Suggested .otf file name for a config, e.g. "Brutalita Custom-Regular.otf".
export function fontFileName(config: FontConfig): string {
  return `${fontName(config)}-${styleName(config)}.otf`;
}

/**
 * PANOSE, which is how a system substitutes a missing font. Brutalita is a
 * monoline sans with no contrast and no stroke variation, so most of this is
 * fixed; only weight and proportion follow the config.
 */
function panose(config: FontConfig): number[] {
  const weightDigit = Math.min(
    11,
    Math.max(2, Math.round(config.weight / 100) + 1)
  );
  return [
    2, // family: latin text
    11, // serif style: normal sans
    weightDigit,
    config.monospace ? 9 : 4, // proportion: monospaced / even width
    1, // contrast: none
    1, // stroke variation: no variation
    2, // arm style: straight arms, horizontal
    2, // letterform: normal, contact
    2, // midline: standard, trimmed
    4, // x-height: constant, large
  ];
}

/**
 * OS/2 fsSelection bits. opentype.js exposes them as
 * `Font.prototype.fsSelectionValues` but @types/opentype.js declares neither
 * that nor a numeric `fsSelection` option, so the values live here.
 */
const FS_ITALIC = 1;
const FS_BOLD = 32;
const FS_REGULAR = 64;
const FS_USE_TYPO_METRICS = 128;

export type BuildFontOptions = {
  /**
   * Unix seconds written to head.created and, by buildFontBytes, to
   * head.modified. Both default to "now", so two builds of an unchanged source
   * differ; pinning them makes the bytes reproducible.
   */
  createdTimestamp?: number;
};

/**
 * Alignment zones and stem widths for the Private DICT. Brutalita's terminals
 * are flat and land exactly on their metric, so every zone is zero-width — no
 * overshoot to suppress — and being monoline there is a single stem width for
 * both axes.
 */
function privateHints(config: FontConfig): FontHints['private'] {
  const { cap, row, stem } = configToMetrics(config);
  return {
    // Baseline pair first, then the top zones, ascending.
    blueValues: [0, 0, cap - row, cap - row, cap, cap],
    otherBlues: [-row, -row],
    stdHW: stem,
    stdVW: stem,
    stemSnapH: [stem],
    stemSnapV: [stem],
    forceBold: config.weight >= 700,
  };
}

// Build the opentype.js Font. Pure and Node-safe (no DOM), so the CLI can import
// it directly. `font.toArrayBuffer()` serializes it to .otf bytes — but prefer
// `buildFontBytes`, which also writes the hints opentype.js cannot.
export function buildFont(
  definition: FontDefinition,
  config: FontConfig,
  options: BuildFontOptions = {}
) {
  return buildFontWithHints(definition, config, options).font;
}

function buildFontWithHints(
  definition: FontDefinition,
  config: FontConfig,
  options: BuildFontOptions = {}
) {
  const metrics = configToMetrics(config);
  const { ascender, descender, stem, monospaceAdvance } = metrics;

  const notdefGlyph = new Opentype.Glyph({
    name: '.notdef',
    advanceWidth: monospaceAdvance,
    path: new Opentype.Path(),
  });

  const built = Object.keys(definition).map((char) => {
    return makeGlyph(char, definition[char], config);
  });

  const glyphs = [notdefGlyph, ...built.map((entry) => entry.glyph)];
  // .notdef is empty, so it leads the hint list with nothing to snap.
  const glyphHints: GlyphHints[] = [
    { h: [], v: [] },
    ...built.map((entry) => entry.hints),
  ];

  const designer = config.designer?.trim() || undefined;
  const family = fontName(config);
  const style = styleName(config);
  const link = styleLink(config);
  const xHeight = metrics.cap - metrics.row;

  const font = new Opentype.Font({
    familyName: family,
    styleName: style,
    italicAngle: -(config.slant ?? 0),
    unitsPerEm: UNITS_PER_EM,
    ascender,
    descender,
    // @types/opentype.js mistypes weightClass as string, but the runtime stores
    // it directly as the numeric OS/2 usWeightClass.
    weightClass: config.weight as unknown as string,
    designer,
    designerURL: config.designerURL?.trim() || undefined,
    version: config.version?.trim()
      ? `Version ${config.version.trim()}`
      : undefined,
    // Every name record opentype.js does not receive is written as a single
    // space, and name ID 3 is built as `${manufacturer}: ${fullName}` — so
    // leaving these unset shipped five junk records and a malformed unique ID.
    copyright: `Copyright (c) 2021, Javier Bórquez`,
    license: 'BSD 3-Clause License',
    licenseURL: 'https://github.com/javierbyte/brutalita/blob/master/LICENSE',
    manufacturer: designer,
    manufacturerURL: config.designerURL?.trim() || undefined,
    description: 'An experimental geometric font.',
    panose: panose(config),
    // USE_TYPO_METRICS: without it a line of Brutalita is a different height on
    // Windows than on macOS, because the two read different metric pairs.
    // Bold only where the style is filed as one (see styleLink): a bit set on
    // every heavy weight makes them all claim to be the family's bold.
    fsSelection:
      (link.bold ? FS_BOLD : 0) |
      (link.italic ? FS_ITALIC : 0) |
      (link.bold || link.italic ? 0 : FS_REGULAR) |
      FS_USE_TYPO_METRICS,
    tables: {
      // Both of these shipped as 0, which makes `text-decoration: underline`
      // a zero-thickness rule sitting on the baseline.
      post: {
        underlinePosition: -Math.round(stem * 1.5),
        underlineThickness: stem,
        isFixedPitch: config.monospace ? 1 : 0,
      },
    },
    ...(options.createdTimestamp !== undefined
      ? { createdTimestamp: options.createdTimestamp }
      : {}),
    glyphs: glyphs,
  } as unknown as ConstructorParameters<typeof Opentype.Font>[0]);

  // opentype.js writes every name record it was not given as a single space, and
  // there is no option for "omit this one" — Brutalita has no trademark, so drop
  // name ID 7 rather than ship a blank or invent a claim.
  //
  // Names 1 and 2 are the four-style filing, 16 and 17 the real family and
  // style. The unique ID is spelled out because opentype.js would otherwise
  // derive it from names 1 and 2 ("Brutalita Light Regular").
  const names = font.names as unknown as Record<
    string,
    Record<string, { en: string } | undefined> | undefined
  >;
  for (const platform of ['unicode', 'macintosh', 'windows'] as const) {
    const records = names[platform];
    if (!records) continue;
    delete records.trademark;
    records.fontFamily = { en: `${family} ${link.familySuffix}`.trim() };
    records.fontSubfamily = { en: link.subfamily };
    records.preferredFamily = { en: family };
    records.preferredSubfamily = { en: style };
    records.uniqueID = {
      en: [designer, `${family} ${style}`].filter(Boolean).join(': '),
    };
  }
  // The CFF table carries a family, weight and full name of its own, which
  // opentype.js also reads from names 1 and 2. Those are not subject to the
  // four-style limit, so serialize them from the real ones.
  const englishName = font.getEnglishName.bind(font);
  font.getEnglishName = (name: string) =>
    name === 'fontFamily'
      ? family
      : name === 'fontSubfamily'
        ? style
        : englishName(name);

  // opentype.js merges font.tables.os2 over its own defaults, which derive the
  // Windows clipping bounds from the outline bounding box. Use the same
  // padded bounds as the typographic layout metrics across both families.
  const os2 = font.tables.os2 as unknown as Record<string, unknown>;
  os2.achVendID = 'JVBY';
  os2.sTypoAscender = ascender;
  os2.sTypoDescender = descender;
  os2.sTypoLineGap = 0;
  os2.usWinAscent = ascender;
  os2.usWinDescent = -descender;
  // opentype.js defaults these to a 49-unit rule a quarter of the way up a
  // 1000-unit em: `text-decoration: line-through` drew a hairline through the
  // feet of the lowercase. A stem thick, centred on the x-height.
  os2.yStrikeoutSize = stem;
  os2.yStrikeoutPosition = Math.round((xHeight + stem) / 2);

  const calculatedPairs = latinKerning(built.map(kerningGlyph), config);
  const glyphIndex = new Map(built.map((entry, index) => [entry.char, index + 1]));
  const charPairs: KerningPair<number>[] = calculatedPairs.map((pair) => ({
    left: glyphIndex.get(pair.left)!,
    right: glyphIndex.get(pair.right)!,
    value: pair.value,
  }));
  // OpenType.js can apply this map while the Font object is in memory, even
  // though its serializer does not write it. buildFontBytes writes the same
  // pairs to GPOS below.
  font.kerningPairs = Object.fromEntries(
    charPairs.map(({ left, right, value }) => [`${left},${right}`, value])
  );

  return {
    font,
    hints: { glyphs: glyphHints, private: privateHints(config) } as FontHints,
    kerning: charPairs,
    link,
  };
}

// Offsets of the fields opentype.js derives on its own and offers no option
// for: head.modified and head.macStyle, and the caret slope in hhea.
const HEAD_CREATED = 20;
const HEAD_MODIFIED = 28;
const HEAD_MAC_STYLE = 44;
/** LONGDATETIME counts from 1904-01-01; unix time counts from 1970-01-01. */
const MAC_EPOCH_OFFSET = 2082844800;
const HHEA_CARET_SLOPE_RISE = 18;
const HHEA_CARET_SLOPE_RUN = 20;
const CARET_RISE = 1000;

/**
 * head.macStyle has to agree with OS/2.fsSelection, and opentype.js sets its
 * bold bit from the weight alone. It also stamps head.modified with the
 * current time whatever head.created was given. An italic leans its text
 * cursor to follow the letters, which opentype.js always writes upright.
 */
function finishHeaderTables(
  input: Uint8Array,
  link: { bold: boolean; italic: boolean },
  slant = 0,
  timestamp?: number
): Uint8Array {
  const macStyle = (link.bold ? 1 : 0) | (link.italic ? 2 : 0);
  let bytes = patchSfntTable(input, 'head', (head) => {
    head.setUint16(HEAD_MAC_STYLE, macStyle);
    if (timestamp !== undefined) {
      const stamp = BigInt(Math.round(timestamp) + MAC_EPOCH_OFFSET);
      head.setBigInt64(HEAD_CREATED, stamp);
      head.setBigInt64(HEAD_MODIFIED, stamp);
    }
  });
  if (slant) {
    bytes = patchSfntTable(bytes, 'hhea', (hhea) => {
      hhea.setInt16(HHEA_CARET_SLOPE_RISE, CARET_RISE);
      hhea.setInt16(
        HHEA_CARET_SLOPE_RUN,
        Math.round(CARET_RISE * slantFactor(slant))
      );
    });
  }
  return bytes;
}

/**
 * The .otf bytes a build ships: serialized, then completed with what
 * OpenType.js cannot emit — the CFF hints, the GPOS kerning table and the style
 * fields of head and hhea.
 */
export function buildFontBytes(
  definition: FontDefinition,
  config: FontConfig,
  options: BuildFontOptions = {}
): Uint8Array {
  const { font, hints, kerning, link } = buildFontWithHints(
    definition,
    config,
    options
  );
  const hinted = addHints(new Uint8Array(font.toArrayBuffer()), hints);
  return finishHeaderTables(
    addKerning(hinted, kerning),
    link,
    config.slant,
    options.createdTimestamp
  );
}

export async function downloadFont(
  definition: FontDefinition,
  config: FontConfig
) {
  const bytes = buildFontBytes(definition, config);

  // opentype.js v2 deprecated Font.download() (no platform-specific actions);
  // serialize to an ArrayBuffer and trigger the download ourselves. blob-utils
  // touches `document` at module load, so import it lazily — that keeps this
  // module importable in Node (the CLI imports buildFont from here).
  const { downloadBlob } = await import('./blob-utils');
  downloadBlob(fontFileName(config), bytes.slice().buffer, 'font/otf');
}
