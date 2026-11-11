'use client';

/* eslint react/prop-types: 0 */

import { useState, useEffect, useReducer, useRef } from 'react';
import type { CSSProperties } from 'react';

import { downloadBlob, uploadBlob } from './blob-utils';
import { buildFontBytes, downloadFont, UNITS_PER_EM } from './font-maker';

import FONT_DEFINITION_SRC from './font.json';

import { Key } from './components/key';
import { AppSidebar } from './components/app-sidebar';
import { AppMenubar } from './components/app-menubar';
import { MARK_ROWS } from './compose';
import { cornerOptions, sharpPath, strokePath } from './corners';
import type { CornerStyle, StrokeStyle } from './corners';
import { DEFAULT_FONT_CONFIG, fontConfigReducer } from './font-config';
import { formatIssue, validateFontSource } from './font-validate';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

import { SEGMENTS } from './types';
import type {
  CharLayer,
  CharLayers,
  FontConfig,
  FontDefinition,
} from './types';

function fontSrcToTypedFont(fontSrc: { [char: string]: number[][][] }) {
  const typedFont: FontDefinition = {};

  for (const char in fontSrc) {
    typedFont[char] = fontSrc[char].map((layer) =>
      layer.map((poly) => [poly[0], poly[1]])
    );
  }

  return typedFont;
}

const { config: INITIAL_FONT_CONFIG, chars: FONT_CHARS_SRC } =
  parseFont(FONT_DEFINITION_SRC);

const STATE: {
  font: FontDefinition;
} = {
  font: fontSrcToTypedFont(FONT_CHARS_SRC),
};

const DISPLAY_CHAR_BASE = `AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789`;
const REMAINING_CHARS = Object.keys(STATE.font)
  .filter((char) => !DISPLAY_CHAR_BASE.includes(char))
  .join('')
  .replace(' ', '')
  .replace('\n', '');

const ALL_CHARS = [...DISPLAY_CHAR_BASE, ...REMAINING_CHARS];
const SPLIT = Math.floor(ALL_CHARS.length / 3) + 2;
ALL_CHARS.splice(SPLIT, 0, `\n`);
ALL_CHARS.splice(SPLIT * 2 + 1, 0, `\n`);

const FONT_VERSION = FONT_DEFINITION_SRC.config.version;

const DEFAULT_TEXT = `Brutalita Sans${FONT_VERSION ? ` v${FONT_VERSION}` : ''}

${ALL_CHARS.join(``)}


Brutalita is an experimental font and editor.
Create and download your font.

Use the controls on this page!
- Download the original font or your custom edition.
- Save and restore your progress.
- This textarea is also editable :)

"Brutalita" is a playful combination of "brutalism" and "little brutal" in Spanish.
Uses OpenType.js to generate .otf files


Made by @javierbyte`;

const DOTSX = SEGMENTS[0];
const DOTSY = SEGMENTS[1];

function includes(arr: CharLayer, el: number[]) {
  return arr.some((elArr) => {
    return elArr[0] === el[0] && elArr[1] === el[1];
  });
}

// Validation itself lives in ./font-validate so the CLI shares it. Here we only
// turn a failed result into a throw the import handler can report.
const MAX_REPORTED_ISSUES = 8;

function parseFont(json: unknown): { config: FontConfig; chars: FontDefinition } {
  const { ok, config, chars, errors } = validateFontSource(json);

  if (!ok) {
    const reported = errors.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
      return formatIssue(issue);
    });
    if (errors.length > reported.length) {
      reported.push(`…and ${errors.length - reported.length} more`);
    }
    throw new Error(reported.join('\n'));
  }

  return { config, chars };
}

// ensures there is always a trailing empty layer so the editor shows an
// empty cell ready to start a new layer
function withTrailingEmptyLayer(layers: CharLayers): CharLayers {
  return [...layers.filter((layer) => layer.length), []];
}

// removes empty layers of font definition
function cleanFontForExport(fontDefinition: FontDefinition) {
  const orderedChars = Object.keys(fontDefinition).sort((a, b) => {
    return a.charCodeAt(0) - b.charCodeAt(0);
  });

  return orderedChars.reduce((acc: FontDefinition, key) => {
    acc[key] = fontDefinition[key].filter((layer) => layer.length);
    return acc;
  }, {});
}

