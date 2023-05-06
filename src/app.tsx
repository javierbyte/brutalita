/* eslint react/prop-types: 0 */

import { Fragment, useState, useEffect, useReducer } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { downloadBlob, uploadBlob } from './blob-utils';
import { downloadFont } from './font-maker';

import FONT_DEFINITION_SRC from './font.json';

import { Key } from './components/key';

import type { ReactNode } from 'react';

type CharLayer = [number, number][];
type CharLayers = CharLayer[];

const weightToStrokeWidth = {
  300: 1.5,
  400: 2,
  700: 2.5,
} as const;

type FontWeightType = keyof typeof weightToStrokeWidth;

export type FontConfig = {
  name: string;
  weight: FontWeightType;
  height: number;
  monospace: true | false;
};
export type FontDefinition = {
  [char: string]: CharLayers;
};

const DEFAULT_FONT_CONFIG = {
  name: 'Brutalita Custom',
  weight: 400,
  height: 1.888,
  monospace: true,
} as const;

function fontSrcToTypedFont(fontSrc: { [char: string]: number[][][] }) {
  const typedFont: FontDefinition = {};

  for (const char in fontSrc) {
    typedFont[char] = fontSrc[char].map((layer) =>
      layer.map((poly) => [poly[0], poly[1]])
    );
  }

  return typedFont;
}

const STATE: {
  font: FontDefinition;
} = {
  font: fontSrcToTypedFont(FONT_DEFINITION_SRC),
};

function fontConfigReducer(
  state: FontConfig,
  action: {
    type: string;
    payload: any;
  }
) {
  switch (action.type) {
    case 'rename':
      return { ...state, name: action.payload };
    case 'change-weight':
      return { ...state, weight: action.payload };
    case 'change-width':
      return {
        ...state,
        monospace: action.payload,
      };
    case 'reset':
      return action.payload;
    default:
      throw new Error();
  }
}

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

const DEFAULT_TEXT = `BRUTALITA v0.7

${ALL_CHARS.join(``)}


Brutalita is an experimental font and editor.
Create and download your font.

Use the controls on this page!
- Download the original font or your custom edition.
- Save and restore your progress.
- This textarea is also editable :)

The name means "little brutal" in Spanish.
Uses OpenType.js to generate .otf files


Made by @javierbyte`;

const SEGMENTS = [2, 4] as const;
const DOTSX = SEGMENTS[0];
const DOTSY = SEGMENTS[1];

function includes(arr: CharLayer, el: number[]) {
  return arr.some((elArr) => {
    return elArr[0] === el[0] && elArr[1] === el[1];
  });
}

function validateCharFontDefinition(fontDefinition: FontDefinition) {
  try {
    if (!Object.keys(fontDefinition).length) {
      alert(`No characters found on this file`);
      return false;
    }

    for (const char of Object.keys(fontDefinition)) {
      if (char.length > 1) {
        throw new Error(`Found invalid char "${char}"`);
      }
      for (const layer of fontDefinition[char]) {
        for (const coord of layer) {
          if (
            coord.length !== 2 ||
            typeof coord[0] !== 'number' ||
            typeof coord[1] !== 'number'
          ) {
            alert(`Invalid char definition found in "${char}"`);
            return false;
          }
        }
      }
    }

    return true;
  } catch (e) {
    throw new Error(`Invalid font file.`);
  }
}

