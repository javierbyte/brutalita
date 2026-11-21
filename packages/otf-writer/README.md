# otf-writer

Write a static OpenType font with CFF outlines from plain data. One function,
no dependencies, runs in Node and in the browser.

```ts
import { writeFont } from 'otf-writer';

const bytes = writeFont({
  unitsPerEm: 1000,
  names: { family: 'Example', style: 'Regular' },
  ascender: 800,
  descender: -200,
  glyphs: [
    { name: '.notdef', advance: 500 },
    { unicode: 0x20, advance: 250 },
    {
      unicode: 0x41, // "A"
      advance: 600,
      contours: [
        [[50, 0], [300, 700], [550, 0]],
      ],
    },
  ],
});
// bytes is a Uint8Array: write it to Example-Regular.otf, or hand it to FontFace.
```

It is the writer behind [Brutalita](https://brutalita.com), and lives in that
repository as a folder that imports nothing from outside itself.

## What it writes

| Table | Contents |
| --- | --- |
| `CFF ` | Outlines as Type 2 charstrings, stem hints, and the Private DICT |
| `cmap` | Format 4, plus format 12 when a code point lies beyond the BMP |
| `GPOS` | Pair kerning under the `kern` feature, when there are pairs |
| `head`, `hhea`, `hmtx`, `maxp` | Measured from the glyphs |
| `name` | Windows Unicode records, US English |
| `OS/2` | Version 4, with `USE_TYPO_METRICS` |
| `post` | Version 3 |

It does not write TrueType outlines, variable fonts, substitution features,
class-based kerning, subroutines or hint masks.

## Glyphs

The first glyph has to be `.notdef`. A glyph's `name` defaults to the
conventional PostScript name of its first code point: `A`, `space`, `uni00C1`.

A contour is a closed shape: a list of nodes, where a node is a point `[x, y]`
reached by a straight line, or a cubic curve `[c1x, c1y, c2x, c2y, x, y]`. The
first node is the starting point and the last is joined back to it.

```ts
const bowl = [
  [300, 0],
  [466, 0, 600, 134, 600, 300], // curve
  [600, 600],                   // line
  [0, 600],
  [0, 300],
  [0, 134, 134, 0, 300, 0],
];
```

Coordinates are in font units with y up, and are rounded to whole units.
Counters wind the opposite way to the shape they are cut from. Points that
repeat the one before, and contours that enclose nothing, are left out.

Lines are written with the shortest operators that draw them: runs share an
operator, and lines along an axis take one operand, not two.

## Names

`family` and `style` are the names a person would use. Software limited to
four styles per family needs the font filed differently, which
`legacyFamily` and `legacyStyle` say:

```ts
names: {
  family: 'Example',        // name ID 16
  style: 'Light Italic',    // name ID 17
  legacyFamily: 'Example Light', // name ID 1
  legacyStyle: 'Italic',         // name ID 2
}
```

Without the legacy pair, `family` and `style` are written as IDs 1 and 2.
`fullName`, `postScriptName` and `uniqueID` have defaults; the remaining
records (`version`, `copyright`, `designer`, `license`, …) are written only
when given. The PostScript name is reduced to the ASCII that PostScript
allows, so "Ñandú" becomes `Nandu`.

`bold` and `italic` set the style bits of `OS/2` and `head`. `italicAngle`
is in degrees counter-clockwise, so a font leaning right is negative; it also
slopes the text cursor.

## Metrics

`ascender`, `descender` and `lineGap` are written as the typographic, `hhea`
and Windows metrics alike, so a line is the same height on every platform.
`capHeight` and `xHeight` default to the tops of "H" and "x".

`underline` and `strikeout` give the top edge and thickness of each rule.
`subscript` and `superscript` give the em size and baseline shift for software
that fakes them. All four have conventional defaults.

## Hints

```ts
writeFont({
  // …
  glyphs: [
    // …
    {
      unicode: 0x48,
      advance: 700,
      contours: [/* … */],
      hints: {
        h: [{ edge: 320, width: 80 }],                       // y of the crossbar
        v: [{ edge: 100, width: 80 }, { edge: 520, width: 80 }], // x of the stems
      },
    },
  ],
  hints: {
    blueValues: [0, 0, 500, 500, 700, 700],
    otherBlues: [-200, -200],
    stdHW: 80,
    stdVW: 80,
  },
});
```

Stems that overlap one already listed are dropped, since a glyph without a
hint mask may not name overlapping stems.

## Kerning

```ts
kerning: [{ left: 'T', right: 'a', value: -60 }];
```

Pairs name glyphs, and `value` is added to the left glyph's advance.

## Reading back

`readFont(bytes)` describes any `.otf` or `.ttf`: its table tags, English
names, units per em, ascender and descender, weight class, glyph count and
the code points it covers. `readHints(bytes)` returns a CFF font's Private
DICT and the number of stem operators in each glyph. They exist to describe
a file and to test a build. Neither is a font parser.

## Reproducible output

`created` and `modified` are unix seconds and default to now. Pin `created`
and the same description always produces the same bytes.

## Errors

`writeFont` throws when the description cannot be a font: no leading
`.notdef`, two glyphs with one name or one code point, a kerning pair naming
a glyph that is not there, or a number too large for its field.

## Tests

```sh
pnpm test
```

The tests read every font back with opentype.js, an independent parser, so
the writer is never checked against itself.

## License

BSD 3-Clause.
