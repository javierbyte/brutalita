// Every table but the outlines and the kerning: small, fixed-layout records
// that say what the font is called and how its lines are set.
import { Bytes } from './bytes';

/** What the tables are written from, once the glyphs have been measured. */
export type FontFacts = {
  unitsPerEm: number;
  /** Name ID to text, already settled. */
  names: Map<number, string>;
  revision: number;
  weightClass: number;
  widthClass: number;
  bold: boolean;
  italic: boolean;
  italicAngle: number;
  monospace: boolean;
  ascender: number;
  descender: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;
  underline: { position: number; thickness: number };
  strikeout: { position: number; size: number };
  subscript: { xSize: number; ySize: number; offset: number };
  superscript: { xSize: number; ySize: number; offset: number };
  panose: readonly number[];
  vendorID: string;
  created: number;
  modified: number;
  hasKerning: boolean;
  /** Per glyph: its advance and, when it has ink, the box around it. */
  glyphs: readonly {
    advance: number;
    bbox?: readonly [number, number, number, number];
  }[];
  /** Code point to glyph index, in ascending code point order. */
  characters: readonly (readonly [number, number])[];
  /** The box around every glyph. */
  bbox: readonly [number, number, number, number];
};

const done = (bytes: Bytes) => bytes.toUint8Array();

export function head(font: FontFacts): Uint8Array {
  const macStyle = (font.bold ? 1 : 0) | (font.italic ? 2 : 0);
  return done(
    new Bytes()
      .u16(1, 0) // version 1.0
      .fixed(font.revision)
      .u32(0) // checkSumAdjustment, filled in once the file is assembled
      .u32(0x5f0f3cf5)
      .u16(0x0003) // baseline at y = 0, left sidebearing at x = 0
      .u16(font.unitsPerEm)
      .date(font.created)
      .date(font.modified)
      .i16(...font.bbox)
      .u16(macStyle)
      .u16(3) // smallest readable size, in pixels per em
      .i16(2) // direction hint, deprecated: always 2
      .i16(0, 0) // loca format and glyph data format, both unused by CFF
  );
}

export function hhea(font: FontFacts): Uint8Array {
  const inked = font.glyphs.flatMap(({ advance, bbox }) =>
    bbox ? [{ left: bbox[0], right: advance - bbox[2], extent: bbox[2] }] : []
  );
  const least = (values: number[]) => (values.length ? Math.min(...values) : 0);
  // A slanted font leans its text cursor to follow the letters.
  const slope = Math.tan((-font.italicAngle * Math.PI) / 180);
  return done(
    new Bytes()
      .u16(1, 0)
      .i16(font.ascender, font.descender, font.lineGap)
      .u16(Math.max(0, ...font.glyphs.map((glyph) => glyph.advance)))
      .i16(least(inked.map((glyph) => glyph.left))) // smallest left side bearing
      .i16(least(inked.map((glyph) => glyph.right))) // and right
      .i16(-least(inked.map((glyph) => -glyph.extent))) // furthest any ink reaches
      .i16(slope ? 1000 : 1, Math.round(1000 * slope), 0)
      .i16(0, 0, 0, 0, 0)
      .u16(font.glyphs.length) // every glyph has its own advance
  );
}

export function hmtx(font: FontFacts): Uint8Array {
  const out = new Bytes();
  for (const glyph of font.glyphs) out.u16(glyph.advance).i16(glyph.bbox?.[0] ?? 0);
  return done(out);
}

export function maxp(font: FontFacts): Uint8Array {
  // Version 0.5, the one for fonts without TrueType outlines.
  return done(new Bytes().u32(0x00005000).u16(font.glyphs.length));
}

/**
 * OS/2 ulUnicodeRange bits for the blocks a text font is likely to cover, as
 * [bit, first, last]. A block outside this list simply goes unannounced.
 */
