import { MARK_ROWS } from '../compose';
import { cornerOptions, sharpPath, strokePath } from '../corners';
import { SEGMENTS } from '../types';
import type { CharLayer, CharLayers, FontConfig } from '../types';
import { Key } from './key';

const [DOTSX, DOTSY] = SEGMENTS;

/** What the editor shows for a character the font has no glyph for yet. */
const NEW_GLYPH: CharLayers = [[[0, 0]]];

/** The pen and curve settings, so a stroke is drawn as the font will build it. */
type PenConfig = Pick<FontConfig, 'stroke' | 'corners' | 'cornerRadius' | 'slant'>;

function LayerEditor({
  value,
  onChange,
  config,
}: {
  value: CharLayer;
  onChange: (layer: CharLayer) => void;
  config: PenConfig;
}) {
  // A wide screen has room for the full grid; a narrow one gets the cap box.
  const advanced = window.innerWidth > 1000;
  const dotSize = advanced ? 24 : 16;
  const gap = advanced ? 50 : 26;
  const controlsHeight = 24;

  // The grid starts above the cap row: accents live in the mark band, so the
  // rows a composed glyph like "Á" uses have to be drawable too.
  const gridTop = MARK_ROWS * gap;

  // Whole steps inside the cap box get a large dot. The full grid adds small
  // ones for the half steps, the descender row and the mark band.
  const step = advanced ? 0.5 : 1;
  const dots: { x: number; y: number; size: number }[] = [];
  for (let x = 0; x <= DOTSX; x += step) {
    for (
      let y = advanced ? -MARK_ROWS : 0;
      y <= (advanced ? DOTSY + 1 : DOTSY);
      y += step
    ) {
      const major =
        Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y <= DOTSY;
      dots.push({ x, y, size: major ? dotSize : dotSize - 8 });
    }
  }

  const curves = cornerOptions(config, 1);

  return (
    <div
      className="editor"
      style={{
        marginTop: dotSize / 2,
        marginLeft: dotSize / 2,
        marginRight: dotSize / 2,
        marginBottom: dotSize / 2 + controlsHeight,
        height: gridTop + (DOTSY + (advanced ? 1 : 0)) * gap,
        width: DOTSX * gap,
      }}
    >
      {dots.map(({ x, y, size }) => (
        <div
          key={`${x},${y}`}
          className="editor-dot"
          onClick={() => onChange([...value, [x, y]])}
          onContextMenu={(e) => {
            e.preventDefault();
            onChange([]);
          }}
          style={{
            height: size,
            width: size,
            backgroundColor: value.some(([px, py]) => px === x && py === y)
              ? '#fff'
              : '#808080',
            left: x * gap,
            top: gridTop + y * gap,
          }}
        />
      ))}

      <svg
        viewBox={`-1 ${-1 - MARK_ROWS} ${DOTSX + 2} ${DOTSY + 2 + MARK_ROWS}`}
        style={{
          position: 'absolute',
          top: -gap,
          left: -gap,
          height: (DOTSY + 2 + MARK_ROWS) * gap,
          width: (DOTSX + 2) * gap,
        }}
      >
        {config.stroke === 'sharp' ? (
          <path d={sharpPath([value], dotSize / 8 / gap, curves)} fill="#fff" />
        ) : (
          <path
            d={strokePath(value, curves)}
            strokeWidth={dotSize / 4}
            fill="none"
            stroke="#fff"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="editor-controls">
        <button onClick={() => onChange([])}>Delete</button>
      </div>
    </div>
  );
}

/**
 * The sidebar's glyph tab: which character is being edited, a preview of it,
 * and one grid per stroke. `layers` is undefined for a character the font does
 * not have yet; the first edit creates it.
 */
export function GlyphEditor({
  char,
  onChangeChar,
  layers,
  onChange,
  config,
}: {
  char: string;
  onChangeChar: (char: string) => void;
  layers: CharLayers | undefined;
  onChange: (layers: CharLayers) => void;
  config: PenConfig;
}) {
  // An empty layer is always on offer, ready to start the next stroke.
  const editing: CharLayers = [...(layers ?? NEW_GLYPH), []];

  function onChangeLayer(index: number, points: CharLayer) {
    // Clicking the last point again takes it back.
    const [a, b] = points.slice(-2);
    const layer =
      b && a[0] === b[0] && a[1] === b[1] ? points.slice(0, -2) : points;
    onChange(
      editing
        .map((existing, i) => (i === index ? layer : existing))
        .filter((existing) => existing.length)
    );
  }

  return (
    <div className="editor-container">
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="editor-input-container">
          <div className="editor-input-label">Editing</div>
          <input
            className="editor-input"
            value={char}
            onChange={(e) => {
              // Whatever was typed last replaces the character being edited.
              const typed = e.target.value.slice(-1);
              if (typed) onChangeChar(typed);
            }}
          />
        </div>
        <div className="editor-input-container">
          <div className="editor-input-label">Preview</div>
          <Key
            path={editing}
            fontSize={8 * 5}
            strokeWidth={4}
            stroke={config.stroke}
            corners={config.corners}
            cornerRadius={config.cornerRadius}
            slant={config.slant}
          />
        </div>
      </div>
      {editing.map((layer, index) => (
        <LayerEditor
          key={index}
          config={config}
          value={layer}
          onChange={(points) => onChangeLayer(index, points)}
        />
      ))}
    </div>
  );
}
