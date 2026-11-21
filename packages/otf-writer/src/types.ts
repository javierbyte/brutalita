/**
 * One step of an outline: a point `[x, y]`, reached by a straight line, or a
 * cubic curve `[c1x, c1y, c2x, c2y, x, y]` to a point through two controls.
 */
export type Node =
  | readonly [number, number]
  | readonly [number, number, number, number, number, number];

/**
 * A closed shape. The first node is where it starts, and has to be a point;
 * the last is joined back to it with a straight line. Coordinates are in font
 * units, y up, and are rounded to whole units. Counters wind the opposite way
 * to the shape they are cut from.
 */
export type Contour = readonly Node[];

/** One stem for the rasterizer: its lower or left edge, and its width. */
export type Stem = { edge: number; width: number };

export type GlyphSource = {
  /**
   * PostScript name, unique in the font. Defaults to the conventional name of
   * the glyph's first code point (see `glyphName`).
   */
  name?: string;
  /** The code point, or code points, this glyph is the character for. */
  unicode?: number | readonly number[];
  /** Horizontal advance. */
  advance: number;
  contours?: readonly Contour[];
  /**
   * Horizontal stems (edges are y positions) and vertical ones (x positions).
   * Stems that overlap one already listed are dropped: the glyph carries no
   * hint mask, so every stem it names is always on.
   */
  hints?: { h?: readonly Stem[]; v?: readonly Stem[] };
};

/** The font-wide hinting values of the CFF Private DICT. */
export type FontHints = {
  /** Alignment zones as [bottom, top] pairs: the baseline zone first. */
  blueValues?: readonly number[];
  /** Further bottom zones, such as the descender, as [bottom, top] pairs. */
  otherBlues?: readonly number[];
  /** The dominant horizontal and vertical stem widths. */
  stdHW?: number;
  stdVW?: number;
  /** Up to twelve common stem widths per axis, ascending. */
  stemSnapH?: readonly number[];
  stemSnapV?: readonly number[];
  forceBold?: boolean;
  /** How far outside a zone a point may sit and still be caught. Default 1. */
  blueFuzz?: number;
};

export type KerningPair = {
  /** Glyph names. */
  left: string;
  right: string;
  /** Added to the left glyph's advance; negative pulls the pair together. */
  value: number;
};

export type FontNames = {
  /** The family and style as a person would name them: "Brutalita", "Light". */
  family: string;
  style: string;
  /**
   * How the font is filed by software that knows four styles per family
   * (Regular, Italic, Bold, Bold Italic): "Brutalita Light", "Regular". When
   * given, these become name IDs 1 and 2 and `family` and `style` move to the
   * typographic IDs 16 and 17.
   */
  legacyFamily?: string;
  legacyStyle?: string;
  /** Name ID 4. Defaults to "family style". */
  fullName?: string;
  /**
   * Name ID 6, and the name of the CFF font. Defaults to "Family-Style". Kept
   * to the characters PostScript allows, whatever is passed.
   */
  postScriptName?: string;
  /** Name ID 3. Defaults to the full name. */
  uniqueID?: string;
  /** Name ID 5, conventionally "Version 1.000". */
  version?: string;
  copyright?: string;
  trademark?: string;
  manufacturer?: string;
  manufacturerURL?: string;
  designer?: string;
  designerURL?: string;
  description?: string;
  license?: string;
  licenseURL?: string;
};

export type FontSource = {
  /** Font units per em. Default 1000. */
  unitsPerEm?: number;
  names: FontNames;
  /** OS/2 usWeightClass, 1–1000. Default 400. */
  weightClass?: number;
  /** OS/2 usWidthClass, 1–9. Default 5 (normal). */
  widthClass?: number;
  /** Whether this is the bold, or the italic, of its (legacy) family. */
  bold?: boolean;
  italic?: boolean;
  /**
   * Degrees counter-clockwise from upright, so a font leaning right has a
   * negative angle. Also slopes the text cursor. Default 0.
   */
  italicAngle?: number;
  monospace?: boolean;
  /**
   * The line box: one pair of values written as the typographic, hhea and
   * Windows metrics alike, so every platform sets the same line.
   */
  ascender: number;
  /** Below the baseline, so negative. */
  descender: number;
  lineGap?: number;
  /** Default to the tops of "H" and "x" when the font has them. */
  capHeight?: number;
  xHeight?: number;
  /** `position` is the top of the rule, usually negative. */
  underline?: { position: number; thickness: number };
  /** `position` is the top of the rule. */
  strikeout?: { position: number; size: number };
  /**
   * How software that fakes a subscript or superscript should set it: the em
   * size to use, and how far to move the baseline down (`subscript`) or up
   * (`superscript`). Both default to 0.65 em wide, 0.6 em tall, dropped 0.075
   * em or raised 0.35 em, which is what most fonts say.
   */
  subscript?: { size: number; offset: number };
  superscript?: { size: number; offset: number };
  /** The ten PANOSE classification bytes. */
  panose?: readonly number[];
  /** Four-character vendor tag. */
  vendorID?: string;
  /**
   * head.fontRevision, a number software may compare to tell which of two
   * copies is newer. Defaults to the first decimal number in `names.version`.
   */
  revision?: number;
  /** Unix seconds. `created` defaults to now and `modified` to `created`. */
  created?: number;
  modified?: number;
  /** In glyph order. The first has to be `.notdef`. */
  glyphs: readonly GlyphSource[];
  kerning?: readonly KerningPair[];
  hints?: FontHints;
};