const UNICODE_RANGES: readonly (readonly [number, number, number])[] = [
  [0, 0x0000, 0x007f], // Basic Latin
  [1, 0x0080, 0x00ff], // Latin-1 Supplement
  [2, 0x0100, 0x017f], // Latin Extended-A
  [3, 0x0180, 0x024f], // Latin Extended-B
  [4, 0x0250, 0x02af], // IPA Extensions
  [5, 0x02b0, 0x02ff], // Spacing Modifier Letters
  [6, 0x0300, 0x036f], // Combining Diacritical Marks
  [7, 0x0370, 0x03ff], // Greek and Coptic
  [9, 0x0400, 0x052f], // Cyrillic and its supplement
  [10, 0x0530, 0x058f], // Armenian
  [11, 0x0590, 0x05ff], // Hebrew
  [13, 0x0600, 0x06ff], // Arabic
  [29, 0x1e00, 0x1eff], // Latin Extended Additional
  [30, 0x1f00, 0x1fff], // Greek Extended
  [31, 0x2000, 0x206f], // General Punctuation
  [32, 0x2070, 0x209f], // Superscripts and Subscripts
  [33, 0x20a0, 0x20cf], // Currency Symbols
  [34, 0x20d0, 0x20ff], // Combining Diacritical Marks for Symbols
  [35, 0x2100, 0x214f], // Letterlike Symbols
  [36, 0x2150, 0x218f], // Number Forms
  [37, 0x2190, 0x21ff], // Arrows
  [38, 0x2200, 0x22ff], // Mathematical Operators
  [39, 0x2300, 0x23ff], // Miscellaneous Technical
  [40, 0x2400, 0x243f], // Control Pictures
  [41, 0x2440, 0x245f], // Optical Character Recognition
  [42, 0x2460, 0x24ff], // Enclosed Alphanumerics
  [43, 0x2500, 0x257f], // Box Drawing
  [44, 0x2580, 0x259f], // Block Elements
  [45, 0x25a0, 0x25ff], // Geometric Shapes
  [46, 0x2600, 0x26ff], // Miscellaneous Symbols
  [47, 0x2700, 0x27bf], // Dingbats
  [48, 0x3000, 0x303f], // CJK Symbols and Punctuation
  [49, 0x3040, 0x309f], // Hiragana
  [50, 0x30a0, 0x30ff], // Katakana
  [59, 0x4e00, 0x9fff], // CJK Unified Ideographs
  [60, 0xe000, 0xf8ff], // Private Use Area
  [62, 0xfb00, 0xfb4f], // Alphabetic Presentation Forms
  [57, 0x10000, 0x10ffff], // anything beyond the Basic Multilingual Plane
];

export function os2(font: FontFacts): Uint8Array {
  const { subscript, superscript } = font;
  const codes = font.characters.map(([code]) => code);

  const ranges = [0, 0, 0, 0];
  for (const [bit, first, last] of UNICODE_RANGES) {
    if (codes.some((code) => code >= first && code <= last)) {
      ranges[bit >> 5] = (ranges[bit >> 5] | (1 << (bit & 31))) >>> 0;
    }
  }

  // Defined as the mean of every glyph that has a width.
  const widths = font.glyphs.map((glyph) => glyph.advance).filter(Boolean);
  const average = widths.length
    ? Math.round(widths.reduce((sum, width) => sum + width, 0) / widths.length)
    : 0;

  const selection =
    (font.italic ? 0x01 : 0) |
    (font.bold ? 0x20 : 0) |
    (font.bold || font.italic ? 0 : 0x40) | // REGULAR
    // USE_TYPO_METRICS: the typographic metrics are the line box, so a line
    // is the same height on Windows as it is on macOS.
    0x80;

  return done(
    new Bytes()
      // Version 4, the first in which USE_TYPO_METRICS means anything.
      .u16(4)
      .i16(average)
      .u16(font.weightClass, font.widthClass)
      .u16(0) // fsType: no embedding restrictions
      // x size, y size, x offset, y offset: both offsets are written positive.
      .i16(subscript.xSize, subscript.ySize, 0, subscript.offset)
      .i16(superscript.xSize, superscript.ySize, 0, superscript.offset)
      .i16(font.strikeout.size, font.strikeout.position)
      .i16(0) // sFamilyClass: unclassified
      .u8(...Array.from({ length: 10 }, (_, i) => font.panose[i] ?? 0))
      .u32(...ranges)
      .ascii(font.vendorID.padEnd(4).slice(0, 4))
      .u16(selection)
      .u16(Math.min(0xffff, codes[0] ?? 0))
      .u16(Math.min(0xffff, codes[codes.length - 1] ?? 0))
      .i16(font.ascender, font.descender, font.lineGap)
      .u16(Math.max(0, font.ascender), Math.max(0, -font.descender)) // usWin*
      // Code pages: Latin 1, for a font with the basic alphabet.
      .u32(codes.includes(0x41) ? 1 : 0, 0)
      .i16(font.xHeight, font.capHeight)
      .u16(0) // the default character is .notdef
      .u16(codes.includes(0x20) ? 0x20 : 0) // the break character is the space
      .u16(font.hasKerning ? 2 : 0) // longest context a lookup reads: a pair
  );
}

