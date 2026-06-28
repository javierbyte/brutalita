import { SEGMENTS } from './types';
import type { FontDefinition, FontWeightType } from './types';

// Render brutalita text to a single, self-contained SVG of single-line strokes —
// the same look as the editor preview (src/components/key.tsx + .key/.type in
// src/style.css), not the filled outlines used for the .otf export.

// Editor glyph scale: a 16px cell. WIDTH/HEIGHT and the coord mapping mirror
// `Key` exactly (cx = round(x * WIDTH / SEGMENTS[0]), cy = round(y * HEIGHT / SEGMENTS[1])).
const EDITOR_FONT_SIZE = 16;
const WIDTH = 0.5 * EDITOR_FONT_SIZE;
const HEIGHT = 1 * EDITOR_FONT_SIZE;

// Editor text layout (monospaced preview): each glyph cell is 10px wide with a
// 4px right margin (=> 14px advance), and the line-height is 30px.
const ADVANCE = 14;
const LINE_HEIGHT = 30;

// Stroke width per weight — matches `weightToStrokeWidth` in src/app.tsx.
const STROKE_WIDTH_BY_WEIGHT: Record<FontWeightType, number> = {
  300: 1.5,
  400: 2,
  700: 2.5,
};

// Horizontal metrics from the .otf build (src/font-maker.ts), reused for the
// proportional (non-mono) layout. In this editor space one glyph cell (SCALE_X
// font units) spans WIDTH px, so FONT_UNITS_PER_PX converts those .otf metrics
// to px. Keep these in sync with font-maker if its metrics change.
const UNITS_PER_EM = 2048;
const SCALE_X = 640;
const KERNING = 256;
const FONT_UNITS_PER_PX = SCALE_X / WIDTH; // 640 / 8 = 80
const KERN_PX = KERNING / FONT_UNITS_PER_PX; // 3.2px gap between proportional glyphs

// Stroke weight as a fraction of the em — mirrors WEIGHTS in src/font-maker.ts,
// used to derive the proportional space advance.
const WEIGHT_FRACTION: Record<FontWeightType, number> = {
  300: 0.15,
  400: 0.25,
  700: 0.3,
};

export type SvgExportOptions = {
  padding?: number;
  color?: string;
  /** Overrides the weight-derived stroke width. */
  strokeWidth?: number;
  /** Used to derive the default stroke width when `strokeWidth` is omitted. */
  weight?: FontWeightType;
  /**
   * Fixed pitch (default) or proportional spacing. When `false`, glyphs advance
   * by their inked width plus a kerning gap, matching the non-mono .otf build.
   */
  monospace?: boolean;
};

export type SvgExportResult = {
  svg: string;
  /** Distinct characters in the text that the font has no glyph for. */
  missing: string[];
};

function mapX(x: number): number {
  return Math.round((x * WIDTH) / SEGMENTS[0]);
}
function mapY(y: number): number {
  return Math.round((y * HEIGHT) / SEGMENTS[1]);
}

