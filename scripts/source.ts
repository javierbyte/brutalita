// The shipped font, validated, for the scripts that build committed artifacts.
import { readFileSync } from 'node:fs';

import { formatIssue, validateFontSource } from '../src/font-validate';

const FONT_JSON = 'src/font.json';

// Through the validator, not just JSON.parse: composed glyphs such as "Á" are
// only layers once it has resolved them.
export function loadShippedFont() {
  const { ok, config, chars, errors } = validateFontSource(
    JSON.parse(readFileSync(FONT_JSON, 'utf8'))
  );
  if (!ok) {
    for (const issue of errors) {
      process.stderr.write(`${formatIssue(issue, FONT_JSON)}\n`);
    }
    process.exit(1);
  }
  return { config, chars };
}
