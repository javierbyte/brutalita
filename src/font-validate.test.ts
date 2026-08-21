import assert from 'node:assert/strict';
import { test } from 'node:test';

import source from './font.json';
import { formatIssue, validateFontSource } from './font-validate';

function messages(issues: { message: string }[]): string {
  return issues.map((issue) => issue.message).join('\n');
}

test('the shipped font validates cleanly', () => {
  const result = validateFontSource(source);
  assert.equal(result.ok, true, messages(result.errors));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [], messages(result.warnings));
  assert.equal(Object.keys(result.chars).length, 96);
  assert.equal(result.config.weight, 400);
  assert.equal(result.config.monospace, false);
});

test('rejects a source that is not an object', () => {
  for (const input of [null, 42, 'font', ['A']]) {
    assert.equal(validateFontSource(input).ok, false);
  }
});

test('rejects a missing or empty chars map', () => {
  assert.match(
    messages(validateFontSource({ config: {} }).errors),
    /missing or not an object/
  );
  assert.match(
    messages(validateFontSource({ chars: {} }).errors),
    /no characters found/
  );
});

test('rejects multi-character keys', () => {
  const result = validateFontSource({ chars: { AB: [[[0, 0]]] } });
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /exactly one character/);
  // The bad glyph is dropped, the rest of the font still parses.
  assert.deepEqual(Object.keys(result.chars), []);
});

test('rejects malformed and non-finite coordinates', () => {
  const result = validateFontSource({
    chars: {
      A: [[[0, 0, 0]]],
      B: [[[0, 'x']]],
      C: [[[0, Number.NaN]]],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
  assert.match(messages(result.errors), /must be a \[x, y\] pair/);
  assert.match(messages(result.errors), /must be finite numbers/);
});

test('warns about off-grid and off-step coordinates without failing', () => {
  const result = validateFontSource({
    chars: { A: [[[0, 0], [2.5, 1]]], B: [[[0.3, 1], [1, 1]]] },
  });
  assert.equal(result.ok, true);
  assert.match(messages(result.warnings), /x=2\.5 is outside the 0\.\.2 grid/);
  assert.match(messages(result.warnings), /\[0\.3, 1\] is not on the 0\.5 step grid/);
});

test('warns about repeated points, empty layers and unknown config keys', () => {
  const result = validateFontSource({
    config: { wobble: true, weight: 500 },
    chars: { A: [[[0, 0], [0, 0]], []] },
  });
  assert.match(messages(result.warnings), /unknown config key/);
  assert.match(messages(result.warnings), /not one of 300, 400, 700/);
  assert.match(messages(result.warnings), /repeats the previous point/);
  assert.match(messages(result.warnings), /empty layer/);
  // An unsupported weight falls back rather than failing the build.
  assert.equal(result.config.weight, 400);
});

test('warns about missing printable ASCII', () => {
  const result = validateFontSource({ chars: { A: [[[0, 0], [1, 1]]] } });
  assert.match(messages(result.warnings), /no glyph for 94 printable ASCII/);
});

test('formatIssue includes the label and location', () => {
  const result = validateFontSource({ chars: { A: [[[0, 'x']]] } });
  assert.equal(
    formatIssue(result.errors[0], 'font.json'),
    'font.json "A" layer 1 point 1: coordinates must be finite numbers (got [0,"x"])'
  );
});
