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

export type SvgExportOptions = {
  padding?: number;
  color?: string;
  /** Overrides the weight-derived stroke width. */
  strokeWidth?: number;
  /** Used to derive the default stroke width when `strokeWidth` is omitted. */
  weight?: FontWeightType;
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
  const strokeWidth =
    options.strokeWidth ?? STROKE_WIDTH_BY_WEIGHT[options.weight ?? 400];
  const dotRadius = strokeWidth * 0.75;

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
    [...line].forEach((char, colIdx) => {
      const originX = colIdx * ADVANCE;
      const layers = definition[char];

      if (!layers) {
        // Unknown glyph: advance the cell but draw nothing (' ' is expected blank).
        if (char !== ' ') missingSet.add(char);
        return;
      }

      for (const layer of layers) {
        if (!layer.length) continue;

        const points = layer.map(([x, y]): [number, number] => {
          const px = originX + mapX(x);
          const py = originY + mapY(y);
          track(px, py);
          return [px, py];
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

  // Reserve room for the stroke half-width / dot radius so round caps never clip.
  const inkPad = Math.max(strokeWidth / 2, dotRadius);

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
