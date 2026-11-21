// The CFF table: the outlines, as Type 2 charstrings, and the hinting values
// that go with them. Written in the order a reader walks it:
// header, Name INDEX, Top DICT INDEX, String INDEX, Global Subr INDEX,
// charset, CharStrings INDEX, Private DICT.
import { Bytes } from './bytes';
import type { FontHints, Stem } from './types';

/** A glyph ready to be written: whole units, hints already settled. */
export type CffGlyph = {
  name: string;
  advance: number;
  contours: readonly (readonly number[])[][];
  hStems: readonly Stem[];
  vStems: readonly Stem[];
};

export type CffSource = {
  postScriptName: string;
  /** Top DICT strings; ASCII. */
  version?: string;
  fullName: string;
  familyName: string;
  weight: string;
  unitsPerEm: number;
  bbox: readonly [number, number, number, number];
  italicAngle: number;
  monospace: boolean;
  glyphs: readonly CffGlyph[];
  hints: FontHints;
};

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

/** An integer, as both DICTs and charstrings write one that fits in 16 bits. */
function integer(value: number): number[] {
  if (value >= -107 && value <= 107) return [value + 139];
  if (value >= 108 && value <= 1131) {
    const v = value - 108;
    return [(v >> 8) + 247, v & 0xff];
  }
  if (value >= -1131 && value <= -108) {
    const v = -value - 108;
    return [(v >> 8) + 251, v & 0xff];
  }
  if (value < -0x8000 || value > 0x7fff) {
    throw new RangeError(`${value} is too large for a charstring`);
  }
  return [28, (value >> 8) & 0xff, value & 0xff];
}

/** A DICT operand of fixed size, so an offset can be written before it is known. */
function offset(value: number): number[] {
  return [29, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** A DICT real: the number's decimal digits, a nibble each. */
function real(value: number): number[] {
  const nibbles: number[] = [];
  const text = String(value).toLowerCase();
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '.') nibbles.push(0xa);
    else if (char === '-') nibbles.push(0xe);
    else if (char === 'e') {
      // "e-7" is one nibble; "e+21" drops its plus sign.
      if (text[i + 1] === '-') nibbles.push(0xc);
      else nibbles.push(0xb);
      if (text[i + 1] === '-' || text[i + 1] === '+') i++;
    } else nibbles.push(Number(char));
  }
  nibbles.push(0xf);
  if (nibbles.length % 2) nibbles.push(0xf);
  const out = [30];
  for (let i = 0; i < nibbles.length; i += 2) out.push((nibbles[i] << 4) | nibbles[i + 1]);
  return out;
}

/** Any DICT operand. */
function operand(value: number): number[] {
  if (!Number.isInteger(value)) return real(value);
  return value >= -0x8000 && value <= 0x7fff ? integer(value) : offset(value);
}

function operator(op: number): number[] {
  return op >= 1200 ? [12, op - 1200] : [op];
}

/** DICT arrays of related values are stored as deltas from the one before. */
function delta(values: readonly number[]): number[] {
  return values.flatMap((value, i) => operand(value - (i ? values[i - 1] : 0)));
}

/* -------------------------------------------------------------------------- */
/* Structures                                                                  */
/* -------------------------------------------------------------------------- */

function index(items: readonly ArrayLike<number>[]): Bytes {
  const out = new Bytes().u16(items.length);
  if (!items.length) return out;

  // Offsets are 1-based from the byte before the data.
  const offsets = [1];
  for (const item of items) offsets.push(offsets[offsets.length - 1] + item.length);
  const last = offsets[offsets.length - 1];
  const offSize = last <= 0xff ? 1 : last <= 0xffff ? 2 : last <= 0xffffff ? 3 : 4;

  out.u8(offSize);
  for (const value of offsets) {
    for (let byte = offSize - 1; byte >= 0; byte--) out.u8(value >>> (8 * byte));
  }
  for (const item of items) out.bytes(item);
  return out;
}

/** A DICT, as [operator, operands] entries. */
function dict(entries: [number, number[]][]): number[] {
  return entries.flatMap(([op, operands]) => [...operands, ...operator(op)]);
}

/* -------------------------------------------------------------------------- */
/* Charstrings                                                                 */
/* -------------------------------------------------------------------------- */

// Type 2 operators.
const HSTEM = 1;
const VSTEM = 3;
const VMOVETO = 4;
const RLINETO = 5;
const HLINETO = 6;
const VLINETO = 7;
const RRCURVETO = 8;
const ENDCHAR = 14;
const RMOVETO = 21;
const HMOVETO = 22;

