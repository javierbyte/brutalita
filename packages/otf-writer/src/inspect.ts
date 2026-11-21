// Read back the few things worth checking in a font file: enough to describe
// one on the command line, and to prove a build wrote the hints it was given.
// Not a font parser — it reads any sfnt's naming and character map, and CFF
// hints only as this library writes them.

export type FontSummary = {
  /** Table tags, in file order. */
  tables: string[];
  /** Name ID to English text. */
  names: Map<number, string>;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** OS/2 usWeightClass; undefined when the font has no OS/2 table. */
  weightClass?: number;
  glyphCount: number;
  /** Every code point the character map covers, ascending. */
  codePoints: number[];
};

type Table = { view: DataView; bytes: Uint8Array };

function tableDirectory(input: Uint8Array): Map<string, Table> {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const tables = new Map<string, Table>();
  if (input.length < 12) throw new Error('not a font file');
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...input.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length > input.length) throw new Error('not a font file');
    const bytes = input.subarray(offset, offset + length);
    tables.set(tag, {
      bytes,
      view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    });
  }
  return tables;
}

function readNames({ view, bytes }: Table): Map<number, string> {
  const names = new Map<number, string>();
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  // Windows English first, then any Unicode record, then old Macintosh ones.
  const rank = (platform: number, language: number) =>
    platform === 3 ? (language === 0x409 ? 0 : 2) : platform === 0 ? 1 : 3;
  const best = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const platform = view.getUint16(record);
    const id = view.getUint16(record + 6);
    const order = rank(platform, view.getUint16(record + 4));
    if ((best.get(id) ?? Infinity) <= order) continue;
    const start = storage + view.getUint16(record + 10);
    const raw = bytes.subarray(start, start + view.getUint16(record + 8));
    let text = '';
    if (platform === 1) {
      // One byte per character; exact for ASCII, which is what they hold.
      text = String.fromCharCode(...raw);
    } else {
      for (let j = 0; j + 1 < raw.length; j += 2) {
        text += String.fromCharCode((raw[j] << 8) | raw[j + 1]);
      }
    }
    best.set(id, order);
    names.set(id, text);
  }
  return names;
}

function readCodePoints({ view }: Table): number[] {
  // The fullest subtable there is: format 12 over format 4.
  let chosen: { offset: number; format: number } | undefined;
  for (let i = 0; i < view.getUint16(2); i++) {
    const offset = view.getUint32(4 + i * 8 + 4);
    const format = view.getUint16(offset);
    if ((format === 4 || format === 12) && format > (chosen?.format ?? 0)) {
      chosen = { offset, format };
    }
  }
  const codes: number[] = [];
  if (!chosen) return codes;
  const at = chosen.offset;

  if (chosen.format === 12) {
    for (let i = 0; i < view.getUint32(at + 12); i++) {
      const group = at + 16 + i * 12;
      const first = view.getUint32(group);
      const glyph = view.getUint32(group + 8);
      for (let code = first; code <= view.getUint32(group + 4); code++) {
        if (glyph + code - first !== 0) codes.push(code);
      }
    }
    return codes;
  }

  const count = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + count * 2 + 2;
  const deltas = starts + count * 2;
  const rangeOffsets = deltas + count * 2;
  for (let i = 0; i < count; i++) {
    const first = view.getUint16(starts + i * 2);
    const rangeOffset = view.getUint16(rangeOffsets + i * 2);
    for (let code = first; code <= view.getUint16(ends + i * 2) && code < 0xffff; code++) {
      let glyph: number;
      if (rangeOffset) {
        glyph = view.getUint16(rangeOffsets + i * 2 + rangeOffset + (code - first) * 2);
        if (glyph) glyph = (glyph + view.getUint16(deltas + i * 2)) & 0xffff;
      } else {
        glyph = (code + view.getUint16(deltas + i * 2)) & 0xffff;
      }
      if (glyph) codes.push(code);
    }
  }
  return codes;
}

