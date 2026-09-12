import { memo } from 'react';

import { MARK_ROWS } from '../compose';
import { SEGMENTS } from '../types';
import type { CharLayers } from '../types';

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;
/** Where the cap-height row sits inside the cell, in .key CSS. */
const CELL_TOP_MARGIN = 12;

export const Key = memo(function Key({
  char,
  path,
  custom = false,
  color = 'white',
  fontSize = DEFAULT_FONT_SIZE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
}: {
  char?: string;
  path: CharLayers;
  custom?: true | false;
  color?: string;
  fontSize?: number;
  strokeWidth?: number;
}) {
  const WIDTH = 0.5 * fontSize;
  const HEIGHT = 1 * fontSize;
  const STROKEWIDTH = strokeWidth;
  const LOW_STEM_HEIGHT = Math.ceil(HEIGHT * 0.25);
  // Room above the cap line for the accent of a composed glyph ("Á"). The cell
  // grows upwards and its top margin shrinks by the same amount, so the
  // baseline stays where it was and lines keep their spacing.
  const MARK_BAND = Math.ceil((HEIGHT / SEGMENTS[1]) * MARK_ROWS);

  const finalPath = path;

  const styles = custom
    ? {
        width: WIDTH + STROKEWIDTH,
        height: HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT + MARK_BAND,
        marginBottom: -LOW_STEM_HEIGHT,
        marginRight: 4,
        marginTop: CELL_TOP_MARGIN - MARK_BAND,
        color,
      }
    : {
        // Keep the enlarged 14px mono cell and skeleton fixed across weights.
        width: WIDTH + STROKEWIDTH,
        height: HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT + MARK_BAND,
        marginRight: 14 - WIDTH - STROKEWIDTH,
        marginTop: CELL_TOP_MARGIN - MARK_BAND,
        marginBottom: -LOW_STEM_HEIGHT - (STROKEWIDTH - DEFAULT_STROKE_WIDTH),
        overflow: 'visible' as const,
      };

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
      viewBox={`${STROKEWIDTH / -2} ${-MARK_BAND - STROKEWIDTH / 2} ${
        WIDTH + STROKEWIDTH
      } ${HEIGHT + STROKEWIDTH + LOW_STEM_HEIGHT + MARK_BAND}`}
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
