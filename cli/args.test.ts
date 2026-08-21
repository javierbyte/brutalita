import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  asEnum,
  asList,
  asNumber,
  asPositive,
  parseCommandArgs,
  UsageError,
} from './args';
import type { CommandSpec } from './args';

const spec: CommandSpec = {
  name: 'demo',
  summary: 'demo',
  usage: 'demo',
  options: {
    out: { type: 'string', short: 'o', desc: 'out' },
    weight: { type: 'string', short: 'w', desc: 'weight' },
    mono: { type: 'boolean', short: 'm', negatable: true, desc: 'mono' },
    strict: { type: 'boolean', desc: 'strict' },
  },
};

test('parses strings, shorts and positionals', () => {
  const { values, positionals } = parseCommandArgs(spec, [
    'font.json',
    '-o',
    'out.otf',
    '--weight',
    '700',
  ]);
  assert.equal(values.out, 'out.otf');
  assert.equal(values.weight, '700');
  assert.deepEqual(positionals, ['font.json']);
});

test('--no-<flag> sets a negatable boolean to false', () => {
  assert.equal(parseCommandArgs(spec, ['--no-mono']).values.mono, false);
  assert.equal(parseCommandArgs(spec, ['--mono']).values.mono, true);
  assert.equal(parseCommandArgs(spec, ['-m']).values.mono, true);
  // Absent means undefined, which is how commands tell "unset" from "off".
  assert.equal(parseCommandArgs(spec, []).values.mono, undefined);
});

test('rejects a flag and its negation together, in either spelling', () => {
  assert.throws(() => parseCommandArgs(spec, ['--mono', '--no-mono']), UsageError);
  assert.throws(() => parseCommandArgs(spec, ['--no-mono', '--mono']), UsageError);
  assert.throws(() => parseCommandArgs(spec, ['-m', '--no-mono']), UsageError);
});

test('--no-<flag> on a non-negatable option is an unknown option', () => {
  assert.throws(() => parseCommandArgs(spec, ['--no-strict']), UsageError);
});

test('rejects unknown options', () => {
  assert.throws(() => parseCommandArgs(spec, ['--nope']), UsageError);
  assert.throws(() => parseCommandArgs(spec, ['-z']), UsageError);
});

test('-- passes later arguments through as positionals', () => {
  const { positionals } = parseCommandArgs(spec, ['--', '--not-a-flag']);
  assert.deepEqual(positionals, ['--not-a-flag']);
});

test('asNumber / asPositive', () => {
  assert.equal(asNumber('16', '--padding'), 16);
  assert.equal(asNumber('-3', '--padding'), -3);
  assert.throws(() => asNumber('wide', '--padding'), UsageError);
  assert.equal(asPositive('0', '--width'), 0);
  assert.throws(() => asPositive('-1', '--width'), UsageError);
});

test('asEnum reports the allowed values', () => {
  assert.equal(asEnum('400', '--weight', ['300', '400']), '400');
  assert.throws(
    () => asEnum('500', '--weight', ['300', '400']),
    /--weight must be one of 300, 400/
  );
});

test('asList splits, trims and rejects empty', () => {
  assert.deepEqual(asList('300, 400 ,700', '--weight'), ['300', '400', '700']);
  assert.throws(() => asList(' , ', '--weight'), UsageError);
});
