#!/usr/bin/env -S npx tsx
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { buildFont, fontFileName } from '../src/font-maker';
import { renderTextToSVG } from '../src/svg-export';
import { DEFAULT_FONT_CONFIG } from '../src/font-config';
import type {
  FontConfig,
  FontDefinition,
  FontWeightType,
} from '../src/types';

const HELP = `brutalita — export a JSON font config to .otf or .svg

Usage:
  brutalita <config.json> -o <output> [options]

The input is the editor's JSON ({ "config": {...}, "chars": {...} }).
The format is taken from the --out extension (.otf / .svg) unless --format is given.

Options:
  -o, --out <file>        Output path. Defaults to a name derived from the config.
  -f, --format <otf|svg>  Force the output format.
  -h, --help              Show this help.

SVG only:
  -t, --text <string>     Text to render. "\\n" starts a new line.
      --text-file <file>  Read the text from a file instead (or pipe via stdin).
  -p, --padding <n>       Padding around the text in px (default 16).
  -c, --color <css>       Stroke/dot color (default #fff).
      --stroke-width <n>  Override the weight-derived stroke width.

Config overrides:
  -w, --weight <300|400|700>  Override the font weight.
      --name <string>         Override the font name (otf).
      --mono / --no-mono      Force monospace on/off.

Examples:
  brutalita src/font.json -o Brutalita.otf
  brutalita src/font.json -o hello.svg -t "Hello\\nWorld" -p 24
`;

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function parseWeight(value: string): FontWeightType {
  const n = Number(value);
  if (n === 300 || n === 400 || n === 700) return n;
  return fail(`--weight must be 300, 400 or 700 (got "${value}")`);
}

function parseNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fail(`${flag} must be a number (got "${value}")`);
  return n;
}

function main() {
  // `pnpm cli -- <args>` forwards a literal `--` into argv; Node's parseArgs would
  // treat it as the options terminator (turning later flags into positionals), so
  // drop a single leading `--`.
  const argv = process.argv.slice(2);
  const args = argv[0] === '--' ? argv.slice(1) : argv;

  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      text: { type: 'string', short: 't' },
      'text-file': { type: 'string' },
      padding: { type: 'string', short: 'p' },
      color: { type: 'string', short: 'c' },
      'stroke-width': { type: 'string' },
      weight: { type: 'string', short: 'w' },
      name: { type: 'string' },
      mono: { type: 'boolean' },
      'no-mono': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const input = positionals[0];
  if (!input) {
    process.stderr.write(HELP);
    process.exit(1);
  }

  // Read + parse the JSON font config.
  let parsed: { config?: Partial<FontConfig>; chars?: FontDefinition };
  try {
    parsed = JSON.parse(readFileSync(input, 'utf8'));
  } catch (err) {
    return fail(`could not read JSON from "${input}": ${(err as Error).message}`);
  }
  const chars = parsed.chars;
  if (!chars || typeof chars !== 'object') {
    return fail(`"${input}" has no "chars" map — expected { config, chars }`);
  }

  // Build the effective config: file config, then CLI overrides.
  const config: FontConfig = { ...DEFAULT_FONT_CONFIG, ...parsed.config };
  if (values.weight) config.weight = parseWeight(values.weight);
  if (values.name) config.name = values.name;
  if (values.mono) config.monospace = true;
  if (values['no-mono']) config.monospace = false;

  // Resolve the output format.
  const out = values.out;
  let format = values.format;
  if (!format && out) {
    const ext = extname(out).toLowerCase();
    if (ext === '.otf') format = 'otf';
    else if (ext === '.svg') format = 'svg';
  }
  if (format !== 'otf' && format !== 'svg') {
    return fail(
      'could not determine output format — pass --format otf|svg or an --out ending in .otf/.svg'
    );
  }

  if (format === 'otf') {
    const outPath = out ?? fontFileName(config);
    const font = buildFont(chars, config);
    const buffer = Buffer.from(font.toArrayBuffer());
    writeFileSync(outPath, buffer);
    process.stdout.write(
      `wrote ${outPath} (${buffer.length} bytes, ${Object.keys(chars).length} glyphs)\n`
    );
    return;
  }

  // format === 'svg'
  const text = resolveText(values.text, values['text-file']);
  if (text === undefined) {
    return fail('SVG export needs text — pass --text, --text-file, or pipe it via stdin');
  }

  const { svg, missing } = renderTextToSVG(chars, text, {
    padding: values.padding ? parseNumber(values.padding, '--padding') : undefined,
    color: values.color,
    strokeWidth: values['stroke-width']
      ? parseNumber(values['stroke-width'], '--stroke-width')
      : undefined,
    weight: config.weight,
  });

  const outPath = out ?? `${basename(input, extname(input))}.svg`;
  writeFileSync(outPath, svg);
  process.stdout.write(`wrote ${outPath}\n`);
  if (missing.length) {
    process.stderr.write(
      `warning: no glyph for: ${missing.map((c) => JSON.stringify(c)).join(', ')}\n`
    );
  }
}

// Resolve SVG text from --text (with \n / \t escapes), --text-file, or stdin.
function resolveText(
  textFlag: string | undefined,
  textFile: string | undefined
): string | undefined {
  if (textFlag !== undefined) {
    return textFlag.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
  if (textFile !== undefined) {
    return readFileSync(textFile, 'utf8');
  }
  if (!process.stdin.isTTY) {
    try {
      const piped = readFileSync(0, 'utf8');
      if (piped.length) return piped.replace(/\n$/, '');
    } catch {
      // no stdin available
    }
  }
  return undefined;
}

main();
