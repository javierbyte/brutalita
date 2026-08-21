import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import Opentype from 'opentype.js';

import { buildFont, fontMetrics, fontName, STYLE_NAME_BY_WEIGHT } from '../../src/font-maker';
import { PRINTABLE_ASCII } from '../../src/font-validate';

import { UsageError } from '../args';
import type { CommandSpec } from '../args';
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
    'brutalita info public/Brutalita-400.otf --coverage',
  ],
} satisfies CommandSpec;

type Values = { coverage?: boolean };

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
  const buffer = readFileSync(path);
  let font: Opentype.Font;
  try {
    font = Opentype.parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
  } catch (err) {
    throw new UsageError(`could not parse ${path}: ${(err as Error).message}`);
  }

  // opentype.js v2 groups names by platform (unicode / macintosh / windows);
  // any of them carries the same strings, so take the first that has one.
  const names = font.names as unknown as Record<
    string,
    Record<string, Record<string, string>>
  >;
  const readName = (key: string): string | undefined => {
    for (const platform of ['unicode', 'windows', 'macintosh']) {
      const value = names[platform]?.[key]?.en;
      if (value) return value;
    }
    return undefined;
  };

  const family = readName('fontFamily') ?? '(unnamed)';
  const style = readName('fontSubfamily') ?? '(none)';
  const designer = readName('designer');
  const fontVersion = readName('version');

  const covered: string[] = [];
  for (let code = 0; code <= 0xffff; code++) {
    const glyphIndex = font.charToGlyphIndex(String.fromCharCode(code));
    if (glyphIndex > 0) covered.push(String.fromCharCode(code));
  }

  const rows: [string, string][] = [
    ['file', path],
    ['family', family],
    ['style', style],
    ['version', fontVersion ?? '(unset)'],
    ['designer', designer ?? '(none)'],
    ['weightClass', String(font.tables.os2?.usWeightClass ?? '(unset)')],
    ['unitsPerEm', String(font.unitsPerEm)],
    ['ascender', String(font.ascender)],
    ['descender', String(font.descender)],
    ['glyphs', String(font.glyphs.length)],
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
    weightClass: font.tables.os2?.usWeightClass ?? null,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    glyphs: font.glyphs.length,
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

  const charKeys = Object.keys(chars);
  let layers = 0;
  let points = 0;
  for (const char of charKeys) {
    layers += chars[char].length;
    for (const layer of chars[char]) points += layer.length;
  }

  // Advance widths come out of the real build, so `info` reports what will
  // actually ship rather than an approximation.
  const font = buildFont(chars, config);
  const advances = font.glyphs.length
    ? Array.from({ length: font.glyphs.length }, (_, i) => font.glyphs.get(i).advanceWidth ?? 0)
    : [0];
  const missing = PRINTABLE_ASCII.filter((char) => !(char in chars));

  const rows: [string, string][] = [
    ['source', source.label],
    ['family', fontName(config)],
    ['style', `${STYLE_NAME_BY_WEIGHT[config.weight]} (${config.weight})`],
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
      config.monospace
        ? `${metrics.monospaceAdvance} (fixed)`
        : `${Math.min(...advances)}–${Math.max(...advances)}`,
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
    rows.push(['coverage', charKeys.sort().join('')]);
  }

  emit(ctx, rows, {
    kind: 'source',
    source: source.label,
    family: fontName(config),
    style: STYLE_NAME_BY_WEIGHT[config.weight],
    weight: config.weight,
    monospace: config.monospace,
    designer: config.designer ?? null,
    glyphs: charKeys.length,
    layers,
    points,
    metrics,
    advance: config.monospace
      ? { fixed: metrics.monospaceAdvance }
      : { min: Math.min(...advances), max: Math.max(...advances) },
    missingAscii: missing,
    coverage: values.coverage ? charKeys.sort() : undefined,
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
