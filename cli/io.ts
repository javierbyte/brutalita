// Source resolution and output writing, shared by every command.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import bundledSource from '../src/font.json';
import { UsageError } from './args';

/** Paths tried, in order, when no source argument is given. */
export const SOURCE_LOOKUP = ['font.json', 'src/font.json'];

export type LoadedSource = {
  /** Parsed JSON, not yet validated. */
  json: unknown;
  /** Display label: a path, "<stdin>", or "<bundled>". */
  label: string;
  /** Absolute path, or undefined for stdin / the bundled source. */
  path?: string;
};

function readStdin(): string {
  try {
    // fd 0 read is synchronous and works for pipes and redirects alike.
    return readFileSync(0, 'utf8');
  } catch {
    throw new UsageError('could not read from stdin');
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}

/**
 * Resolve the font source: an explicit path, "-" for stdin, or — when omitted —
 * ./font.json, ./src/font.json, then the copy bundled into the package. The
 * bundled fallback is what lets `brutalita build -o Font.otf` work with no
 * arguments at all.
 */
export function loadSource(argument?: string): LoadedSource {
  if (argument === '-') {
    return { json: parseJson(readStdin(), '<stdin>'), label: '<stdin>' };
  }

  if (argument) {
    const path = resolve(argument);
    if (!existsSync(path)) {
      throw new UsageError(`no such file: ${argument}`);
    }
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      throw new UsageError(`could not read ${argument}: ${(err as Error).message}`);
    }
    return { json: parseJson(text, argument), label: argument, path };
  }

  for (const candidate of SOURCE_LOOKUP) {
    const path = resolve(candidate);
    if (existsSync(path)) {
      return {
        json: parseJson(readFileSync(path, 'utf8'), candidate),
        label: candidate,
        path,
      };
    }
  }

  return { json: bundledSource, label: '<bundled>' };
}

/** True when the destination means "write the payload to stdout". */
export function isStdout(out: string | undefined): boolean {
  return out === '-';
}

export function writeOutput(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, data);
}

export function writeStdout(data: string | Uint8Array): void {
  process.stdout.write(data);
}

export function ensureDir(path: string): void {
  mkdirSync(resolve(path), { recursive: true });
}

/** Expand the \n and \t escapes people type into a shell argument. */
export function expandEscapes(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * Resolve text for `render`: --text, --text-file (or "-"), else piped stdin.
 * Returns undefined when there is nothing to render.
 */
export function resolveText(
  textFlag: string | undefined,
  textFile: string | undefined
): string | undefined {
  if (textFlag !== undefined) return expandEscapes(textFlag);
  if (textFile !== undefined) {
    if (textFile === '-') return readStdin().replace(/\n$/, '');
    const path = resolve(textFile);
    if (!existsSync(path)) throw new UsageError(`no such file: ${textFile}`);
    return readFileSync(path, 'utf8');
  }
  if (!process.stdin.isTTY) {
    const piped = readStdin();
    if (piped.length) return piped.replace(/\n$/, '');
  }
  return undefined;
}
