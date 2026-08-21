import { existsSync } from 'node:fs';
import { join } from 'node:path';

import bundledSource from '../../src/font.json';
import { DEFAULT_FONT_CONFIG } from '../../src/font-config';
import { PRINTABLE_ASCII } from '../../src/font-validate';
import type { FontDefinition } from '../../src/types';

import { asEnum, UsageError } from '../args';
import type { CommandSpec } from '../args';
import { GLOBAL_OPTIONS } from '../context';
import type { CommandContext } from '../context';
import { writeOutput } from '../io';

const FILENAME = 'font.json';

export const spec = {
  name: 'init',
  summary: 'Create a starter font source',
  usage: 'brutalita init [dir] [options]',
  args: [{ name: 'dir', desc: 'Where to write font.json. Defaults to the current directory.' }],
  options: {
    from: {
      type: 'string',
      arg: '<blank|brutalita>',
      desc: 'blank seeds every printable ASCII glyph empty; brutalita copies the shipped font',
      default: 'blank',
    },
    name: { type: 'string', arg: '<string>', desc: 'Family name for the new font' },
    force: { type: 'boolean', desc: 'Overwrite an existing font.json' },
    ...GLOBAL_OPTIONS,
  },
  examples: ['brutalita init', 'brutalita init my-font --from brutalita --name "My Font"'],
} satisfies CommandSpec;

type Values = { from?: string; name?: string; force?: boolean };

export function run(
  values: Values,
  positionals: string[],
  ctx: CommandContext
): number {
  if (positionals.length > 1) {
    throw new UsageError(`init takes one directory, got ${positionals.length}`);
  }

  const from = asEnum(values.from ?? 'blank', '--from', ['blank', 'brutalita']);
  const path = join(positionals[0] ?? '.', FILENAME);

  if (existsSync(path) && !values.force) {
    throw new UsageError(`${path} already exists — pass --force to overwrite`);
  }

  // The JSON import widens coordinates to number[]; the shipped font is
  // validated by src/font-validate.test.ts, so the shape is safe to assert.
  const template = bundledSource as unknown as {
    config: typeof DEFAULT_FONT_CONFIG;
    chars: FontDefinition;
  };

  const chars: FontDefinition =
    from === 'brutalita'
      ? template.chars
      : Object.fromEntries(PRINTABLE_ASCII.map((char) => [char, []]));

  const config = {
    ...DEFAULT_FONT_CONFIG,
    ...(from === 'brutalita' ? template.config : {}),
    ...(values.name ? { name: values.name } : {}),
  };

  writeOutput(path, `${JSON.stringify({ config, chars }, null, 2)}\n`);
  ctx.logger.success(
    `${path} ${ctx.logger.dim(`(${Object.keys(chars).length} glyphs, from ${from})`)}`
  );
  ctx.logger.info(
    `Edit it at https://brutalita.com, or run: brutalita build ${path} -o ${config.name.replace(/\s+/g, '')}.otf`
  );
  return 0;
}
