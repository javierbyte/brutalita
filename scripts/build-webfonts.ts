#!/usr/bin/env -S npx tsx
// Wrap the built .otf files as .woff2 for web embedding, so brutalita.com serves
// both a desktop-installable font and one that @font-face can use.
//
// This is a site-build script rather than a `brutalita` subcommand on purpose:
// scripts/build-cli.ts esbuild-bundles the CLI into a single dependency-free
// dist/cli/brutalita.mjs, and woff2-encoder's WASM cannot be inlined that way.
import { readFileSync, writeFileSync } from 'node:fs';

import { compress } from 'woff2-encoder';

import { SHIPPED_WEIGHTS, styleName } from '../src/weights';

const DIR = 'public/font';
const FAMILIES = ['Brutalita', 'Brutalita Mono'];

// Wrapped in a function because these scripts run through tsx as CJS, where
// top-level await is unavailable.
async function main() {
  // Driven off the shipped weights rather than a glob, so a missing build fails
  // here instead of silently shipping a weight short.
  for (const family of FAMILIES) {
    for (const weight of SHIPPED_WEIGHTS) {
      const base = `${DIR}/${family}-${styleName({ weight })}`;
      const otf = readFileSync(`${base}.otf`);
      const woff2 = await compress(otf);
      writeFileSync(`${base}.woff2`, woff2);
      process.stdout.write(
        `wrote ${base}.woff2 (${otf.length} -> ${woff2.length} bytes)\n`
      );
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