/** An interpreter need not hold more operands than this. */
const STACK_LIMIT = 48;

/**
 * Stems in ascending order with none overlapping. A charstring may only name
 * overlapping stems if it also carries a hint mask to switch between them, and
 * keeping the set flat — every stem always on — avoids that machinery.
 */
export function flatStems(stems: readonly Stem[]): Stem[] {
  const sorted = stems
    .map(({ edge, width }) => ({ edge: Math.round(edge), width: Math.round(width) }))
    .filter(({ width }) => width > 0)
    .sort((a, b) => a.edge - b.edge || a.width - b.width);
  const kept: Stem[] = [];
  for (const stem of sorted) {
    const previous = kept[kept.length - 1];
    // Stems may touch but not overlap.
    if (previous && stem.edge < previous.edge + previous.width) continue;
    kept.push(stem);
  }
  return kept;
}

function charstring(glyph: CffGlyph): number[] {
  // The width comes first. It is always written: the Private DICT leaves both
  // of its width defaults at zero.
  const out = integer(glyph.advance);

  // Stems: the first edge is absolute, every later one is measured from the
  // top of the stem before it.
  for (const [stems, op] of [
    [glyph.hStems, HSTEM],
    [glyph.vStems, VSTEM],
  ] as const) {
    let top = 0;
    // One slot short of the limit, which the width may be holding.
    const perOperator = (STACK_LIMIT - 2) / 2;
    for (let i = 0; i < stems.length; i += perOperator) {
      for (const stem of stems.slice(i, i + perOperator)) {
        out.push(...integer(stem.edge - top), ...integer(stem.width));
        top = stem.edge + stem.width;
      }
      out.push(op);
    }
  }

  // The pen. A contour closes itself, and closing does not move the pen: the
  // next contour is measured from the last point drawn.
  let x = 0;
  let y = 0;
  for (const contour of glyph.contours) {
    const [startX, startY] = contour[0];
    const dx = startX - x;
    const dy = startY - y;
    if (dy === 0) out.push(...integer(dx), HMOVETO);
    else if (dx === 0) out.push(...integer(dy), VMOVETO);
    else out.push(...integer(dx), ...integer(dy), RMOVETO);
    x = startX;
    y = startY;

    // Each segment as its operands, relative to the point before it.
    const segments: number[][] = [];
    for (const node of contour.slice(1)) {
      if (node.length === 2) {
        segments.push([node[0] - x, node[1] - y]);
      } else {
        segments.push([
          node[0] - x,
          node[1] - y,
          node[2] - node[0],
          node[3] - node[1],
          node[4] - node[2],
          node[5] - node[3],
        ]);
      }
      x = node[node.length - 2];
      y = node[node.length - 1];
    }

    // Runs of like segments share one operator. A straight line along an axis
    // needs one operand, not two, and consecutive ones that turn a right angle
    // each time — most of a monoline design — share an operator as well.
    const axis = (segment: number[]) =>
      segment.length === 2 && (segment[0] === 0 ? 'v' : segment[1] === 0 ? 'h' : '');
    for (let i = 0; i < segments.length; ) {
      const first = axis(segments[i]);
      const operands: number[] = [];
      let end = i;
      let op: number;
      if (first) {
        op = first === 'h' ? HLINETO : VLINETO;
        let expected: string = first;
        while (
          end < segments.length &&
          operands.length < STACK_LIMIT &&
          axis(segments[end]) === expected
        ) {
          operands.push(segments[end][expected === 'h' ? 0 : 1]);
          expected = expected === 'h' ? 'v' : 'h';
          end++;
        }
      } else {
        const size = segments[i].length;
        op = size === 2 ? RLINETO : RRCURVETO;
        while (
          end < segments.length &&
          operands.length + size <= STACK_LIMIT &&
          segments[end].length === size &&
          !axis(segments[end])
        ) {
          operands.push(...segments[end]);
          end++;
        }
      }
      out.push(...operands.flatMap(integer), op);
      i = end;
    }
  }

  out.push(ENDCHAR);
  return out;
}

/* -------------------------------------------------------------------------- */
/* The table                                                                   */
/* -------------------------------------------------------------------------- */

