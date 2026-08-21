// Everything a command needs beyond its own parsed flags. Split out so command
// modules and the dispatcher can both import it without a cycle.
import { UsageError } from './args';
import type { OptionSpec } from './args';
import type { Logger } from './log';

export type CommandContext = {
  logger: Logger;
  /** --json: emit a machine-readable result on stdout instead of prose. */
  json: boolean;
};

/** Options every command accepts, merged into each spec so parsing stays strict. */
export const GLOBAL_OPTIONS = {
  help: { type: 'boolean', short: 'h', desc: 'Show help for this command' },
  quiet: { type: 'boolean', short: 'q', desc: 'Only print errors' },
  verbose: { type: 'boolean', short: 'v', desc: 'Print extra detail' },
  json: { type: 'boolean', desc: 'Emit a machine-readable result on stdout' },
  'no-color': { type: 'boolean', desc: 'Disable coloured output' },
} as const satisfies Record<string, OptionSpec>;

export type GlobalOptions = typeof GLOBAL_OPTIONS;

/** Commands signal a clean failure by throwing; the dispatcher maps it to exit 2. */
export class SourceError extends Error {}

export { UsageError };
