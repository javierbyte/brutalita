/** A growing run of big-endian bytes: the only way tables are written. */
export class Bytes {
  readonly data: number[] = [];

  get length(): number {
    return this.data.length;
  }

  u8(...values: number[]): this {
    for (const value of values) this.data.push(value & 0xff);
    return this;
  }

  u16(...values: number[]): this {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
        throw new RangeError(`${value} does not fit in a uint16`);
      }
      this.data.push(value >>> 8, value & 0xff);
    }
    return this;
  }

  i16(...values: number[]): this {
    for (const value of values) {
      if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) {
        throw new RangeError(`${value} does not fit in an int16`);
      }
      this.data.push((value >> 8) & 0xff, value & 0xff);
    }
    return this;
  }

  u32(...values: number[]): this {
    for (const value of values) {
      this.data.push(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff
      );
    }
    return this;
  }

  /** A signed 16.16 fixed-point number. */
  fixed(value: number): this {
    return this.u32(Math.round(value * 0x10000) >>> 0);
  }

  /** LONGDATETIME: seconds since 1904-01-01, from unix seconds. */
  date(unixSeconds: number): this {
    const seconds = Math.round(unixSeconds) + 2082844800;
    return this.u32(Math.floor(seconds / 0x100000000), seconds >>> 0);
  }

  /** ASCII text, one byte per character. */
  ascii(text: string): this {
    for (let i = 0; i < text.length; i++) this.data.push(text.charCodeAt(i) & 0xff);
    return this;
  }

  /** Any run of bytes. A loop, not a spread: tables outgrow the call stack. */
  bytes(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.data.push(values[i]);
    return this;
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.data);
  }
}
