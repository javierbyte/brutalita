// Add CFF hints to a built .otf.
//
// opentype.js cannot emit them: its CFF writer's PRIVATE_DICT_META carries only
// subrs/defaultWidthX/nominalWidthX, and glyphToOps emits nothing but
// rmoveto/rlineto/rrcurveto/endchar. So the hints are spliced into the
// serialized bytes here, the same way otf-deterministic.ts patches head.
//
// These hints describe stem edges and alignment zones to CFF rasterizers.
// Their effect depends on the renderer and its hinting mode; they cannot
// recover counters or separate contours that already overlap in the outline.
//
// Everything is Uint8Array/DataView rather than Buffer so the browser editor's
// download path can hint too.

import { replaceSfntTable } from './sfnt';

/** One stem: its lower edge and its width, in font units. */
export type StemHint = { edge: number; width: number };

/** The stems of a single glyph, in charstring coordinates. */
export type GlyphHints = { h: StemHint[]; v: StemHint[] };

export type PrivateHints = {
  /** Bottom zone first, then top zones, as [bottom, top] pairs. */
  blueValues: number[];
  /** Additional bottom zones — the descender. */
  otherBlues: number[];
  stdHW: number;
  stdVW: number;
  stemSnapH: number[];
  stemSnapV: number[];
  forceBold: boolean;
};

export type FontHints = {
  /** Parallel to font.glyphs, so index 0 is .notdef. */
  glyphs: GlyphHints[];
  private: PrivateHints;
};

const SFNT_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const CFF_TAG = 0x43464620; // 'CFF '

// Type 2 charstring operators.
const OP_HSTEM = 1;
const OP_VSTEM = 3;

// Top DICT operators.
const OP_CHARSET = 15;
const OP_ENCODING = 16;
const OP_CHARSTRINGS = 17;
const OP_PRIVATE = 18;

/* -------------------------------------------------------------------------- */
/* Number encodings                                                            */
/* -------------------------------------------------------------------------- */

/** Type 2 charstring integer. */
function encodeCharstringNumber(value: number): number[] {
  const v = Math.round(value);
  if (v >= -107 && v <= 107) return [v + 139];
  if (v >= 108 && v <= 1131) {
    const d = v - 108;
    return [(d >> 8) + 247, d & 0xff];
  }
  if (v >= -1131 && v <= -108) {
    const d = -v - 108;
    return [(d >> 8) + 251, d & 0xff];
  }
  return [28, (v >> 8) & 0xff, v & 0xff];
}

/**
 * DICT integer. Every value written here is an integer — BlueScale and
 * BlueShift keep their spec defaults precisely so this never has to encode a
 * real number in BCD.
 */
