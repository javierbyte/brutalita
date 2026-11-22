// Write a static OpenType font with CFF outlines from plain data.
import { buildCff, flatStems } from './cff';
import type { CffGlyph } from './cff';
import { glyphName } from './glyph-names';
import { buildGpos } from './gpos';
import { assembleSfnt } from './sfnt';
import { cmap, head, hhea, hmtx, maxp, name, os2, post } from './tables';
import type { FontFacts } from './tables';
import type { Contour, FontSource, GlyphSource } from './types';

export { glyphName } from './glyph-names';
export { readFont, readHints } from './inspect';
export type { FontSummary, HintReport } from './inspect';
export type {
  Contour,
  FontHints,
  FontNames,
  FontSource,
  GlyphSource,
  KerningPair,
  Node,
  Stem,
} from './types';

type Box = [number, number, number, number];

/**
 * A contour on whole units, with nothing in it that draws nothing: points
 * repeated in place, and a last point that is the first again, which closing
 * the contour already implies.
 */
function tidyContour(contour: Contour, glyph: string): number[][] {
  const nodes: number[][] = [];
  for (const node of contour) {
    if (node.length !== 2 && node.length !== 6) {
      throw new Error(`${glyph}: a node is [x, y] or [c1x, c1y, c2x, c2y, x, y]`);
    }
    const rounded = node.map(Math.round);
    if (rounded.some((value) => !Number.isFinite(value))) {
      throw new Error(`${glyph}: an outline coordinate is not a number`);
    }
    const previous = nodes[nodes.length - 1];
    const same =
      previous &&
      rounded.length === 2 &&
      previous[previous.length - 2] === rounded[0] &&
      previous[previous.length - 1] === rounded[1];
    if (!same) nodes.push(rounded);
  }
  if (!nodes.length) return nodes;
  if (nodes[0].length !== 2) {
    throw new Error(`${glyph}: a contour has to start with a point, not a curve`);
  }
  const last = nodes[nodes.length - 1];
  if (
    nodes.length > 1 &&
    last.length === 2 &&
    last[0] === nodes[0][0] &&
    last[1] === nodes[0][1]
  ) {
    nodes.pop();
  }
  return nodes;
}

/** Where a cubic turns back along one axis, if it does inside the curve. */
function cubicExtremes(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (b) roots.push(-c / b);
  } else {
    const root = Math.sqrt(b * b - 4 * a * c);
    if (!Number.isNaN(root)) roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
  }
  return roots
    .filter((t) => t > 0 && t < 1)
    .map((t) => {
      const u = 1 - t;
      return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    });
}

/** The box around the ink, curves measured where they actually reach. */
function boundsOf(contours: readonly number[][][]): Box | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const contour of contours) {
    let [x, y] = contour[0];
    for (const node of contour) {
      const endX = node[node.length - 2];
      const endY = node[node.length - 1];
      xs.push(endX);
      ys.push(endY);
      if (node.length === 6) {
        xs.push(...cubicExtremes(x, node[0], node[2], endX));
        ys.push(...cubicExtremes(y, node[1], node[3], endY));
      }
      x = endX;
      y = endY;
    }
  }
  if (!xs.length) return undefined;
  return [
    Math.floor(Math.min(...xs)),
    Math.floor(Math.min(...ys)),
    Math.ceil(Math.max(...xs)),
    Math.ceil(Math.max(...ys)),
  ];
}

/** Only what PostScript allows in a name: printable ASCII, minus its syntax. */
function postScriptSafe(text: string): string {
  const ascii = text.normalize('NFKD').replace(/[^\x21-\x7e]|[[\](){}<>/%]/g, '');
  return ascii.slice(0, 63) || 'Untitled';
}

/** ASCII for the strings CFF stores a byte per character. */
function asciiOnly(text: string): string {
  return text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
}

const codesOf = (glyph: GlyphSource): number[] =>
  glyph.unicode === undefined ? [] : [glyph.unicode].flat();

/**
 * Serialize a font to the bytes of an .otf file.
 *
 * Throws when the description cannot be a font: no leading `.notdef`, two
 * glyphs with one name or one code point, a kerning pair naming a glyph that
 * is not there, or a number too large for the field it belongs in.
 */
