/* eslint-disable */

import { memo, Fragment, useState, useEffect } from 'react';

import { downloadBlob, uploadBlob } from './blob-utils.js';
import { downloadFont } from './font-maker.js';

import FONT_SRC from './font.json';

// import { renderToStaticMarkup } from 'react-dom/server';

window.FONT = FONT_SRC;

const DISPLAY_CHAR_BASE = `AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789`;
const REMAINING_CHARS = Object.keys(window.FONT)
  .filter((char) => !DISPLAY_CHAR_BASE.includes(char))
  .join('')
  .replace(' ', '')
  .replace('\n', '');

const ALL_CHARS = [...DISPLAY_CHAR_BASE, ...REMAINING_CHARS];
const SPLIT = Math.floor(ALL_CHARS.length / 3) + 2;
ALL_CHARS.splice(SPLIT, 0, `\n`);
ALL_CHARS.splice(SPLIT * 2 + 1, 0, `\n`);

// const SPLIT = Math.floor(ALL_CHARS.length / 2) + 1;
// ALL_CHARS.splice(SPLIT, 0, `\n`);

const DEFAULT_TEXT = `BRUTALITA v0.5

${ALL_CHARS.join(``)}


Brutalita is an experimental font and editor,
edit in your browser and download the font.

The name means "little brutal" in Spanish.
Made with SVG and OpenType.js

Use the controls on this page!
- Tap twice to delete a layer.
- Save and restore your progress.
- This textarea is also editable :)

Made by @javierbyte`;

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;

const SEGMENTS = [2, 4];
const DOTSX = SEGMENTS[0];
const DOTSY = SEGMENTS[1];

function includes(arr, el) {
  return arr.some((elArr) => {
    return elArr[0] === el[0] && elArr[1] === el[1];
  });
}

function validateFont(fontDefinition) {
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
          if (coord.length !== 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
            alert(`Invalid char definition found in "${char}"`);
            return false;
          }
        }
      }
    }

    return true;
  } catch (e) {
    alert(`Invalid font file`, e);
    return false;
  }
}

// removes empty layers of font definition
function cleanFontForExport(fontDefinition) {
  const orderedChars = Object.keys(fontDefinition).sort((a, b) => {
    return a.charCodeAt(0) - b.charCodeAt(0);
  });

  return orderedChars.reduce((acc, key) => {
    acc[key] = fontDefinition[key].filter((layer) => layer.length);
    return acc;
  }, {});
}

// <img
//   style={{ zIndex: 100000, margin: 128 }}
//   src={`data:image/svg+xml;base64,${btoa(
//     renderSvg(DEFAULT_TEXT.split(`\n`).slice(0, 9).join(`\n`))
//   )}`}
// />

// function renderSvg(message) {
//   const customWidth = 10;
//   const customSpace = 4;
//   const customRowHeight = 22 + 10;
//   const renderWidth = 800;
//   const renderHeight = 450;
//   let paddingTop = 0;
//   let paddingLeft = 30;

//   const longestRow = Math.max(...message.split(`\n`).map((row) => row.length));

//   paddingLeft = (renderWidth - longestRow * (customWidth + customSpace)) / 2;
//   paddingTop = (renderHeight - message.split(`\n`).length * customRowHeight) / 2;

//   return renderToStaticMarkup(
//     <svg
//       xmlns="http://www.w3.org/2000/svg"
//       fill="#282828"
//       width={renderWidth}
//       height={renderHeight}
//       viewBox={`0 0 ${renderWidth} ${renderHeight}`}
//       style={{ backgroundColor: '#111' }}
//     >
//       {message.split('\n').map((row, rowIdx) =>
//         row.split('').map((char, idx) => {
//           return (
//             <svg
//               x={idx * customWidth + idx * customSpace + paddingLeft}
//               y={rowIdx * customRowHeight + paddingTop}
//             >
//               <Key custom char={char} />
//             </svg>
//           );
//         })
//       )}
//     </svg>
//   );
// }