/** Describe a font file: any .otf or .ttf, not only one written here. */
export function readFont(input: Uint8Array): FontSummary {
  const tables = tableDirectory(input);
  const need = (tag: string) => {
    const table = tables.get(tag);
    if (!table) throw new Error(`the font has no ${tag} table`);
    return table;
  };
  const hhea = need('hhea').view;
  return {
    tables: [...tables.keys()],
    names: readNames(need('name')),
    unitsPerEm: need('head').view.getUint16(18),
    ascender: hhea.getInt16(4),
    descender: hhea.getInt16(6),
    weightClass: tables.get('OS/2')?.view.getUint16(4),
    glyphCount: need('maxp').view.getUint16(4),
    codePoints: readCodePoints(need('cmap')),
  };
}

/* -------------------------------------------------------------------------- */
/* CFF hints                                                                   */
/* -------------------------------------------------------------------------- */

export type HintReport = {
  /** Private DICT entries, keyed by operator, still delta-encoded as stored. */
  private: Map<number, number[]>;
  /** Count of hstem and vstem operators per glyph, in glyph order. */
  stems: { h: number; v: number }[];
};

function readIndex(data: Uint8Array, position: number) {
  const count = (data[position] << 8) | data[position + 1];
  if (count === 0) return { items: [] as Uint8Array[], end: position + 2 };
  const offSize = data[position + 2];
  const offsets = position + 3;
  const offsetAt = (i: number) => {
    let value = 0;
    for (let j = 0; j < offSize; j++) value = value * 256 + data[offsets + i * offSize + j];
    return value;
  };
  // Offsets are 1-based from the byte before the data.
  const base = offsets + (count + 1) * offSize - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    items.push(data.subarray(base + offsetAt(i), base + offsetAt(i + 1)));
  }
  return { items, end: base + offsetAt(count) };
}

/** A DICT as operator to operands. Reals are not decoded, and read as NaN. */
function readDict(data: Uint8Array): Map<number, number[]> {
  const entries = new Map<number, number[]>();
  let operands: number[] = [];
  for (let i = 0; i < data.length; ) {
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
      // Nibbles, ended by an 0xf nibble.
      i++;
      while (i < data.length && (data[i] & 0x0f) !== 0xf && data[i] >> 4 !== 0xf) i++;
      i++;
      operands.push(NaN);
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
      entries.set(b0 === 12 ? 1200 + data[i + 1] : b0, operands);
      operands = [];
      i += b0 === 12 ? 2 : 1;
    }
  }
  return entries;
}

/**
 * The hinting a CFF font carries: its Private DICT, and how many stem
 * operators each glyph opens with. Font parsers rarely expose either, so
 * without this there is no way to assert that a build shipped its hints.
 */
export function readHints(input: Uint8Array): HintReport {
  const cff = tableDirectory(input).get('CFF ')?.bytes;
  if (!cff) throw new Error('the font has no CFF table');

  const nameIndex = readIndex(cff, cff[2]);
  const topDict = readDict(readIndex(cff, nameIndex.end).items[0]);
  const [privateSize, privateAt] = topDict.get(18) ?? [0, 0];
  const [charStringsAt] = topDict.get(17) ?? [];
  if (charStringsAt === undefined) throw new Error('the font has an unexpected CFF Top DICT');

  const stems = readIndex(cff, charStringsAt).items.map((charstring) => {
    let h = 0;
    let v = 0;
    // Stem operators come before the first moveto, so stop at anything else.
    for (let i = 0; i < charstring.length; i++) {
      const b0 = charstring[i];
      if (b0 === 28) i += 2;
      else if (b0 >= 247 && b0 <= 254) i += 1;
      else if (b0 === 255) i += 4;
      else if (b0 === 1) h++;
      else if (b0 === 3) v++;
      else if (b0 < 32) break;
    }
    return { h, v };
  });

  return { private: readDict(cff.subarray(privateAt, privateAt + privateSize)), stems };
}
