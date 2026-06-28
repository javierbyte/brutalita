#!/usr/bin/env -S npx tsx
// Regenerate the README preview banner (public/brutalita-cover.svg) from the
// current font in src/font.json, using the same stroke renderer as the CLI's
// SVG export so the cover always reflects the live glyphs.
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
});

// renderTextToSVG fits the canvas tightly and ships no background. Scale the
// whole thing up to TARGET_WIDTH and drop a dark rect behind it so the white
// strokes read on GitHub, matching the look/size of the previous banner.
const open = svg.match(/<svg[^>]*>/)?.[0];
const box = open?.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
if (!open || !box) throw new Error('could not parse the rendered SVG header');

const [vx, vy, vw, vh] = box.slice(1).map(Number);
const scale = TARGET_WIDTH / vw;
const width = Math.round(vw * scale);
const height = Math.round(vh * scale);

const header =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
  `viewBox="${vx} ${vy} ${vw} ${vh}">\n` +
  `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${BACKGROUND}" />`;

writeFileSync(OUT, svg.replace(open, header));

process.stdout.write(`wrote ${OUT} (${width}x${height})\n`);
if (missing.length) {
  process.stderr.write(
    `warning: no glyph for: ${missing.map((c) => JSON.stringify(c)).join(', ')}\n`
  );
}
