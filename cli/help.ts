// Help text rendered from the same command specs used for parsing, so the two
// cannot drift (the previous hand-written HELP constant already had).
import type { CommandSpec, OptionSpec } from './args';

const INDENT = '  ';
const GUTTER = 2;

// "-o, --out <file>" — the left column of an option row.
function optionSignature(name: string, option: OptionSpec): string {
  const lead = option.short ? `-${option.short}, ` : '    ';
  const negation = option.negatable ? `/--no-${name}` : '';
  const arg = option.type === 'string' ? ` ${option.arg ?? '<value>'}` : '';
  return `${lead}--${name}${negation}${arg}`;
}

function renderRows(rows: [string, string][]): string {
  if (!rows.length) return '';
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows
    .map(([left, right]) => `${INDENT}${left.padEnd(width + GUTTER)}${right}`)
    .join('\n');
}

export function renderOptions(
  options: Record<string, OptionSpec>
): [string, string][] {
  return Object.entries(options).map(([name, option]) => [
    optionSignature(name, option),
    option.default ? `${option.desc} (default: ${option.default})` : option.desc,
  ]);
}

export function renderCommandHelp(
  spec: CommandSpec,
  globals?: Record<string, OptionSpec>
): string {
  const parts: string[] = [`${spec.summary}\n`, `Usage:\n${INDENT}${spec.usage}\n`];

  if (spec.args?.length) {
    parts.push(
      `Arguments:\n${renderRows(spec.args.map((a) => [a.name, a.desc]))}\n`
    );
  }

  const own = Object.fromEntries(
    Object.entries(spec.options).filter(([name]) => !globals || !(name in globals))
  );
  if (Object.keys(own).length) {
    parts.push(`Options:\n${renderRows(renderOptions(own))}\n`);
  }

  for (const section of spec.sections ?? []) {
    parts.push(`${section.title}:\n${section.body}\n`);
  }

  if (globals && Object.keys(globals).length) {
    parts.push(`Global options:\n${renderRows(renderOptions(globals))}\n`);
  }

  if (spec.examples?.length) {
    parts.push(
      `Examples:\n${spec.examples.map((line) => INDENT + line).join('\n')}\n`
    );
  }

  return parts.join('\n');
}

export function renderRootHelp(
  commands: { name: string; summary: string }[],
  globals: Record<string, OptionSpec>,
  version: string
): string {
  return [
    `brutalita ${version} — compile a Brutalita font source to .otf\n`,
    `Usage:\n${INDENT}brutalita <command> [args] [options]\n`,
    `Commands:\n${renderRows(commands.map((c) => [c.name, c.summary]))}\n`,
    `Global options:\n${renderRows(renderOptions(globals))}\n`,
    [
      'Examples:',
      `${INDENT}brutalita build src/font.json -o Brutalita.otf`,
      `${INDENT}brutalita build src/font.json -d public -w all`,
      `${INDENT}brutalita render src/font.json -t "Hello" -o hello.svg`,
      `${INDENT}brutalita validate src/font.json`,
      '',
      `${INDENT}Run \`brutalita help <command>\` for the full option list.`,
      '',
    ].join('\n'),
  ].join('\n');
}
