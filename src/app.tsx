'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { downloadBlob, uploadBlob } from './blob-utils';
import {
  buildFontBytes,
  downloadFont,
  GEOMETRY_KEYS,
  UNITS_PER_EM,
} from './font-maker';

import FONT_DEFINITION_SRC from './font.json';

import { AppSidebar } from './components/app-sidebar';
import { AppMenubar } from './components/app-menubar';
import { GlyphEditor } from './components/glyph-editor';
import { DEFAULT_FONT_CONFIG, fontConfigReducer } from './font-config';
import { formatIssue, validateFontSource } from './font-validate';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';

import type { FontConfig, FontDefinition } from './types';

// Validation itself lives in ./font-validate so the CLI shares it. Here we only
// turn a failed result into a throw the import handler can report.
const MAX_REPORTED_ISSUES = 8;

function parseFont(json: unknown): { config: FontConfig; chars: FontDefinition } {
  const { ok, config, chars, errors } = validateFontSource(json);

  if (!ok) {
    const reported = errors
      .slice(0, MAX_REPORTED_ISSUES)
      .map((issue) => formatIssue(issue));
    if (errors.length > reported.length) {
      reported.push(`…and ${errors.length - reported.length} more`);
    }
    throw new Error(reported.join('\n'));
  }

  return { config, chars };
}

const { config: INITIAL_FONT_CONFIG, chars: INITIAL_FONT } =
  parseFont(FONT_DEFINITION_SRC);

// The specimen: letters and digits first, then whatever else the font has,
// over three lines.
const DISPLAY_CHAR_BASE = `AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789`;
const ALL_CHARS = [
  ...DISPLAY_CHAR_BASE,
  ...Object.keys(INITIAL_FONT).filter(
    (char) => !DISPLAY_CHAR_BASE.includes(char) && char !== ' ' && char !== '\n'
  ),
];
const SPLIT = Math.floor(ALL_CHARS.length / 3) + 2;
ALL_CHARS.splice(SPLIT, 0, `\n`);
ALL_CHARS.splice(SPLIT * 2 + 1, 0, `\n`);

const FONT_VERSION = INITIAL_FONT_CONFIG.version;

const DEFAULT_TEXT = `Brutalita Sans${FONT_VERSION ? ` v${FONT_VERSION}` : ''}

${ALL_CHARS.join(``)}


Brutalita is an experimental font and editor.
Create and download your font.

Use the controls on this page!
- Download the original font or your custom edition.
- Save and restore your progress.
- This textarea is also editable :)

"Brutalita" is a playful combination of "brutalism" and "little brutal" in Spanish.


Made by @javierbyte`;

/** The font with its characters in code order, so two exports diff cleanly. */
function sortedForExport(font: FontDefinition): FontDefinition {
  return Object.fromEntries(
    Object.keys(font)
      .sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0))
      .map((char) => [char, font[char]])
  );
}

/** What an alert appends after its headline, when the error says anything. */
function errorDetail(error: unknown): string {
  return error instanceof Error && error.message ? `\n\n${error.message}` : '';
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
 * build lands.
 */
function useLiveFont(font: FontDefinition, config: FontConfig): string | null {
  const [family, familySet] = useState<string | null>(null);
  const faces = useRef<FontFace[]>([]);

  // Only what shapes the outlines and spacing, as one comparable value.
  // Renaming the font or its designer must not rebuild on every keystroke.
  const geometry = JSON.stringify(config, [...GEOMETRY_KEYS]);

  useEffect(() => {
    let cancelled = false;

    // Off the event that caused it, so a slider drag paints its own thumb
    // first and a burst of changes builds once.
    const timer = setTimeout(async () => {
      try {
        const bytes = buildFontBytes(font, {
          ...JSON.parse(geometry),
          name: 'Brutalita Preview',
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
  }, [font, geometry]);

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
  const [font, fontSet] = useState(INITIAL_FONT);
  const [editingChar, editingCharSet] = useState('Q');
  const [text, textSet] = useState(DEFAULT_TEXT);

  const previewFamily = useLiveFont(font, fontConfig);

  async function onExportOtf() {
    try {
      await downloadFont(font, fontConfig);
    } catch (e) {
      // A glyph the builder cannot outline fails the whole export; say so
      // rather than leaving the button looking as if it did nothing.
      console.error(e);
      alert(`Unable to build the font.${errorDetail(e)}`);
    }
  }

  function onExportJson() {
    downloadBlob(
      `brutalita-${Date.now()}.json`,
      JSON.stringify(
        { config: fontConfig, chars: sortedForExport(font) },
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
        json = { chars: json, config: { ...DEFAULT_FONT_CONFIG } };
      }

      const { config, chars } = parseFont(json);
      fontSet(chars);
      fontConfigDispatch({ type: 'reset', payload: config });
    } catch (e) {
      // parseFont throws with the specific validation errors; show them rather
      // than a bare "unable to load".
      alert(`Unable to load font file.${errorDetail(e)}`);
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
          <GlyphEditor
            char={editingChar}
            onChangeChar={editingCharSet}
            layers={font[editingChar]}
            onChange={(layers) => fontSet({ ...font, [editingChar]: layers })}
            config={fontConfig}
          />
        }
      />
    </SidebarProvider>
  );
}

export default App;
