import assert from 'node:assert/strict';
import { test } from 'node:test';

// An independent reader: the writer is not checked against itself.
import * as Opentype from 'opentype.js';

import { glyphName, readFont, readHints, writeFont } from '../src';
import type { Contour, FontSource, GlyphSource } from '../src';

const NOTDEF: GlyphSource = { name: '.notdef', advance: 500 };

function source(overrides: Partial<FontSource> = {}): FontSource {
  return {
    names: { family: 'Test Sans', style: 'Regular' },
    ascender: 800,
    descender: -200,
    created: 1700000000,
    glyphs: [NOTDEF],
    ...overrides,
  };
}

function parse(bytes: Uint8Array): Opentype.Font {
  return Opentype.parse(bytes.slice().buffer);
}

/** A parsed glyph's outline in the shape contours are written in. */
function contoursOf(glyph: Opentype.Glyph): number[][][] {
  const contours: number[][][] = [];
  for (const command of glyph.path.commands) {
    const c = command as unknown as Record<string, number> & { type: string };
    if (c.type === 'M') contours.push([[c.x, c.y]]);
    else if (c.type === 'L') contours[contours.length - 1].push([c.x, c.y]);
    else if (c.type === 'C') {
      contours[contours.length - 1].push([c.x1, c.y1, c.x2, c.y2, c.x, c.y]);
    }
  }
  return contours;
}

function roundTrip(contours: Contour[]): number[][][] {
  const font = parse(
    writeFont(source({ glyphs: [NOTDEF, { unicode: 0x41, advance: 600, contours }] }))
  );
  return contoursOf(font.charToGlyph('A'));
}

const SQUARE: Contour = [
  [100, 0],
  [500, 0],
  [500, 400],
  [100, 400],
];

test('outlines come back exactly as they went in', () => {
  const triangle: Contour = [
    [0, 0],
    [300, 700],
    [600, 0],
  ];
  const counter: Contour = [
    [200, 100],
    [200, 300],
    [400, 300],
    [400, 100],
  ];
  assert.deepEqual(roundTrip([triangle]), [triangle]);
  assert.deepEqual(roundTrip([SQUARE, counter]), [SQUARE, counter]);
  // Mixed: diagonals, then a run along the axes, then a diagonal home.
  const mixed: Contour = [
    [0, 0],
    [50, 100],
    [120, 130],
    [120, 400],
    [300, 400],
    [300, 250],
    [310, 250],
    [600, -20],
  ];
  assert.deepEqual(roundTrip([mixed]), [mixed]);
});

test('curves are written as curves', () => {
  const blob: Contour = [
    [300, 0],
    [466, 0, 600, 134, 600, 300],
    [600, 466, 466, 600, 300, 600],
    [100, 600],
    [50, 500, 50, 100, 300, 0],
  ];
  assert.deepEqual(roundTrip([blob]), [blob]);
});

test('long runs are split to fit the interpreter stack, and survive', () => {
  // More points than one operator may carry, of each kind.
  const zigzag: Contour = Array.from({ length: 120 }, (_, i): [number, number] => [
    i * 7,
    i % 2 ? 400 + i : i,
  ]);
  const stairs: Contour = [
    ...Array.from({ length: 80 }, (_, i): [number, number] => [
      Math.ceil(i / 2) * 10,
      Math.floor(i / 2) * 10,
    ]),
    [0, 400],
  ];
  const waves: Contour = [
    [0, 0],
    ...Array.from({ length: 20 }, (_, i): Contour[number] => [
      i * 30 + 10,
      50,
      i * 30 + 20,
      -50,
      i * 30 + 30,
      i % 2 ? 0 : 10,
    ]),
    [300, -400],
  ];
  assert.deepEqual(roundTrip([zigzag]), [zigzag]);
  assert.deepEqual(roundTrip([stairs]), [stairs]);
  assert.deepEqual(roundTrip([waves]), [waves]);
});

test('coordinates are rounded, and points that draw nothing are dropped', () => {
  assert.deepEqual(
    roundTrip([
      [
        [100.4, -0.2],
        [100, 0], // the same point once rounded
        [499.6, 0],
        [500, 400],
        [100, 400],
        [100, 0], // the start again: closing already implies it
      ],
      // Neither of these encloses anything.
      [[10, 10]],
      [
        [0, 0],
        [50, 50],
      ],
    ]),
    [SQUARE]
  );
});

test('the pen carries on from the last point of the contour before', () => {
  const second: Contour = [
    [700, 50],
    [900, 50],
    [900, 250],
  ];
  const font = parse(
    writeFont(
      source({
        glyphs: [
          NOTDEF,
          { unicode: 0x41, advance: 1000, contours: [SQUARE, second, SQUARE] },
        ],
      })
    )
  );
  assert.deepEqual(contoursOf(font.charToGlyph('A')), [SQUARE, second, SQUARE]);
});

