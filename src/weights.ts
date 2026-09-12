// Everything the codebase knows about a font weight. A weight is a number and a
// stroke thickness — nothing else — so a new one is data here, not code
// elsewhere. Kept free of opentype.js and the DOM: the browser editor, the SVG
// exporter, the validator and the CLI all import it.

import type { FontWeightType } from './types';

/** OS/2 usWeightClass is a uint16 the spec restricts to 1..1000. */
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 1000;

/**
 * The original SVG stroke widths are the design reference: Light 1.5px,
 * Regular 2px, Bold 2.5px on an 8×16px skeleton. Additional weights extend
 * that range without changing these anchors. Both exporters use this table.
 */
const STOPS = [
  { weight: 100, editorStroke: 0.5 },
  { weight: 200, editorStroke: 1 },
  { weight: 300, editorStroke: 1.5 },
  { weight: 400, editorStroke: 2 },
  { weight: 700, editorStroke: 2.5 },
  { weight: 800, editorStroke: 2.65 },
  { weight: 900, editorStroke: 2.8 },
] as const;

/** Stroke width in pixels of the original 8×16 SVG design. */
export function editorStrokeWidth(weight: FontWeightType): number {
  const first = STOPS[0];
  const last = STOPS[STOPS.length - 1];
  if (weight <= first.weight) return first.editorStroke;
  if (weight >= last.weight) return last.editorStroke;

  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1];
    const b = STOPS[i];
    if (weight > b.weight) continue;
    const t = (weight - a.weight) / (b.weight - a.weight);
    return a.editorStroke * (1 - t) + b.editorStroke * t;
  }
  return last.editorStroke;
}

/** Stroke width relative to the 8px-wide SVG skeleton. */
export function strokeFraction(weight: FontWeightType): number {
  return editorStrokeWidth(weight) / 8;
}

const STANDARD_STYLE_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

/**
 * The subfamily name a config builds under, used for the OpenType name table
 * and the default filename. A weight without a standard name is named after
 * itself ("Brutalita-550.otf") so two weights can never collide.
 */
export function styleName(config: {
  weight: FontWeightType;
  styleName?: string;
}): string {
  const override = config.styleName?.trim();
  if (override) return override;
  return STANDARD_STYLE_NAMES[config.weight] ?? String(config.weight);
}

/**
 * Coerce a user-supplied weight — a number, or the string form of one — to an
 * integer in range. Returns null when it is not a weight at all, leaving the
 * caller to decide between a warning, a fallback and an error.
 */
export function parseWeight(value: unknown): FontWeightType | null {
  const weight = Math.round(Number(value));
  if (!Number.isFinite(weight)) return null;
  if (weight < MIN_WEIGHT || weight > MAX_WEIGHT) return null;
  return weight;
}

/**
 * The weights brutalita.com publishes and the editor offers, and what
 * `brutalita build --weight all` expands to. Any other weight still builds —
 * this list is what ships, not what is allowed.
 */
export const SHIPPED_WEIGHTS: FontWeightType[] = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
];
