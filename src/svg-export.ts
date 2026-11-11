import { SCALE_X, fontLayout, stemWidth } from './font-maker';
import { kerningMap, pairKey } from './kerning';
import { anchorEnds, cornerOptions, sharpPath, strokePath } from './corners';
import type { CornerStyle, StrokeStyle } from './corners';
import { SEGMENTS } from './types';
import type { FontDefinition, FontWeightType } from './types';
import { editorStrokeWidth } from './weights';
import { slantFactor } from './slant';

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

// The proportional (non-mono) layout is the .otf build's own: advances, the
// position of each skeleton inside its advance, and kerning all come from
// fontLayout (src/font-maker.ts), so a line set here is exactly as wide as the
// same line set in the font. In this editor space one glyph cell (SCALE_X font
// units) spans WIDTH px, so FONT_UNITS_PER_PX converts those metrics to px.
const FONT_UNITS_PER_PX = SCALE_X / WIDTH; // 640 / 8 = 80

export type SvgExportOptions = {
  padding?: number;
  color?: string;
  /** Overrides the weight-derived stroke width. */
  strokeWidth?: number;
  /** Used to derive the default stroke width when `strokeWidth` is omitted. */
  weight?: FontWeightType;
  /** Font aspect ratio used by the shared optical kerning calculation. */
  height?: number;
  /** Pen, corner style and curve size, matching the font configuration. */
  stroke?: StrokeStyle;
  corners?: CornerStyle;
  cornerRadius?: number;
  /** Rightward italic angle in degrees, matching the font configuration. */
  slant?: number;
  /**
   * Fixed pitch (default) or proportional spacing. When `false`, glyphs are
   * spaced and kerned exactly as the proportional font built from the same
   * options would be.
   */
  monospace?: boolean;
  /**
   * Proportional spacing in font units, matching the font configuration:
   * letter gap, space advance, and the most a kerning pair may close.
   */
  spacing?: number;
  wordSpacing?: number;
  kerning?: number;
  /**
   * Paint a rect of this colour behind the text, covering the whole viewBox.
   * Default: no background, so the SVG stays transparent.
   */
  background?: string;
  /**
   * Scale the rendered size to this pixel width. The viewBox is unchanged, so
   * this only affects how large the SVG draws by default.
   */
  width?: number;
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
  const height = options.height ?? 2;
  const monospace = options.monospace ?? true;
  const strokeWidth = options.strokeWidth ?? editorStrokeWidth(weight);
  const dotRadius = strokeWidth * 0.75;
  const shear = slantFactor(options.slant);
  const curves = cornerOptions(options, HEIGHT / SEGMENTS[1]);
  const sharp = options.stroke === 'sharp';

  // Reserve room for the stroke half-width / dot radius so round caps never clip,
  // and so proportional side bearings sit beside the visible ink, not the path.
  const inkPad = Math.max(strokeWidth / 2, dotRadius);
  const horizontalInkPad = inkPad * (1 + Math.abs(shear));

  // Only the characters being set: kerning is measured between every pair of
  // glyphs it is given, and a line of text uses a fraction of the font.
  const layout = monospace
    ? undefined
    : fontLayout(
        Object.fromEntries(
          [...new Set(text)]
            .filter((char) => definition[char])
            .map((char) => [char, definition[char]])
        ),
        {
          weight,
          height,
          monospace,
          stroke: options.stroke,
          corners: options.corners,
          cornerRadius: options.cornerRadius,
          slant: options.slant,
          spacing: options.spacing,
          wordSpacing: options.wordSpacing,
          kerning: options.kerning,
        }
      );
  const kern = kerningMap(layout?.kerning ?? []);
  // The font spaces glyphs by the stroke its weight draws. A stroke-width
  // override is drawn around the same skeleton, so let it push the glyphs
  // apart by as much as it thickens them and the whitespace between two
  // letters stays what the spacing asked for.
  const strokeGrowth =
    options.strokeWidth === undefined
      ? 0
      : strokeWidth - stemWidth(weight) / FONT_UNITS_PER_PX;

  // Strokes (>=2 points) become path subpaths; single-point layers become dots.
  const strokeRuns: string[] = [];
  const dots: [number, number][] = [];
  const slantedLines: string[] = [];
  const renderBody = () => {
    const body: string[] = [];
    if (strokeRuns.length) {
      body.push(sharp
        ? `    <path d="${strokeRuns.join(' ')}" fill="${color}" stroke="none" />`
        : `    <path d="${strokeRuns.join(' ')}" />`);
    }
    for (const [cx, cy] of dots) {
      body.push(`    <circle cx="${num(cx)}" cy="${num(cy)}" r="${num(dotRadius)}" fill="${color}" stroke="none" />`);
    }
    return body.join('\n');
  };
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
    let previous = '';

    [...line].forEach((char, colIdx) => {
      const layers = definition[char];

      // Map this glyph's layers to local px (origin at grid column 0).
      const localLayers: [number, number][][] = [];
      if (layers) {
        for (const layer of layers) {
          if (!layer.length) continue;
          localLayers.push(
            layer.map(([x, y]): [number, number] => [mapX(x), mapY(y)])
          );
        }
      } else if (char !== ' ') {
        // Unknown glyph: advance the cell but draw nothing (' ' is expected blank).
        missingSet.add(char);
      }

      // Resolve the cell's x origin: fixed pitch, or the font's own advance,
      // skeleton position and kerning. Blank/unknown glyphs advance by a space.
      let originX: number;
      if (!layout) {
        originX = colIdx * ADVANCE;
      } else {
        const metrics = layout.glyphs.get(char);
        if (!metrics) {
          penX += layout.spaceAdvance / FONT_UNITS_PER_PX;
          previous = char;
          return;
        }
        penX += (kern.get(pairKey(previous, char)) ?? 0) / FONT_UNITS_PER_PX;
        originX =
          penX + metrics.skeletonOrigin / FONT_UNITS_PER_PX + strokeGrowth / 2;
        penX += metrics.advance / FONT_UNITS_PER_PX + strokeGrowth;
      }
      previous = char;

      const outline: [number, number][][] = [];
      for (const pts of curves && !sharp ? anchorEnds(localLayers, curves) : localLayers) {
        const points = pts.map(([px, py]): [number, number] => {
          const gx = originX + px;
          const gy = originY + py;
          track(gx + shear * (HEIGHT - py), gy);
          return [gx, gy];
        });

        if (sharp) {
          outline.push(points);
        } else if (points.length === 1) {
          dots.push(points[0]);
        } else {
          const [first, ...rest] = points;
          const d = `M ${num(first[0])},${num(first[1])} L ${rest
            .map(([x, y]) => `${num(x)},${num(y)}`)
            .join(' ')}`;
          strokeRuns.push(curves ? strokePath(points, curves) : d);
        }
      }
      if (outline.length) strokeRuns.push(sharpPath(outline, strokeWidth / 2, curves));
    });
    if (shear) {
      const body = renderBody();
      if (body) {
        slantedLines.push(`    <g transform="matrix(1 0 ${-shear} 1 ${shear * (originY + HEIGHT)} 0)">\n${body}\n    </g>`);
      }
      strokeRuns.length = 0;
      dots.length = 0;
    }
  });

  let viewX: number;
  let viewY: number;
  let viewW: number;
  let viewH: number;
  if (Number.isFinite(minX)) {
    viewX = minX - horizontalInkPad - padding;
    viewY = minY - inkPad - padding;
    viewW = maxX - minX + 2 * (horizontalInkPad + padding);
    viewH = maxY - minY + 2 * (inkPad + padding);
  } else {
    // Empty / all-blank text: just an empty padded canvas.
    viewX = 0;
    viewY = 0;
    viewW = 2 * padding;
    viewH = 2 * padding;
  }

  // The canvas fits the ink tightly; `width` scales the drawn size without
  // touching the viewBox, and `background` fills that same box.
  const scale = options.width ? options.width / viewW : 1;
  const renderedW = options.width ? String(Math.round(viewW * scale)) : num(viewW);
  const renderedH = options.width ? String(Math.round(viewH * scale)) : num(viewH);

  const body = shear ? slantedLines.join('\n') : renderBody();

  const backgroundRect = options.background
    ? `\n  <rect x="${num(viewX)}" y="${num(viewY)}" width="${num(
        viewW
      )}" height="${num(viewH)}" fill="${options.background}" />`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${renderedW}" height="${renderedH}" viewBox="${num(
    viewX
  )} ${num(viewY)} ${num(viewW)} ${num(viewH)}">${backgroundRect}
  <g fill="none" stroke="${color}" stroke-width="${num(
    strokeWidth
  )}" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;

  return { svg, missing: [...missingSet] };
}
