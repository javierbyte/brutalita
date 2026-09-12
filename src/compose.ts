import { SEGMENTS } from './types';
import type { CharLayers, Composite, MarkDefinition, MarkSet } from './types';

// Glyphs that are other glyphs rearranged: "á" is "a" with an acute over it,
// "¿" is "?" turned around. Writing their outlines out by hand would work once
// and then drift the first time "a" or "?" is redrawn, so the source names the
// relationship and this module resolves it. Node-safe and free of opentype.js:
// the validator resolves composites before anyone builds or renders them.

/**
 * Rows of clear space between the base letter's topmost stroke and the foot of
 * the mark above it. One row is the design's own minimum gap — it is the space
 * between "i" and its dot — and half a row closes up completely at Black,
 * where the stroke is as wide as the gap it would leave.
 */
export const MARK_CLEARANCE = 1;

/** Tallest a mark may be drawn. Anything more overflows the mark band. */
export const MARK_HEIGHT = 0.5;

/**
 * Rows the mark band adds above the cap line: the clearance plus the mark
 * itself, which is what a mark over a capital needs. A mark over a lowercase
 * letter sits a row lower, since it starts from the x-height.
 */
export const MARK_ROWS = MARK_CLEARANCE + MARK_HEIGHT;

export function isComposite(value: unknown): value is Composite {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Composite).base === 'string'
  );
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export function layerBounds(layers: CharLayers): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    for (const [x, y] of layer) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/** Design-grid coordinates move in half steps; keep placement on them. */
function snap(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * A mark translated onto a base: centred over the base's skeleton and lifted so
 * its foot clears the base's topmost point by MARK_CLEARANCE rows. Marks are
 * drawn with their foot on y = 0 rising into negative y, so over a lowercase
 * letter the acute lands on the cap line and over a capital a row above it.
 * Nothing here is glyph-specific — an accent that needs hand placement is a
 * sign the mark itself is drawn wrong.
 */
export function placeMark(base: CharLayers, mark: MarkDefinition): CharLayers {
  const baseBounds = layerBounds(base);
  const markBounds = layerBounds(mark);
  if (!baseBounds || !markBounds) return mark;

  const dy = baseBounds.minY - MARK_CLEARANCE - markBounds.maxY;
  const dx = snap(
    (baseBounds.minX + baseBounds.maxX) / 2 -
      (markBounds.minX + markBounds.maxX) / 2
  );

  return mark.map((layer) =>
    layer.map(([x, y]): [number, number] => [x + dx, y + dy])
  );
}

/**
 * A half turn within the cap box, which is what "¿" is to "?". Rotating around
 * the box rather than the glyph's own bounding box keeps the turned glyph on
 * the same rows as the one it came from.
 */
export function turnGlyph(layers: CharLayers): CharLayers {
  const [boxX, boxY] = SEGMENTS;
  return layers.map((layer) =>
    layer.map(([x, y]): [number, number] => [boxX - x, boxY - y])
  );
}

/** The layers a composite resolves to, given its base's resolved layers. */
export function composeGlyph(
  base: CharLayers,
  composite: Composite,
  marks: MarkSet
): CharLayers {
  const body = composite.rotate ? turnGlyph(base) : base;
  const mark = composite.mark === undefined ? undefined : marks[composite.mark];
  return mark ? [...body, ...placeMark(body, mark)] : body;
}
