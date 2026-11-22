// Load + validate a font source and apply CLI config overrides. Shared by
// build, render, info and watch so they all reject the same bad input.
import { fontName } from '../src/font-maker';
import { formatIssue, validateFontSource } from '../src/font-validate';
import type { Issue } from '../src/font-validate';
import type { FontConfig, FontDefinition, FontWeightType } from '../src/types';
import {
  MAX_WEIGHT,
  MIN_WEIGHT,
  parseWeight,
  SHIPPED_WEIGHTS,
} from '../src/weights';

import { asList, UsageError } from './args';
import { SourceError } from './context';
import type { CommandContext } from './context';
import { loadSource } from './io';
import { plural } from './log';

const MAX_LISTED_ISSUES = 20;

export type ResolvedSource = {
  config: FontConfig;
  chars: FontDefinition;
  label: string;
  path?: string;
  warnings: Issue[];
};

function reportIssues(
  issues: Issue[],
  label: string,
  emit: (line: string) => void
): void {
  for (const issue of issues.slice(0, MAX_LISTED_ISSUES)) {
    emit(formatIssue(issue, label));
  }
  if (issues.length > MAX_LISTED_ISSUES) {
    emit(`…and ${issues.length - MAX_LISTED_ISSUES} more`);
  }
}

/**
 * Read the source, validate it, and refuse to continue on errors. Warnings are
 * printed and — under `strict` — also fatal.
 */
export function loadValidatedSource(
  argument: string | undefined,
  ctx: CommandContext,
  options: { strict?: boolean; quietWarnings?: boolean } = {}
): ResolvedSource {
  const source = loadSource(argument);
  const result = validateFontSource(source.json);

  if (!result.ok) {
    reportIssues(result.errors, source.label, (line) => ctx.logger.error(line));
    throw new SourceError(
      `${source.label} has ${plural(result.errors.length, 'error')}`
    );
  }

  if (result.warnings.length && !options.quietWarnings) {
    if (options.strict) {
      reportIssues(result.warnings, source.label, (line) => ctx.logger.error(line));
    } else if (ctx.logger.level === 'verbose') {
      reportIssues(result.warnings, source.label, (line) => ctx.logger.warn(line));
    } else {
      ctx.logger.debug(`${result.warnings.length} warnings (run with -v to list)`);
    }
  }

  if (options.strict && result.warnings.length) {
    throw new SourceError(
      `${source.label} has ${plural(result.warnings.length, 'warning')} and --strict is set`
    );
  }

  return {
    config: result.config,
    chars: result.chars,
    label: source.label,
    path: source.path,
    warnings: result.warnings,
  };
}

export type ConfigOverrides = {
  name?: string;
  designer?: string;
  'designer-url'?: string;
  'style-name'?: string;
  mono?: boolean;
};

/** Layer CLI flags over the config that came from the source file. */
export function applyConfigOverrides(
  config: FontConfig,
  values: ConfigOverrides
): FontConfig {
  const next: FontConfig = { ...config };
  if (values.name !== undefined) next.name = values.name;
  if (values.designer !== undefined) next.designer = values.designer;
  if (values['designer-url'] !== undefined) {
    next.designerURL = values['designer-url'];
  }
  if (values.mono !== undefined) next.monospace = values.mono;
  if (values['style-name'] !== undefined) next.styleName = values['style-name'];
  return next;
}

/** Coerce one weight flag value, naming the flag if it is not a weight. */
export function asWeight(value: string, flag: string): FontWeightType {
  const weight = parseWeight(value);
  if (weight === null) {
    throw new UsageError(
      `${flag} must be a weight between ${MIN_WEIGHT} and ${MAX_WEIGHT} (got ${JSON.stringify(
        value
      )})`
    );
  }
  return weight;
}

/**
 * Parse `--weight`: a comma-separated list of weights, or "all" for the ones
 * Brutalita ships. Defaults to the source's own weight.
 */
export function resolveWeights(
  value: string | undefined,
  fallback: FontWeightType
): FontWeightType[] {
  if (value === undefined) return [fallback];
  if (value.trim() === 'all') return [...SHIPPED_WEIGHTS];

  const weights = asList(value, '--weight').map((part) =>
    asWeight(part, '--weight')
  );

  // Deduplicate but keep the order the user asked for.
  return [...new Set(weights)];
}

/** Lowercase, hyphenated, filesystem-safe form of the family name. */
export function slugify(name: string): string {
  // NFKD splits an accented letter into base + combining mark; drop the marks
  // first so "ó" slugs to "o" rather than splitting the word in two.
  return (
    name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'font'
  );
}

/**
 * Expand an output filename template. Tokens: {name} {slug} {style} {weight}
 * {mono} {ext}. Unknown tokens are a usage error rather than being left in the
 * filename, where they would be very confusing.
 */
export function renderFilename(
  template: string,
  config: FontConfig,
  style: string,
  ext: string
): string {
  const tokens: Record<string, string> = {
    name: fontName(config),
    slug: slugify(fontName(config)),
    style,
    weight: String(config.weight),
    mono: config.monospace ? 'Mono' : '',
    ext,
  };

  const filename = template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    if (!(token in tokens)) {
      throw new UsageError(
        `--filename has an unknown token {${token}} — use one of ${Object.keys(tokens)
          .map((key) => `{${key}}`)
          .join(' ')}`
      );
    }
    return tokens[token];
  });

  if (filename.includes('/') || filename.includes('\\')) {
    throw new UsageError('--filename must be a file name, not a path');
  }
  return filename;
}
