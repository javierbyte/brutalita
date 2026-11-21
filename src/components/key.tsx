import { memo } from 'react';

import { MARK_ROWS } from '../compose';
import { anchorEnds, cornerOptions, sharpPath, strokePath } from '../corners';
import type { CornerStyle, StrokeStyle } from '../corners';
import { slantFactor } from '../slant';
import { SEGMENTS } from '../types';
import type { CharLayers } from '../types';

/** Where the cap-height row sits inside the cell. */
const CELL_TOP_MARGIN = 12;

/**
 * One glyph drawn as strokes, the way src/svg-export.ts draws text: the same
 * cell (half an em wide, one em tall) and the same rounding onto it.
 */
export const Key = memo(function Key({
  path,
  fontSize,
  strokeWidth,
  stroke,
  corners,
  cornerRadius,
  slant = 0,
}: {
  path: CharLayers;
  fontSize: number;
  strokeWidth: number;
  stroke?: StrokeStyle;
  corners?: CornerStyle;
  cornerRadius?: number;
  slant?: number;
}) {
  const width = 0.5 * fontSize;
  const height = fontSize;
  const row = height / SEGMENTS[1];
  const shear = slantFactor(slant);
  const curves = cornerOptions({ corners, cornerRadius }, row);
  const descender = Math.ceil(height * 0.25);
  // Room above the cap line for the accent of a composed glyph ("Á"). The cell
  // grows upwards and its top margin shrinks by the same amount, so the
  // baseline stays where it was.
  const markBand = Math.ceil(row * MARK_ROWS);

  const cellWidth = width + strokeWidth;
  const cellHeight = height + strokeWidth + descender + markBand;

  const grid = path.map((layer) =>
    layer.map(([x, y]): [number, number] => [
      Math.round((x * width) / SEGMENTS[0]),
      Math.round((y * height) / SEGMENTS[1]),
    ])
  );
  const strokes = curves ? anchorEnds(grid, curves) : grid;
  // A layer of a single point is a dot.
  const dots = grid.filter((layer) => layer.length === 1).map(([dot]) => dot);

  return (
    <svg
      viewBox={`${strokeWidth / -2} ${-markBand - strokeWidth / 2} ${cellWidth} ${cellHeight}`}
      width={cellWidth}
      height={cellHeight}
      style={{
        marginRight: 4,
        marginTop: CELL_TOP_MARGIN - markBand,
        marginBottom: -descender,
        overflow: 'visible',
      }}
    >
      <g transform={shear ? `matrix(1 0 ${-shear} 1 ${height * shear} 0)` : undefined}>
        {stroke === 'sharp' ? (
          <path d={sharpPath(strokes, strokeWidth / 2, curves)} fill="white" />
        ) : (
          <>
            {strokes.map((line, index) => (
              <path
                key={index}
                d={strokePath(line, curves)}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect={shear ? undefined : 'non-scaling-stroke'}
                fill="none"
                stroke="white"
              />
            ))}
            {dots.map(([cx, cy]) => (
              <circle
                key={`${cx},${cy}`}
                cx={cx}
                cy={cy}
                r={strokeWidth * 0.75}
                fill="white"
              />
            ))}
          </>
        )}
      </g>
    </svg>
  );
});
