// Optical kerning calculation. This module deliberately knows nothing about
// OpenType, the editor, or Brutalita's source grid: callers provide filled
// outline contours and receive sparse pair adjustments in the same units.

export type KerningPoint = readonly [number, number];

export type KerningGlyph<Key = number> = {
  key: Key;
  advanceWidth: number;
  contours: readonly (readonly KerningPoint[])[];
};

export type KerningPair<Key = number> = {
  left: Key;
  right: Key;
  /** Added to the left glyph's horizontal advance; normally negative. */
  value: number;
};

export type KerningOptions<Key = number> = {
  /** Optical whitespace represented by two straight facing sides. */
  targetGap: number;
  /** Distance between horizontal outline samples. */
  sampleStep?: number;
  /** Smallest permitted whitespace anywhere the two glyphs overlap. */
  minimumClearance?: number;
  /** Round adjustments to this many font units. */
  quantization?: number;
  /** Omit adjustments smaller than this. */
  minimumAdjustment?: number;
  /** Hard limit on how far a pair may be pulled together. */
  maximumReduction?: number;
  /** Restrict calculation to pairs meaningful for the caller's script. */
  includePair?: (left: Key, right: Key) => boolean;
};

type Profile = { left: number; right: number } | undefined;

function bounds(contours: KerningGlyph['contours']) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const [, y] of contour) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minY, maxY };
}

/** Extreme filled-outline intersections with a horizontal scanline. */
function profileAt(contours: KerningGlyph['contours'], y: number): Profile {
  let left = Infinity;
  let right = -Infinity;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      // Half-open crossing avoids counting a vertex twice. Horizontal edges
      // are represented by the samples immediately above and below them.
      if (!((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))) continue;
      const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return Number.isFinite(left) ? { left, right } : undefined;
}

function percentile(values: number[], position: number): number {
  values.sort((a, b) => a - b);
  const index = (values.length - 1) * position;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return values[lower] + (values[Math.min(lower + 1, values.length - 1)] - values[lower]) * fraction;
}

/**
 * Derive sparse, deterministic pair kerning from outline whitespace.
 *
 * The average scanline corridor is brought toward `targetGap`, while the
 * closest scanline and `maximumReduction` provide independent collision and
 * outlier limits. Equal vertical sides therefore produce no pair at all.
 */
export function calculateKerning<Key>(
  glyphs: readonly KerningGlyph<Key>[],
  options: KerningOptions<Key>
): KerningPair<Key>[] {
  const sampleStep = options.sampleStep ?? Math.max(8, options.targetGap / 8);
  const minimumClearance = options.minimumClearance ?? options.targetGap * 0.375;
  const quantization = options.quantization ?? 8;
  const minimumAdjustment = options.minimumAdjustment ?? quantization * 2;
  const maximumReduction = options.maximumReduction ?? options.targetGap * 0.75;

  const prepared = glyphs
    .filter((glyph) => glyph.contours.some((contour) => contour.length >= 3))
    .map((glyph) => {
      const { minY, maxY } = bounds(glyph.contours);
      const samples = new Map<number, Exclude<Profile, undefined>>();
      const first = Math.floor(minY / sampleStep) * sampleStep + sampleStep / 2;
      for (let y = first; y < maxY; y += sampleStep) {
        const profile = profileAt(glyph.contours, y);
        if (profile) samples.set(y, profile);
      }
      return { glyph, samples };
    });

  const pairs: KerningPair<Key>[] = [];
  for (const left of prepared) {
    for (const right of prepared) {
      if (options.includePair?.(left.glyph.key, right.glyph.key) === false) continue;
      const gaps: number[] = [];
      for (const [y, leftProfile] of left.samples) {
        const rightProfile = right.samples.get(y);
        if (!rightProfile) continue;
        gaps.push(
          left.glyph.advanceWidth + rightProfile.left - leftProfile.right
        );
      }
      if (gaps.length < 3) continue;

      // The lower quartile represents the part of the pair the eye reads as
      // its closest sustained corridor. A mean over-kerns shelves and bowls.
      const opticalGap = percentile(gaps, 0.25);
      const closestGap = Math.min(...gaps);
      const requested = options.targetGap - opticalGap;
      const safe = minimumClearance - closestGap;
      const value =
        Math.round(
          Math.max(requested, safe, -maximumReduction) / quantization
        ) * quantization;
      if (value <= -minimumAdjustment) {
        pairs.push({ left: left.glyph.key, right: right.glyph.key, value });
      }
    }
  }
  return pairs;
}

/** Fast lookup for text layout; the separator cannot collide with numeric IDs. */
export function kerningMap<Key extends string | number>(
  pairs: readonly KerningPair<Key>[]
): Map<string, number> {
  return new Map(pairs.map(({ left, right, value }) => [`${left}\0${right}`, value]));
}

export function pairKey(left: string | number, right: string | number): string {
  return `${left}\0${right}`;
}
