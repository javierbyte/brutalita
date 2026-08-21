import { formatIssue, validateFontSource } from '../../src/font-validate';
import type { Issue } from '../../src/font-validate';

import type { CommandSpec } from '../args';
import { GLOBAL_OPTIONS, SourceError } from '../context';
import type { CommandContext } from '../context';
import { loadSource, writeStdout } from '../io';

export const spec = {
  name: 'validate',
  summary: 'Check a font source for errors',
  usage: 'brutalita validate [source...] [options]',
  args: [
    {
      name: 'source...',
      desc: 'One or more font JSON files. Defaults to the usual lookup.',
    },
  ],
  options: {
    strict: { type: 'boolean', desc: 'Treat warnings as errors' },
    ...GLOBAL_OPTIONS,
  },
  sections: [
    {
      title: 'Checks',
      body: [
        '  errors    multi-character keys, malformed or non-finite coordinates,',
        '            a missing or empty chars map',
        '  warnings  coordinates off the 0.5 grid or outside it, unknown config',
        '            keys, an unsupported weight, empty layers, repeated points,',
        '            missing printable ASCII',
      ].join('\n'),
    },
  ],
  examples: [
    'brutalita validate src/font.json',
    'brutalita validate fonts/*.json --strict',
  ],
} satisfies CommandSpec;

type Values = { strict?: boolean };

type Report = {
  source: string;
  ok: boolean;
  glyphs: number;
  errors: Issue[];
  warnings: Issue[];
};

function describe(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function run(
  values: Values,
  positionals: string[],
  ctx: CommandContext
): number {
  const targets = positionals.length ? positionals : [undefined];
  const reports: Report[] = [];

  for (const target of targets) {
    const source = loadSource(target);
    const result = validateFontSource(source.json);
    reports.push({
      source: source.label,
      ok: result.ok && (!values.strict || !result.warnings.length),
      glyphs: Object.keys(result.chars).length,
      errors: result.errors,
      warnings: result.warnings,
    });

    if (ctx.json) continue;

    for (const issue of result.errors) {
      ctx.logger.error(formatIssue(issue, source.label));
    }
    for (const issue of result.warnings) {
      ctx.logger.warn(formatIssue(issue, source.label));
    }

    const counts = [
      describe(result.errors.length, 'error'),
      describe(result.warnings.length, 'warning'),
    ].join(', ');

    if (result.ok && !result.warnings.length) {
      ctx.logger.success(`${source.label} — ${describe(Object.keys(result.chars).length, 'glyph')}, no issues`);
    } else {
      ctx.logger.info(`${source.label} — ${counts}`);
    }
  }

  const failed = reports.filter((report) => !report.ok);

  if (ctx.json) {
    writeStdout(
      `${JSON.stringify(
        {
          ok: failed.length === 0,
          reports: reports.map((report) => ({
            ...report,
            errors: report.errors.map((issue) => formatIssue(issue)),
            warnings: report.warnings.map((issue) => formatIssue(issue)),
          })),
        },
        null,
        2
      )}\n`
    );
  }

  if (failed.length) {
    throw new SourceError(
      `${describe(failed.length, 'source')} failed validation`
    );
  }
  return 0;
}
