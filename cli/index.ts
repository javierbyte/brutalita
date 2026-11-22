// Entry point for the `brutalita` bin. Run in development with `pnpm cli`;
// scripts/build-cli.ts bundles this into dist/cli/brutalita.mjs (adding the
// node shebang) for publishing.
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

import { version as VERSION } from '../package.json';

import { parseCommandArgs, UsageError } from './args';
import type { CommandSpec, ParsedValues } from './args';
import { GLOBAL_OPTIONS, SourceError } from './context';
import type { CommandContext } from './context';
import { renderCommandHelp, renderRootHelp } from './help';
import { createLogger } from './log';
import type { LogLevel } from './log';

import * as build from './commands/build';
import * as info from './commands/info';
import * as init from './commands/init';
import * as render from './commands/render';
import * as validate from './commands/validate';
import * as watch from './commands/watch';

type Command = {
  spec: CommandSpec;
  // Each command narrows `values` to the flags it declares.
  run: (
    values: never,
    positionals: string[],
    ctx: CommandContext
  ) => number;
};

const COMMANDS: Command[] = [build, render, validate, info, init, watch] as Command[];

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_INVALID_SOURCE = 2;

function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.spec.name === name);
}

/**
 * Pre-0.4 the CLI was a single command: `brutalita font.json -o out.otf`. Keep
 * that working by inferring the subcommand from the arguments.
 */
function inferCommand(argv: string[]): Command | undefined {
  const first = argv[0];
  if (!first || first.startsWith('-') || !existsSync(first)) return undefined;

  const outIndex = argv.findIndex((arg) => arg === '-o' || arg === '--out');
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const wantsSvg =
    argv.includes('-t') ||
    argv.includes('--text') ||
    argv.includes('--text-file') ||
    (out !== undefined && extname(out).toLowerCase() === '.svg');

  return findCommand(wantsSvg ? 'render' : 'build');
}

function levelFrom(values: ParsedValues): LogLevel {
  if (values.quiet === true) return 'quiet';
  if (values.verbose === true) return 'verbose';
  return 'normal';
}

function rootHelp(): string {
  return renderRootHelp(
    COMMANDS.map(({ spec }) => ({ name: spec.name, summary: spec.summary })),
    GLOBAL_OPTIONS,
    VERSION
  );
}

function main(argv: string[]): number {
  // `pnpm cli -- <args>` forwards a literal `--`, which parseArgs would treat as
  // the options terminator; drop a single leading one.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const [first, second] = args;

  const logger = createLogger();

  if (!first || first === '--help' || first === '-h') {
    process.stdout.write(rootHelp());
    return EXIT_OK;
  }

  if (first === '--version' || first === '-V') {
    process.stdout.write(`${VERSION}\n`);
    return EXIT_OK;
  }

  if (first === 'help') {
    const target = second ? findCommand(second) : undefined;
    if (second && !target) {
      logger.error(`unknown command "${second}"`);
      return EXIT_USAGE;
    }
    process.stdout.write(
      target ? renderCommandHelp(target.spec, GLOBAL_OPTIONS) : rootHelp()
    );
    return EXIT_OK;
  }

  const named = findCommand(first);
  const command = named ?? inferCommand(args);
  if (!command) {
    logger.error(
      `unknown command "${first}" — run \`brutalita --help\` for the command list`
    );
    return EXIT_USAGE;
  }

  const parsed = parseCommandArgs(command.spec, named ? args.slice(1) : args);

  if (parsed.values.help === true) {
    process.stdout.write(renderCommandHelp(command.spec, GLOBAL_OPTIONS));
    return EXIT_OK;
  }

  const ctx: CommandContext = {
    logger: createLogger({
      level: levelFrom(parsed.values),
      ...(parsed.values['no-color'] === true ? { color: false } : {}),
    }),
    json: parsed.values.json === true,
  };

  if (!named) {
    ctx.logger.debug(`inferred \`brutalita ${command.spec.name}\` from the arguments`);
  }

  return command.run(parsed.values as never, parsed.positionals, ctx);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  const logger = createLogger();
  if (err instanceof UsageError) {
    logger.error(err.message);
    logger.info('run `brutalita --help` for usage');
    process.exitCode = EXIT_USAGE;
  } else if (err instanceof SourceError) {
    logger.error(err.message);
    process.exitCode = EXIT_INVALID_SOURCE;
  } else {
    logger.error((err as Error).stack ?? String(err));
    process.exitCode = EXIT_USAGE;
  }
}
