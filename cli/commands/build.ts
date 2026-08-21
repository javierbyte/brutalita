import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildFont,
  fontName,
  STYLE_NAME_BY_WEIGHT,
} from '../../src/font-maker';
import type { FontConfig } from '../../src/types';

import { UsageError } from '../args';
import type { CommandSpec } from '../args';
import { GLOBAL_OPTIONS } from '../context';
import type { CommandContext } from '../context';
import { isStdout, writeOutput, writeStdout } from '../io';
import { formatBytes } from '../log';
import { stampTimestamps } from '../otf-deterministic';
import {
  applyConfigOverrides,
  loadValidatedSource,
  renderFilename,
  resolveWeights,
} from '../source';
import { parseTimestamp } from '../timestamp';

const DEFAULT_FILENAME = '{name}-{style}.{ext}';

export const spec = {
  name: 'build',
  summary: 'Compile a font source to .otf',
  usage: 'brutalita build [source] [options]',
  args: [
    {
      name: 'source',
      desc: 'Font JSON ({ config, chars }), or "-" for stdin. Defaults to ./font.json, ./src/font.json, then the bundled font.',
    },
  ],
  options: {
    out: {
      type: 'string',
      short: 'o',
      arg: '<file>',
      desc: 'Write one .otf here ("-" for stdout)',
    },
    'out-dir': {
      type: 'string',
      short: 'd',
      arg: '<dir>',
      desc: 'Write into this directory, named by --filename',
    },
    filename: {
      type: 'string',
      arg: '<template>',
      desc: 'Name template for --out-dir',
      default: DEFAULT_FILENAME,
    },
    'no-clobber': {
      type: 'boolean',
      desc: 'Refuse to overwrite an existing file',
    },
    'dry-run': { type: 'boolean', desc: 'Report what would be written' },
    weight: {
      type: 'string',
      short: 'w',
      arg: '<list>',
      desc: '300, 400, 700 — comma-separated, or "all"',
      default: "the source's weight",
    },
    mono: {
      type: 'boolean',
      short: 'm',
      negatable: true,
      desc: 'Monospaced metrics',
      default: "the source's setting",
    },
    name: { type: 'string', arg: '<string>', desc: 'Override the family name' },
    designer: { type: 'string', arg: '<string>', desc: 'Override the designer' },
    'designer-url': {
      type: 'string',
      arg: '<url>',
      desc: 'Override the designer URL',
    },
    timestamp: {
      type: 'string',
      arg: '<when>',
      desc: 'ISO date or unix seconds for head.created/modified, making the output byte-reproducible',
    },
    strict: { type: 'boolean', desc: 'Treat validation warnings as errors' },
    ...GLOBAL_OPTIONS,
  },
  sections: [
    {
      title: 'Filename tokens',
      body: '  {name} {slug} {style} {weight} {mono} {ext}',
    },
  ],
  examples: [
    'brutalita build src/font.json -o Brutalita.otf',
    'brutalita build src/font.json -d public -w all --filename "Brutalita-{weight}.{ext}"',
    'brutalita build src/font.json -w 700 -o - > Bold.otf',
  ],
} satisfies CommandSpec;

/** The subset of parsed flags this command reads. */
export type Values = {
  out?: string;
  'out-dir'?: string;
  filename?: string;
  'no-clobber'?: boolean;
  'dry-run'?: boolean;
  weight?: string;
  mono?: boolean;
  name?: string;
  designer?: string;
  'designer-url'?: string;
  timestamp?: string;
  strict?: boolean;
};

type Output = {
  path: string;
  weight: number;
  style: string;
  bytes: number;
  glyphs: number;
};

export function run(
  values: Values,
  positionals: string[],
  ctx: CommandContext
): number {
  if (positionals.length > 1) {
    throw new UsageError(`build takes one source, got ${positionals.length}`);
  }

  const source = loadValidatedSource(positionals[0], ctx, {
    strict: values.strict,
  });
  const baseConfig = applyConfigOverrides(source.config, values);
  const weights = resolveWeights(values.weight, baseConfig.weight);
  const toStdout = isStdout(values.out);
  const createdTimestamp = parseTimestamp(values.timestamp);

  if (weights.length > 1 && values.out) {
    throw new UsageError(
      `--out writes a single file but ${weights.length} weights were requested — use --out-dir`
    );
  }
  if (values.out && values['out-dir']) {
    throw new UsageError('--out and --out-dir are mutually exclusive');
  }

  const glyphCount = Object.keys(source.chars).length;
  const outputs: Output[] = [];

  for (const weight of weights) {
    const config: FontConfig = { ...baseConfig, weight };
    const style = STYLE_NAME_BY_WEIGHT[weight];

    const font = buildFont(source.chars, config, { createdTimestamp });
    let bytes: Buffer = Buffer.from(font.toArrayBuffer());
    if (createdTimestamp !== undefined) {
      bytes = stampTimestamps(bytes, createdTimestamp);
    }

    if (toStdout) {
      if (!values['dry-run']) writeStdout(bytes);
      ctx.logger.debug(`wrote ${formatBytes(bytes.length)} to stdout`);
      outputs.push({
        path: '-',
        weight,
        style,
        bytes: bytes.length,
        glyphs: glyphCount,
      });
      continue;
    }

    const filename = renderFilename(
      values.filename ?? DEFAULT_FILENAME,
      config,
      style,
      'otf'
    );
    const path = values.out ?? join(values['out-dir'] ?? '.', filename);

    if (values['no-clobber'] && existsSync(path)) {
      throw new UsageError(`${path} already exists (--no-clobber)`);
    }

    if (values['dry-run']) {
      ctx.logger.info(
        `would write ${path} (${formatBytes(bytes.length)}, ${glyphCount} glyphs)`
      );
    } else {
      writeOutput(path, bytes);
      ctx.logger.success(
        `${path} ${ctx.logger.dim(
          `(${formatBytes(bytes.length)}, ${glyphCount} glyphs, ${fontName(
            config
          )} ${style})`
        )}`
      );
    }

    outputs.push({
      path,
      weight,
      style,
      bytes: bytes.length,
      glyphs: glyphCount,
    });
  }

  if (ctx.json) {
    writeStdout(
      `${JSON.stringify(
        {
          ok: true,
          source: source.label,
          family: fontName(baseConfig),
          monospace: baseConfig.monospace,
          dryRun: Boolean(values['dry-run']),
          outputs,
          warnings: source.warnings.length,
        },
        null,
        2
      )}\n`
    );
  }

  return 0;
}