function encodeDictNumber(value: number): number[] {
  const v = Math.round(value);
  if (v >= -107 && v <= 107) return [v + 139];
  if (v >= 108 && v <= 1131) {
    const d = v - 108;
    return [(d >> 8) + 247, d & 0xff];
  }
  if (v >= -1131 && v <= -108) {
    const d = -v - 108;
    return [(d >> 8) + 251, d & 0xff];
  }
  if (v >= -32768 && v <= 32767) return [28, (v >> 8) & 0xff, v & 0xff];
  return [29, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** The fixed 5-byte form opentype.js uses for every Top DICT offset. */
function encodeDictOffset(value: number): number[] {
  return [
    29,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function encodeDictOperator(op: number): number[] {
  return op >= 1200 ? [12, op - 1200] : [op];
}

/** DICT arrays are stored as deltas from the previous entry. */
function encodeDelta(values: number[]): number[] {
  const out: number[] = [];
  let previous = 0;
  for (const value of values) {
    out.push(...encodeDictNumber(value - previous));
    previous = value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* INDEX structures                                                            */
/* -------------------------------------------------------------------------- */

type IndexResult = { items: Uint8Array[]; end: number };

function readIndex(data: Uint8Array, position: number): IndexResult {
  const count = (data[position] << 8) | data[position + 1];
  if (count === 0) return { items: [], end: position + 2 };

  const offSize = data[position + 2];
  const offsetsStart = position + 3;
  const readOffset = (i: number) => {
    let value = 0;
    for (let j = 0; j < offSize; j++) {
      value = value * 256 + data[offsetsStart + i * offSize + j];
    }
    return value;
  };

  // INDEX offsets are 1-based from the byte before the data block.
  const dataStart = offsetsStart + (count + 1) * offSize - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    items.push(data.subarray(dataStart + readOffset(i), dataStart + readOffset(i + 1)));
  }
  return { items, end: dataStart + readOffset(count) };
}

function buildIndex(items: Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0]);

  const total = items.reduce((sum, item) => sum + item.length, 0);
  const last = total + 1;
  const offSize = last <= 0xff ? 1 : last <= 0xffff ? 2 : last <= 0xffffff ? 3 : 4;

  const out = new Uint8Array(3 + (items.length + 1) * offSize + total);
  out[0] = (items.length >> 8) & 0xff;
  out[1] = items.length & 0xff;
  out[2] = offSize;

  let cursor = 3;
  const writeOffset = (value: number) => {
    for (let j = 0; j < offSize; j++) {
      out[cursor + j] = (value >>> (8 * (offSize - 1 - j))) & 0xff;
    }
    cursor += offSize;
  };

  let offset = 1;
  writeOffset(offset);
  for (const item of items) {
    offset += item.length;
    writeOffset(offset);
  }
  for (const item of items) {
    out.set(item, cursor);
    cursor += item.length;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* DICT scanning                                                               */
/* -------------------------------------------------------------------------- */

/** One DICT entry: its operator, its operand values, and its raw bytes. */
type DictEntry = { op: number; operands: number[]; start: number; end: number };

/**
 * Parse a DICT into entries, keeping each one's byte range so the entries that
 * do not change can be copied through verbatim.
 */
function parseDict(data: Uint8Array, start: number, end: number): DictEntry[] {
  const entries: DictEntry[] = [];
  let operands: number[] = [];
  let entryStart = start;
  let i = start;

  while (i < end) {
    const b0 = data[i];
    if (b0 === 28) {
      operands.push((((data[i + 1] << 8) | data[i + 2]) << 16) >> 16);
      i += 3;
    } else if (b0 === 29) {
      operands.push(
        (data[i + 1] << 24) | (data[i + 2] << 16) | (data[i + 3] << 8) | data[i + 4]
      );
      i += 5;
    } else if (b0 === 30) {
      // Real number: nibble-encoded, terminated by an 0xf nibble.
      let j = i + 1;
      let done = false;
      while (j < end && !done) {
        const byte = data[j++];
        if (byte >> 4 === 0xf || (byte & 0x0f) === 0xf) done = true;
      }
      operands.push(NaN);
      i = j;
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + data[i + 1] + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - data[i + 1] - 108);
      i += 2;
    } else {
      const op = b0 === 12 ? 1200 + data[i + 1] : b0;
      i += b0 === 12 ? 2 : 1;
      entries.push({ op, operands, start: entryStart, end: i });
      operands = [];
      entryStart = i;
    }
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* Hint injection                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Drop hints that overlap one already accepted. A charstring may only carry
 * non-overlapping stems unless it also carries a hintmask, and keeping the set
 * flat — all hints always active — avoids that machinery entirely.
 */
function withoutOverlaps(hints: StemHint[]): StemHint[] {
  const unique = new Map<string, StemHint>();
  for (const hint of hints) unique.set(`${hint.edge},${hint.width}`, hint);

  const sorted = [...unique.values()].sort((a, b) => a.edge - b.edge);
  const accepted: StemHint[] = [];
  for (const hint of sorted) {
    const previous = accepted[accepted.length - 1];
    // Stems may touch but not overlap.
    if (previous && hint.edge < previous.edge + previous.width) continue;
    accepted.push(hint);
  }
  return accepted;
}

/** `y dy {dya dyb}*` — the first edge absolute, the rest deltas. */
function encodeStems(hints: StemHint[]): number[] {
  const out: number[] = [];
  let previousTop = 0;
  for (const hint of hints) {
    out.push(...encodeCharstringNumber(hint.edge - previousTop));
    out.push(...encodeCharstringNumber(hint.width));
    previousTop = hint.edge + hint.width;
  }
  return out;
}

/**
 * Splice hstem/vstem in front of a charstring's outline.
 *
 * opentype.js writes `width dx dy rmoveto ...` (it sets defaultWidthX and
 * nominalWidthX to 0, so the width is always explicit). The width has to move
 * ahead of the stem operators, which is what makes their argument count odd —
 * the spec's own signal that a width is present.
 */
function injectGlyphHints(charstring: Uint8Array, hints: GlyphHints): Uint8Array {
  const h = withoutOverlaps(hints.h);
  const v = withoutOverlaps(hints.v);
  if (h.length === 0 && v.length === 0) return charstring;

  // Read the leading operands and the operator that consumes them.
  const operands: number[] = [];
  let i = 0;
  while (i < charstring.length) {
    const b0 = charstring[i];
    if (b0 === 28) {
      operands.push((((charstring[i + 1] << 8) | charstring[i + 2]) << 16) >> 16);
      i += 3;
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      i += 1;
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + charstring[i + 1] + 108);
      i += 2;
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - charstring[i + 1] - 108);
      i += 2;
    } else if (b0 === 255) {
      operands.push(
        (((charstring[i + 1] << 24) |
          (charstring[i + 2] << 16) |
          (charstring[i + 3] << 8) |
          charstring[i + 4]) >>
          0) /
          65536
      );
      i += 5;
    } else {
      break;
    }
  }

  const operator = charstring[i];
  // rmoveto takes two arguments; a third is the width. Anything else here is
  // not something opentype.js emits, so leave that glyph alone.
  if (operator !== 21 || operands.length < 2) return charstring;

  const width = operands.length > 2 ? operands[operands.length - 3] : undefined;
  const moveTo = operands.slice(-2);

  const out: number[] = [];
  if (width !== undefined) out.push(...encodeCharstringNumber(width));
  if (h.length) {
    out.push(...encodeStems(h), OP_HSTEM);
  }
  if (v.length) {
    out.push(...encodeStems(v), OP_VSTEM);
  }
  out.push(...encodeCharstringNumber(moveTo[0]));
  out.push(...encodeCharstringNumber(moveTo[1]));
  out.push(operator);

  const tail = charstring.subarray(i + 1);
  const result = new Uint8Array(out.length + tail.length);
  result.set(out, 0);
  result.set(tail, out.length);
  return result;
}

function buildPrivateDict(hints: PrivateHints): Uint8Array {
  const bytes: number[] = [];
  const entry = (op: number, operands: number[]) => {
    bytes.push(...operands, ...encodeDictOperator(op));
  };

  if (hints.blueValues.length) entry(6, encodeDelta(hints.blueValues));
  if (hints.otherBlues.length) entry(7, encodeDelta(hints.otherBlues));
  entry(10, encodeDictNumber(hints.stdHW));
  entry(11, encodeDictNumber(hints.stdVW));
  if (hints.stemSnapH.length) entry(1212, encodeDelta(hints.stemSnapH));
  if (hints.stemSnapV.length) entry(1213, encodeDelta(hints.stemSnapV));
  if (hints.forceBold) entry(1214, encodeDictNumber(1));
  // The outlines sit on exact integers, so a fuzz band would only let a
  // near-miss coordinate get captured by a zone it does not belong to.
  entry(1211, encodeDictNumber(0));
  // opentype.js writes both as 0 and every charstring carries an explicit
  // width, which injectGlyphHints preserves.
  entry(20, encodeDictNumber(0));
  entry(21, encodeDictNumber(0));

  return new Uint8Array(bytes);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/** Return a copy of `input` with `hints` written into its CFF table. */
export function addHints(input: Uint8Array, hints: FontHints): Uint8Array {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const numTables = view.getUint16(4);

  let cffOffset = -1;
  let cffLength = 0;
  for (let i = 0; i < numTables; i++) {
    const record = SFNT_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    if (view.getUint32(record) === CFF_TAG) {
      cffOffset = view.getUint32(record + 8);
      cffLength = view.getUint32(record + 12);
    }
  }
  if (cffOffset < 0) throw new Error('the built font has no CFF table');

  const cff = input.subarray(cffOffset, cffOffset + cffLength);

  // header -> Name INDEX -> Top DICT INDEX -> String INDEX -> Global Subr INDEX
  // -> charset -> CharStrings INDEX -> Private DICT, which is the order
  // opentype.js writes and the order this rebuilds in.
  const headerSize = cff[2];
  const nameIndex = readIndex(cff, headerSize);
  const topDictIndex = readIndex(cff, nameIndex.end);
  const topDict = topDictIndex.items[0];
  const topDictStart = topDict.byteOffset - cff.byteOffset;

  const entries = parseDict(cff, topDictStart, topDictStart + topDict.length);
  const find = (op: number) => entries.find((entry) => entry.op === op);
  const charsetEntry = find(OP_CHARSET);
  const charStringsEntry = find(OP_CHARSTRINGS);
  const privateEntry = find(OP_PRIVATE);
  if (!charsetEntry || !charStringsEntry || !privateEntry) {
    throw new Error('the built font has an unexpected CFF Top DICT');
  }

  const charsetOffset = charsetEntry.operands[0];
  const charStringsOffset = charStringsEntry.operands[0];

  const charStrings = readIndex(cff, charStringsOffset);
  if (charStrings.items.length !== hints.glyphs.length) {
    throw new Error(
      `hints cover ${hints.glyphs.length} glyphs but the font has ${charStrings.items.length}`
    );
  }

  const charStringsBytes = buildIndex(
    charStrings.items.map((charstring, index) =>
      injectGlyphHints(charstring, hints.glyphs[index])
    )
  );
  const privateBytes = buildPrivateDict(hints.private);

  // Everything between the Top DICT INDEX and the charset (the String INDEX and
  // the Global Subr INDEX) and the charset itself are copied through unchanged.
  const middle = cff.subarray(topDictIndex.end, charsetOffset);
  const charsetBytes = cff.subarray(charsetOffset, charStringsOffset);

  // The Top DICT is rebuilt rather than patched: `private` is [number, offset],
  // and that first operand is variable-width, so a Private DICT that grows past
  // 107 bytes would need more bytes than the original left room for. Writing
  // all four location operands in the fixed 5-byte form makes the Top DICT's
  // size independent of its values, so one sizing pass is enough.
  const preserved: number[] = [];
  for (const entry of entries) {
    if (
      entry.op === OP_CHARSET ||
      entry.op === OP_ENCODING ||
      entry.op === OP_CHARSTRINGS ||
      entry.op === OP_PRIVATE
    ) {
      continue;
    }
    preserved.push(...cff.subarray(entry.start, entry.end));
  }

  const makeTopDict = (
    charset: number,
    charStringsAt: number,
    privateSize: number,
    privateAt: number
  ) =>
    new Uint8Array([
      ...preserved,
      ...encodeDictOffset(charset),
      ...encodeDictOperator(OP_CHARSET),
      // Standard encoding, which is what opentype.js writes.
      ...encodeDictOffset(0),
      ...encodeDictOperator(OP_ENCODING),
      ...encodeDictOffset(charStringsAt),
      ...encodeDictOperator(OP_CHARSTRINGS),
      ...encodeDictOffset(privateSize),
      ...encodeDictOffset(privateAt),
      ...encodeDictOperator(OP_PRIVATE),
    ]);

  const topDictSize = buildIndex([makeTopDict(0, 0, 0, 0)]).length;
  const base = nameIndex.end + topDictSize;
  const newCharsetOffset = base + middle.length;
  const newCharStringsOffset = newCharsetOffset + charsetBytes.length;
  const newPrivateOffset = newCharStringsOffset + charStringsBytes.length;

  const topDictBytes = buildIndex([
    makeTopDict(
      newCharsetOffset,
      newCharStringsOffset,
      privateBytes.length,
      newPrivateOffset
    ),
  ]);
  if (topDictBytes.length !== topDictSize) {
    throw new Error('CFF Top DICT changed size between passes');
  }

  const out = new Uint8Array(newPrivateOffset + privateBytes.length);
  out.set(cff.subarray(0, nameIndex.end), 0);
  out.set(topDictBytes, nameIndex.end);
  out.set(middle, base);
  out.set(charsetBytes, newCharsetOffset);
  out.set(charStringsBytes, newCharStringsOffset);
  out.set(privateBytes, newPrivateOffset);

  return replaceSfntTable(input, 'CFF ', out);
}

/* -------------------------------------------------------------------------- */
/* Read-back                                                                   */
/* -------------------------------------------------------------------------- */

export type HintReport = {
  /** Private DICT entries, keyed by operator, still delta-encoded as stored. */
  private: Map<number, number[]>;
  /** Count of hstem/vstem operators per glyph, in glyph order. */
  stems: { h: number; v: number }[];
};

/**
 * Read back what `addHints` wrote. opentype.js's CFF parser only knows
 * subrs/defaultWidthX/nominalWidthX, so without this there is no way to assert
 * that a build actually shipped its hints.
 */
export function readHints(input: Uint8Array): HintReport {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const numTables = view.getUint16(4);

  let cffOffset = -1;
  let cffLength = 0;
  for (let i = 0; i < numTables; i++) {
    const record = SFNT_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    if (view.getUint32(record) === CFF_TAG) {
      cffOffset = view.getUint32(record + 8);
      cffLength = view.getUint32(record + 12);
    }
  }
  if (cffOffset < 0) throw new Error('the font has no CFF table');

  const cff = input.subarray(cffOffset, cffOffset + cffLength);
  const nameIndex = readIndex(cff, cff[2]);
  const topDictIndex = readIndex(cff, nameIndex.end);
  const topDict = topDictIndex.items[0];
  const topDictStart = topDict.byteOffset - cff.byteOffset;
  const entries = parseDict(cff, topDictStart, topDictStart + topDict.length);

  const privateEntry = entries.find((entry) => entry.op === OP_PRIVATE);
  const charStringsEntry = entries.find((entry) => entry.op === OP_CHARSTRINGS);
  if (!privateEntry || !charStringsEntry) throw new Error('unexpected CFF Top DICT');

  const [privateSize, privateOffset] = privateEntry.operands;
  const privateEntries = parseDict(cff, privateOffset, privateOffset + privateSize);

  const stems = readIndex(cff, charStringsEntry.operands[0]).items.map((charstring) => {
    let h = 0;
    let v = 0;
    // Only the leading hint operators matter, and they precede the first
    // moveto, so stop there rather than walking the whole outline.
    for (let i = 0; i < charstring.length; i++) {
      const b0 = charstring[i];
      if (b0 === 28) i += 2;
      else if (b0 >= 247 && b0 <= 254) i += 1;
      else if (b0 === 255) i += 4;
      else if (b0 === OP_HSTEM) h++;
      else if (b0 === OP_VSTEM) v++;
      else if (b0 < 32) break;
    }
    return { h, v };
  });

  return {
    private: new Map(privateEntries.map((entry) => [entry.op, entry.operands])),
    stems,
  };
}
