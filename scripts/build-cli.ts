#!/usr/bin/env -S npx tsx
// Bundle the CLI into one self-contained file for publishing.
//
// Everything is inlined — opentype.js, polygon-clipping and src/font.json — so
// the published package has no runtime dependencies and `pnpm dlx brutalita` is
// a single download. The app's Next/React dependencies never enter the graph:
// the CLI only reaches into the Node-safe half of src/ (font-maker, svg-export,
// font-validate, font-config, types), and font-maker defers its one DOM-touching
// import behind a lazy import() that the CLI never takes.
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

const OUT = 'dist/cli/brutalita.mjs';

async function main() {
  const result = await build({
    entryPoints: ['cli/index.ts'],
    outfile: OUT,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
    // Keep the MIT notices of the bundled dependencies.
    legalComments: 'eof',
    metafile: true,
    logLevel: 'warning',
  });

  // npm preserves the mode bits in the tarball, so the bin needs +x here.
  chmodSync(OUT, 0o755);

  const output = result.metafile.outputs[OUT];
  process.stdout.write(`wrote ${OUT} (${(output.bytes / 1024).toFixed(1)} kB)\n`);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
