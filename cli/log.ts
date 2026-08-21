// Diagnostics always go to stderr so stdout stays a clean payload channel
// (`--json`, or `--out -` writing raw .otf bytes to a pipe).

export type LogLevel = 'quiet' | 'normal' | 'verbose';

// Built from a char code rather than a literal so no raw control byte ends up
// in this file.
const CSI = `${String.fromCharCode(27)}[`;
const COLORS = {
  reset: `${CSI}0m`,
  dim: `${CSI}2m`,
  red: `${CSI}31m`,
  yellow: `${CSI}33m`,
  green: `${CSI}32m`,
  bold: `${CSI}1m`,
} as const;

export type Logger = {
  level: LogLevel;
  /** Normal progress output. Suppressed by --quiet. */
  info(message: string): void;
  /** Extra detail. Only shown with --verbose. */
  debug(message: string): void;
  /** Always shown. */
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
  dim(text: string): string;
  bold(text: string): string;
};

export function createLogger(
  options: { level?: LogLevel; color?: boolean } = {}
): Logger {
  const level = options.level ?? 'normal';
  // Honour NO_COLOR and non-TTY stderr unless --no-color already forced it off.
  const color =
    options.color ?? (process.stderr.isTTY === true && !process.env.NO_COLOR);

  const paint = (code: string, text: string) =>
    color ? `${code}${text}${COLORS.reset}` : text;

  const write = (message: string) => process.stderr.write(`${message}\n`);

  return {
    level,
    info(message) {
      if (level !== 'quiet') write(message);
    },
    debug(message) {
      if (level === 'verbose') write(paint(COLORS.dim, message));
    },
    warn(message) {
      write(`${paint(COLORS.yellow, 'warning')} ${message}`);
    },
    error(message) {
      write(`${paint(COLORS.red, 'error')} ${message}`);
    },
    success(message) {
      if (level !== 'quiet') write(`${paint(COLORS.green, '✓')} ${message}`);
    },
    dim: (text) => paint(COLORS.dim, text),
    bold: (text) => paint(COLORS.bold, text),
  };
}

/** Human-readable byte count for build output lines. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}
