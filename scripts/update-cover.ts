#!/usr/bin/env -S npx tsx
// Regenerate the README preview banner (public/brutalita-cover.svg) from the
// current font in src/font.json, using the same stroke renderer as the CLI's
// `render` command so the cover always reflects the live glyphs.
//
// This stays a script rather than a plain CLI call because the banner text
// interpolates the font's own name from its config.
import { readFileSync, writeFileSync } from 'node:fs';

import { renderTextToSVG } from '../src/svg-export';
import type { FontDefinition, FontWeightType } from '../src/types';

const FONT_JSON = 'src/font.json';
const OUT = 'public/brutalita-cover.svg';

const BACKGROUND = '#111';
const STROKE = '#fff';
const PADDING = 72;
const TARGET_WIDTH = 800; // match the previous cover's width

const { config, chars } = JSON.parse(readFileSync(FONT_JSON, 'utf8')) as {
  config: { name: string; weight: FontWeightType; monospace: boolean };
  chars: FontDefinition;
};

// ${FONT_NAME} is filled from the font config so the banner tracks the version.
const text = [
  config.name,
  '',
  'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQ',
  'qRrSsTtUuVvWwXxYyZz0123456789!"#$',
  "%&'()*+,-./:;<=>?@[\\]^_`{|}~´",
  '',
  '',
  'Brutalita is an experimental font and editor.',
  'Create and download your own font.',
].join('\n');

const { svg, missing } = renderTextToSVG(chars, text, {
  weight: config.weight,
  monospace: config.monospace, // src/font.json is proportional (monospace: false)
  color: STROKE,
  padding: PADDING,
  background: BACKGROUND,
  width: TARGET_WIDTH,
});

writeFileSync(OUT, svg);

const size = /width="(\d+)" height="(\d+)"/.exec(svg);
process.stdout.write(`wrote ${OUT}${size ? ` (${size[1]}x${size[2]})` : ''}\n`);
if (missing.length) {
  process.stderr.write(
    `warning: no glyph for: ${missing.map((c) => JSON.stringify(c)).join(', ')}\n`
  );
}
