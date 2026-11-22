// Horizontal spacing of the proportional family, in font units. Kept free of
// opentype.js and the DOM: the builder, the SVG exporter, the validator and the
// editor sidebar all import it. The monospace family ignores all three — its
// advance is fixed, so there is nothing for them to act on.

import type { FontConfig } from './types';

export type SpacingKey = 'spacing' | 'wordSpacing' | 'kerning';

/**
 * One pixel at the design size, where the 640-unit character box is drawn 8px
 * wide (25.6px type). The skeleton lives on half grid columns, two of these
 * apart, and a Regular stem is two wide — so text whose spacing is counted in
 * whole pixels puts every vertical edge on a device pixel, at that size and at
 * its multiples. All spacing is therefore a multiple of this.
 */
export const PIXEL = 80;

/**
 * Whitespace between two flat-sided letters such as "HH": six pixels.
 */
export const DEFAULT_SPACING = 6 * PIXEL;

/** What a source may ask for; every stop is a whole number of pixels. */
export const SPACING_RANGES: Record<
  SpacingKey,
  { min: number; max: number; step: number }
> = {
  spacing: { min: 2 * PIXEL, max: 10 * PIXEL, step: PIXEL },
  wordSpacing: { min: 2 * PIXEL, max: 20 * PIXEL, step: PIXEL },
  kerning: { min: 0, max: 4 * PIXEL, step: PIXEL },
};

export function isValidSpacing(key: SpacingKey, value: unknown): value is number {
  const { min, max, step } = SPACING_RANGES[key];
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    value % step === 0
  );
}

/**
 * The spacing a config builds with. Anything the source leaves out follows the
 * letter gap:
 *
 * - The space glyph advances about one and a half letter gaps. Ink-to-ink
 *   across a word boundary is that plus one more gap, since each neighbour
 *   contributes half a bearing, which holds the word gap near two and a half
 *   times the letter gap. Tuning the two independently had drifted it out to
 *   six times, which read as cramped letters rather than as generous words.
 * - A kerning pair closes one pixel. The measurement happily asks for far more
 *   on open pairs such as "Ta", but Brutalita's stems are light and wide-set,
 *   and closing more than this reads as a typo rather than as even colour.
 *   Zero turns pair kerning off.
 */
export function resolveSpacing(
  config: Pick<FontConfig, SpacingKey>
): Record<SpacingKey, number> {
  const spacing = config.spacing ?? DEFAULT_SPACING;
  return {
    spacing,
    wordSpacing:
      config.wordSpacing ?? Math.round((spacing * 1.5) / PIXEL) * PIXEL,
    kerning: config.kerning ?? PIXEL,
  };
}

/**
 * How a letter gap is split around a glyph. The left side takes whole pixels
 * so the ink starts on one; an odd gap leaves its spare pixel on the right.
 */
export function sideBearings(spacing: number): { left: number; right: number } {
  const left = Math.floor(spacing / 2 / PIXEL) * PIXEL;
  return { left, right: spacing - left };
}