test('advances, names and the character map are what was asked for', () => {
  const bytes = writeFont(
    source({
      unitsPerEm: 2048,
      glyphs: [
        NOTDEF,
        { unicode: 0x20, advance: 300 },
        { unicode: 0x41, advance: 600, contours: [SQUARE] },
        { unicode: [0x42, 0x3b2], advance: 650, contours: [SQUARE] },
        { name: 'A.alt', advance: 610, contours: [SQUARE] },
        { unicode: 0x1f600, advance: 900, contours: [SQUARE] },
      ],
    })
  );
  const font = parse(bytes);
  assert.equal(font.unitsPerEm, 2048);
  assert.equal(font.glyphs.length, 6);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => font.glyphs.get(i).name),
    ['.notdef', 'space', 'A', 'B', 'A.alt', 'u1F600']
  );
  assert.equal(font.charToGlyph('A').advanceWidth, 600);
  assert.equal(font.charToGlyphIndex('B'), 3);
  assert.equal(font.charToGlyphIndex('β'), 3);
  assert.equal(font.charToGlyphIndex('😀'), 5);
  assert.equal(font.charToGlyphIndex('Z'), 0);
  assert.equal(font.glyphs.get(4).advanceWidth, 610);

  const summary = readFont(bytes);
  assert.deepEqual(summary.codePoints, [0x20, 0x41, 0x42, 0x3b2, 0x1f600]);
  assert.equal(summary.glyphCount, 6);
  assert.equal(summary.unitsPerEm, 2048);
  assert.equal(summary.ascender, 800);
  assert.equal(summary.descender, -200);
  assert.equal(summary.weightClass, 400);
  assert.equal(summary.names.get(1), 'Test Sans');
});

test('glyphs are named after their character unless told otherwise', () => {
  assert.equal(glyphName('A'), 'A');
  assert.equal(glyphName(0x20), 'space');
  assert.equal(glyphName('Á'), 'uni00C1');
  assert.equal(glyphName(0x1f600), 'u1F600');
});

function nameOf(font: Opentype.Font, key: string): string | undefined {
  const names = font.names as unknown as Record<
    string,
    Record<string, { en: string } | undefined> | undefined
  >;
  return names.windows?.[key]?.en;
}

test('a plain style is named once; a filed one keeps both sets of names', () => {
  const plain = parse(writeFont(source()));
  assert.equal(nameOf(plain, 'fontFamily'), 'Test Sans');
  assert.equal(nameOf(plain, 'fontSubfamily'), 'Regular');
  assert.equal(nameOf(plain, 'fullName'), 'Test Sans Regular');
  assert.equal(nameOf(plain, 'postScriptName'), 'TestSans-Regular');
  assert.equal(nameOf(plain, 'preferredFamily'), undefined);
  // Nothing was said about these, so nothing is written — not even a blank.
  assert.equal(nameOf(plain, 'designer'), undefined);
  assert.equal(nameOf(plain, 'trademark'), undefined);

  const light = parse(
    writeFont(
      source({
        names: {
          family: 'Test Sans',
          style: 'Light Italic',
          legacyFamily: 'Test Sans Light',
          legacyStyle: 'Italic',
          version: 'Version 2.5',
          designer: 'Someone',
          copyright: '   ',
        },
        weightClass: 300,
        italic: true,
        italicAngle: -12,
      })
    )
  );
  assert.equal(nameOf(light, 'fontFamily'), 'Test Sans Light');
  assert.equal(nameOf(light, 'fontSubfamily'), 'Italic');
  assert.equal(nameOf(light, 'preferredFamily'), 'Test Sans');
  assert.equal(nameOf(light, 'preferredSubfamily'), 'Light Italic');
  assert.equal(nameOf(light, 'fullName'), 'Test Sans Light Italic');
  assert.equal(nameOf(light, 'designer'), 'Someone');
  assert.equal(nameOf(light, 'copyright'), undefined);
  assert.equal(light.tables.head.fontRevision, 2.5);
  assert.equal(light.tables.os2.usWeightClass, 300);
  assert.equal(light.tables.post.italicAngle, -12);
  // Italic, not regular, not bold; typographic metrics in force.
  assert.equal(light.tables.os2.fsSelection, 0x81);
  assert.equal(light.tables.head.macStyle, 2);
  assert.equal(light.tables.hhea.caretSlopeRise, 1000);
  assert.equal(light.tables.hhea.caretSlopeRun, 213);
});

