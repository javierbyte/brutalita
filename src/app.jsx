/* eslint-disable */

import { Fragment, useState, useEffect } from 'react';

import { downloadFont } from './font-maker.js';

import FONT from './font.json';

const DEFAULT_TEXT = `BRUTALITA SANS V0.4

ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
0123456789
@_.,()?;:!"#$%<>=/+*&[]{}^'


BRUTALITA IS AN EXPERIMENTAL FONT AND FONT EDITOR,
EDIT IN YOUR BROWSER AND DOWNLOAD AN OPENTYPE FONT.

THE NAME MEANS "LITTLE BRUTAL" IN SPANISH.
MADE WITH SVG AND OPENTYPE.JS

USE THE CONTROLS ON THIS PAGE!
> TAP TWICE TO DELETE A LAYER.


MADE BY @JAVIERBYTE`;

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;

const SEGMENTS = [2, 4];
const DOTSX = SEGMENTS[0];
const DOTSY = SEGMENTS[1];

// FILLING THE GAPS
for (const char in FONT) {
  for (const line in FONT[char]) {
    if (FONT[char][line]) {
      const lastEl = FONT[char][line].slice(-1)[0];
      if (lastEl === 'X') {
        FONT[char][line] = [...FONT[char][line].slice(0, -1), FONT[char][line][0]];
      }
    }
  }
}

function includes(arr, el) {
  return arr.some((elArr) => {
    return elArr[0] === el[0] && elArr[1] === el[1];
  });
}

function Key({
  char,
  path,
  custom = false,
  color = 'white',
  fontSize = DEFAULT_FONT_SIZE,
  strokeWidth = DEFAULT_STROKE_WIDTH
}) {
  const WIDTH = 0.5 * fontSize;
  const HEIGHT = 1 * fontSize;
  const STROKEWIDTH = strokeWidth;
  const LOW_STEM_HEIGHT = 4;

  const finalPath = path || FONT[char];

  const styles = custom
    ? {
        width: WIDTH + STROKEWIDTH,
        height: HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT,
        marginBottom: -LOW_STEM_HEIGHT,
        marginRight: 4,
        marginTop: 12,
        color
      }
    : null;

  if (!finalPath) {
    return <div className="unknown-char key">{char}</div>;
  }

  let corners = {};
  const pathMapped = finalPath.map((lines) =>
    lines.map(([x, y]) => {
      const coordX = Math.round((x * WIDTH) / SEGMENTS[0]);
      const coordY = Math.round((y * HEIGHT) / SEGMENTS[1]);

      const coordStr = `${coordX},${coordY}`;

      corners[coordStr] = [coordX, coordY];

      return coordStr;
    })
  );

  return (
    <svg
      className="key"
      viewBox={`${STROKEWIDTH / -2} ${STROKEWIDTH / -2} ${WIDTH + STROKEWIDTH} ${
        HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT
      }`}
      style={styles}
    >
      {pathMapped.map((line, lineIdx) => (
        <polyline
          key={lineIdx}
          points={line.join(' ')}
          strokeWidth={STROKEWIDTH}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          fill="none"
          stroke={color}
        />
      ))}

      {Object.keys(corners).map((corner) => (
        <circle
          key={corner}
          cx={corners[corner][0]}
          cy={corners[corner][1]}
          r={STROKEWIDTH / 2}
          fill={color}
        />
      ))}
    </svg>
  );
}

