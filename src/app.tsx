/* eslint react/prop-types: 0 */

import { memo, Fragment, useState, useEffect, useRef } from 'react';

import { downloadBlob, uploadBlob } from './blob-utils';
import { downloadFont } from './font-maker';

import FONT_SRC from './font.json';

import type { ReactNode, RefObject } from 'react';

type CharLayer = [number, number][];
type CharLayers = CharLayer[];
export type FontDefinition = {
  [char: string]: CharLayers;
};

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
  font: fontSrcToTypedFont(FONT_SRC),
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

const DEFAULT_TEXT = `BRUTALITA v0.6

${ALL_CHARS.join(``)}


Brutalita is an experimental font and editor,
edit in your browser and download the font.

Use the controls on this page!
- Download the original font or your custom edition.
- Save and restore your progress.
- This textarea is also editable :)

The name means "little brutal" in Spanish.
Made with SVG and OpenType.js


Made by @javierbyte`;

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;

const SEGMENTS = [2, 4];
const DOTSX = SEGMENTS[0];
const DOTSY = SEGMENTS[1];

function includes(arr: CharLayer, el: number[]) {
  return arr.some((elArr) => {
    return elArr[0] === el[0] && elArr[1] === el[1];
  });
}

function validateFont(fontDefinition: FontDefinition) {
  try {
    if (!Object.keys(fontDefinition).length) {
      alert(`No characters found on this file`);
      return false;
    }

    for (const char of Object.keys(fontDefinition)) {
      if (char.length > 1) {
        alert(`Found invalid char "${char}"`);
        return false;
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
    alert(`Invalid font file.`);
    return false;
  }
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

const Key = memo(function Key({
  char,
  path,
  custom = false,
  color = 'white',
  fontSize = DEFAULT_FONT_SIZE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: {
  char?: string;
  path?: CharLayers;
  custom?: true | false;
  color?: string;
  fontSize?: number;
  strokeWidth?: number;
}) {
  const WIDTH = 0.5 * fontSize;
  const HEIGHT = 1 * fontSize;
  const STROKEWIDTH = strokeWidth;
  const LOW_STEM_HEIGHT = Math.ceil(HEIGHT * 0.25);

  const finalPath = path || STATE.font[char as string];

  const styles = custom
    ? {
        width: WIDTH + STROKEWIDTH,
        height: HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT,
        marginBottom: -LOW_STEM_HEIGHT,
        marginRight: 4,
        marginTop: 12,
        color,
      }
    : {};

  if (!finalPath) {
    return <div className="unknown-char key">{char}</div>;
  }

  let dots: [number, number][] = [];

  const pathMapped = finalPath.map((layer) =>
    layer.map(([x, y]) => {
      const coordX = Math.round((x * WIDTH) / SEGMENTS[0]);
      const coordY = Math.round((y * HEIGHT) / SEGMENTS[1]);

      const coordStr = `${coordX},${coordY}`;

      if (layer.length === 1) {
        dots.push([coordX, coordY]);
      }

      return coordStr;
    })
  );

  return (
    <svg
      className="key"
      viewBox={`${STROKEWIDTH / -2} ${STROKEWIDTH / -2} ${
        WIDTH + STROKEWIDTH
      } ${HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT}`}
      width={styles ? styles.width : undefined}
      height={styles ? styles.height : undefined}
      style={styles}
    >
      {pathMapped.map((line, lineIdx) => (
        <polyline
          key={lineIdx}
          points={line.join(' ')}
          strokeWidth={STROKEWIDTH}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          fill="none"
          stroke={color}
        />
      ))}

      {dots.map((dotXY) => (
        <circle
          key={`${dotXY[0]}, ${dotXY[1]}`}
          cx={dotXY[0]}
          cy={dotXY[1]}
          r={STROKEWIDTH * 0.75}
          fill={color}
        />
      ))}
    </svg>
  );
});

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

function Write({ message }: { message: string }) {
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

        return <Key key={keyIdx} char={char} />;
      })}
    </Fragment>
  );
}

const useClickOutside = (
  ref: RefObject<HTMLInputElement>,
  callback: () => void
) => {
  const handleClick = (e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
      callback();
    }
  };
  useEffect(() => {
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  });
};

function Menu({
  children,
  options = {},
}: {
  children: ReactNode;
  options: { [key: string]: string | (() => void) };
}) {
  const [open, openSet] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const classList = [`jbx-menu`, open && '-open'].filter((e) => e).join(' ');

  useClickOutside(ref, () => {
    openSet(false);
  });

  return (
    <div
      ref={ref}
      onClick={() => {
        openSet(!open);
      }}
      className={classList}
    >
      {children}
      {open && (
        <div className="jbx-menu-options">
          {Object.keys(options).map((name) => {
            if (options[name] instanceof Function) {
              return (
                <div
                  className="jbx-menu-option"
                  key={name}
                  onClick={options[name] as () => void}
                >
                  {name}
                </div>
              );
            } else {
              return (
                <a
                  className="jbx-menu-option"
                  key={name}
                  href={options[name] as string}
                >
                  {name}
                </a>
              );
            }
          })}
        </div>
      )}
    </div>
  );
}

function App() {
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

      // const availableChars = Math.min(Math.floor(width / 14), 160);

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
        <Write message={text} />
      </div>

      <EditorContainer
        key={fontLoadTrack}
        editingChar={editingChar}
        onChangeEditingChar={editingCharSet}
        onChange={onFontChange}
      />

      <nav className={`topnav`}>
        <Menu
          options={{
            'Export Config': () => {
              downloadBlob(
                `brutalita-${new Date().getTime()}.json`,
                JSON.stringify(cleanFontForExport(STATE.font), null, 2)
              );
            },
            'Restore Config': async () => {
              try {
                const blob = (await uploadBlob()) as [string];
                const json = JSON.parse(blob[0]);

                if (validateFont(json)) {
                  STATE.font = json;
                  fontLoadTrackSet(new Date().getTime());
                  fontChangeTrackSet(new Date().getTime() + 1);
                }
              } catch (e) {
                alert(`Unable to load font file.`);
              }
            },
          }}
        >
          {`File`}
        </Menu>
        <Menu
          options={{
            'Download edited font': () => {
              downloadFont(STATE.font);
            },
            'Download original font': () => {
              window.open('Brutalita-Regular.otf');
            },
          }}
        >
          {`Download`}
        </Menu>
        <Menu
          options={{
            'Github Repo': 'https://github.com/javierbyte/brutalita',
          }}
        >
          {`About`}
        </Menu>
        <div style={{ flex: 1 }} />
        <a href="https://twitter.com/javierbyte">Made by Javier</a>
      </nav>
    </Fragment>
  );
}

export default App;
