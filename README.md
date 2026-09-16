# Brutalita

[![brutalita](https://raw.githubusercontent.com/javierbyte/brutalita/HEAD/public/brutalita-cover.svg)](https://brutalita.com/)

Brutalita is an experimental font and font editor. Draw in your browser, download OTF.

The name means "little brutal" in spanish. Made with SVG and Opentype.JS.

- **[brutalita.com](https://brutalita.com/)** — the editor
- **[brutalita.com/demo](https://brutalita.com/demo)** — specimens at several sizes

## Download

Two families, **Brutalita** (proportional) and **Brutalita Mono**, each in nine
weights, as OTF for desktop and WOFF2 for the web. These links always point at
the latest release.

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

Mono files are named `Brutalita Mono-{Style}`, with the space URL-encoded:
[Mono Regular OTF](https://brutalita.com/font/Brutalita%20Mono-Regular.otf),
[WOFF2](https://brutalita.com/font/Brutalita%20Mono-Regular.woff2).

```css
@font-face {
  font-family: 'Brutalita';
  src: url('https://brutalita.com/font/Brutalita-Regular.woff2') format('woff2');
  font-weight: 400;
}
```

Both families cover printable ASCII, the Spanish set — `ÁÉÍÑÓÚÜ áéíñóúü ¿ ¡` —
and `↕`. Accents sit in their own band above the cap line, so a line of accented
capitals still fits its line box; `line-height: normal` is 1.24em.

## CLI

Compile a font source to `.otf` without opening the editor.

```sh
pnpm dlx brutalita build my-font.json -o MyFont.otf
```

The source is the same JSON the editor exports — `{ "config": {...}, "marks": {...},
"chars": {...} }` — where each glyph is a list of polylines on a 2×4 half-step grid.
With no source argument the CLI looks for `./font.json`, then `./src/font.json`, then
falls back to the copy of Brutalita it bundles.

A glyph can also be built from another instead of drawn, either by taking an
accent from `marks` or by turning the letter around:

```json
"marks": { "acute": [[[0.5, 0], [1.5, -0.5]]] },
"chars": {
  "á": { "base": "a", "mark": "acute" },
  "¿": { "base": "?", "rotate": 180 }
}
```

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
# all nine standard weights, into a directory
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
pnpm dev         # the editor at localhost:2788
pnpm cli         # run the CLI from source
pnpm assets      # regenerate every committed artifact (fonts + banner)
pnpm test        # unit tests + golden font/SVG regression tests
pnpm typecheck
pnpm build:cli   # bundle the CLI to dist/cli/brutalita.mjs
```

The built fonts and the banner are committed: the `.otf` files are the golden
reference for the build tests, and GitHub serves the banner above straight from
the repo. `pnpm assets` rebuilds them byte-for-byte, so a clean `git status`
afterwards means they are current.

To release a new version of the typeface, bump `config.version` in `src/font.json`
and the `--timestamp` in `fonts:otf`, then run `pnpm assets`.

## License

BSD 3-Clause. © Javier Bórquez.


## 🌐 Web Resources & Aesthetic Symbols Index
- [SYM 1F606](https://clean-dot-aesthetic-48.pages.dev/symbol/sym-1f606/)
- [SYM 26E5](https://coquette-aesthetic-symbols-62.pages.dev/symbol/sym-26e5/)
- [SYM 2764 FE0F 200D 1F525](https://glitch-font-studio-46.pages.dev/symbol/sym-2764-fe0f-200d-1f525/)
- [BRACKETS](https://anime-sparkle-text-23.pages.dev/es/brackets/)
- [SYM 1F924](https://coquette-symbols.pages.dev/symbol/sym-1f924/)
- [SYM 1D47C](https://minimal-star-symbols-93.pages.dev/symbol/sym-1d47c/)
- [SYM 1F47F](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-1f47f/)
- [SYM 1F48C](https://scholarly-vintage-symbols-48.pages.dev/symbol/sym-1f48c/)
- [SYM 26D2](https://coquette-symbols.pages.dev/symbol/sym-26d2/)
- [SYM 1D42E](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-1d42e/)
- [SYM 1D427](https://mecha-blade-symbols-46.pages.dev/symbol/sym-1d427/)
- [FREEFIRE NAMES](https://coquette-symbols.pages.dev/vi/freefire-names/)
- [SYM 26F6](https://anime-sparkle-text-23.pages.dev/symbol/sym-26f6/)
- [SYM 1D418](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-1d418/)
- [COQUETTE BOW RIBBON](https://sleek-line-symbols-51.pages.dev/symbol/coquette-bow-ribbon/)
- [STARS](https://coquette-aesthetic-symbols-86.pages.dev/es/stars/)
- [SYM 2671](https://neon-glitch-symbols-84.pages.dev/symbol/sym-2671/)
- [SYM 1D486](https://theeduplaycampen.pages.dev/symbol/sym-1d486/)
- [SYM 1D475](https://matrix-glitch-text-37.pages.dev/symbol/sym-1d475/)
- [STARRY LOVE AURA](https://sleek-line-symbols-51.pages.dev/symbol/starry-love-aura/)
- [SYM 26ED](https://anime-sparkle-text-23.pages.dev/symbol/sym-26ed/)
- [SYM 1D48F](https://pearl-girly-fonts-86.pages.dev/symbol/sym-1d48f/)
- [SYM 1F915](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1f915/)
- [SYM 26F7](https://anime-sparkle-text-23.pages.dev/symbol/sym-26f7/)
- [SYM 26B3](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-26b3/)
- [SYM 1F4A9](https://minimal-star-symbols-93.pages.dev/symbol/sym-1f4a9/)
- [SYM 1F644](https://soft-bow-fonts-22.pages.dev/symbol/sym-1f644/)
- [SYM 1F911](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f911/)
- [SYM 1D437](https://angelic-bow-symbols-42.pages.dev/symbol/sym-1d437/)
- [TRENDING](https://futuristic-gaming-fonts-52.pages.dev/trending/)
- [HEARTS](https://lace-heart-kaomoji-64.pages.dev/vi/hearts/)
- [GEMINI ZODIAC TWINS](https://coquette-aesthetic-symbols-52.pages.dev/symbol/gemini-zodiac-twins/)
- [SYM 1F62D](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1f62d/)
- [SYM 1F626](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-1f626/)
- [LEO ZODIAC LION](https://coquette-symbols.pages.dev/symbol/leo-zodiac-lion/)
- [SYM 1F637](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f637/)
- [SYM 1F979](https://sleek-line-symbols-51.pages.dev/symbol/sym-1f979/)
- [SYM 26A6](https://sleek-line-symbols-51.pages.dev/symbol/sym-26a6/)
- [SYM 26D8](https://angelic-bow-symbols-42.pages.dev/symbol/sym-26d8/)
- [SYM 1F629](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1f629/)
- [SYM 1D416](https://matrix-glitch-text-37.pages.dev/symbol/sym-1d416/)
- [PT](https://pastel-moe-emoticons-80.pages.dev/pt/)
- [SYM 267F](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-267f/)
- [SYM 1D41A](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1d41a/)
- [SYM 1D48B](https://matrix-glitch-text-37.pages.dev/symbol/sym-1d48b/)
- [SKULL AND CROSSBONES](https://coquette-aesthetic-symbols-86.pages.dev/symbol/skull-and-crossbones/)
- [SYM 2625](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2625/)
- [SYM 1D419](https://matrix-glitch-text-37.pages.dev/symbol/sym-1d419/)
- [SYM 2689](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-2689/)
- [ROTATED HEART BULLET](https://neon-glitch-symbols-84.pages.dev/symbol/rotated-heart-bullet/)
- [SYM 2686](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-2686/)
- [TRENDING](https://pastel-moe-emoticons-80.pages.dev/pt/trending/)
- [SYM 1F61C](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1f61c/)
- [SYM 267F](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-267f/)
- [SYM 2731](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2731/)
- [HEARTS](https://mecha-synth-kaomoji-92.pages.dev/ja/hearts/)
- [SYM 2721](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2721/)
- [KAOMOJI](https://futuristic-gaming-fonts-52.pages.dev/vi/kaomoji/)
- [SYM 1D403](https://angelic-bow-symbols-42.pages.dev/symbol/sym-1d403/)
- [LEFT MATHEMATICAL WHITE SQUARE BRACKET](https://angelic-bow-symbols-42.pages.dev/symbol/left-mathematical-white-square-bracket/)
- [SYM 2686](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2686/)
- [SYM 26F7](https://angelic-bow-symbols-42.pages.dev/symbol/sym-26f7/)
- [SYM 1D441](https://coquette-symbols.pages.dev/symbol/sym-1d441/)
- [PINWHEEL STAR](https://coquette-aesthetic-symbols-86.pages.dev/symbol/pinwheel-star/)
- [SYM 274A](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-274a/)
- [SYM 1F61E](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1f61e/)
- [GAMING WEAPONS](https://coquette-symbols.pages.dev/es/gaming-weapons/)
- [HIGH VOLTAGE LIGHTNING](https://coquette-aesthetic-symbols-86.pages.dev/symbol/high-voltage-lightning/)
- [SYM 267C](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-267c/)
- [LEFT WHITE CORNER BRACKET](https://coquette-aesthetic-symbols-52.pages.dev/symbol/left-white-corner-bracket/)
- [LEFT RIGHT EXCHANGE ARROWS](https://minimal-star-symbols-25.pages.dev/symbol/left-right-exchange-arrows/)
- [BORDERS DIVIDERS](https://neon-glitch-symbols-84.pages.dev/ja/borders-dividers/)
- [SYM 1F97A](https://coquette-symbols.pages.dev/symbol/sym-1f97a/)
- [SAGITTARIUS ZODIAC ARCHER](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sagittarius-zodiac-archer/)
- [BOLD TIPPED ARROW](https://minimal-star-symbols-25.pages.dev/symbol/bold-tipped-arrow/)
- [SYM 1F979](https://neon-glitch-symbols-84.pages.dev/symbol/sym-1f979/)
- [SYM 2655](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2655/)
- [SYM 1F49C](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-1f49c/)
- [UPWARD DIAGONAL ARROW](https://coquette-aesthetic-symbols-52.pages.dev/symbol/upward-diagonal-arrow/)
- [SYM 2685](https://angelic-bow-symbols-42.pages.dev/symbol/sym-2685/)
- [SYM 1F601](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-1f601/)
- [SYM 1D463](https://coquette-aesthetic-symbols-86.pages.dev/symbol/sym-1d463/)
- [SYM 2641](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2641/)
- [SYM 26B4](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-26b4/)
- [MUSIC WEATHER](https://sleek-line-symbols-51.pages.dev/vi/music-weather/)
- [SYM 1F61B](https://minimal-star-symbols-93.pages.dev/symbol/sym-1f61b/)
- [DISCORD STATUS](https://minimal-star-symbols-25.pages.dev/es/discord-status/)
- [SYM 2748](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2748/)
- [SYM 1F921](https://coquette-symbols.pages.dev/symbol/sym-1f921/)
- [SYM 1F639](https://pearl-girly-fonts-86.pages.dev/symbol/sym-1f639/)
- [SYM 1D41B](https://minimal-star-symbols-93.pages.dev/symbol/sym-1d41b/)
- [SYM 1D490](https://anime-sparkle-text-23.pages.dev/symbol/sym-1d490/)
- [CANCER ZODIAC CRAB](https://pearl-girly-fonts-86.pages.dev/symbol/cancer-zodiac-crab/)
- [DAGGER BLADE](https://coquette-aesthetic-symbols-86.pages.dev/symbol/dagger-blade/)
- [SYM 2660](https://coquette-aesthetic-symbols-52.pages.dev/symbol/sym-2660/)
- [SYM 260B](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-260b/)
- [ZODIAC CELESTIAL](https://neon-glitch-symbols-84.pages.dev/ja/zodiac-celestial/)
- [RIGHT BLACK LENTICULAR BRACKET](https://cyberpunk-clan-tags-43.pages.dev/symbol/right-black-lenticular-bracket/)
- [HEAVY RIGHTWARD ARROW](https://mecha-blade-symbols-46.pages.dev/symbol/heavy-rightward-arrow/)
- [RINGED PLANET SATURN](https://mecha-synth-kaomoji-92.pages.dev/symbol/ringed-planet-saturn/)
- [FREEFIRE NAMES](https://mecha-blade-symbols-46.pages.dev/ja/freefire-names/)
- [SYM 268D](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-268d/)
- [TAURUS ZODIAC BULL](https://coquette-aesthetic-symbols-52.pages.dev/symbol/taurus-zodiac-bull/)
- [DISCORD STATUS](https://mecha-synth-kaomoji-92.pages.dev/discord-status/)
- [SYM 1D498](https://matrix-glitch-text-37.pages.dev/symbol/sym-1d498/)
- [DISCORD STATUS](https://cyberpunk-clan-tags-43.pages.dev/ru/discord-status/)
- [GAMING WEAPONS](https://mecha-blade-symbols-46.pages.dev/ja/gaming-weapons/)
- [SYM 1D407](https://angelic-bow-symbols-42.pages.dev/symbol/sym-1d407/)
- [TIKTOK CAPTIONS](https://cyberpunk-clan-tags-43.pages.dev/ru/tiktok-captions/)
- [SYM 1D405](https://angelic-bow-symbols-42.pages.dev/symbol/sym-1d405/)
- [SYM 26D7](https://angelic-bow-symbols-42.pages.dev/symbol/sym-26d7/)
- [SYM 2624](https://angelic-bow-symbols-42.pages.dev/symbol/sym-2624/)
- [SYM 1FA77](https://coquette-symbols.pages.dev/symbol/sym-1fa77/)
- [SYM 1D45A](https://mecha-blade-symbols-46.pages.dev/symbol/sym-1d45a/)
- [SWIMMING FISH LEFT](https://coquette-aesthetic-symbols-52.pages.dev/symbol/swimming-fish-left/)
- [NATURE FLOWERS](https://pastel-moe-emoticons-80.pages.dev/nature-flowers/)
- [SYM 2654](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-2654/)
- [SYM 1D40B](https://angelic-bow-symbols-42.pages.dev/symbol/sym-1d40b/)
- [SYM 267B](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-267b/)
- [DOWNWARD DIAGONAL ARROW](https://coquette-symbols.pages.dev/symbol/downward-diagonal-arrow/)
- [GAMING WEAPONS](https://neon-glitch-symbols-84.pages.dev/ja/gaming-weapons/)
- [SYM 262D](https://mecha-synth-kaomoji-92.pages.dev/symbol/sym-262d/)
- [SYM 1F60C](https://minimal-star-symbols-25.pages.dev/symbol/sym-1f60c/)
- [SYM 26DE](https://lace-heart-kaomoji-64.pages.dev/symbol/sym-26de/)
- [SYM 1D415](https://pearl-girly-fonts-86.pages.dev/symbol/sym-1d415/)
- [SYM 2617](https://pastel-moe-emoticons-80.pages.dev/symbol/sym-2617/)
- [SYM 1F974](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-1f974/)
- [BLACK FOUR POINT STAR](https://cyberpunk-clan-tags-43.pages.dev/symbol/black-four-point-star/)
- [SYM 1D457](https://futuristic-gaming-fonts-52.pages.dev/symbol/sym-1d457/)
- [SYM 2670](https://cyberpunk-clan-tags-43.pages.dev/symbol/sym-2670/)
