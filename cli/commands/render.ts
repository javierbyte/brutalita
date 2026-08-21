import { basename, extname } from 'node:path';

import { renderTextToSVG } from '../../src/svg-export';
import type { FontWeightType } from '../../src/types';

import { asEnum, asPositive, UsageError } from '../args';
import type { CommandSpec } from '../args';
import { GLOBAL_OPTIONS, SourceError } from '../context';
import type { CommandContext } from '../context';
import { isStdout, resolveText, writeOutput, writeStdout } from '../io';
import { applyConfigOverrides, loadValidatedSource } from '../source';

export const spec = {
  name: 'render',
  summary: 'Render text to a single-stroke .svg',
  usage: 'brutalita render [source] [options]',
  args: [
    {
      name: 'source',
      desc: 'Font JSON, or "-" for stdin. Defaults to ./font.json, ./src/font.json, then the bundled font.',
    },
  ],
  options: {
    text: {
      type: 'string',
      short: 't',
      arg: '<string>',
      desc: 'Text to render; \\n and \\t are expanded',
    },
    'text-file': {
      type: 'string',
      arg: '<file>',
      desc: 'Read the text from a file ("-" for stdin)',
    },
    out: {
      type: 'string',
      short: 'o',
      arg: '<file>',
      desc: 'Output .svg path ("-" for stdout)',
    },
    padding: {
      type: 'string',
      short: 'p',
      arg: '<px>',
      desc: 'Padding around the text',
      default: '16',
    },
    color: {
      type: 'string',
      short: 'c',
      arg: '<css>',
      desc: 'Stroke and dot colour',
      default: '#fff',
    },
    background: {
      type: 'string',
      arg: '<css>',
      desc: 'Paint a rect behind the text',
      default: 'transparent',
    },
    'stroke-width': {
      type: 'string',
      arg: '<n>',
      desc: 'Override the weight-derived stroke width',
    },
    width: {
      type: 'string',
      arg: '<px>',
      desc: 'Scale the output to this pixel width',
    },
    weight: {
      type: 'string',
      short: 'w',
      arg: '<300|400|700>',
      desc: 'Weight to render at',
      default: "the source's weight",
    },
    mono: {
      type: 'boolean',
      short: 'm',
      negatable: true,
      desc: 'Fixed pitch instead of proportional',
      default: "the source's setting",
    },
    'fail-on-missing': {
      type: 'boolean',
      desc: 'Exit non-zero when the text needs glyphs the font lacks',
    },
    strict: { type: 'boolean', desc: 'Treat validation warnings as errors' },
    ...GLOBAL_OPTIONS,
  },
  examples: [
    'brutalita render src/font.json -t "Hello" -o hello.svg',
    'brutalita render src/font.json -t "Hi" --background "#111" --width 800 -o cover.svg',
    'echo "piped" | brutalita render src/font.json -o - > out.svg',
  ],
} satisfies CommandSpec;

type Values = {
  text?: string;
  'text-file'?: string;
  out?: string;
  padding?: string;
  color?: string;
  background?: string;
  'stroke-width'?: string;
  width?: string;
  weight?: string;
  mono?: boolean;
  'fail-on-missing'?: boolean;
  strict?: boolean;
};

export function run(
  values: Values,
  positionals: string[],
  ctx: CommandContext
): number {
  if (positionals.length > 1) {
    throw new UsageError(`render takes one source, got ${positionals.length}`);
  }

  // The source may itself come from stdin, in which case stdin is spent and
  // cannot also supply the text.
  const sourceFromStdin = positionals[0] === '-';
  const source = loadValidatedSource(positionals[0], ctx, {
    strict: values.strict,
  });
  const config = applyConfigOverrides(source.config, values);

  const weight = values.weight
    ? (Number(asEnum(values.weight, '--weight', ['300', '400', '700'])) as FontWeightType)
    : config.weight;

  const text =
    values.text !== undefined || values['text-file'] !== undefined
      ? resolveText(values.text, values['text-file'])
      : sourceFromStdin
        ? undefined
        : resolveText(undefined, undefined);

  if (text === undefined) {
    throw new UsageError(
      'render needs text — pass --text, --text-file, or pipe it via stdin'
    );
  }

  const { svg, missing } = renderTextToSVG(source.chars, text, {
    padding: values.padding ? asPositive(values.padding, '--padding') : undefined,
    color: values.color,
    background: values.background,
    width: values.width ? asPositive(values.width, '--width') : undefined,
    strokeWidth: values['stroke-width']
      ? asPositive(values['stroke-width'], '--stroke-width')
      : undefined,
    weight,
    // The old CLI dropped this, so proportional fonts still rendered monospaced.
    monospace: config.monospace,
  });

  if (isStdout(values.out)) {
    writeStdout(svg);
  } else {
    const outPath =
      values.out ??
      (source.path ? `${basename(source.path, extname(source.path))}.svg` : 'brutalita.svg');
    writeOutput(outPath, svg);
    ctx.logger.success(`${outPath} ${ctx.logger.dim(`(${svg.length} bytes)`)}`);
  }

  if (missing.length) {
    const list = missing.map((char) => JSON.stringify(char)).join(', ');
    if (values['fail-on-missing']) {
      throw new SourceError(`no glyph for: ${list}`);
    }
    ctx.logger.warn(`no glyph for: ${list}`);
  }

  return 0;
}
