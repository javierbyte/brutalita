import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MARK_CLEARANCE, placeMark, turnGlyph } from './compose';
import { validateFontSource } from './font-validate';
import source from './font.json';
import type { CharLayers } from './types';

const { chars } = validateFontSource(source);

/** Topmost (smallest y) and lowest point of a set of layers. */
function span(layers: CharLayers) {
  const ys = layers.flat().map(([, y]) => y);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

test('a mark is centred on the letter and clears its topmost stroke', () => {
  const mark: CharLayers = [[[0, 0], [1, -0.5]]];

  // An x-height letter: the mark's foot lands on the cap line.
  const lowercase = placeMark([[[0, 1], [2, 1], [2, 4]]], mark);
  assert.deepEqual(lowercase, [[[0.5, 0], [1.5, -0.5]]]);

  // The same mark over a capital sits a row higher, on the mark band.
  const capital = placeMark([[[0, 0], [2, 0], [2, 4]]], mark);
  assert.deepEqual(capital, [[[0.5, -1], [1.5, -1.5]]]);

  // Centring follows the base's ink, not the character box.
  const narrow = placeMark([[[0, 1], [1, 1]]], mark);
  assert.deepEqual(narrow, [[[0, 0], [1, -0.5]]]);
});

test('composed glyphs keep their base and clear it by one row', () => {
  for (const [char, base] of [
    ['á', 'a'],
    ['é', 'e'],
    ['í', 'ı'],
    ['ñ', 'n'],
    ['ü', 'u'],
    ['Á', 'A'],
    ['Ñ', 'N'],
    ['Ü', 'U'],
  ]) {
    const layers = chars[char];
    const baseLayers = chars[base];
    assert.deepEqual(
      layers.slice(0, baseLayers.length),
      baseLayers,
      `${char} is still ${base}`
    );

    const markLayers = layers.slice(baseLayers.length);
    assert.ok(markLayers.length, `${char} carries a mark`);
    assert.equal(
      span(markLayers).bottom,
      span(baseLayers).top - MARK_CLEARANCE,
      `${char} clears ${base} by ${MARK_CLEARANCE} row`
    );
  }
});

test('a turned glyph is its base rotated within the cap box', () => {
  assert.deepEqual(chars['¿'], turnGlyph(chars['?']));
  assert.deepEqual(chars['¡'], turnGlyph(chars['!']));
  assert.deepEqual(turnGlyph(turnGlyph(chars['?'])), chars['?']);
});

test('the acute is one drawing, placed on six letters', () => {
  const shape = (char: string, base: string) =>
    JSON.stringify(
      chars[char]
        .slice(chars[base].length)
        .map((layer) => layer.map(([x, y]) => [x - layer[0][0], y - layer[0][1]]))
    );
  const acute = shape('á', 'a');
  for (const [char, base] of [
    ['é', 'e'],
    ['í', 'ı'],
    ['ó', 'o'],
    ['ú', 'u'],
    ['Á', 'A'],
    ['Ó', 'O'],
  ]) {
    assert.equal(shape(char, base), acute, `${char} carries the same acute`);
  }
});

test('a source written before marks existed still validates and builds', () => {
  // Every glyph spelled out as layers, no "marks" key at all: the shape of
  // every font.json exported by the editor up to now.
  const drawn = Object.fromEntries(
    Object.entries(source.chars).filter(([, glyph]) => Array.isArray(glyph))
  );
  const result = validateFontSource({ config: source.config, chars: drawn });

  assert.equal(result.ok, true, result.errors.map((issue) => issue.message).join('\n'));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.chars, drawn);
});

test('rejects composites that name a mark, base or rotation it cannot build', () => {
  const messages = (json: unknown) =>
    validateFontSource(json)
      .errors.map((issue) => issue.message)
      .join('\n');

  const marks = { acute: [[[0.5, 0], [1.5, -0.5]]] };
  assert.match(
    messages({ marks, chars: { a: [[[0, 1]]], á: { base: 'a', mark: 'grave' } } }),
    /no mark named "grave"/
  );
  assert.match(
    messages({ marks, chars: { á: { base: 'a', mark: 'acute' } } }),
    /no glyph for base "a"/
  );
  assert.match(
    messages({ chars: { '?': [[[0, 0]]], '¿': { base: '?', rotate: 90 } } }),
    /rotate must be 180/
  );
  assert.match(
    messages({ chars: { a: { base: 'b' }, b: { base: 'a' } } }),
    /is built from itself/
  );
});

test('warns about a mark drawn outside its band', () => {
  const warnings = validateFontSource({
    marks: { acute: [[[0.5, 1], [1.5, -1]]] },
    chars: { a: [[[0, 1]]] },
  }).warnings.map((issue) => `${issue.field} ${issue.message}`);

  assert.ok(
    warnings.some((message) => /marks\.acute .*outside the -0\.5\.\.0 mark band/.test(message)),
    warnings.join('\n')
  );
  assert.ok(
    warnings.some((message) => /marks\.acute .*foot sits on y=1/.test(message)),
    warnings.join('\n')
  );
});