test('names outside ASCII are kept where they can be and made safe where not', () => {
  const bytes = writeFont(
    source({ names: { family: 'Ñandú (Über)', style: 'Regular', designer: 'José — ✓' } })
  );
  const font = parse(bytes);
  assert.equal(nameOf(font, 'fontFamily'), 'Ñandú (Über)');
  assert.equal(nameOf(font, 'designer'), 'José — ✓');
  // PostScript names are ASCII with none of the language's own punctuation.
  assert.equal(nameOf(font, 'postScriptName'), 'NanduUber-Regular');
  assert.equal(font.tables.cff.topDict.familyName, 'Nandu (Uber)');
});

test('one line box is written for every platform', () => {
  const font = parse(
    writeFont(
      source({
        ascender: 950,
        descender: -250,
        lineGap: 30,
        capHeight: 700,
        xHeight: 500,
        underline: { position: -120, thickness: 60 },
        strikeout: { position: 280, size: 60 },
        subscript: { size: 500, offset: 80 },
        superscript: { size: 500, offset: 350 },
        monospace: true,
        panose: [2, 11, 5, 9],
        vendorID: 'TEST',
        bold: true,
        weightClass: 700,
        glyphs: [NOTDEF, { unicode: 0x41, advance: 600, contours: [SQUARE] }],
      })
    )
  );
  const { os2, hhea, post, head } = font.tables;
  assert.equal(os2.version, 4);
  assert.deepEqual(
    [hhea.ascender, hhea.descender, hhea.lineGap],
    [950, -250, 30]
  );
  assert.deepEqual(
    [os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap],
    [950, -250, 30]
  );
  assert.deepEqual([os2.usWinAscent, os2.usWinDescent], [950, 250]);
  assert.deepEqual([os2.sCapHeight, os2.sxHeight], [700, 500]);
  assert.deepEqual([os2.yStrikeoutPosition, os2.yStrikeoutSize], [280, 60]);
  assert.deepEqual([post.underlinePosition, post.underlineThickness], [-120, 60]);
  assert.deepEqual(
    [os2.ySubscriptXSize, os2.ySubscriptYSize, os2.ySubscriptYOffset],
    [500, 500, 80]
  );
  assert.deepEqual(
    [os2.ySuperscriptXSize, os2.ySuperscriptYSize, os2.ySuperscriptYOffset],
    [500, 500, 350]
  );
  assert.equal(post.isFixedPitch, 1);
  assert.equal(os2.achVendID, 'TEST');
  assert.equal(os2.fsSelection, 0xa0);
  assert.equal(head.macStyle, 1);
  assert.equal(hhea.caretSlopeRise, 1);
  assert.equal(hhea.caretSlopeRun, 0);
  // Measured from the ink.
  assert.deepEqual([head.xMin, head.yMin, head.xMax, head.yMax], [100, 0, 500, 400]);
  assert.equal(hhea.advanceWidthMax, 600);
  assert.equal(hhea.minLeftSideBearing, 100);
  assert.equal(hhea.minRightSideBearing, 100);
  assert.equal(hhea.xMaxExtent, 500);
  assert.equal(font.tables.hmtx, undefined); // opentype.js folds it into glyphs
  assert.equal(font.charToGlyph('A').leftSideBearing, 100);
});

test('cap height and x-height default to the letters themselves', () => {
  const font = parse(
    writeFont(
      source({
        glyphs: [
          NOTDEF,
          { unicode: 0x48, advance: 600, contours: [[[0, 0], [400, 0], [400, 720], [0, 720]]] },
          { unicode: 0x78, advance: 500, contours: [[[0, 0], [400, 0], [400, 510], [0, 510]]] },
        ],
      })
    )
  );
  assert.deepEqual([font.tables.os2.sCapHeight, font.tables.os2.sxHeight], [720, 510]);
});

test('a curve is measured where it reaches, not at its control points', () => {
  const font = parse(
    writeFont(
      source({
        glyphs: [
          NOTDEF,
          {
            unicode: 0x41,
            advance: 600,
            // Bulges to x = 375, three quarters of the way to its controls.
            contours: [[[0, 0], [500, 0, 500, 400, 0, 400]]],
          },
        ],
      })
    )
  );
  assert.equal(font.tables.head.xMax, 375);
  assert.equal(font.tables.head.yMax, 400);
});