function Editor({
  value,
  onChange,
  stroke,
  corners,
  cornerRadius,
}: {
  value: CharLayer;
  onChange: (arg0: CharLayer) => void;
  stroke?: StrokeStyle;
  corners?: CornerStyle;
  cornerRadius?: number;
}) {
  const EDITOR_ADVANCE = window.innerWidth > 1000;
  const EDITOR_DOT_SIZE = EDITOR_ADVANCE ? 24 : 16;
  const EDITOR_GAP = EDITOR_ADVANCE ? 50 : 26;

  const EDITOR_CONTROLS_HEIGHT = 24;

  // The grid starts above the cap row: accents live in the mark band, so the
  // rows a composed glyph like "Á" uses have to be drawable too.
  const gridTop = MARK_ROWS * EDITOR_GAP;

  const style = {
    marginTop: EDITOR_DOT_SIZE / 2,
    marginLeft: EDITOR_DOT_SIZE / 2,
    marginRight: EDITOR_DOT_SIZE / 2,
    marginBottom: EDITOR_DOT_SIZE / 2 + EDITOR_CONTROLS_HEIGHT,
    height: gridTop + (DOTSY + (EDITOR_ADVANCE ? 1 : 0)) * EDITOR_GAP,
    width: DOTSX * EDITOR_GAP,
  };

  return (
    <div className="editor" style={style}>
      {new Array(DOTSX + 1).fill('').map((_1, x) => {
        return new Array(DOTSY + 1).fill('').map((_1, y) => {
          const currentDotId = `${x},${y}`;
          return (
            <div
              onClick={() => {
                onChange([...value, [x, y]]);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onChange([]);
              }}
              key={currentDotId}
              style={{
                height: EDITOR_DOT_SIZE,
                width: EDITOR_DOT_SIZE,
                backgroundColor: includes(value, [x, y]) ? '#fff' : '#808080',
                left: x * EDITOR_GAP,
                top: gridTop + y * EDITOR_GAP,
              }}
              className="editor-dot"
            />
          );
        });
      })}

      {EDITOR_ADVANCE &&
        new Array(DOTSX * 2 + 3).fill('').map((_1, x) => {
          return new Array((DOTSY + 1 + MARK_ROWS) * 2 + 1).fill('').map((_1, y) => {
            const x1 = x / 2 - 0.5;
            const y1 = y / 2 - MARK_ROWS;

            // do not ovrelap with bigger dots, which only cover the cap box
            if (x1 === Math.round(x1) && y1 === Math.round(y1)) {
              if (y1 >= 0 && y1 <= DOTSY) {
                return null;
              }
            }
            if (x1 === -0.5) {
              return null;
            }
            if (x1 === DOTSX + 0.5) {
              return null;
            }

            const currentDotId = `${x1},${y1}`;
            return (
              <div
                onClick={() => {
                  onChange([...value, [x1, y1]]);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onChange([]);
                }}
                key={currentDotId}
                style={{
                  height: EDITOR_DOT_SIZE - 8,
                  width: EDITOR_DOT_SIZE - 8,
                  backgroundColor: includes(value, [x1, y1])
                    ? '#fff'
                    : '#808080',
                  left: x1 * EDITOR_GAP,
                  top: gridTop + y1 * EDITOR_GAP,
                }}
                className="editor-dot"
              />
            );
          });
        })}

      <svg
        viewBox={`-1 ${-1 - MARK_ROWS} ${DOTSX + 2} ${DOTSY + 2 + MARK_ROWS}`}
        style={{
          position: 'absolute',
          top: -EDITOR_GAP,
          left: -EDITOR_GAP,
          height: (DOTSY + 2 + MARK_ROWS) * EDITOR_GAP,
          width: (DOTSX + 2) * EDITOR_GAP,
        }}
      >
        {stroke === 'sharp' ? (
          <path
            d={sharpPath(
              [value],
              EDITOR_DOT_SIZE / 8 / EDITOR_GAP,
              cornerOptions({ corners, cornerRadius }, 1)
            )}
            fill="#fff"
          />
        ) : (
          <path
            d={strokePath(value, cornerOptions({ corners, cornerRadius }, 1))}
            strokeWidth={EDITOR_DOT_SIZE / 4}
            fill="none"
            stroke="#fff"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="editor-controls">
        <button
          onClick={() => {
            onChange([]);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function EditorContainer({
  onChange,
  editingChar,
  onChangeEditingChar,
  stroke,
  corners,
  cornerRadius,
  slant,
}: {
  onChange: () => void;
  editingChar: string;
  onChangeEditingChar: (arg0: string) => void;
  stroke?: StrokeStyle;
  corners?: CornerStyle;
  cornerRadius?: number;
  slant: number;
}) {
  const [layers, layersSet] = useState(STATE.font[editingChar]);

  useEffect(() => {
    let newEditingBase = [[[0, 0]]];

    if (STATE.font[editingChar]) {
      newEditingBase = STATE.font[editingChar];
    }

    layersSet(withTrailingEmptyLayer(newEditingBase as CharLayers));
  }, [editingChar, layersSet]);

  function onChangeEditor(layerIdx: number, val: CharLayer) {
    let charLayersCopy: CharLayers = JSON.parse(JSON.stringify(layers));
    charLayersCopy[layerIdx] = val.filter((el) => el.length);

    // prevent adding the same point twice
    if (charLayersCopy[layerIdx].slice(-2).length === 2) {
      if (
        charLayersCopy[layerIdx].slice(-2)[0].join(',') ===
        charLayersCopy[layerIdx].slice(-2)[1].join(',')
      ) {
        charLayersCopy[layerIdx] = charLayersCopy[layerIdx].slice(0, -2);
      }
    }

    charLayersCopy = withTrailingEmptyLayer(charLayersCopy);

    layersSet(charLayersCopy);
    STATE.font[editingChar] = charLayersCopy;
    onChange();
  }

  return (
    <div className="editor-container">
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="editor-input-container">
          <div className="editor-input-label">Editing</div>
          <input
            className="editor-input"
            value={String(editingChar)}
            onChange={(e) => {
              let newChar = '';
              try {
                newChar = e.target.value.slice(-1)[0];
              } catch (e) {
                console.error(e);
              }
              if (newChar) {
                onChangeEditingChar(newChar);
              }
            }}
          />
        </div>
        <div className="editor-input-container">
          <div className="editor-input-label">Preview</div>
          <Key
            custom={true}
            path={layers}
            fontSize={8 * 5}
            strokeWidth={4}
            stroke={stroke}
            corners={corners}
            cornerRadius={cornerRadius}
            slant={slant}
          />
        </div>
      </div>
      {layers.map((_1, layerIdx) => {
        return (
          <Editor
            key={layerIdx}
            stroke={stroke}
            corners={corners}
            cornerRadius={cornerRadius}
            value={layers[layerIdx]}
            onChange={(val) => {
              onChangeEditor(layerIdx, val);
            }}
          />
        );
      })}
    </div>
  );
}

// The preview is the real font: every change rebuilds the .otf the Export menu
// would download and hands those bytes to the browser, so spacing, kerning and
// rasterization on screen are the shipped ones rather than a drawing of them.
//
// One em is sized so a grid column keeps the 4px it had when the preview was
// drawn as SVG strokes: the 640-unit character box spans 8px.
const PREVIEW_FONT_SIZE = UNITS_PER_EM / 80;

let liveFontCount = 0;

/**
 * Build the font for the current glyphs and config and register it with the
 * document. Returns the family name to render with, or null before the first
 * build lands. `revision` changes whenever a glyph is edited or a font loaded.
 */
function useLiveFont(config: FontConfig, revision: number): string | null {
  const [family, familySet] = useState<string | null>(null);
  const faces = useRef<FontFace[]>([]);

  // Only what shapes the outlines and spacing. Renaming the font or its
  // designer must not rebuild on every keystroke.
  const {
    weight,
    height,
    monospace,
    slant,
    stroke,
    corners,
    cornerRadius,
    spacing,
    wordSpacing,
    kerning,
  } = config;

  useEffect(() => {
    let cancelled = false;

    // Off the event that caused it, so a slider drag paints its own thumb
    // first and a burst of changes builds once.
    const timer = setTimeout(async () => {
      try {
        const bytes = buildFontBytes(STATE.font, {
          name: 'Brutalita Preview',
          weight,
          height,
          monospace,
          slant,
          stroke,
    corners,
    cornerRadius,
          spacing,
          wordSpacing,
          kerning,
        });
        // A fresh family per build: the browser caches shaping per family, and
        // swapping the name is what makes it lay the text out again.
        const name = `brutalita-preview-${++liveFontCount}`;
        const face = new FontFace(name, bytes.slice().buffer);
        await face.load();
        if (cancelled) return;
        document.fonts.add(face);
        faces.current.push(face);
        familySet(name);
      } catch (error) {
        // A half-drawn glyph can fail to build. Keep showing the last font
        // that did rather than dropping the preview to a fallback.
        console.error(error);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    revision,
    weight,
    height,
    monospace,
    slant,
    stroke,
    corners,
    cornerRadius,
    spacing,
    wordSpacing,
    kerning,
  ]);

  // Retire superseded builds only once the new family is on screen, so there
  // is never a frame with no font to draw.
  useEffect(() => {
    const stale = faces.current.slice(0, -1);
    faces.current = faces.current.slice(-1);
    for (const face of stale) document.fonts.delete(face);
  }, [family]);

  return family;
}

function App() {
  const [fontConfig, fontConfigDispatch] = useReducer(
    fontConfigReducer,
    INITIAL_FONT_CONFIG
  );
  const [editingChar, editingCharSet] = useState('Q');
  const [text, textSet] = useState(DEFAULT_TEXT);
  // Counters, not timestamps: two edits inside one millisecond still have to
  // rebuild the preview. `fontChangeTrack` moves on every glyph edit,
  // `fontLoadTrack` only when a whole font is loaded.
  const [fontChangeTrack, onFontChange] = useReducer(
    (count: number) => count + 1,
    0
  );
  const [fontLoadTrack, onFontLoad] = useReducer(
    (count: number) => count + 1,
    0
  );

  const previewFamily = useLiveFont(fontConfig, fontChangeTrack);

  async function onExportOtf() {
    try {
      await downloadFont(STATE.font, fontConfig);
    } catch (e) {
      // A glyph the builder cannot outline fails the whole export; say so
      // rather than leaving the button looking as if it did nothing.
      console.error(e);
      const detail = e instanceof Error && e.message ? `\n\n${e.message}` : '';
      alert(`Unable to build the font.${detail}`);
    }
  }

  function onExportJson() {
    downloadBlob(
      `brutalita-${new Date().getTime()}.json`,
      JSON.stringify(
        {
          config: fontConfig,
          chars: cleanFontForExport(STATE.font),
        },
        null,
        2
      ),
      'application/json'
    );
  }

  async function onImport() {
    try {
      const [file] = await uploadBlob();
      // The picker was dismissed: nothing to load, and nothing to report.
      if (file === undefined) return;
      let json = JSON.parse(file);

      // Old Format Support: a bare map of characters, with no config.
      if (json && typeof json === 'object' && !Array.isArray(json) && !json.config) {
        json = {
          chars: json,
          config: { ...DEFAULT_FONT_CONFIG },
        };
      }

      const { config, chars } = parseFont(json);

      STATE.font = chars;
      fontConfigDispatch({ type: 'reset', payload: config });
      onFontLoad();
      onFontChange();
    } catch (e) {
      // parseFont throws with the specific validation errors; show them rather
      // than a bare "unable to load".
      const detail = e instanceof Error && e.message ? `\n\n${e.message}` : '';
      alert(`Unable to load font file.${detail}`);
    }
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '12rem' } as CSSProperties}>
      <SidebarInset>
        <AppMenubar
          fontConfig={fontConfig}
          fontConfigDispatch={fontConfigDispatch}
          onExportOtf={onExportOtf}
          onExportJson={onExportJson}
          onImport={onImport}
        />
        <div className="scroller">
          {/* The mirror holds the same text in the same font and gives the
              area its height; the textarea fills it, so the page scrolls
              instead of the field. */}
          <div
            className="type"
            style={{
              fontFamily: previewFamily
                ? `"${previewFamily}", monospace`
                : undefined,
              fontSize: PREVIEW_FONT_SIZE,
              visibility: previewFamily ? 'visible' : 'hidden',
            }}
          >
            <div className="type-mirror" aria-hidden="true">
              {`${text}\n`}
            </div>
            <textarea
              spellCheck="false"
              aria-label="Preview text"
              value={text}
              onChange={(e) => {
                textSet(e.target.value);
              }}
            />
          </div>
        </div>
      </SidebarInset>

      <AppSidebar
        fontConfig={fontConfig}
        fontConfigDispatch={fontConfigDispatch}
        editorView={
          <EditorContainer
            key={fontLoadTrack}
            editingChar={editingChar}
            slant={fontConfig.slant ?? 0}
            onChangeEditingChar={editingCharSet}
            onChange={onFontChange}
            stroke={fontConfig.stroke}
            corners={fontConfig.corners}
            cornerRadius={fontConfig.cornerRadius}
          />
        }
      />
    </SidebarProvider>
  );
}

export default App;
