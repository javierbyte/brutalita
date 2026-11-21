import type { CharLayer, CharLayers } from './types';

// The edits the glyph canvas makes to a glyph's strokes. Kept apart from the
// component so the rules — what a drag moves, what a tap draws, what is left
// when a point goes — can be tested without a pointer.

export type Point = [number, number];

export const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/** A stroke without points that repeat the one before them. */
function tidyStroke(stroke: CharLayer): CharLayer {
  return stroke.filter((point, i) => !i || !samePoint(point, stroke[i - 1]));
}

/**
 * The strokes with one of them replaced. Only the edited stroke is tidied, so
 * the rest of the glyph is handed back exactly as it came in, and a stroke
 * left without points is dropped rather than kept as an empty layer.
 */
export function replaceStroke(
  strokes: CharLayers,
  index: number,
  stroke: CharLayer
): CharLayers {
  const tidy = tidyStroke(stroke);
  return tidy.length
    ? strokes.map((existing, i) => (i === index ? tidy : existing))
    : strokes.filter((_, i) => i !== index);
}

/**
 * Every point of a stroke that sits on `at`. A closed stroke starts and ends
 * on the same point and a figure such as "8" crosses itself on one; they are
 * grabbed together, so moving the spot keeps the stroke joined there.
 */
export function pointsAt(stroke: CharLayer, at: Point): number[] {
  return stroke.flatMap((point, i) => (samePoint(point, at) ? [i] : []));
}

/**
 * Move the given points of one stroke to `to`, or remove them when `to` is
 * null. Landing on a neighbour merges with it.
 */
export function movePoints(
  strokes: CharLayers,
  stroke: number,
  indices: number[],
  to: Point | null
): CharLayers {
  const points = strokes[stroke];
  const edited =
    to === null
      ? points.filter((_, i) => !indices.includes(i))
      : points.map((point, i) => (indices.includes(i) ? to : point));
  return replaceStroke(strokes, stroke, edited);
}

/** The strokes with a new point put into one of them, before `index`. */
export function insertPoint(
  strokes: CharLayers,
  stroke: number,
  index: number,
  point: Point
): CharLayers {
  return strokes.map((existing, i) =>
    i === stroke
      ? [...existing.slice(0, index), point, ...existing.slice(index)]
      : existing
  );
}

/**
 * The segment of a stroke that passes closest to `p`: how far away it is, and
 * the index a point dropped onto it would take.
 */
export function nearestSegment(
  stroke: CharLayer,
  p: Point
): { index: number; distance: number } | null {
  let best: { index: number; distance: number } | null = null;
  for (let i = 1; i < stroke.length; i++) {
    const [ax, ay] = stroke[i - 1];
    const [bx, by] = stroke[i];
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / length))
      : 0;
    const distance = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
    if (!best || distance < best.distance) best = { index: i, distance };
  }
  return best;
}

export function sameStrokes(a: CharLayers, b: CharLayers): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
