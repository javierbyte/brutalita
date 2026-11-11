// PostScript glyph names. A CFF font names every glyph, and the name has to be
// a PostScript identifier: letters, digits, "." and "_", not starting with a
// digit. Naming a glyph after its own character breaks that for the space,
// every digit and all punctuation, which validators reject and PDF writers
// cannot map back to text. Kept free of opentype.js so anything can import it.

/** Adobe Glyph List names for the printable ASCII that is not a letter. */
const ASCII_NAMES: Record<string, string> = {
  ' ': 'space',
  '!': 'exclam',
  '"': 'quotedbl',
  '#': 'numbersign',
  $: 'dollar',
  '%': 'percent',
  '&': 'ampersand',
  "'": 'quotesingle',
  '(': 'parenleft',
  ')': 'parenright',
  '*': 'asterisk',
  '+': 'plus',
  ',': 'comma',
  '-': 'hyphen',
  '.': 'period',
  '/': 'slash',
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  ':': 'colon',
  ';': 'semicolon',
  '<': 'less',
  '=': 'equal',
  '>': 'greater',
  '?': 'question',
  '@': 'at',
  '[': 'bracketleft',
  '\\': 'backslash',
  ']': 'bracketright',
  '^': 'asciicircum',
  _: 'underscore',
  '`': 'grave',
  '{': 'braceleft',
  '|': 'bar',
  '}': 'braceright',
  '~': 'asciitilde',
};

/**
 * The glyph name for a character: the letter itself for A–Z and a–z, the Adobe
 * name for the rest of ASCII, and the generic `uniXXXX` (`uXXXXX` beyond the
 * BMP) for everything else, which any consumer can turn back into a code point
 * without carrying the full glyph list.
 */
export function glyphName(char: string): string {
  if (/^[A-Za-z]$/.test(char)) return char;
  const ascii = ASCII_NAMES[char];
  if (ascii) return ascii;
  const code = char.codePointAt(0) ?? 0;
  const hex = code.toString(16).toUpperCase();
  return code > 0xffff ? `u${hex.padStart(5, '0')}` : `uni${hex.padStart(4, '0')}`;
}
