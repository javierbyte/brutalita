import { UsageError } from './args';

/**
 * Parse `--timestamp`: unix seconds, or anything Date can read (an ISO date is
 * the intended spelling). Returns undefined when the flag was not given.
 */
export function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new UsageError(
      `--timestamp must be unix seconds or a date (got ${JSON.stringify(value)})`
    );
  }
  return Math.floor(parsed / 1000);
}