function parseFont(json: any): { config: FontConfig; chars: FontDefinition } {
  const newConfig: FontConfig = { ...DEFAULT_FONT_CONFIG };

  newConfig.name = String(json.config.name);
  newConfig.monospace = Boolean(json.config.monospace);

  const newWeight = Number(json.config.weight);
  if (newWeight === 300 || newWeight === 400 || newWeight === 700) {
    newConfig.weight = newWeight;
  }

  validateCharFontDefinition(json.chars);

  return { config: newConfig, chars: json.chars };
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
}: {
  value: CharLayer;
  onChange: (arg0: CharLayer) => void;
}) {
  const EDITOR_ADVANCE = window.innerWidth > 1000;
  const EDITOR_DOT_SIZE = EDITOR_ADVANCE ? 24 : 16;
  const EDITOR_GAP = EDITOR_ADVANCE ? 50 : 26;

  const EDITOR_CONTROLS_HEIGHT = 24;

  const style = {
    marginTop: EDITOR_DOT_SIZE / 2,
    marginLeft: EDITOR_DOT_SIZE / 2,
    marginRight: EDITOR_DOT_SIZE / 2,
    marginBottom: EDITOR_DOT_SIZE / 2 + EDITOR_CONTROLS_HEIGHT,
    height: (DOTSY + (EDITOR_ADVANCE ? 1 : 0)) * EDITOR_GAP,
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
                top: y * EDITOR_GAP,
              }}
              className="editor-dot"
            />
          );
        });
      })}

      {EDITOR_ADVANCE &&
        new Array(DOTSX * 2 + 3).fill('').map((_1, x) => {
          return new Array(DOTSY * 2 + 4).fill('').map((_1, y) => {
            const x1 = x / 2 - 0.5;
            const y1 = y / 2 - 0.5;

            // do not ovrelap with bigger dots
            if (x1 === Math.round(x1) && y1 === Math.round(y1)) {
              if (y1 !== DOTSY + 1) {
                return null;
              }
            }
            if (x1 === -0.5) {
              return null;
            }
            if (y1 === -0.5) {
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
                  top: y1 * EDITOR_GAP,
                }}
                className="editor-dot"
              />
            );
          });
        })}

      <svg
        viewBox={`-1 -1 ${DOTSX + 2} ${DOTSY + 2}`}
        style={{
          top: -EDITOR_GAP,
          left: -EDITOR_GAP,
          height: (DOTSY + 2) * EDITOR_GAP,
          width: (DOTSX + 2) * EDITOR_GAP,
        }}
      >
        <polyline
          points={value.map((dot) => dot.join(',')).join(' ')}
          strokeWidth={EDITOR_DOT_SIZE / 4}
          fill="none"
          stroke="#fff"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
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

