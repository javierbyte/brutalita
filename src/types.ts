export type CharLayer = [number, number][];
export type CharLayers = CharLayer[];

/**
 * An accent, drawn in its own frame: foot on y = 0, rising into negative y.
 * Where it ends up is decided when it is placed on a letter (see ./compose).
 */
export type MarkDefinition = CharLayers;
export type MarkSet = { [name: string]: MarkDefinition };

// Editor grid resolution: 2 columns x 4 rows of segments.
export const SEGMENTS = [2, 4] as const;

/**
 * OS/2 usWeightClass: any integer in 1..1000, not a fixed set. Stroke
 * thickness and style name are derived from it in src/weights.ts.
 */
export type FontWeightType = number;

export type FontConfig = {
  name: string;
  weight: FontWeightType;
  height: number;
  monospace: boolean;
  designer?: string;
  designerURL?: string;
  /**
   * Overrides the subfamily name derived from `weight` ("Regular", "Bold",
   * or the number itself for a weight with no standard name).
   */
  styleName?: string;
  /**
   * Release number of the typeface ("0.9"). Written to OpenType name ID 5 as
   * "Version 0.9". The family name has to stay stable across releases or
   * documents using the font break, so the version lives here rather than in
   * `name`. Omitted for user fonts.
   */
  version?: string;
};

/**
 * A glyph built from another glyph instead of drawn: "á" is "a" with an acute
 * over it, "¿" is "?" turned around. Resolved by ./compose.
 */
export type Composite = {
  /** Character whose layers this glyph is built from. */
  base: string;
  /** Mark to place above the base, by name in the source's `marks` map. */
  mark?: string;
  /** Half turn within the cap box. 180 is the only supported angle. */
  rotate?: number;
};

/** A glyph as the source writes it: drawn outright, or built from another. */
export type CharSource = CharLayers | Composite;

export type FontDefinition = {
  [char: string]: CharLayers;
};
