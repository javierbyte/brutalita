import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Opentype from 'opentype.js';

import { buildFontBytes, fontMetrics } from './font-maker';
import { validateFontSource } from './font-validate';
import source from './font.json';
import { glyphName } from './glyph-names';
import { SHIPPED_WEIGHTS, styleLink, styleName } from './weights';

const { config, chars } = validateFontSource(source);

function build(overrides: object = {}) {
  const bytes = buildFontBytes(chars, { ...config, ...overrides });
  return Opentype.parse(bytes.slice().buffer);
}

function name(font: Opentype.Font, key: string): string {
  const names = font.names as unknown as Record<
    string,
    Record<string, { en: string } | undefined>
  >;
  return names.windows[key]?.en ?? '';
}

test('glyph names are PostScript identifiers that map back to their character', () => {
  assert.equal(glyphName('A'), 'A');
  assert.equal(glyphName(' '), 'space');
  assert.equal(glyphName('0'), 'zero');
  assert.equal(glyphName('('), 'parenleft');
  assert.equal(glyphName('Á'), 'uni00C1');
  assert.equal(glyphName('↕'), 'uni2195');
  assert.equal(glyphName('😀'), 'u1F600');

  const font = build();
  const seen = new Set<string>();
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    const label = `glyph ${i} ${JSON.stringify(glyph.name)}`;
    assert.match(glyph.name ?? '', /^\.notdef$|^[A-Za-z_][A-Za-z0-9._]*$/, label);
    assert.ok(!seen.has(glyph.name ?? ''), `${label} is a duplicate`);
    seen.add(glyph.name ?? '');
    if (i > 0) {
      assert.equal(glyph.name, glyphName(String.fromCodePoint(glyph.unicode!)));
    }
  }
});

test('only Regular and Bold share the bare family in the four-style names', () => {
  assert.deepEqual(styleLink({ weight: 400 }), {
    familySuffix: '',
    subfamily: 'Regular',
    bold: false,
    italic: false,
  });
  assert.deepEqual(styleLink({ weight: 700, slant: 10 }), {
    familySuffix: '',
    subfamily: 'Bold Italic',
    bold: true,
    italic: true,
  });
  assert.deepEqual(styleLink({ weight: 300, slant: 10 }), {
    familySuffix: 'Light',
    subfamily: 'Italic',
    bold: false,
    italic: true,
  });
  assert.equal(styleLink({ weight: 550 }).familySuffix, '550');
  assert.equal(
    styleLink({ weight: 400, styleName: 'Poster' }).familySuffix,
    'Poster'
  );

  // No two shipped styles may answer to the same family + style pair, in
  // either naming scheme.
  for (const slant of [0, 10]) {
    const legacy = new Set<string>();
    for (const weight of SHIPPED_WEIGHTS) {
      const font = build({ weight, slant });
      const style = styleName({ weight, slant });
      const link = styleLink({ weight, slant });
      const label = `${weight} slant ${slant}`;

      assert.equal(name(font, 'preferredFamily'), 'Brutalita', label);
      assert.equal(name(font, 'preferredSubfamily'), style, label);
      assert.equal(name(font, 'fullName'), `Brutalita ${style}`, label);
      assert.equal(name(font, 'uniqueID'), `javierbyte: Brutalita ${style}`, label);
      assert.equal(
        name(font, 'fontFamily'),
        `Brutalita ${link.familySuffix}`.trim(),
        label
      );
      assert.equal(name(font, 'fontSubfamily'), link.subfamily, label);

      const key = `${name(font, 'fontFamily')}/${name(font, 'fontSubfamily')}`;
      assert.ok(!legacy.has(key), `${label} collides on ${key}`);
      legacy.add(key);

      // fsSelection and macStyle say the same thing as name ID 2.
      const selection = font.tables.os2.fsSelection;
      const bold = weight === 700;
      assert.equal(!!(selection & 32), bold, `${label} bold bit`);
      assert.equal(!!(selection & 1), !!slant, `${label} italic bit`);
      assert.equal(!!(selection & 64), !bold && !slant, `${label} regular bit`);
      assert.equal(
        font.tables.head.macStyle,
        (bold ? 1 : 0) | (slant ? 2 : 0),
        `${label} macStyle`
      );
      assert.equal(font.tables.os2.usWeightClass, weight, label);

      // The CFF table's own names are the real family and style.
      const topDict = font.tables.cff.topDict;
      assert.equal(topDict.familyName, 'Brutalita', label);
      assert.equal(topDict.weight, style, label);
      assert.equal(topDict.fullName, `Brutalita ${style}`, label);
    }
  }
});

test('strikeout is a stem thick and centred on the x-height', () => {
  for (const weight of SHIPPED_WEIGHTS) {
    const cfg = { ...config, weight };
    const { stem, capHeight, row } = fontMetrics(cfg);
    const os2 = build({ weight }).tables.os2;
    const xHeight = capHeight - row;
    assert.equal(os2.yStrikeoutSize, stem);
    // yStrikeoutPosition is the top of the rule.
    assert.ok(Math.abs(os2.yStrikeoutPosition - stem / 2 - xHeight / 2) <= 1);
  }
});

test('an italic leans its caret by the slant, and an upright leaves it vertical', () => {
  const upright = build().tables.hhea;
  assert.equal(upright.caretSlopeRun, 0);
  const italic = build({ slant: 12 }).tables.hhea;
  assert.equal(italic.caretSlopeRise, 1000);
  assert.equal(
    italic.caretSlopeRun,
    Math.round(1000 * Math.tan((12 * Math.PI) / 180))
  );
});