// DICT operators.
const TOP = {
  version: 0,
  fullName: 2,
  familyName: 3,
  weight: 4,
  fontBBox: 5,
  charset: 15,
  charStrings: 17,
  private: 18,
  isFixedPitch: 1201,
  italicAngle: 1202,
  fontMatrix: 1207,
};
const PRIVATE = {
  blueValues: 6,
  otherBlues: 7,
  stdHW: 10,
  stdVW: 11,
  defaultWidthX: 20,
  nominalWidthX: 21,
  blueFuzz: 1211,
  stemSnapH: 1212,
  stemSnapV: 1213,
  forceBold: 1214,
};

/** Strings a font defines itself are numbered after the 391 standard ones. */
const FIRST_CUSTOM_SID = 391;

function privateDict(hints: FontHints): number[] {
  const entries: [number, number[]][] = [];
  const list = (op: number, values?: readonly number[]) => {
    if (values?.length) entries.push([op, delta(values)]);
  };
  const value = (op: number, number?: number) => {
    if (number !== undefined) entries.push([op, operand(number)]);
  };
  list(PRIVATE.blueValues, hints.blueValues);
  list(PRIVATE.otherBlues, hints.otherBlues);
  value(PRIVATE.stdHW, hints.stdHW);
  value(PRIVATE.stdVW, hints.stdVW);
  list(PRIVATE.stemSnapH, hints.stemSnapH);
  list(PRIVATE.stemSnapV, hints.stemSnapV);
  if (hints.forceBold) value(PRIVATE.forceBold, 1);
  value(PRIVATE.blueFuzz, hints.blueFuzz);
  // Zero, so every charstring states its own width.
  value(PRIVATE.defaultWidthX, 0);
  value(PRIVATE.nominalWidthX, 0);
  return dict(entries);
}

export function buildCff(source: CffSource): Uint8Array {
  if (source.glyphs[0]?.name !== '.notdef') {
    throw new Error('the first glyph of a CFF font has to be .notdef');
  }

  // Strings: the Top DICT's own, then every glyph name but .notdef, which is
  // standard string 0. Glyph names that happen to be standard strings are
  // written out all the same, which costs a few bytes and saves the table.
  const strings: string[] = [];
  const sid = (text: string) => {
    strings.push(text);
    return FIRST_CUSTOM_SID + strings.length - 1;
  };
  const named: [number, number[]][] = [];
  if (source.version) named.push([TOP.version, operand(sid(source.version))]);
  named.push(
    [TOP.fullName, operand(sid(source.fullName))],
    [TOP.familyName, operand(sid(source.familyName))],
    [TOP.weight, operand(sid(source.weight))]
  );
  if (source.monospace) named.push([TOP.isFixedPitch, operand(1)]);
  if (source.italicAngle) named.push([TOP.italicAngle, operand(source.italicAngle)]);
  named.push([TOP.fontBBox, source.bbox.flatMap(operand)]);
  // The default matrix is for 1000 units per em.
  if (source.unitsPerEm !== 1000) {
    const scale = 1 / source.unitsPerEm;
    named.push([TOP.fontMatrix, [scale, 0, 0, scale, 0, 0].flatMap(operand)]);
  }

  // charset format 0: one string per glyph after .notdef.
  const charset = new Bytes().u8(0);
  for (const glyph of source.glyphs.slice(1)) charset.u16(sid(glyph.name));

  const header = [1, 0, 4, 4];
  const nameIndex = index([new Bytes().ascii(source.postScriptName).data]);
  const stringIndex = index(strings.map((text) => new Bytes().ascii(text).data));
  const globalSubrs = index([]);
  const charStrings = index(source.glyphs.map(charstring));
  const privateBytes = privateDict(source.hints);

  // The Top DICT points at what follows it, so it is sized first — with every
  // offset in the fixed five-byte form — and written once the offsets are known.
  const topDict = (charsetAt = 0, charStringsAt = 0, privateAt = 0) =>
    index([
      dict([
        ...named,
        [TOP.charset, offset(charsetAt)],
        [TOP.charStrings, offset(charStringsAt)],
        [TOP.private, [...offset(privateBytes.length), ...offset(privateAt)]],
      ]),
    ]);
  const charsetAt =
    header.length +
    nameIndex.length +
    topDict().length +
    stringIndex.length +
    globalSubrs.length;
  const charStringsAt = charsetAt + charset.length;
  const privateAt = charStringsAt + charStrings.length;

  return new Bytes()
    .bytes(header)
    .bytes(nameIndex.data)
    .bytes(topDict(charsetAt, charStringsAt, privateAt).data)
    .bytes(stringIndex.data)
    .bytes(globalSubrs.data)
    .bytes(charset.data)
    .bytes(charStrings.data)
    .bytes(privateBytes)
    .toUint8Array();
}