// Compact number: round to 3 decimals and drop trailing zeros.
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function renderTextToSVG(
  definition: FontDefinition,
  text: string,
  options: SvgExportOptions = {}
): SvgExportResult {
  const padding = options.padding ?? 16;
  const color = options.color ?? '#fff';
  const weight = options.weight ?? 400;
  const monospace = options.monospace ?? true;
  const strokeWidth = options.strokeWidth ?? STROKE_WIDTH_BY_WEIGHT[weight];
  const dotRadius = strokeWidth * 0.75;

  // Reserve room for the stroke half-width / dot radius so round caps never clip,
  // and so proportional side bearings sit beside the visible ink, not the path.
  const inkPad = Math.max(strokeWidth / 2, dotRadius);

  // Proportional layout (mono === false): each glyph advances by its inked width
  // plus a kerning gap, with half the gap as the left side bearing, and the space
  // glyph is 0.8 × the monospace advance — all mirroring src/font-maker.ts.
  const monoAdvancePx =
    (UNITS_PER_EM -
      SCALE_X -
      KERNING +
      (WEIGHT_FRACTION[weight] / 4) * UNITS_PER_EM) /
    FONT_UNITS_PER_PX;
  const spaceAdvance = monoAdvancePx * 0.8;

  // Strokes (>=2 points) become path subpaths; single-point layers become dots.
  const strokeRuns: string[] = [];
  const dots: [number, number][] = [];
  const missingSet = new Set<string>();

  // Bounding box over all drawn points, so we can fit the canvas tightly.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const track = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const lines = text.split('\n');
  lines.forEach((line, lineIdx) => {
    const originY = lineIdx * LINE_HEIGHT;
    let penX = 0; // running x origin for proportional layout

    [...line].forEach((char, colIdx) => {
      const layers = definition[char];

      // Map this glyph's layers to local px (origin at x = 0) and measure its ink
      // span, so proportional layout can advance by the glyph's real width.
      let glyphMinX = Infinity;
      let glyphMaxX = -Infinity;
      const localLayers: [number, number][][] = [];
      if (layers) {
        for (const layer of layers) {
          if (!layer.length) continue;
          const pts = layer.map(([x, y]): [number, number] => {
            const px = mapX(x);
            if (px < glyphMinX) glyphMinX = px;
            if (px > glyphMaxX) glyphMaxX = px;
            return [px, mapY(y)];
          });
          localLayers.push(pts);
        }
      } else if (char !== ' ') {
        // Unknown glyph: advance the cell but draw nothing (' ' is expected blank).
        missingSet.add(char);
      }

      // Resolve the cell's x origin: fixed pitch, or proportional (left side
      // bearing + ink + kerning). Blank/unknown glyphs advance by a space.
      let originX: number;
      if (monospace) {
        originX = colIdx * ADVANCE;
      } else if (Number.isFinite(glyphMinX)) {
        originX = penX + KERN_PX / 2 - (glyphMinX - inkPad);
        penX += glyphMaxX - glyphMinX + 2 * inkPad + KERN_PX;
      } else {
        penX += spaceAdvance;
        return;
      }

      for (const pts of localLayers) {
        const points = pts.map(([px, py]): [number, number] => {
          const gx = originX + px;
          const gy = originY + py;
          track(gx, gy);
          return [gx, gy];
        });

        if (points.length === 1) {
          dots.push(points[0]);
        } else {
          const [first, ...rest] = points;
          const d = `M ${num(first[0])},${num(first[1])} L ${rest
            .map(([x, y]) => `${num(x)},${num(y)}`)
            .join(' ')}`;
          strokeRuns.push(d);
        }
      }
    });
  });

  let viewX: number;
  let viewY: number;
  let viewW: number;
  let viewH: number;
  if (Number.isFinite(minX)) {
    viewX = minX - inkPad - padding;
    viewY = minY - inkPad - padding;
    viewW = maxX - minX + 2 * (inkPad + padding);
    viewH = maxY - minY + 2 * (inkPad + padding);
  } else {
    // Empty / all-blank text: just an empty padded canvas.
    viewX = 0;
    viewY = 0;
    viewW = 2 * padding;
    viewH = 2 * padding;
  }

  const body: string[] = [];
  if (strokeRuns.length) {
    body.push(`    <path d="${strokeRuns.join(' ')}" />`);
  }
  for (const [cx, cy] of dots) {
    body.push(
      `    <circle cx="${num(cx)}" cy="${num(cy)}" r="${num(
        dotRadius
      )}" fill="${color}" stroke="none" />`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(
    viewW
  )}" height="${num(viewH)}" viewBox="${num(viewX)} ${num(viewY)} ${num(
    viewW
  )} ${num(viewH)}">
  <g fill="none" stroke="${color}" stroke-width="${num(
    strokeWidth
  )}" stroke-linecap="round" stroke-linejoin="round">
${body.join('\n')}
  </g>
</svg>
`;

  return { svg, missing: [...missingSet] };
}