const Key = memo(function Key({
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
  const LOW_STEM_HEIGHT = Math.ceil(HEIGHT * 0.25);

  const finalPath = path || window.FONT[char];

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

  let dots = [];

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
      viewBox={`${STROKEWIDTH / -2} ${STROKEWIDTH / -2} ${WIDTH + STROKEWIDTH} ${
        HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT
      }`}
      width={custom ? styles.width : undefined}
      height={custom ? styles.height : undefined}
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

function Editor({ value, onChange }) {
  const EDITOR_ADVANCE = window.innerWidth > 1000;
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
                  height: EDITOR_DOT_SIZE - 8,
                  width: EDITOR_DOT_SIZE - 8,
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
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function EditorContainer({ onChange, editingChar, onChangeEditingChar }) {
  const [layers, layersSet] = useState(window.FONT[editingChar]);

  useEffect(() => {
    let newEditingBase = [[], []];

    if (window.FONT[editingChar]) {
      newEditingBase = window.FONT[editingChar];
    }

    layersSet(newEditingBase);
  }, [editingChar, layersSet]);

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
    window.FONT[editingChar] = layersCopy;
    onChange();
  }

  return (
    <div className="sidebar">
      <div style={{ display: 'flex', gap: 12 }}>
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
  const [editingChar, editingCharSet] = useState('Q');
  const [textAreaHeight, textAreaHeightSet] = useState(window.innerHeight);
  const [charWidth, charWidthSet] = useState(64);
  const [text, textSet] = useState(DEFAULT_TEXT);
  const [fontChangeTrack, fontChangeTrackSet] = useState(new Date().getTime());
  const [fontLoadTrack, fontLoadTrackSet] = useState(new Date().getTime() + 1);
  const [isResponsive, isResponsiveSet] = useState(false);

  function onFontChange() {
    fontChangeTrackSet(new Date().getTime());
  }

  useEffect(() => {
    const typeEl = document.querySelector('.type');
    const { height } = typeEl.getBoundingClientRect();
    textAreaHeightSet(height + 200);
  }, [text]);

  useEffect(() => {
    function resize() {
      const width = document.querySelector('body').getBoundingClientRect().width;
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

      <div key={fontChangeTrack} className="type" style={{ width: 14 * charWidth }}>
        <Write message={text} />
      </div>

      <EditorContainer
        key={fontLoadTrack}
        editingChar={editingChar}
        onChangeEditingChar={editingCharSet}
        onChange={onFontChange}
      />

      <div className={`topnav ${isResponsive ? '-responsive' : ''}`}>
        <button
          onClick={() => {
            isResponsiveSet(!isResponsive);
          }}
          className="-show-only-mobile"
        >
          Menu
        </button>
        <button
          onClick={() => {
            window.open('Brutalita-Regular.otf');
          }}
        >
          Download
        </button>
        <button
          className="-hide-on-mobile"
          onClick={() => {
            downloadFont(window.FONT);
          }}
        >
          Download Edited Font
        </button>
        <button
          className="-hide-on-mobile"
          onClick={() => {
            downloadBlob(
              `brutalita-${new Date().getTime()}.json`,
              JSON.stringify(cleanFontForExport(window.FONT), 0, 2)
            );
          }}
        >
          Download JSON
        </button>
        <button
          className="-hide-on-mobile"
          onClick={async () => {
            try {
              const blob = await uploadBlob();
              const json = JSON.parse(blob[0]);

              if (validateFont(json)) {
                window.FONT = json;
                fontLoadTrackSet(new Date().getTime());
                fontChangeTrackSet(new Date().getTime());
              }
            } catch (e) {
              alert(`Unable to load font.json file`, e);
            }
          }}
        >
          Restore JSON
        </button>
        <div style={{ flex: 1 }} />
        <div>
          {'Made by '}
          <a href="https://javier.xyz/">@javierbyte</a>
        </div>
      </div>
    </Fragment>
  );
}

// console.log(renderSvg(DEFAULT_TEXT.split(`\n`).slice(0, 9).join(`\n`)));

export default App;
