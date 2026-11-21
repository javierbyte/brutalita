// The sfnt container: a directory of tables, each checksummed, and one more
// checksum over the whole file kept in `head`.
import { Bytes } from './bytes';

const HEADER_SIZE = 12;
const RECORD_SIZE = 16;
/** Where `head` keeps checkSumAdjustment. */
const ADJUSTMENT_OFFSET = 8;
const CHECKSUM_MAGIC = 0xb1b0afba;

function checksum(data: Uint8Array, offset = 0, length = data.length): number {
  let sum = 0;
  // Tables are zero-padded to four bytes, so reading past `length` is reading
  // padding. Past the end of the file there is nothing, which also reads as 0.
  for (let i = offset; i < offset + length; i += 4) {
    sum =
      (sum +
        (((data[i] ?? 0) << 24) |
          ((data[i + 1] ?? 0) << 16) |
          ((data[i + 2] ?? 0) << 8) |
          (data[i + 3] ?? 0))) >>>
      0;
  }
  return sum;
}

/** Lay tables out as a complete font file. Tags are four ASCII characters. */
export function assembleSfnt(
  tables: Record<string, Uint8Array>,
  flavor = 'OTTO'
): Uint8Array {
  // The directory is sorted by tag, and the data follows in the same order.
  const tags = Object.keys(tables).sort();
  for (const tag of tags) {
    if (tag.length !== 4) throw new Error(`sfnt tag must be four characters: ${tag}`);
  }
  const padded = (length: number) => (length + 3) & ~3;

  const entrySelector = Math.floor(Math.log2(tags.length));
  const searchRange = 2 ** entrySelector * RECORD_SIZE;
  const header = new Bytes()
    .ascii(flavor)
    .u16(
      tags.length,
      searchRange,
      entrySelector,
      tags.length * RECORD_SIZE - searchRange
    );

  let offset = HEADER_SIZE + tags.length * RECORD_SIZE;
  const total = tags.reduce((sum, tag) => sum + padded(tables[tag].length), offset);
  const output = new Uint8Array(total);

  let headOffset = -1;
  for (const tag of tags) {
    const data = tables[tag];
    output.set(data, offset);
    if (tag === 'head') {
      headOffset = offset;
      // Its own checksum is defined with the adjustment still zero.
      output.fill(0, offset + ADJUSTMENT_OFFSET, offset + ADJUSTMENT_OFFSET + 4);
    }
    header.ascii(tag).u32(checksum(output, offset, data.length), offset, data.length);
    offset += padded(data.length);
  }
  output.set(header.data, 0);

  if (headOffset >= 0) {
    new DataView(output.buffer).setUint32(
      headOffset + ADJUSTMENT_OFFSET,
      (CHECKSUM_MAGIC - checksum(output)) >>> 0
    );
  }
  return output;
}
