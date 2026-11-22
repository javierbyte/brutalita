import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { readFont } from '../../packages/otf-writer/src';
import type { FontSummary } from '../../packages/otf-writer/src';
import { fontLayout, fontMetrics, fontName } from '../../src/font-maker';
import { styleName } from '../../src/weights';
import { PRINTABLE_ASCII } from '../../src/font-validate';

import { UsageError } from '../args';
import type { CommandSpec, ValuesOf } from '../args';
import { GLOBAL_OPTIONS } from '../context';
import type { CommandContext } from '../context';
import { writeStdout } from '../io';
import { loadValidatedSource } from '../source';

export const spec = {
  name: 'info',
  summary: 'Describe a font source or a built .otf',
  usage: 'brutalita info [source|font.otf] [options]',
  args: [
    { name: 'target', desc: 'A font JSON source, or a built .otf to read back' },
  ],
  options: {
    coverage: { type: 'boolean', desc: 'List the characters the font covers' },
    ...GLOBAL_OPTIONS,
  },
  examples: [
    'brutalita info src/font.json',
    'brutalita info public/font/Brutalita-Regular.otf --coverage',
  ],
} satisfies CommandSpec;

type Values = ValuesOf<typeof spec>;

function emit(
  ctx: CommandContext,
  rows: [string, string][],
  payload: Record<string, unknown>
): void {
  if (ctx.json) {
    writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    ctx.logger.info(`${ctx.logger.dim(`${label}:`.padEnd(width + 2))}${value}`);
  }
}

// Reading a built .otf back is the way to verify a build without a font editor.
function describeOtf(path: string, values: Values, ctx: CommandContext): number {
  let font: FontSummary;
  try {
    font = readFont(readFileSync(path));
  } catch (err) {
    throw new UsageError(`could not parse ${path}: ${(err as Error).message}`);
  }

  // The typographic names first: names 1 and 2 file every weight but Regular
  // and Bold as a family of its own ("Brutalita Light" / "Regular").
  const family = font.names.get(16) ?? font.names.get(1) ?? '(unnamed)';
  const style = font.names.get(17) ?? font.names.get(2) ?? '(none)';
  const designer = font.names.get(9);
  const fontVersion = font.names.get(5);
  const covered = font.codePoints.map((code) => String.fromCodePoint(code));

  const rows: [string, string][] = [
    ['file', path],
    ['family', family],
    ['style', style],
    ['version', fontVersion ?? '(unset)'],
    ['designer', designer ?? '(none)'],
    ['weightClass', String(font.weightClass ?? '(unset)')],
    ['unitsPerEm', String(font.unitsPerEm)],
    ['ascender', String(font.ascender)],
    ['descender', String(font.descender)],
    ['glyphs', String(font.glyphCount)],
    ['covered', `${covered.length} characters`],
  ];
  if (values.coverage) {
    rows.push(['coverage', covered.join('')]);
  }

  emit(ctx, rows, {
    kind: 'otf',
    file: path,
    family,
    style,
    version: fontVersion ?? null,
    designer: designer ?? null,
    weightClass: font.weightClass ?? null,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    glyphs: font.glyphCount,
    covered: values.coverage ? covered : covered.length,
  });
  return 0;
}

function describeSource(
  target: string | undefined,
  values: Values,
  ctx: CommandContext
): number {
  const source = loadValidatedSource(target, ctx, { quietWarnings: true });
  const { config, chars } = source;
  const metrics = fontMetrics(config);

  const charKeys = Object.keys(chars).sort();
  let layers = 0;
  let points = 0;
  for (const char of charKeys) {
    layers += chars[char].length;
    for (const layer of chars[char]) points += layer.length;
  }

  // Advance widths come out of the real build, so `info` reports what will
  // actually ship rather than an approximation.
  const layout = fontLayout(chars, config);
  const advances = [
    metrics.monospaceAdvance, // .notdef
    ...Object.keys(chars).map(
      (char) => layout.glyphs.get(char)?.advance ?? layout.spaceAdvance
    ),
  ];
  const advance = config.monospace
    ? { fixed: metrics.monospaceAdvance }
    : { min: Math.min(...advances), max: Math.max(...advances) };
  const missing = PRINTABLE_ASCII.filter((char) => !(char in chars));

  const rows: [string, string][] = [
    ['source', source.label],
    ['family', fontName(config)],
    ['style', `${styleName(config)} (${config.weight})`],
    ['spacing', config.monospace ? 'monospace' : 'proportional'],
    ['designer', config.designer || '(none)'],
    ['glyphs', String(charKeys.length)],
    ['layers', String(layers)],
    ['points', String(points)],
    ['unitsPerEm', String(metrics.unitsPerEm)],
    ['ascender', String(metrics.ascender)],
    ['descender', String(metrics.descender)],
    [
      'advance',
      'fixed' in advance
        ? `${advance.fixed} (fixed)`
        : `${advance.min}–${advance.max}`,
    ],
    [
      'ASCII',
      missing.length
        ? `${PRINTABLE_ASCII.length - missing.length}/${PRINTABLE_ASCII.length} — missing ${missing
            .map((char) => JSON.stringify(char))
            .join(' ')}`
        : 'complete',
    ],
  ];
  if (values.coverage) {
    rows.push(['coverage', charKeys.join('')]);
  }

  emit(ctx, rows, {
    kind: 'source',
    source: source.label,
    family: fontName(config),
    style: styleName(config),
    weight: config.weight,
    monospace: config.monospace,
    designer: config.designer ?? null,
    glyphs: charKeys.length,
    layers,
    points,
    metrics,
    advance,
    missingAscii: missing,
    coverage: values.coverage ? charKeys : undefined,
    warnings: source.warnings.length,
  });
  return 0;
}

export function run(
  values: Values,
  positionals: string[],
  ctx: CommandContext
): number {
  if (positionals.length > 1) {
    throw new UsageError(`info takes one target, got ${positionals.length}`);
  }
  const target = positionals[0];

  if (target && target !== '-' && extname(target).toLowerCase() === '.otf') {
    return describeOtf(target, values, ctx);
  }
  return describeSource(target, values, ctx);
}
