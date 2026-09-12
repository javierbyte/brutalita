# Brutalita

[![brutalita](https://raw.githubusercontent.com/javierbyte/brutalita/HEAD/public/brutalita-cover.svg)](https://brutalita.com/)

Brutalita is an experimental font and font editor, edit in your browser and download OTF.

The name means "little brutal" in spanish. Made with SVG and Opentype.JS

## Download

These links always point at the latest release.

| Weight | Desktop | Web |
| --- | --- | --- |
| Thin | [Brutalita-Thin.otf](https://brutalita.com/font/Brutalita-Thin.otf) | [Brutalita-Thin.woff2](https://brutalita.com/font/Brutalita-Thin.woff2) |
| Extra Light | [Brutalita-ExtraLight.otf](https://brutalita.com/font/Brutalita-ExtraLight.otf) | [Brutalita-ExtraLight.woff2](https://brutalita.com/font/Brutalita-ExtraLight.woff2) |
| Light | [Brutalita-Light.otf](https://brutalita.com/font/Brutalita-Light.otf) | [Brutalita-Light.woff2](https://brutalita.com/font/Brutalita-Light.woff2) |
| Regular | [Brutalita-Regular.otf](https://brutalita.com/font/Brutalita-Regular.otf) | [Brutalita-Regular.woff2](https://brutalita.com/font/Brutalita-Regular.woff2) |
| Medium | [Brutalita-Medium.otf](https://brutalita.com/font/Brutalita-Medium.otf) | [Brutalita-Medium.woff2](https://brutalita.com/font/Brutalita-Medium.woff2) |
| Semi Bold | [Brutalita-SemiBold.otf](https://brutalita.com/font/Brutalita-SemiBold.otf) | [Brutalita-SemiBold.woff2](https://brutalita.com/font/Brutalita-SemiBold.woff2) |
| Bold | [Brutalita-Bold.otf](https://brutalita.com/font/Brutalita-Bold.otf) | [Brutalita-Bold.woff2](https://brutalita.com/font/Brutalita-Bold.woff2) |
| Extra Bold | [Brutalita-ExtraBold.otf](https://brutalita.com/font/Brutalita-ExtraBold.otf) | [Brutalita-ExtraBold.woff2](https://brutalita.com/font/Brutalita-ExtraBold.woff2) |
| Black | [Brutalita-Black.otf](https://brutalita.com/font/Brutalita-Black.otf) | [Brutalita-Black.woff2](https://brutalita.com/font/Brutalita-Black.woff2) |

Both **Brutalita** (proportional) and **Brutalita Mono** ship in all nine weights as OTF and WOFF2. Mono filenames use `Brutalita Mono-{Style}` (URL-encode the space as `%20`), for example [Mono Regular OTF](https://brutalita.com/font/Brutalita%20Mono-Regular.otf) and [WOFF2](https://brutalita.com/font/Brutalita%20Mono-Regular.woff2). The [web demo](https://brutalita.com/demo) switches all specimens between the two families.

Both families cover printable ASCII plus the Spanish set — `ÁÉÍÑÓÚÜ áéíñóúü ¿ ¡` — and the dotless `ı` the accented `í` is built from. Accents stand a row clear of the letter, in a mark band above the cap line, so a line of accented capitals fits inside its own line box: `line-height: normal` is 1.24em.

The original design scale is preserved: at **16px**, Regular has a **1.25px stroke** and **11.25px cap height**; the mono advance is **8.75px**. The demo includes **12.8, 19.2, and 25.6px** to compare the SVG-derived scales without changing the font outlines. CFF hints assist supported rasterizers, but crispness depends on display density, placement, and browser rendering. These fonts do not match Courier's layout metrics.

The demo's **Debug: Brutalita horizontal offset** control compares fractional CSS-pixel placement without changing font size, outlines, or advances. It defaults to off. A local Chromium canvas comparison at 1× and 2× found that the clearest offset varied by size and density; hinted/unhinted output was generally similar, and small baseline nudges did not consistently help. These are renderer-specific observations, not a universal sharpness setting.

```css
@font-face {
  font-family: 'Brutalita';
  src: url('https://brutalita.com/font/Brutalita-Regular.woff2') format('woff2');
  font-weight: 400;
}
```

## CLI

Compile a font source to `.otf` without opening the editor. The source is the
same JSON the editor exports — `{ "config": {...}, "marks": {...}, "chars": {...} }` —
where each glyph is a list of polylines on a 2×4 half-step grid.

A glyph can also be built from another instead of drawn. `marks` holds accents
drawn once, foot on `y = 0`; a composite places one on a letter, or turns the
letter around:

```json
"marks": { "acute": [[[0.5, 0], [1.5, -0.5]]] },
"chars": {
  "á": { "base": "a", "mark": "acute" },
  "¿": { "base": "?", "rotate": 180 }
}
```

The mark is centred on the base's ink and lifted a row clear of its topmost
stroke, so the same acute lands on the cap line over an "a" and a row higher
over an "A".

```sh
pnpm dlx brutalita build my-font.json -o MyFont.otf
```

With no source argument it looks for `./font.json`, then `./src/font.json`, then
falls back to the copy of Brutalita bundled with the CLI.

### Commands

| Command | What it does |
| --- | --- |
| `build` | Compile a font source to `.otf` |
| `render` | Render text to a single-stroke `.svg` |
| `validate` | Check a font source for errors |
| `info` | Describe a font source, or read a built `.otf` back |
| `init` | Create a starter font source |
| `watch` | Rebuild whenever the source changes |

Run `brutalita help <command>` for the full option list.

```sh
# all nine standard weights above, into a directory
brutalita build src/font.json -d public/font -w all

# any weight from 1 to 1000 builds, named after itself when it has no
# standard name (Brutalita-550.otf)
brutalita build src/font.json -w 550 --style-name SemiMedium

# pipe the bytes somewhere else
brutalita build src/font.json -w 700 -o - > Bold.otf

# a specimen image
brutalita render src/font.json -t "Hello\nWorld" --background "#111" --width 800 -o hello.svg

# check a font you are editing by hand
brutalita validate my-font.json --strict
brutalita info my-font.json
```

Diagnostics always go to stderr, so `--out -` and `--json` stay pipeable.
Exit codes: `0` success, `1` usage or I/O error, `2` invalid font source.

## Development

```sh
pnpm dev         # the editor at localhost:3000
pnpm cli         # run the CLI from source
pnpm assets      # regenerate every committed artifact (fonts + banner)
pnpm fonts       # just public/font/Brutalita-*.{otf,woff2}
pnpm cover       # just the banner above
pnpm test        # unit tests + golden font/SVG regression tests
pnpm typecheck
pnpm build:cli   # bundle the CLI to dist/cli/brutalita.mjs
```

The generated files are committed: the `.otf` files are the golden reference for the
build tests, and GitHub serves the banner above straight from the repo. `pnpm assets`
rebuilds them byte-for-byte, so a clean `git status` afterwards means they are current.

To release a new version of the typeface, bump `config.version` in `src/font.json` and
the `--timestamp` in `fonts:otf`, then run `pnpm assets`.

Stroke thickness is interpolated between the anchors in `src/weights.ts`, which is
the only place a weight is described. `SHIPPED_WEIGHTS` there lists the weights the
site publishes and the editor offers; `--weight all` expands to it.

The CLI bundles to a single dependency-free file, so `dist/cli/brutalita.mjs` is
the only thing published. The font-building core (`src/font-maker.ts`,
`src/cff-hint.ts`, `src/svg-export.ts`, `src/font-validate.ts`) is shared with the
browser editor and stays free of DOM access.

The original SVG is the outline reference: an 8×16px skeleton with 1.5px Light,
2px Regular, and 2.5px Bold strokes. The font uses those same proportions,
round caps, joins, and oversized dots. Its grid stays fixed across weights;
the shipped source uses `height: 2` to match the SVG aspect ratio. Existing
sources with a different height still use their configured aspect ratio.

Nine weights span 40–224 font units. Strokes round to the nearest two font
units for serialization, rather than a screen-pixel ladder. The CFF hints
describe the resulting outlines without changing the design. Actual pixel
rendering still depends on size and renderer. At 25.6px font size, the 2048-upem
font has the same scale as the original 16px SVG skeleton; compare at equal
visible scale rather than assuming the two size numbers mean the same thing.
