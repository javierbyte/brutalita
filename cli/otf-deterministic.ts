// Make a built .otf byte-reproducible.
//
// opentype.js takes a `createdTimestamp` for head.created but always writes
// head.modified as "now", so two builds of an unchanged source differ. Patching
// the field afterwards means fixing up two checksums as well: head's own entry
// in the table directory, and the whole-file checkSumAdjustment.

const HEAD_TAG = 0x68656164; // 'head'
/** LONGDATETIME counts from 1904-01-01; unix time counts from 1970-01-01. */
const MAC_EPOCH_OFFSET = 2082844800;
const CHECKSUM_MAGIC = 0xb1b0afba;

// Offsets within the head table.
const CHECKSUM_ADJUSTMENT_OFFSET = 8;
const CREATED_OFFSET = 20;
const MODIFIED_OFFSET = 28;

const SFNT_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;

/**
 * Sum of big-endian uint32s over a range, zero-padded to a 4-byte boundary —
 * the OpenType table checksum.
 */
function checksum(buffer: Buffer, offset: number, length: number): number {
  const end = offset + length;
  let sum = 0;
  for (let i = offset; i < end; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      const index = i + j;
      const byte = index < end && index < buffer.length ? buffer[index] : 0;
      word = (word << 8) | byte;
    }
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function findHeadTable(buffer: Buffer): { record: number; offset: number; length: number } {
  const numTables = buffer.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = SFNT_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    if (buffer.readUInt32BE(record) === HEAD_TAG) {
      return {
        record,
        offset: buffer.readUInt32BE(record + 8),
        length: buffer.readUInt32BE(record + 12),
      };
    }
  }
  throw new Error('the built font has no head table');
}

/**
 * Pin head.created and head.modified to `unixSeconds` and repair the checksums.
 * Returns a new buffer; the input is left alone.
 */
export function stampTimestamps(input: Buffer, unixSeconds: number): Buffer {
  const buffer = Buffer.from(input);
  const head = findHeadTable(buffer);

  const stamp = BigInt(unixSeconds + MAC_EPOCH_OFFSET);
  buffer.writeBigInt64BE(stamp, head.offset + CREATED_OFFSET);
  buffer.writeBigInt64BE(stamp, head.offset + MODIFIED_OFFSET);

  // head's table checksum is defined with checkSumAdjustment treated as zero.
  buffer.writeUInt32BE(0, head.offset + CHECKSUM_ADJUSTMENT_OFFSET);
  buffer.writeUInt32BE(
    checksum(buffer, head.offset, head.length),
    head.record + 4
  );

  // checkSumAdjustment then makes the whole file sum to the magic constant.
  const adjustment = (CHECKSUM_MAGIC - checksum(buffer, 0, buffer.length)) >>> 0;
  buffer.writeUInt32BE(adjustment, head.offset + CHECKSUM_ADJUSTMENT_OFFSET);

  return buffer;
}
