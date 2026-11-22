#!/usr/bin/env -S npx tsx
// Build every font brutalita.com serves: both families in each shipped weight,
// as .otf for the desktop and .woff2 for @font-face.
//
// A script rather than `brutalita build`, for two reasons. woff2-encoder's WASM
// cannot be inlined into the single dependency-free file scripts/build-cli.ts
// bundles the CLI into. And one process draws each weight once: the two
// families share their outlines and differ only in spacing.
import { writeFileSync } from 'node:fs';

import { compress } from 'woff2-encoder';

import { buildFontBytes, fontFileName } from '../src/font-maker';
import { SHIPPED_WEIGHTS } from '../src/weights';
import { loadShippedFont } from './source';

const DIR = 'public/font';

/**
 * Written to head.created and head.modified. Pinned, so an unchanged source
 * rebuilds byte for byte; moved forward when a new version of the typeface is
 * released.
 */
const RELEASED = '2026-11-21';

// Wrapped in a function because these scripts run through tsx as CJS, where
// top-level await is unavailable.
async function main() {
  const { config, chars } = loadShippedFont();
  const createdTimestamp = Date.parse(RELEASED) / 1000;

  for (const weight of SHIPPED_WEIGHTS) {
    for (const monospace of [false, true]) {
      const family = { ...config, weight, monospace };
      const otf = buildFontBytes(chars, family, { createdTimestamp });
      const woff2 = await compress(otf);

      const path = `${DIR}/${fontFileName(family)}`;
      writeFileSync(path, otf);
      writeFileSync(path.replace(/\.otf$/, '.woff2'), woff2);
      process.stdout.write(
        `wrote ${path} (${otf.length} bytes, ${woff2.length} as .woff2)\n`
      );
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
