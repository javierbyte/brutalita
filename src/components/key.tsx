import { memo } from 'react';

type CharLayer = [number, number][];
type CharLayers = CharLayer[];

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 2;
const SEGMENTS = [2, 4] as const;

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

  const finalPath = path;

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
