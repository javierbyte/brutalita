// Minimal sfnt table reassembly shared by post-processors. OpenType.js does
// not serialize every table Brutalita needs, so features can replace or add a
// table without knowing anything about the rest of the font.

const CHECKSUM_MAGIC = 0xb1b0afba;
const HEADER_SIZE = 12;
const RECORD_SIZE = 16;
const HEAD = 0x68656164; // 'head'

function checksum(data: Uint8Array, offset = 0, length = data.length): number {
  const end = offset + length;
  let sum = 0;
  for (let i = offset; i < end; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      const at = i + j;
      word = (word << 8) | (at < end && at < data.length ? data[at] : 0);
    }
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function tagNumber(tag: string): number {
  if (tag.length !== 4) throw new Error(`sfnt tag must be four characters: ${tag}`);
  return (
    (tag.charCodeAt(0) << 24) |
    (tag.charCodeAt(1) << 16) |
    (tag.charCodeAt(2) << 8) |
    tag.charCodeAt(3)
  ) >>> 0;
}

/** Return a new font with one table added or replaced. The input is untouched. */
export function replaceSfntTable(
  input: Uint8Array,
  tagName: string,
  replacement: Uint8Array
): Uint8Array {
  const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const replacedTag = tagNumber(tagName);
  const count = inputView.getUint16(4);
  const tables: { tag: number; data: Uint8Array }[] = [];

  for (let i = 0; i < count; i++) {
    const record = HEADER_SIZE + i * RECORD_SIZE;
    const tag = inputView.getUint32(record);
    const offset = inputView.getUint32(record + 8);
    const length = inputView.getUint32(record + 12);
    tables.push({
      tag,
      data:
        tag === replacedTag
          ? replacement
          : input.slice(offset, offset + length),
    });
  }
  if (!tables.some((table) => table.tag === replacedTag)) {
    tables.push({ tag: replacedTag, data: replacement });
  }
  tables.sort((a, b) => a.tag - b.tag);

  const numTables = tables.length;
  const power = 2 ** Math.floor(Math.log2(numTables));
  let total = HEADER_SIZE + numTables * RECORD_SIZE;
  for (const table of tables) total += (table.data.length + 3) & ~3;

  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  view.setUint32(0, inputView.getUint32(0));
  view.setUint16(4, numTables);
  view.setUint16(6, power * RECORD_SIZE);
  view.setUint16(8, Math.log2(power));
  view.setUint16(10, numTables * RECORD_SIZE - power * RECORD_SIZE);

  let cursor = HEADER_SIZE + numTables * RECORD_SIZE;
  let headRecord = -1;
  let headOffset = -1;
  let headLength = 0;
  tables.forEach((table, index) => {
    const record = HEADER_SIZE + index * RECORD_SIZE;
    output.set(table.data, cursor);
    view.setUint32(record, table.tag);
    view.setUint32(record + 4, checksum(output, cursor, table.data.length));
    view.setUint32(record + 8, cursor);
    view.setUint32(record + 12, table.data.length);
    if (table.tag === HEAD) {
      headRecord = record;
      headOffset = cursor;
      headLength = table.data.length;
    }
    cursor += (table.data.length + 3) & ~3;
  });

  // The head checksum is defined with checkSumAdjustment zero, even after the
  // final adjustment is written into the table.
  if (headOffset >= 0) {
    view.setUint32(headOffset + 8, 0);
    view.setUint32(headRecord + 4, checksum(output, headOffset, headLength));
    view.setUint32(
      headOffset + 8,
      (CHECKSUM_MAGIC - checksum(output)) >>> 0
    );
  }
  return output;
}

