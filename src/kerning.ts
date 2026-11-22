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

type Profile = { left: number; right: number };

/**
 * Extreme filled-outline intersections with each horizontal sample row, where
 * row `r` is the scanline at (r + 0.5) * sampleStep. Rows are shared by every
 * glyph, so two profiles compare by row index.
 */
function profilesOf(contours: KerningGlyph['contours'], sampleStep: number) {
  let firstRow = Infinity;
  for (const contour of contours) {
    for (const [, y] of contour) firstRow = Math.min(firstRow, y);
  }
  firstRow = Math.floor(firstRow / sampleStep);

  // Edge by edge rather than row by row: an edge only meets the few rows it
  // spans, and a round cap is dozens of edges that each span one or none.
  const rows: (Profile | undefined)[] = [];
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      const low = Math.min(a[1], b[1]);
      const high = Math.max(a[1], b[1]);
      // Half-open crossing avoids counting a vertex twice. Horizontal edges
      // are represented by the samples immediately above and below them.
      for (let row = Math.ceil(low / sampleStep - 0.5); ; row++) {
        const y = (row + 0.5) * sampleStep;
        if (y >= high) break;
        const x = a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        const profile = (rows[row - firstRow] ??= { left: x, right: x });
        profile.left = Math.min(profile.left, x);
        profile.right = Math.max(profile.right, x);
      }
    }
  }
  return { firstRow, rows };
}

/** A percentile of values already in ascending order. */
function percentile(values: Float64Array, position: number): number {
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
    .map((glyph) => ({ glyph, ...profilesOf(glyph.contours, sampleStep) }));

  // One buffer for every pair's gaps: sorting a typed array is several times
  // faster than a plain one, and this loop runs once per pair of glyphs.
  const buffer = new Float64Array(
    Math.max(0, ...prepared.map(({ rows }) => rows.length))
  );
  const pairs: KerningPair<Key>[] = [];
  for (const left of prepared) {
    for (const right of prepared) {
      if (options.includePair?.(left.glyph.key, right.glyph.key) === false) continue;
      let count = 0;
      const end = Math.min(
        left.firstRow + left.rows.length,
        right.firstRow + right.rows.length
      );
      for (let row = Math.max(left.firstRow, right.firstRow); row < end; row++) {
        const leftProfile = left.rows[row - left.firstRow];
        const rightProfile = right.rows[row - right.firstRow];
        if (!leftProfile || !rightProfile) continue;
        buffer[count++] =
          left.glyph.advanceWidth + rightProfile.left - leftProfile.right;
      }
      if (count < 3) continue;
      const gaps = buffer.subarray(0, count).sort();

      // The lower quartile represents the part of the pair the eye reads as
      // its closest sustained corridor. A mean over-kerns shelves and bowls.
      const opticalGap = percentile(gaps, 0.25);
      const closestGap = gaps[0];
      const requested = options.targetGap - opticalGap;
      const safe = minimumClearance - closestGap;
      // Round the request, then hold it to the limits: rounding the limited
      // value instead could step past the clearance by half a quantum, which
      // is real ink once the quantum is as coarse as a pixel.
      const limit =
        Math.ceil(Math.max(safe, -maximumReduction) / quantization) *
        quantization;
      const value = Math.max(
        Math.round(requested / quantization) * quantization,
        limit
      );
      if (value <= -minimumAdjustment) {
        pairs.push({ left: left.glyph.key, right: right.glyph.key, value });
      }
    }
  }
  return pairs;
}

/** Key of a pair in `kerningMap`; the separator cannot collide with numeric IDs. */
export function pairKey(left: string | number, right: string | number): string {
  return `${left}\0${right}`;
}

/** Fast lookup for text layout, by `pairKey`. */
export function kerningMap<Key extends string | number>(
  pairs: readonly KerningPair<Key>[]
): Map<string, number> {
  return new Map(pairs.map(({ left, right, value }) => [pairKey(left, right), value]));
}
