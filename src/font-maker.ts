// Namespace import, not default: opentype.js ships only named ESM exports, so
// a default import resolves through interop that the RSC bundler does not
// apply. This form works for the CLI, the browser bundle and Server Components.
import * as Opentype from 'opentype.js';
import polygonClipping from 'polygon-clipping';
import { addHints } from './cff-hint';
import type { FontHints, GlyphHints, StemHint } from './cff-hint';
import { MARK_ROWS } from './compose';
import { addKerning } from './gpos';
import { calculateKerning } from './kerning';
import type { KerningGlyph, KerningOptions, KerningPair } from './kerning';
import { FontConfig, FontDefinition, FontWeightType } from './types';
import { strokeFraction, styleName } from './weights';

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
 * Nominal whitespace between two flat-sided letters such as "HH". Every
 * proportional glyph carries half of it on each side.
 */
export const KERNING = 384;

/**
 * Advance of the space glyph. Ink-to-ink across a word boundary is this plus
 * KERNING, since each neighbour contributes half a bearing. Deriving it from
 * KERNING holds the word gap at two and a half times the letter gap; tuning
 * the two independently had drifted it out to six times, which read as
 * cramped letters rather than as generous words.
 */
const WORD_SPACE = Math.round(KERNING * 1.5);

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

/**
 * The single kerning configuration. The OTF's GPOS table and the SVG renderer
 * both lay text out from this, so they must never drift apart.
 */
const LATIN_KERNING_OPTIONS: Omit<KerningOptions<string>, 'includePair'> & {
  includePair: (left: string, right: string) => boolean;
} = {
  targetGap: KERNING,
  sampleStep: 32,
  minimumClearance: 96,
  quantization: 8,
  minimumAdjustment: 32,
  // Cap a pair at a quarter of the nominal gap. The measurement happily asks
  // for far more on open pairs such as "Ta", but Brutalita's stems are light
  // and wide-set, and closing more than this reads as a typo rather than as
  // even colour.
  maximumReduction: KERNING / 4,
  includePair: includeLatinKerningPair,
};

/**
 * Only round enough to serialize integral CFF coordinates. An even stem keeps
 * its half-width integral; the maximum deviation from the SVG is 1/80px.
 * Preserve the design scale and spacing. Hints may help the rasterizer, but
 * the outlines themselves are not quantized to a screen-pixel grid.
 */
export const STEM_QUANTUM = 2;

export function stemWidth(weight: FontWeightType): number {
  return Math.round((strokeFraction(weight) * SCALE_X) / STEM_QUANTUM) * STEM_QUANTUM;
}

/** The SVG editor uses a fixed 14px advance on its 8px-wide skeleton. */
export function monospaceAdvance(_weight: FontWeightType): number {
  return (SCALE_X / 8) * 14;
}

type GeometryConfig = Pick<FontConfig, 'weight' | 'height' | 'monospace'>;

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
 * the leftmost edge on KERNING / 2 and the baseline row's lower edge on 0.
 */
function gridToUnits(x: number, y: number, metrics: Metrics): [number, number] {
  return [
    (x * SCALE_X) / CHAR_X + KERNING / 2 + metrics.halfStem,
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
    get() {
      return [multiPolygon];
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
      rawContours.push(contour);
      for (const [x] of contour) {
        globalMinX = Math.min(globalMinX, x);
        globalMaxX = Math.max(globalMaxX, x);
      }
    }
  }

  // Every proportional glyph keeps the same nominal bearing on both sides.
  // Brutalita is drawn almost entirely from vertical stems, so per-glyph
  // optical bearings had no true diagonal to act on and only tightened the
  // shelved letters (T, I, L, F). Optical spacing is pair kerning's job.
  const sideBearings = config.monospace
    ? { left: 0, right: 0 }
    : { left: KERNING / 2, right: KERNING / 2 };
  const remainingSpaceTranslation =
    !config.monospace && Number.isFinite(globalMinX)
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
        const px = x + remainingSpaceTranslation;
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
      ? WORD_SPACE
      : baseDynamicSpacing + sideBearings.left + sideBearings.right;

  const tmpGlyph = new Opentype.Glyph({
    name: char,
    unicode: char.charCodeAt(0),
    advanceWidth: finalSpacing,
    path: tmpPath,
  });

  // Vertical stems move with the glyph's left side bearing; horizontal ones do
  // not, since the translation is horizontal only.
  const hints: GlyphHints = {
    h: hHints,
    v: vHints.map(({ edge, width }) => ({
      edge: edge + remainingSpaceTranslation,
      width,
    })),
  };

  return {
    char,
    glyph: tmpGlyph,
    hints,
    contours,
    leftSideBearing: xs.length ? sideBearings.left : 0,
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
  const glyphs: KerningGlyph<string>[] = Object.keys(definition).map((char) => {
    const built = makeGlyph(char, definition[char], config);
    return {
      key: char,
      advanceWidth: built.glyph.advanceWidth ?? 0,
      contours: built.contours,
    };
  });
  return calculateKerning(glyphs, LATIN_KERNING_OPTIONS);
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
    kerning: KERNING,
    scaleX: SCALE_X,
    /** Baseline to cap height. */
    capHeight: metrics.cap,
    /** Distance between skeleton rows; ink cap height also includes the stem. */
    row: metrics.row,
    /** Stroke width in font units, always a multiple of STEM_QUANTUM. */
    stem: metrics.stem,
    monospaceAdvance: metrics.monospaceAdvance,
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
const FS_BOLD = 32;
const FS_REGULAR = 64;
const FS_USE_TYPO_METRICS = 128;

export type BuildFontOptions = {
  /**
   * Unix seconds written to head.created. opentype.js defaults it to "now";
   * pinning it is half of a reproducible build (see src/otf-deterministic.ts,
   * which also pins head.modified).
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

  const font = new Opentype.Font({
    familyName: fontName(config),
    styleName: styleName(config),
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
    fsSelection: (config.weight >= 600 ? FS_BOLD : FS_REGULAR) | FS_USE_TYPO_METRICS,
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
  for (const platform of ['unicode', 'macintosh', 'windows'] as const) {
    delete (font.names as unknown as Record<string, Record<string, unknown>>)[
      platform
    ]?.trademark;
  }

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

  const calculatedPairs = config.monospace
    ? []
    : calculateKerning(
        built.map(
          (entry): KerningGlyph<string> => ({
            key: entry.char,
            advanceWidth: entry.glyph.advanceWidth ?? 0,
            contours: entry.contours,
          })
        ),
        LATIN_KERNING_OPTIONS
      );
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
  };
}

/**
 * The .otf bytes a build ships: serialized, then completed with the CFF hints
 * and GPOS kerning tables OpenType.js cannot emit.
 */
export function buildFontBytes(
  definition: FontDefinition,
  config: FontConfig,
  options: BuildFontOptions = {}
): Uint8Array {
  const { font, hints, kerning } = buildFontWithHints(definition, config, options);
  const hinted = addHints(new Uint8Array(font.toArrayBuffer()), hints);
  return addKerning(hinted, kerning);
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
  downloadBlob(fontFileName(config), bytes.slice().buffer);
}
