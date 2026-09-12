import type { KerningPair } from './kerning';
import { replaceSfntTable } from './sfnt';

// GPOS PairPos Format 1 encoder. The kerning calculator is intentionally kept
// outside this module; this boundary accepts glyph IDs and signed font units.

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function i16(value: number): number[] {
  if (value < -32768 || value > 32767) {
    throw new Error(`GPOS adjustment is outside int16: ${value}`);
  }
  return u16(value & 0xffff);
}

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function tag(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function pairPositioning(pairs: readonly KerningPair<number>[]): Uint8Array {
  const byLeft = new Map<number, KerningPair<number>[]>();
  for (const pair of pairs) {
    if (!Number.isInteger(pair.left) || !Number.isInteger(pair.right)) {
      throw new Error('GPOS glyph IDs must be integers');
    }
    const entries = byLeft.get(pair.left) ?? [];
    entries.push(pair);
    byLeft.set(pair.left, entries);
  }
  const lefts = [...byLeft.keys()].sort((a, b) => a - b);
  const headerSize = 10 + lefts.length * 2;
  const pairSets: number[][] = [];
  let cursor = headerSize;
  const offsets: number[] = [];
  for (const left of lefts) {
    const entries = byLeft.get(left)!.sort((a, b) => a.right - b.right);
    const bytes = [
      ...u16(entries.length),
      ...entries.flatMap((entry) => [...u16(entry.right), ...i16(entry.value)]),
    ];
    offsets.push(cursor);
    pairSets.push(bytes);
    cursor += bytes.length;
  }
  const coverageOffset = cursor;
  if (coverageOffset > 0xffff) {
    throw new Error('kerning pairs do not fit in one GPOS PairPos subtable');
  }
  return new Uint8Array([
    ...u16(1), // PairPos format 1: explicit glyph pairs
    ...u16(coverageOffset),
    ...u16(0x0004), // valueRecord1 contains xAdvance
    ...u16(0),
    ...u16(lefts.length),
    ...offsets.flatMap(u16),
    ...pairSets.flat(),
    ...u16(1), // Coverage format 1
    ...u16(lefts.length),
    ...lefts.flatMap(u16),
  ]);
}

/** Build a complete GPOS table with a default-on `kern` feature. */
export function buildKerningGpos(
  pairs: readonly KerningPair<number>[]
): Uint8Array {
  const pairPos = pairPositioning(pairs);
  const langSys = [...u16(0), ...u16(0xffff), ...u16(1), ...u16(0)];
  const script = [...u16(4), ...u16(0), ...langSys];
  // Advertise the same default language system for DFLT and Latin shaping.
  const scripts = [
    ...u16(2),
    ...tag('DFLT'),
    ...u16(14),
    ...tag('latn'),
    ...u16(14),
    ...script,
  ];
  const features = [
    ...u16(1),
    ...tag('kern'),
    ...u16(8),
    ...u16(0),
    ...u16(1),
    ...u16(0),
  ];
  const lookup = [
    ...u16(2), // Pair Adjustment
    ...u16(0),
    ...u16(1),
    ...u16(8),
    ...pairPos,
  ];
  const lookups = [...u16(1), ...u16(4), ...lookup];
  const scriptOffset = 10;
  const featureOffset = scriptOffset + scripts.length;
  const lookupOffset = featureOffset + features.length;
  return new Uint8Array([
    ...u32(0x00010000),
    ...u16(scriptOffset),
    ...u16(featureOffset),
    ...u16(lookupOffset),
    ...scripts,
    ...features,
    ...lookups,
  ]);
}

/** Add standards-based pair kerning to an already serialized OpenType font. */
export function addKerning(
  input: Uint8Array,
  pairs: readonly KerningPair<number>[]
): Uint8Array {
  return pairs.length
    ? replaceSfntTable(input, 'GPOS', buildKerningGpos(pairs))
    : input;
}

