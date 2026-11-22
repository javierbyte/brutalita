# 0.10.0 — 2026-11-21

- New glyph editor: every stroke on one grid. Tap to draw, drag a point to move
  it, drag a line to add a point. Undo and redo per glyph.
- The preview text is set in the built font.
- New style options, saved in `config`: `stroke` (round or sharp), `corners`
  and `cornerRadius` (chamfer, circular or continuous), `slant` (0–20°), and
  `spacing`, `wordSpacing` and `kerning`.
- `.otf` files are written by `packages/otf-writer`, which has no dependencies.
  The files are about a quarter smaller; the CLI bundle is 219 kB, down from
  783 kB.
- Line box: 2080 above the baseline, 480 below. `line-height: normal` is 1.25em.
- Underline, subscript and superscript metrics sit on the 160-unit lattice.
- Name records are written once, for Windows. OS/2 is version 4.
- Fixed: a family name outside ASCII built an invalid font.
- `pnpm fonts` builds both families, as OTF and WOFF2.

# 0.9.1 — 2026-09-13

- Added `↕`.
- Monospace ink sits on the 160-unit design lattice.

# 0.9 — 2026-09-12

- Nine weights, Thin through Black, replacing the four that used to ship.
  `--weight all` expands to the full set.
- Brutalita Mono ships as its own family, in the same nine weights, as OTF and
  WOFF2.
- Stroke widths are re-anchored to the original SVG design: 1.5px Light, 2px
  Regular, 2.5px Bold on the 8×16px skeleton. The three original anchors are
  unchanged; the new weights extend the range around them.
- Added the Spanish set — `ÁÉÍÑÓÚÜ áéíñóúü ¿ ¡` — and the dotless `ı`. Accents
  live in a mark band above the cap line, so accented capitals stay inside their
  own line box.
- Glyphs can be composed instead of drawn: `marks` holds an accent once, and a
  char can be `{ "base": "a", "mark": "acute" }` or
  `{ "base": "?", "rotate": 180 }`.
- Added pair kerning, written to a GPOS table.
- Added CFF stem hints. They describe the existing outlines and do not change
  the design.
- Added a `/demo` page that switches specimens between the two families.

# 0.8 — 2026-06-28

- The font source carries its own `config`: name, weight, width, designer and
  designer URL travel with the JSON instead of living in the editor.
- Added a command-line build. `brutalita <config.json> -o <out>` writes an OTF
  without opening the editor.
- Added an SVG text exporter, so a source can render a specimen as well as build
  a font.
- Exported files are named by style — `Brutalita-Regular.otf` — instead of by
  weight number.
- Redesigned `C`, `M`, `m`, `w`.
- Rebuilt the editor around a menubar, and moved the site to Next.js.

# 0.7 — 2023-05-06

- Three weights — 300, 400 and 700 — selectable in the editor and downloadable
  as separate files. Stroke thickness follows the weight.
- Added a proportional width alongside monospace. Advance width now follows the
  stroke, instead of being fixed at 600 units.
- Moved the editor to TypeScript and replaced the top-nav buttons with a
  dropdown menu.

# 0.6 — 2022-01-23

- Added polygon-clipping algorithm by @mfogel to make the font smaller and
  cleaner.
- Added unicode name table.

# 0.5 — 2022-01-01

- Added lowercase chars!
- Added one more half resolution point to the advanced editor at the bottom to
  the descender to go up to half a point lower.
- Points that are alone in a layer are now 50% bigger.
- Redesigned `*`, `%` and dots and characters with dots.

# 0.4 — 2021-12-30

- More rounded `0`, `Q`, `U`, and shorter `"`.

# 0.3 — 2021-12-29

- Created the "advanced" editor that has half point vertices. Updated most
  characters to take advantage of this.

# 0.2 — 2021-12-29

- Change char width to match "Courier".
- Change W, 8 an V to be more angular

# 0.1 — 2021-12-29

- Initial release
