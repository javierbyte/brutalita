// GPOS with a single lookup: pair kerning (PairPos format 1), on by default
// through the `kern` feature for the default and Latin scripts.
import { Bytes } from './bytes';

/** A pair by glyph index: `value` is added to the left glyph's advance. */
export type IndexedPair = { left: number; right: number; value: number };

function pairPositioning(pairs: readonly IndexedPair[]): Bytes {
  const byLeft = new Map<number, IndexedPair[]>();
  for (const pair of pairs) {
    const entries = byLeft.get(pair.left) ?? [];
    entries.push(pair);
    byLeft.set(pair.left, entries);
  }
  // Coverage, and each set of second glyphs, are searched: both go in order.
  const lefts = [...byLeft.keys()].sort((a, b) => a - b);

  const sets = new Bytes();
  const offsets: number[] = [];
  const header = 10 + lefts.length * 2;
  for (const left of lefts) {
    const entries = byLeft.get(left)!.sort((a, b) => a.right - b.right);
    offsets.push(header + sets.length);
    sets.u16(entries.length);
    for (const entry of entries) sets.u16(entry.right).i16(entry.value);
  }
  const coverage = header + sets.length;
  if (coverage > 0xffff) {
    throw new Error(
      `${pairs.length} kerning pairs do not fit in one GPOS subtable`
    );
  }

  return new Bytes()
    .u16(1, coverage) // PairPos format 1: explicit glyph pairs
    .u16(0x0004, 0) // the first glyph's xAdvance is adjusted; the second is left alone
    .u16(lefts.length, ...offsets)
    .bytes(sets.data)
    .u16(1, lefts.length, ...lefts); // Coverage format 1
}

export function buildGpos(pairs: readonly IndexedPair[]): Uint8Array {
  const pairPos = pairPositioning(pairs);

  // Two scripts sharing one default language system, which asks for feature 0.
  const scripts = new Bytes()
    .u16(2)
    .ascii('DFLT')
    .u16(14)
    .ascii('latn')
    .u16(14)
    .u16(4, 0) // Script: default LangSys follows, no others
    .u16(0, 0xffff, 1, 0); // LangSys: no required feature, one feature, index 0
  const features = new Bytes().u16(1).ascii('kern').u16(8).u16(0, 1, 0);
  const lookups = new Bytes()
    .u16(1, 4) // one lookup, right after this list
    .u16(2, 0, 1, 8) // pair adjustment, no flags, one subtable
    .bytes(pairPos.data);

  const scriptsAt = 10;
  const featuresAt = scriptsAt + scripts.length;
  return new Bytes()
    .u32(0x00010000)
    .u16(scriptsAt, featuresAt, featuresAt + features.length)
    .bytes(scripts.data)
    .bytes(features.data)
    .bytes(lookups.data)
    .toUint8Array();
}