test('kerning pairs are applied by a shaping engine', () => {
  const glyphs: GlyphSource[] = [
    NOTDEF,
    { unicode: 0x41, advance: 600, contours: [SQUARE] },
    { unicode: 0x56, advance: 600, contours: [SQUARE] },
    { unicode: 0x54, advance: 600, contours: [SQUARE] },
  ];
  const font = parse(
    writeFont(
      source({
        glyphs,
        kerning: [
          { left: 'T', right: 'A', value: -70 },
          { left: 'A', right: 'V', value: -50 },
          { left: 'A', right: 'T', value: -40.4 },
          { left: 'V', right: 'V', value: 0 },
        ],
      })
    )
  );
  const pair = (left: string, right: string) =>
    font.getKerningValue(font.charToGlyph(left), font.charToGlyph(right));
  assert.equal(pair('A', 'V'), -50);
  assert.equal(pair('A', 'T'), -40);
  assert.equal(pair('T', 'A'), -70);
  assert.equal(pair('V', 'A'), 0);
  // usMaxContext, under the name opentype.js gives it.
  assert.equal(font.tables.os2.usMaxContent, 2);

  const plain = parse(writeFont(source({ glyphs })));
  assert.equal(plain.tables.gpos, undefined);
  assert.equal(plain.tables.os2.usMaxContent, 0);
});

test('hints are written for the glyph and for the font', () => {
  const bytes = writeFont(
    source({
      glyphs: [
        NOTDEF,
        {
          unicode: 0x41,
          advance: 600,
          contours: [SQUARE],
          hints: {
            h: [
              { edge: 320, width: 80 },
              { edge: 0, width: 80 },
              { edge: 40, width: 80 }, // overlaps the one at 0: dropped
            ],
            v: [{ edge: 100, width: 80 }],
          },
        },
        { unicode: 0x42, advance: 600, contours: [SQUARE] },
      ],
      hints: {
        blueValues: [-10, 0, 500, 510, 700, 710],
        otherBlues: [-210, -200],
        stdHW: 80,
        stdVW: 90,
        stemSnapH: [80, 100],
        forceBold: true,
        blueFuzz: 0,
      },
    })
  );
  const { private: dict, stems } = readHints(bytes);
  assert.deepEqual(stems, [
    { h: 0, v: 0 },
    { h: 1, v: 1 },
    { h: 0, v: 0 },
  ]);
  // Stored as deltas.
  assert.deepEqual(dict.get(6), [-10, 10, 500, 10, 190, 10]);
  assert.deepEqual(dict.get(7), [-210, 10]);
  assert.deepEqual(dict.get(10), [80]);
  assert.deepEqual(dict.get(11), [90]);
  assert.deepEqual(dict.get(1212), [80, 20]);
  assert.deepEqual(dict.get(1214), [1]);
  assert.deepEqual(dict.get(1211), [0]);
  // Hints instruct the rasterizer; they do not redraw the glyph.
  assert.deepEqual(contoursOf(parse(bytes).charToGlyph('A')), [SQUARE]);
});

test('the same description always gives the same bytes, with valid checksums', () => {
  const description = source({
    glyphs: [NOTDEF, { unicode: 0x41, advance: 600, contours: [SQUARE] }],
  });
  const bytes = writeFont(description);
  assert.deepEqual(writeFont(description), bytes);

  // The whole file sums to a fixed constant once head is adjusted for it.
  const view = new DataView(bytes.buffer);
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  assert.equal(bytes.length % 4, 0);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'OTTO');
});

test('a description that cannot be a font is refused, saying why', () => {
  const glyph = (extra: Partial<GlyphSource>): GlyphSource => ({ advance: 500, ...extra });
  assert.throws(() => writeFont(source({ glyphs: [] })), /\.notdef/);
  assert.throws(() => writeFont(source({ glyphs: [glyph({ name: 'A' })] })), /\.notdef/);
  assert.throws(
    () => writeFont(source({ glyphs: [NOTDEF, glyph({ unicode: 65 }), glyph({ name: 'A' })] })),
    /two glyphs are named A/
  );
  assert.throws(
    () => writeFont(source({ glyphs: [NOTDEF, glyph({ unicode: 65 }), glyph({ name: 'B', unicode: 65 })] })),
    /U\+0041 is given to two glyphs/
  );
  assert.throws(
    () => writeFont(source({ kerning: [{ left: 'A', right: 'V', value: -10 }] })),
    /does not have: A V/
  );
  assert.throws(
    () => writeFont(source({ glyphs: [NOTDEF, glyph({ unicode: 65, contours: [[[0, 0, 1, 1, 2, 2], [5, 5], [9, 0]]] })] })),
    /start with a point/
  );
  assert.throws(
    () => writeFont(source({ glyphs: [NOTDEF, glyph({ unicode: 65, advance: 70000 })] })),
    /advance of 70000 is out of range/
  );
});