function Tabs({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (newValue: string) => void;
}) {
  return (
    <div className="jbx-tabs">
      {options.map((option) => {
        return (
          <button
            key={option}
            className={option === value ? 'active' : ''}
            onClick={() => {
              onChange(option);
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function EditorContainer({
  onChange,
  editingChar,
  onChangeEditingChar,
}: {
  onChange: () => void;
  editingChar: string;
  onChangeEditingChar: (arg0: string) => void;
}) {
  const [layers, layersSet] = useState(STATE.font[editingChar]);

  useEffect(() => {
    let newEditingBase = [[[0, 0]]];

    if (STATE.font[editingChar]) {
      newEditingBase = STATE.font[editingChar];
    }

    layersSet(newEditingBase as CharLayers);
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

    charLayersCopy = charLayersCopy.filter((layer) => layer.length);
    charLayersCopy.push([]);

    layersSet(charLayersCopy);
    STATE.font[editingChar] = charLayersCopy;
    onChange();
  }

  return (
    <div className="sidebar">
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
          <Key custom={true} path={layers} fontSize={8 * 5} strokeWidth={4} />
        </div>
      </div>
      {layers.map((_1, layerIdx) => {
        return (
          <Editor
            key={layerIdx}
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

function Write({
  message,
  fontWeight,
}: {
  message: string;
  fontWeight: FontWeightType;
}) {
  return (
    <Fragment>
      {message.split('').map((char, keyIdx) => {
        if (char === '\n') {
          return (
            <Fragment key={keyIdx}>
              <div style={{ height: 30, width: 0 }} />
              <div className="type-break" />
            </Fragment>
          );
        }

        return (
          <Key
            key={keyIdx}
            char={char}
            path={STATE.font[char]}
            strokeWidth={weightToStrokeWidth[fontWeight]}
          />
        );
      })}
    </Fragment>
  );
}

function Menu({ title, children }: { title: string; children: ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger>{title}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Content className="jbx-popover">
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  );
}

function App() {
  const [fontConfig, fontConfigDispatch] = useReducer(
    fontConfigReducer,
    DEFAULT_FONT_CONFIG
  );
  const [editingChar, editingCharSet] = useState('Q');
  const [textAreaHeight, textAreaHeightSet] = useState(window.innerHeight);
  const [charWidth, charWidthSet] = useState(64);
  const [text, textSet] = useState(DEFAULT_TEXT);
  const [fontChangeTrack, fontChangeTrackSet] = useState(new Date().getTime());
  const [fontLoadTrack, fontLoadTrackSet] = useState(new Date().getTime() + 1);

  function onFontChange() {
    fontChangeTrackSet(new Date().getTime());
  }

  useEffect(() => {
    const typeEl = document.querySelector('.type') as HTMLElement;
    const { height } = typeEl.getBoundingClientRect();
    textAreaHeightSet(height + 200);
  }, [text]);

  useEffect(() => {
    function resize() {
      const bodyWidth = (
        document.querySelector('body') as HTMLElement
      ).getBoundingClientRect().width;

      const sidebarWidth = (
        document.querySelector('.sidebar') as HTMLElement
      ).getBoundingClientRect().width;

      const availableChars = Math.min(
        Math.floor((bodyWidth - (sidebarWidth < 200 ? sidebarWidth : 0)) / 14),
        160
      );

      charWidthSet(availableChars);

      window.requestAnimationFrame(() => {
        const typeEl = document.querySelector('.type') as HTMLElement;
        const { height } = typeEl.getBoundingClientRect();
        textAreaHeightSet(height + 200);
      });
    }
    window.addEventListener('resize', () => {
      resize();
    });
    resize();
  }, []);

  return (
    <Fragment>
      <div className="scroller">
        <textarea
          style={{ height: textAreaHeight, width: 14 * charWidth }}
          spellCheck="false"
          value={text}
          onChange={(e) => {
            textSet(e.target.value);
          }}
        />

        <div
          key={fontChangeTrack}
          className="type"
          style={{ width: 14 * charWidth }}
        >
          <Write message={text} fontWeight={fontConfig.weight} />
        </div>
      </div>

      <EditorContainer
        key={fontLoadTrack}
        editingChar={editingChar}
        onChangeEditingChar={editingCharSet}
        onChange={onFontChange}
      />

      <nav className={`topnav`}>
        <Menu title="Export">
          <button
            onClick={() => {
              downloadFont(STATE.font, fontConfig);
            }}
          >
            Font (.otf)
          </button>
          <button
            onClick={() => {
              downloadBlob(
                `brutalita-${new Date().getTime()}.json`,
                JSON.stringify(
                  {
                    config: fontConfig,
                    chars: cleanFontForExport(STATE.font),
                  },
                  null,
                  2
                )
              );
            }}
          >
            Font Definition (.json)
          </button>
        </Menu>

        <Menu title="Import">
          <button
            onClick={async () => {
              try {
                const blob = (await uploadBlob()) as [string];
                let json = JSON.parse(blob[0]);

                // Old Format Support
                if (!json.config) {
                  json = {
                    chars: json,
                    config: { ...DEFAULT_FONT_CONFIG },
                  };
                }

                const { config, chars } = parseFont(json);

                STATE.font = chars;
                fontConfigDispatch({ type: 'reset', payload: config });
                fontLoadTrackSet(new Date().getTime());
                fontChangeTrackSet(new Date().getTime() + 1);
              } catch (e) {
                alert(`Unable to load font file.`);
              }
            }}
          >
            Font Definition (.json)
          </button>
        </Menu>

        <Menu title="Settings">
          <div className="jbx-popover--title">Font Name</div>
          <input
            className="jbx-input"
            value={fontConfig.name}
            onChange={(evt) =>
              fontConfigDispatch({ type: 'rename', payload: evt.target.value })
            }
            spellCheck={false}
          />
          <div className="jbx-popover--title">Font Weight</div>
          <Tabs
            options={['300', '400', '700']}
            value={String(fontConfig.weight)}
            onChange={(newValue) =>
              fontConfigDispatch({ type: 'change-weight', payload: newValue })
            }
          />
          <div className="jbx-popover--title">Width</div>
          <Tabs
            options={['Monospace', 'Proportional']}
            onChange={(newValue) =>
              fontConfigDispatch({
                type: 'change-width',
                payload: newValue === 'Monospace',
              })
            }
            value={fontConfig.monospace ? 'Monospace' : 'Proportional'}
          />
        </Menu>

        <Menu title="About">
          <div className="jbx-popover--content">
            Made by <a href="https://javier.xyz">Javier Bórquez</a>.
          </div>
          <hr />
          <div className="jbx-popover--content">
            <a href="Brutalita-300.otf">Download Brutalita 300</a>
          </div>
          <div className="jbx-popover--content">
            <a href="Brutalita-400.otf">Download Brutalita 400</a>
          </div>
          <div className="jbx-popover--content">
            <a href="Brutalita-700.otf">Download Brutalita 700</a>
          </div>
          <hr />
          <div className="jbx-popover--content">
            <a href="https://github.com/javierbyte/brutalita">Github Repo</a>
          </div>
        </Menu>
      </nav>
    </Fragment>
  );
}

export default App;
