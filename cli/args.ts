// A thin spec layer over node:util parseArgs. Commands declare their options
// once; parsing, `--no-x` negation, coercion and help text all derive from that
// single declaration so they cannot drift apart.
import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export type OptionSpec = {
  type: 'string' | 'boolean';
  short?: string;
  /** One-line description shown in help. */
  desc: string;
  /** Placeholder for string options, e.g. "<file>". */
  arg?: string;
  /** Booleans only: also accept `--no-<name>` to set it false. */
  negatable?: boolean;
  /** Allow the flag to repeat; values collect into an array. */
  multiple?: boolean;
  /** Shown as "(default: ...)" in help. Purely documentation. */
  default?: string;
};

export type CommandSpec = {
  name: string;
  summary: string;
  usage: string;
  /** Positional arguments, for the help header only. */
  args?: { name: string; desc: string }[];
  options: Record<string, OptionSpec>;
  /** Extra help sections, rendered after the options. */
  sections?: { title: string; body: string }[];
  examples?: string[];
};

// parseArgs produces booleans for boolean options and strings for string ones;
// absent flags are undefined. Each command narrows this to its own shape — the
// spec is the single source of truth, so a mismatch shows up immediately in use.
export type ParsedValues = Record<
  string,
  string | boolean | string[] | boolean[] | undefined
>;

export type ParseResult = {
  values: ParsedValues;
  positionals: string[];
};

// `--no-mono` is not a parseArgs feature: it would be an unknown option. Rewrite
// it into the underlying flag before parsing, and record the negation so the
// caller sees `mono: false` rather than a second independent boolean (which is
// how the old CLI handled --mono/--no-mono, letting both be passed at once).
function expandNegations(
  args: string[],
  options: Record<string, OptionSpec>
): { args: string[]; negated: Set<string> } {
  const negatable = new Set(
    Object.keys(options).filter((key) => options[key].negatable)
  );
  const negated = new Set<string>();
  const out: string[] = [];

  let passthrough = false;
  for (const arg of args) {
    if (passthrough) {
      out.push(arg);
      continue;
    }
    if (arg === '--') {
      passthrough = true;
      out.push(arg);
      continue;
    }

    const match = /^--no-(.+)$/.exec(arg);
    if (match && negatable.has(match[1])) {
      negated.add(match[1]);
      continue;
    }
    out.push(arg);
  }

  return { args: out, negated };
}

export function parseCommandArgs(
  spec: CommandSpec,
  argv: string[]
): ParseResult {
  const { args, negated } = expandNegations(argv, spec.options);

  const parseOptions: Record<
    string,
    { type: 'string' | 'boolean'; short?: string; multiple?: boolean }
  > = {};
  for (const [name, option] of Object.entries(spec.options)) {
    parseOptions[name] = {
      type: option.type,
      ...(option.short ? { short: option.short } : {}),
      ...(option.multiple ? { multiple: true } : {}),
    };
  }

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: parseOptions,
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    // parseArgs messages are already precise ("Unknown option '--foo'"); wrap
    // them so the dispatcher can print usage alongside.
    throw new UsageError((err as Error).message);
  }

  const values = parsed.values as Record<string, unknown>;
  for (const name of negated) {
    // Catches `--mono --no-mono` and `-m --no-mono` alike: parseArgs has already
    // resolved the positive form, whichever spelling was used.
    if (values[name] === true) {
      throw new UsageError(`--${name} and --no-${name} are mutually exclusive`);
    }
    values[name] = false;
  }

  return {
    values: values as ParsedValues,
    positionals: parsed.positionals,
  };
}

// --- coercion -------------------------------------------------------------
// Each helper names the flag in its error so the user knows what to fix.

export function asNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UsageError(`${flag} must be a number (got ${JSON.stringify(value)})`);
  }
  return n;
}

export function asPositive(value: string, flag: string): number {
  const n = asNumber(value, flag);
  if (n < 0) throw new UsageError(`${flag} must not be negative (got ${n})`);
  return n;
}

export function asEnum<const T extends readonly string[]>(
  value: string,
  flag: string,
  allowed: T
): T[number] {
  if (!allowed.includes(value)) {
    throw new UsageError(
      `${flag} must be one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`
    );
  }
  return value;
}

/** Split a comma-separated flag value, trimming and dropping empties. */
export function asList(value: string, flag: string): string[] {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new UsageError(`${flag} must not be empty`);
  return parts;
}
