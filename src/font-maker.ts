import polygonClipping from 'polygon-clipping';
import { glyphName, writeFont } from '../packages/otf-writer/src';
import type { FontHints, GlyphSource, Stem } from '../packages/otf-writer/src';
import { MARK_ROWS } from './compose';
import { anchorEnds, cornerOptions, flattenStroke, sharpGlyph, shoelace, strokeCommands, strokeOutline } from './corners';
import type { StrokeCommand } from './corners';
import { calculateKerning } from './kerning';
import type { KerningPair } from './kerning';
import { SEGMENTS } from './types';
import type { CharLayers, FontConfig, FontDefinition, FontWeightType } from './types';
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
const [CHAR_X, CHAR_Y] = SEGMENTS;

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
 * Pair adjustments for built glyphs; none for a monospace font. The OTF's GPOS
 * table and the SVG renderer both lay text out from this, so they cannot drift
 * apart.
 */
function latinKerning(
  glyphs: BuiltGlyph[],
  config: GeometryConfig
): KerningPair<string>[] {
  const { spacing, kerning } = resolveSpacing(config);
  // A cap below the smallest adjustment worth writing can produce no pair, so
  // skip measuring every combination just to discard them all.
  if (config.monospace || kerning < KERNING_MINIMUM_ADJUSTMENT) return [];
  return calculateKerning(
    glyphs.map(({ char, advance, contours }) => ({
      key: char,
      advanceWidth: advance,
      contours,
    })),
    {
      targetGap: spacing,
      sampleStep: 32,
      minimumClearance: 96,
      // Whole pixels, like every other advance: a pair that closed a fraction
      // of one would knock the rest of its line off the pixel grid.
      quantization: PIXEL,
      minimumAdjustment: KERNING_MINIMUM_ADJUSTMENT,
      maximumReduction: kerning,
      includePair: includeLatinKerningPair,
    }
  );
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
const MONOSPACE_ADVANCE = (SCALE_X / 8) * 14;

// Square font units. A period is some 40,000; a pixel at 16px is 3,900.
const SLIVER_AREA = 32;

/** The config fields that shape outlines and spacing; the rest only name it. */
export const GEOMETRY_KEYS = [
  'weight',
  'height',
  'monospace',
  'stroke',
  'corners',
  'cornerRadius',
  'slant',
  'spacing',
  'wordSpacing',
  'kerning',
] as const satisfies readonly (keyof FontConfig)[];

export type GeometryConfig = Pick<FontConfig, (typeof GEOMETRY_KEYS)[number]>;

/**
 * Half a grid column, the step every design-grid position is a multiple of
 * (see MONO_LATTICE_OFFSET). A Regular stem is exactly one.
 */
const LATTICE = 2 * PIXEL;

/** Up to the next lattice line. */
function toLattice(units: number): number {
  return Math.ceil(units / LATTICE) * LATTICE;
}

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
    // The line box bounds the supported grid at every weight, oversized dots
    // included; these are not ink heights. The mark band is part of that grid:
    // a line of accented capitals has to fit inside its own line box, as it
    // does in every other Latin font, so the ascender carries it even though
    // most text never reaches up there. Each edge is then taken out to the
    // lattice, so the line box is whole pixels wherever the letters are: the
    // shipped proportions give 2080 above the baseline and 480 below, and a
    // `line-height: normal` of exactly 1.25em.
    ascender: toLattice(
      row * (CHAR_Y + MARK_ROWS) + Math.ceil(stemWidth(900) * 1.25)
    ),
    descender: -toLattice(row + Math.ceil(stemWidth(900) * 0.25)),
    stem,
    halfStem,
    row,
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

type Point = [number, number];

/** Whether `p` sits strictly inside the segment a–b, on the design grid. */
function insideSegment(p: Point, a: Point, b: Point): boolean {
  const between = (axis: 0 | 1) =>
    Math.min(a[axis], b[axis]) < p[axis] && Math.max(a[axis], b[axis]) > p[axis];
  if (a[0] === b[0]) return p[0] === a[0] && between(1);
  const progress = (p[0] - a[0]) / (b[0] - a[0]);
  return progress * (b[1] - a[1]) === p[1] - a[1] && between(0);
}

/** A round join or dot, as the polygon the union can take. */
function circle([cx, cy]: Point, radius: number): Point[] {
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, i): Point => {
    const angle = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

/** The config fields that shape the ink itself; the rest only position it. */
const PEN_KEYS = [
  'weight',
  'height',
  'stroke',
  'corners',
  'cornerRadius',
] as const satisfies readonly (keyof GeometryConfig)[];

/** A glyph's ink where the design grid puts it, before spacing and slant. */
type Ink = {
  /** Closed rings on whole font units. */
  outline: Point[][];
  /** Stems for the CFF hints, by the axis they run along. */
  hStems: Stem[];
  vStems: Stem[];
  /**
   * The span of the stroke itself, a stem wide around every skeleton point;
   * none for a glyph with no points. Spacing is measured from this rather than
   * from the ink: a dot is drawn half a stem wider than its stroke, and a
   * curved corner sits inside the one it replaces, and neither may move the
   * skeleton off the lattice.
   */
  span?: [number, number];
};

function drawInk(
  layers: CharLayers,
  config: GeometryConfig,
  metrics: Metrics
): Ink {
  const { halfStem, stem } = metrics;
  const toUnits = ([x, y]: Point) => gridToUnits(x, y, metrics);
  const curves = cornerOptions(config, metrics.row);
  const sharp = config.stroke === 'sharp';

  // The editor keeps an empty layer ready for the next stroke.
  const strokes = layers.filter((layer) => layer.length);
  // Everything is drawn in font units, not grid units. The two axes are scaled
  // differently (SCALE_X across CHAR_X columns, `row` down the rows), so a pen
  // or a curve applied before the scale would come out elliptical.
  const drawn = strokes.map((layer) => layer.map(toUnits));

  // Rings whose union is the glyph's ink.
  const rings: Point[][] = [];

  // Stems for the CFF hints, taken from the skeleton rather than recovered from
  // the outline: a segment that is axis-aligned in the design grid is a stem,
  // and its width is the stroke. Diagonals and dots get none, which is correct —
  // there is nothing for a rasterizer to snap them to.
  const hStems: Stem[] = [];
  const vStems: Stem[] = [];
  const hintSegment = (a: Point, b: Point) => {
    if (a[0] === b[0]) vStems.push({ edge: a[0] - halfStem, width: stem });
    if (a[1] === b[1]) hStems.push({ edge: a[1] - halfStem, width: stem });
  };
  // Only the straight portions of a curved stroke, never its flattened bends.
  const hintStraights = (commands: StrokeCommand[]) => {
    let previous: Point | undefined;
    for (const command of commands) {
      if (command.type === 'Z') continue;
      if (command.type === 'L' && previous) hintSegment(previous, command.point);
      previous = command.point;
    }
  };

  // The strokes still to be drawn by the plain round pen further down.
  let plain = strokes;
  if (sharp) {
    for (const points of drawn) hintStraights(strokeCommands(points, curves));
    // One ring per curved stroke, here and for the round pen below: as separate
    // pieces its flattened bends are thousands of overlapping shapes and more
    // near-coincident edges than polygon-clipping's sweep line survives.
    const ring = (points: Point[]) =>
      strokeOutline(points, halfStem, CIRCLE_SEGMENTS, false);
    rings.push(...sharpGlyph(drawn, halfStem, curves, 0.5, ring));
    plain = [];
  } else if (curves) {
    const anchored = anchorEnds(drawn, curves);
    plain = strokes.filter((_, index) => {
      const points = anchored[index];
      const commands = strokeCommands(points, curves);
      // A straight stroke whose end moved onto a curve has left the grid too.
      if (points === drawn[index] && !commands.some((c) => c.type === 'C')) {
        return true;
      }
      hintStraights(commands);
      rings.push(
        strokeOutline(flattenStroke(points, curves), halfStem, CIRCLE_SEGMENTS)
      );
      return false;
    });
  }

  // The plain round pen: a rectangle along each segment…
  for (const layer of plain) {
    const points = layer.map(toUnits);
    points.slice(1).forEach((b, i) => {
      const a = points[i];
      hintSegment(a, b);
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2;
      const nx = halfStem * Math.cos(angle);
      const ny = halfStem * Math.sin(angle);
      rings.push([
        [a[0] - nx, a[1] - ny],
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
      ]);
    });
  }
  // …a circle on every end and join, unless the point is buried inside another
  // segment, and a larger circle for each dot, a layer of a single point.
  const joins = new Map<string, Point>();
  const dots = new Map<string, Point>();
  for (const layer of plain) {
    for (const point of layer) {
      const buried = () =>
        plain.some((other) =>
          other.slice(1).some((b, i) => insideSegment(point, other[i], b))
        );
      if (layer.length === 1) dots.set(point.join(','), point);
      else if (!buried()) joins.set(point.join(','), point);
    }
  }
  for (const point of joins.values()) rings.push(circle(toUnits(point), halfStem));
  for (const point of dots.values()) {
    rings.push(circle(toUnits(point), halfStem * 1.5));
  }

  // Corners are snapped to whole font units on the way in. polygon-clipping
  // 0.15 cannot reliably close a ring built from raw floats ("Unable to
  // complete output ring"), and integer input is what the sweep line needs to
  // agree with itself about which segments touch. Axis-aligned corners are
  // already integral here; this only bites on diagonals and circle vertices.
  const union = polygonClipping.union(
    rings.map((ring) => {
      const snapped = ring.map(([x, y]): Point => [Math.round(x), Math.round(y)]);
      return [[...snapped, snapped[0]]];
    })
  );

  // The union's intersection vertices are fractional however clean its inputs
  // were. Round them here rather than leave it to opentype.js on the way into
  // the charstring, which made the final outline a property of the serializer.
  const outline = union
    .flat()
    .map((ring) => ring.map(([x, y]): Point => [Math.round(x), Math.round(y)]))
    // Offset joins can leave microscopic rings where their intersections round
    // onto the same CFF coordinates, or where a curve grazes the stroke beside
    // it. They have no representable ink.
    .filter(
      (ring) =>
        !(curves || sharp) || Math.abs(shoelace(ring)) > 2 * SLIVER_AREA
    );

  const centres = drawn.flat().map(([x]) => x);
  return {
    outline,
    hStems,
    vStems,
    span: centres.length
      ? [Math.min(...centres) - halfStem, Math.max(...centres) + halfStem]
      : undefined,
  };
}

// The union is nine tenths of a build, and most rebuilds do not need it again:
// a stroke drawn in the editor changes one glyph, and slant, spacing and family
// only move ink that is already drawn. Layers are replaced, never mutated — by
// the validator and by the editor alike — so the array itself identifies a
// drawing, and the cache lives exactly as long as the drawing does.
const inkCache = new WeakMap<CharLayers, { pen: string; ink: Ink }>();

type BuiltGlyph = {
  char: string;
  advance: number;
  /** The outline as the font has it: positioned in its advance and slanted. */
  contours: Point[][];
  hints: NonNullable<GlyphSource['hints']>;
  /** Whether the glyph draws anything; a blank one advances like a space. */
  blank: boolean;
  /**
   * Where the stroke through grid column 0 is centred, from the glyph's
   * origin and before any slant: what a stroke renderer needs to put the
   * skeleton exactly where the outline has it.
   */
  skeletonOrigin: number;
};

/** Every glyph of a font, drawn and spaced. */
function buildGlyphs(
  definition: FontDefinition,
  config: GeometryConfig
): BuiltGlyph[] {
  const metrics = configToMetrics(config);
  const { halfStem } = metrics;
  const pen = PEN_KEYS.map((key) => config[key]).join();

  // Every proportional glyph keeps the same nominal bearing on both sides.
  // Brutalita is drawn almost entirely from vertical stems, so per-glyph
  // optical bearings had no true diagonal to act on and only tightened the
  // shelved letters (T, I, L, F). Optical spacing is pair kerning's job.
  const { spacing, wordSpacing } = resolveSpacing(config);
  const bearings = splitBearings(spacing);
  const shear = slantFactor(config.slant);

  return Object.keys(definition).map((char) => {
    const layers = definition[char];
    let cached = inkCache.get(layers);
    if (cached?.pen !== pen) {
      cached = { pen, ink: drawInk(layers, config, metrics) };
      inkCache.set(layers, cached);
    }
    const { outline, hStems, vStems, span } = cached.ink;
    const blank = outline.length === 0;

    const shift = config.monospace
      ? MONO_LATTICE_OFFSET
      : span
        ? bearings.left - span[0]
        : 0;

    const advance = config.monospace
      ? MONOSPACE_ADVANCE
      : char === ' ' || blank || !span
        ? wordSpacing
        : // To half a pixel, which is a whole device pixel on a 2x screen. The
          // weights whose stem is not a whole number of them (500, 600, 800,
          // 900) would otherwise push each following glyph off the lattice.
          // Regular's stem is two whole pixels, so it needs no rounding at all.
          Math.round(
            (span[1] - span[0] + bearings.left + bearings.right) / (PIXEL / 2)
          ) *
          (PIXEL / 2);

    return {
      char,
      advance,
      // Shear the finished outline about the skeleton's baseline, including
      // round caps and dots. Advances stay fixed as the angle changes.
      contours: outline.map((ring) =>
        ring.map(([x, y]): Point => [
          Math.round(x + shift + shear * (y - halfStem)),
          y,
        ])
      ),
      hints: {
        // Horizontal stems stay put: the glyph only ever moves sideways.
        h: hStems,
        // Vertical ones move with it, and a slanted stem is not vertical.
        v: config.slant
          ? []
          : vStems.map(({ edge, width }) => ({ edge: edge + shift, width })),
      },
      blank,
      skeletonOrigin: CELL_BEARING + halfStem + shift,
    };
  });
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
  const built = buildGlyphs(definition, config);
  return {
    glyphs: new Map(
      built
        .filter((glyph) => !glyph.blank)
        .map(({ char, advance, skeletonOrigin }) => [
          char,
          { advance, skeletonOrigin },
        ])
    ),
    spaceAdvance: config.monospace
      ? MONOSPACE_ADVANCE
      : resolveSpacing(config).wordSpacing,
    kerning: latinKerning(built, config),
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
    monospaceAdvance: MONOSPACE_ADVANCE,
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

export type BuildFontOptions = {
  /**
   * Unix seconds written to head.created and head.modified. Both default to
   * "now", so two builds of an unchanged source differ; pinning them makes the
   * bytes reproducible.
   */
  createdTimestamp?: number;
};

/**
 * Alignment zones and stem widths for the Private DICT. Brutalita's terminals
 * are flat and land exactly on their metric, so every zone is zero-width — no
 * overshoot to suppress — and being monoline there is a single stem width for
 * both axes.
 */
function privateHints(config: FontConfig): FontHints {
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
    // The outlines sit on exact integers, so a fuzz band would only let a
    // near-miss coordinate get captured by a zone it does not belong to.
    blueFuzz: 0,
  };
}

/**
 * The .otf bytes a build ships. Pure and Node-safe (no DOM), so the CLI and
 * the editor build the same file.
 */
export function buildFontBytes(
  definition: FontDefinition,
  config: FontConfig,
  options: BuildFontOptions = {}
): Uint8Array {
  const { ascender, descender, stem, cap, row } = configToMetrics(config);
  const built = buildGlyphs(definition, config);

  const designer = config.designer?.trim() || undefined;
  const designerURL = config.designerURL?.trim() || undefined;
  const family = fontName(config);
  const style = styleName(config);
  const link = styleLink(config);
  const xHeight = cap - row;
  const version = config.version?.trim() || '0.1';
  // As a number that keeps releases in order: 0.9.1 is 0.0901 and 0.10.0 is
  // 0.1, where reading "0.10" as a decimal would put it before 0.9.
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  const revision = major + minor / 100 + patch / 10000;

  return writeFont({
    unitsPerEm: UNITS_PER_EM,
    names: {
      family,
      style,
      // The four-style filing (see styleLink): "Brutalita Light" / "Regular".
      legacyFamily: `${family} ${link.familySuffix}`.trim(),
      legacyStyle: link.subfamily,
      postScriptName: `${family}${style}`.replace(/\s/g, ''),
      uniqueID: [designer, `${family} ${style}`].filter(Boolean).join(': '),
      // Sources written before `config.version` existed are version 0.1.
      version: `Version ${version}`,
      copyright: 'Copyright (c) 2021, Javier Bórquez',
      license: 'BSD 3-Clause License',
      licenseURL: 'https://github.com/javierbyte/brutalita/blob/master/LICENSE',
      manufacturer: designer,
      manufacturerURL: designerURL,
      designer,
      designerURL,
      description: 'An experimental geometric font.',
    },
    revision: Number.isFinite(revision) ? revision : undefined,
    weightClass: config.weight,
    // Bold only where the style is filed as one (see styleLink): a bit set on
    // every heavy weight makes them all claim to be the family's bold.
    bold: link.bold,
    italic: link.italic,
    italicAngle: -(config.slant ?? 0),
    monospace: config.monospace,
    ascender,
    descender,
    capHeight: cap,
    xHeight,
    // Both rules are a stem thick, as the letters are. The underline starts
    // half a row under the baseline, which is on the lattice at every weight;
    // the strikeout is centred on the x-height, where Regular puts both of
    // its edges on the lattice too.
    underline: { position: -row / 2, thickness: stem },
    strikeout: { position: Math.round((xHeight + stem) / 2), size: stem },
    // Half size, because half of the lattice is still pixels: a faked
    // superscript at 25.6px is the 12.8px rendering, strokes and all. It hangs
    // from the cap line, and a subscript drops half a row.
    superscript: { size: UNITS_PER_EM / 2, offset: Math.round(cap / 2) },
    subscript: { size: UNITS_PER_EM / 2, offset: row / 2 },
    panose: panose(config),
    vendorID: 'JVBY',
    created: options.createdTimestamp,
    glyphs: [
      { name: '.notdef', advance: MONOSPACE_ADVANCE },
      ...built.map(({ char, advance, contours, hints }) => ({
        unicode: char.codePointAt(0),
        advance,
        contours,
        hints,
      })),
    ],
    kerning: latinKerning(built, config).map(({ left, right, value }) => ({
      left: glyphName(left),
      right: glyphName(right),
      value,
    })),
    hints: privateHints(config),
  });
}

export async function downloadFont(
  definition: FontDefinition,
  config: FontConfig
) {
  const bytes = buildFontBytes(definition, config);

  // blob-utils touches `document` at module load, so import it lazily — that
  // keeps this module importable in Node (the CLI builds fonts from here).
  const { downloadBlob } = await import('./blob-utils');
  downloadBlob(fontFileName(config), bytes.slice().buffer, 'font/otf');
}
