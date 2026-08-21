import { watch as watchFile } from 'node:fs';

import { UsageError } from '../args';
import type { CommandSpec } from '../args';
import { SourceError } from '../context';
import type { CommandContext } from '../context';
import { loadSource } from '../io';
import * as build from './build';

const DEBOUNCE_MS = 100;

export const spec = {
  name: 'watch',
  summary: 'Rebuild whenever the source changes',
  usage: 'brutalita watch [source] [build options]',
  args: [{ name: 'source', desc: 'Font JSON to watch. Must be a real file.' }],
  // Watch is build plus a loop, so it accepts exactly build's flags.
  options: build.spec.options,
  examples: [
    'brutalita watch src/font.json -d public -w all',
    'brutalita watch my-font.json -o MyFont.otf',
  ],
} satisfies CommandSpec;

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function run(
  values: build.Values,
  positionals: string[],
  ctx: CommandContext
): number {
  const source = loadSource(positionals[0]);
  if (!source.path) {
    throw new UsageError(
      'watch needs a file on disk — stdin and the bundled font cannot be watched'
    );
  }

  const rebuild = () => {
    try {
      build.run(values, [source.path as string], ctx);
    } catch (err) {
      // Keep watching: a half-edited JSON file is the normal case here.
      if (err instanceof SourceError || err instanceof UsageError) {
        ctx.logger.error(err.message);
      } else {
        ctx.logger.error((err as Error).message);
      }
    }
  };

  ctx.logger.info(`watching ${source.label} ${ctx.logger.dim('(ctrl-c to stop)')}`);
  rebuild();

  let pending: NodeJS.Timeout | undefined;
  watchFile(source.path, () => {
    // Editors write in several steps; collapse the burst into one rebuild.
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      ctx.logger.info(ctx.logger.dim(`[${timestamp()}] rebuilding…`));
      rebuild();
    }, DEBOUNCE_MS);
  });

  // fs.watch keeps the event loop alive; the process ends on ctrl-c.
  return 0;
}