export function writeFont(source: FontSource): Uint8Array {
  const unitsPerEm = source.unitsPerEm ?? 1000;
  if (!source.glyphs.length || (source.glyphs[0].name ?? '.notdef') !== '.notdef') {
    throw new Error('the first glyph has to be .notdef');
  }
  if (source.glyphs.length > 0xffff) throw new Error('a font holds at most 65535 glyphs');

  // Glyphs: named, rounded, measured.
  const indexByName = new Map<string, number>();
  const glyphByCode = new Map<number, number>();
  const boxes: (Box | undefined)[] = [];
  const glyphs: CffGlyph[] = source.glyphs.map((glyph, index) => {
    const codes = codesOf(glyph);
    const glyphLabel =
      glyph.name ??
      (index === 0 ? '.notdef' : codes.length ? glyphName(codes[0]) : `glyph${index}`);
    if (indexByName.has(glyphLabel)) {
      throw new Error(`two glyphs are named ${glyphLabel}`);
    }
    indexByName.set(glyphLabel, index);
    for (const code of codes) {
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
        throw new Error(`${glyphLabel}: ${code} is not a code point`);
      }
      if (glyphByCode.has(code)) {
        throw new Error(
          `U+${code.toString(16).toUpperCase().padStart(4, '0')} is given to two glyphs`
        );
      }
      glyphByCode.set(code, index);
    }
    const advance = Math.round(glyph.advance);
    // A charstring states its width as a 16-bit signed integer.
    if (!(advance >= 0 && advance <= 0x7fff)) {
      throw new Error(`${glyphLabel}: an advance of ${glyph.advance} is out of range`);
    }
    const contours = (glyph.contours ?? [])
      .map((contour) => tidyContour(contour, glyphLabel))
      // A point or a doubled-back line encloses nothing.
      .filter((nodes) => nodes.length > 2 || nodes.some((node) => node.length === 6));
    boxes.push(boundsOf(contours));
    return {
      name: glyphLabel,
      advance,
      contours,
      hStems: flatStems(glyph.hints?.h ?? []),
      vStems: flatStems(glyph.hints?.v ?? []),
    };
  });
  const characters = [...glyphByCode].sort(([a], [b]) => a - b);
  const inked = boxes.filter((box): box is Box => !!box);
  const bbox: Box = inked.length
    ? [
        Math.min(...inked.map((box) => box[0])),
        Math.min(...inked.map((box) => box[1])),
        Math.max(...inked.map((box) => box[2])),
        Math.max(...inked.map((box) => box[3])),
      ]
    : [0, 0, 0, 0];
  const topOf = (char: string) => {
    const index = glyphByCode.get(char.codePointAt(0)!);
    return index === undefined ? undefined : boxes[index]?.[3];
  };

  // Names.
  const given = source.names;
  const fullName = given.fullName ?? `${given.family} ${given.style}`;
  const postScriptName = postScriptSafe(
    given.postScriptName ?? `${given.family}-${given.style}`.replace(/\s+/g, '')
  );
  const typographic = given.legacyFamily !== undefined || given.legacyStyle !== undefined;
  const names = new Map<number, string>();
  for (const [id, text] of [
    [0, given.copyright],
    [1, given.legacyFamily ?? given.family],
    [2, given.legacyStyle ?? given.style],
    [3, given.uniqueID ?? fullName],
    [4, fullName],
    [5, given.version],
    [6, postScriptName],
    [7, given.trademark],
    [8, given.manufacturer],
    [9, given.designer],
    [10, given.description],
    [11, given.manufacturerURL],
    [12, given.designerURL],
    [13, given.license],
    [14, given.licenseURL],
    [16, typographic ? given.family : undefined],
    [17, typographic ? given.style : undefined],
  ] as const) {
    // A record with nothing in it says less than no record.
    if (text?.trim()) names.set(id, text);
  }

  const kerning = (source.kerning ?? [])
    .filter((pair) => Math.round(pair.value) !== 0)
    .map((pair) => {
      const left = indexByName.get(pair.left);
      const right = indexByName.get(pair.right);
      if (left === undefined || right === undefined) {
        throw new Error(`kerning names a glyph the font does not have: ${pair.left} ${pair.right}`);
      }
      return { left, right, value: Math.round(pair.value) };
    });

  const script = (given: FontSource['subscript'], offset: number) =>
    given
      ? {
          xSize: Math.round(given.size),
          ySize: Math.round(given.size),
          offset: Math.round(given.offset),
        }
      : {
          xSize: Math.round(unitsPerEm * 0.65),
          ySize: Math.round(unitsPerEm * 0.6),
          offset: Math.round(unitsPerEm * offset),
        };
  const created = source.created ?? Date.now() / 1000;
  const facts: FontFacts = {
    unitsPerEm,
    names,
    // "Version 1.5" is revision 1.5; a font that does not say is 1.0.
    revision: source.revision ?? Number(/\d+\.\d+/.exec(given.version ?? '')?.[0] ?? 1),
    weightClass: source.weightClass ?? 400,
    widthClass: source.widthClass ?? 5,
    bold: !!source.bold,
    italic: !!source.italic,
    italicAngle: source.italicAngle ?? 0,
    monospace: !!source.monospace,
    ascender: Math.round(source.ascender),
    descender: Math.round(source.descender),
    lineGap: Math.round(source.lineGap ?? 0),
    capHeight: Math.round(source.capHeight ?? topOf('H') ?? 0),
    xHeight: Math.round(source.xHeight ?? topOf('x') ?? 0),
    underline: source.underline ?? {
      position: -Math.round(unitsPerEm * 0.075),
      thickness: Math.round(unitsPerEm * 0.05),
    },
    strikeout: source.strikeout ?? {
      position: Math.round(unitsPerEm * 0.3),
      size: Math.round(unitsPerEm * 0.05),
    },
    subscript: script(source.subscript, 0.075),
    superscript: script(source.superscript, 0.35),
    panose: source.panose ?? [],
    vendorID: source.vendorID ?? 'NONE',
    created,
    modified: source.modified ?? created,
    hasKerning: kerning.length > 0,
    glyphs: glyphs.map((glyph, index) => ({ advance: glyph.advance, bbox: boxes[index] })),
    characters,
    bbox,
  };

  const tables: Record<string, Uint8Array> = {
    'CFF ': buildCff({
      postScriptName,
      version: given.version && asciiOnly(given.version),
      fullName: asciiOnly(fullName),
      familyName: asciiOnly(given.family),
      weight: asciiOnly(given.style),
      unitsPerEm,
      bbox,
      italicAngle: facts.italicAngle,
      monospace: facts.monospace,
      glyphs,
      hints: source.hints ?? {},
    }),
    'OS/2': os2(facts),
    cmap: cmap(facts),
    head: head(facts),
    hhea: hhea(facts),
    hmtx: hmtx(facts),
    maxp: maxp(facts),
    name: name(facts),
    post: post(facts),
  };
  if (kerning.length) tables.GPOS = buildGpos(kerning);
  return assembleSfnt(tables);
}