export function post(font: FontFacts): Uint8Array {
  // Version 3: no glyph names, which a CFF font keeps in its own table.
  return done(
    new Bytes()
      .u32(0x00030000)
      .fixed(font.italicAngle)
      .i16(font.underline.position, font.underline.thickness)
      .u32(font.monospace ? 1 : 0)
      .u32(0, 0, 0, 0)
  );
}

export function name(font: FontFacts): Uint8Array {
  // One set of records: Windows, Unicode BMP, US English. Every current
  // platform reads these, the Mac included.
  const ids = [...font.names.keys()].sort((a, b) => a - b);
  const records = new Bytes();
  const storage = new Bytes();
  const stored = new Map<string, number>();
  for (const id of ids) {
    const text = font.names.get(id)!;
    let at = stored.get(text);
    if (at === undefined) {
      at = storage.length;
      stored.set(text, at);
      for (let i = 0; i < text.length; i++) storage.u16(text.charCodeAt(i));
    }
    records.u16(3, 1, 0x0409, id, text.length * 2, at);
  }
  return done(
    new Bytes()
      .u16(0, ids.length, 6 + records.length)
      .bytes(records.data)
      .bytes(storage.data)
  );
}

/** Format 4: the Basic Multilingual Plane as runs of consecutive code points. */
function cmapFormat4(characters: FontFacts['characters']): Bytes {
  // A run is consecutive code points on consecutive glyphs, so the whole of
  // it is one constant added to the code point.
  const runs: { first: number; last: number; delta: number }[] = [];
  for (const [code, glyph] of characters) {
    const run = runs[runs.length - 1];
    if (run && code === run.last + 1 && glyph - code === run.delta) run.last = code;
    else runs.push({ first: code, last: code, delta: glyph - code });
  }
  // The table ends with a run for 0xFFFF, mapped to the missing glyph.
  if (runs[runs.length - 1]?.last !== 0xffff) {
    runs.push({ first: 0xffff, last: 0xffff, delta: 1 });
  }

  const count = runs.length;
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = 2 ** entrySelector * 2;
  const body = new Bytes()
    .u16(count * 2, searchRange, entrySelector, count * 2 - searchRange)
    .u16(...runs.map((run) => run.last))
    .u16(0)
    .u16(...runs.map((run) => run.first))
    .u16(...runs.map((run) => run.delta & 0xffff))
    .u16(...runs.map(() => 0)); // no glyph index arrays: the deltas say it all
  return new Bytes().u16(4, 6 + body.length, 0).bytes(body.data);
}

/** Format 12: every code point, as runs of consecutive ones. */
function cmapFormat12(characters: FontFacts['characters']): Bytes {
  const groups: number[][] = [];
  for (const [code, glyph] of characters) {
    const group = groups[groups.length - 1];
    if (group && code === group[1] + 1 && glyph - code === group[2] - group[0]) {
      group[1] = code;
    } else groups.push([code, code, glyph]);
  }
  return new Bytes()
    .u16(12, 0)
    .u32(16 + groups.length * 12, 0, groups.length)
    .u32(...groups.flat());
}

export function cmap(font: FontFacts): Uint8Array {
  const bmp = font.characters.filter(([code]) => code <= 0xffff);
  const subtables: [number, Bytes][] = [[1, cmapFormat4(bmp)]];
  // Beyond the BMP a second subtable carries everything, the BMP included.
  if (bmp.length < font.characters.length) {
    subtables.push([10, cmapFormat12(font.characters)]);
  }

  const out = new Bytes().u16(0, subtables.length);
  let at = 4 + subtables.length * 8;
  for (const [encoding, subtable] of subtables) {
    out.u16(3, encoding).u32(at); // platform 3, Windows
    at += subtable.length;
  }
  for (const [, subtable] of subtables) out.bytes(subtable.data);
  return done(out);
}