function Editor({ value, onChange }) {
  const EDITOR_ADVANCE = window.innerWidth > 1200;
  const EDITOR_DOT_SIZE = EDITOR_ADVANCE ? 24 : 16;
  const EDITOR_GAP = EDITOR_ADVANCE ? 50 : 26;

  const style = {
    margin: EDITOR_DOT_SIZE / 2,
    height: (DOTSY + (EDITOR_ADVANCE ? 1 : 0)) * EDITOR_GAP,
    width: DOTSX * EDITOR_GAP
  };

  return (
    <div className="editor" style={style}>
      {new Array(DOTSX + 1).fill('').map((a, x) => {
        return new Array(DOTSY + 1).fill('').map((a, y) => {
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
                top: y * EDITOR_GAP
              }}
              className="editor-dot"
            />
          );
        });
      })}

      {EDITOR_ADVANCE &&
        new Array(DOTSX * 2 + 3).fill('').map((a, x) => {
          return new Array(DOTSY * 2 + 4).fill('').map((a, y) => {
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
            // if (y1 === DOTSY + 0.5) {
            //   return null;
            // }

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
                  height: EDITOR_DOT_SIZE - 10,
                  width: EDITOR_DOT_SIZE - 10,
                  backgroundColor: includes(value, [x1, y1]) ? '#fff' : '#808080',
                  left: x1 * EDITOR_GAP,
                  top: y1 * EDITOR_GAP
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
          width: (DOTSX + 2) * EDITOR_GAP
        }}
      >
        <polyline
          points={value.map((dot) => dot.join(',')).join(' ')}
          strokeWidth={EDITOR_DOT_SIZE / 4}
          fill="none"
          stroke="#fff"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function EditorContainer({ onChange }) {
  const [editingChar, editingCharSet] = useState('Q');
  const [layers, layersSet] = useState(FONT['Q']);

  useEffect(() => {
    let newEditingBase = [[], []];

    if (FONT[editingChar]) {
      newEditingBase = FONT[editingChar];
    }

    layersSet(newEditingBase);
  }, [editingChar, layersSet]);

  useEffect(() => {
    FONT[editingChar] = layers;
    onChange();
  }, layers);

  function onChangeEditor(layerIdx, val) {
    let layersCopy = JSON.parse(JSON.stringify(layers));
    layersCopy[layerIdx] = val.filter((el) => el.length);

    // clear on doble click
    if (layersCopy[layerIdx].slice(-2).length === 2) {
      if (
        layersCopy[layerIdx].slice(-2)[0].join(',') === layersCopy[layerIdx].slice(-2)[1].join(',')
      ) {
        layersCopy[layerIdx] = [];
      }
    }

    layersCopy = layersCopy.filter((layer) => layer.length);
    layersCopy.push([]);

    layersSet(layersCopy);
  }

  return (
    <div className="editor-container">
      <div className="editor-input-container">
        <div className="editor-input-label">To edit</div>
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
              editingCharSet(newChar);
            }
          }}
        />
      </div>
      <div className="editor-input-container">
        <div className="editor-input-label">Preview</div>
        <Key custom={true} path={layers} fontSize={8 * 6} strokeWidth={4} />
      </div>
      {layers.map((layer, layerIdx) => {
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

function Write({ message }) {
  return message.split('').map((char, keyIdx) => {
    if (char === '\n') {
      return (
        <Fragment key={keyIdx}>
          <div style={{ height: 30, width: 0 }} />
          <div className="type-break" />
        </Fragment>
      );
    }

    return <Key key={keyIdx} char={char} />;
  });
}

function App() {
  const [textAreaHeight, textAreaHeightSet] = useState(window.innerHeight);
  const [charWidth, charWidthSet] = useState(64);
  const [text, textSet] = useState(DEFAULT_TEXT);
  const [timestamp, timestampSet] = useState(new Date().getTime());

  function onFontChange() {
    window.FONT = FONT;
    timestampSet(new Date().getTime());
  }

  useEffect(() => {
    const typeEl = document.querySelector('.type');
    const { height } = typeEl.getBoundingClientRect();
    textAreaHeightSet(height + 200);
  }, [text]);

  useEffect(() => {
    function resize() {
      const width = document.querySelector('body').getBoundingClientRect().width - 32;
      const availableChars = Math.min(Math.floor(width / 14), 60);

      charWidthSet(availableChars);

      window.requestAnimationFrame(() => {
        const typeEl = document.querySelector('.type');
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
      <div className="type" key={timestamp} style={{ width: 14 * charWidth }}>
        <Write message={text} />
      </div>

      <EditorContainer onChange={onFontChange} />

      <div className="topnav">
        <button
          onClick={() => {
            downloadFont(FONT);
          }}
        >
          Download Edited
        </button>
        <button
          onClick={() => {
            window.open('Brutalita-Regular.otf');
          }}
        >
          Download Brutalita
        </button>
        <div style={{ flex: 1 }} />

        <div>
          {'Made by  '}
          <a href="https://javier.xyz/">@javierbyte</a>
        </div>
      </div>
    </Fragment>
  );
}

export default App;
