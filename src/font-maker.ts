import Opentype from 'opentype.js';
import polygonClipping from 'polygon-clipping';
import { FontConfig, FontDefinition } from './app';

// import unicodeCsvSrc from './lib/named-character-references.csv';

const CIRCLE_SEGMENTS = 16;

const WEIGHTS = {
  '300': 0.15,
  '400': 0.25,
  '700': 0.3,
} as const;

const CHAR_X = 2;
const CHAR_Y = 4;
const SCALE_X = 640;
const SCALE_Y = SCALE_X * 1.888;

const KERNING = Math.round((SCALE_X * 0.4) / 2) * 2;
const UNITS_PER_EM = 2048;

const ASCENDER = Math.round((SCALE_Y * 5) / 4);
const DESCENDER = -Math.round(SCALE_Y / 4);

function configToMetrics(config: FontConfig) {
  const weight = WEIGHTS[config.weight];
  const monospaceAdvance =
    UNITS_PER_EM - SCALE_X - KERNING + (weight / CHAR_X / 2) * UNITS_PER_EM;
  return { weight, monospaceAdvance };
}

function coordToScale(
  x: number,
  y: number,
  config: FontConfig
): [number, number] {
  const { weight } = configToMetrics(config);

  const newCoord: [number, number] = [
    Math.round(((x + weight) / CHAR_X) * SCALE_X) + KERNING / 2,
    Math.round(((CHAR_Y - y - weight + 0.5) / CHAR_Y) * SCALE_Y),
  ];

  return newCoord;
}

// const TO_COMBINE = {
//   á: ['a', '´'],
//   é: ['e', '´'],
//   í: ['i', '´'],
//   ó: ['o', '´'],
//   ú: ['u', '´'],
// };

// async function getUnicodeCharNames() {
//   return fetch(unicodeCsvSrc)
//     .then((response) => response.text())
//     .then((dataRaw) => {
//       return dataRaw
//         .trim()
//         .split(`\n`)
//         .map((e) => e.split(','))
//         .reduce((res: { [key: string]: string }, row) => {
//           const unicodeNumber = parseInt(row[1], 16);
//           res[unicodeNumber] = row[0];
//           return res;
//         }, {});
//     });
// }

function polar2cartesian({
  distance,
  angle,
}: {
  distance: number;
  angle: number;
}) {
  return {
    x: distance * Math.cos(angle),
    y: distance * Math.sin(angle),
  };
}

function cartesian2polar({ x, y }: { x: number; y: number }) {
  return {
    distance: Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)),
    angle: Math.atan2(y, x),
  };
}

type polygon = [number, number][];

function definePolygon() {
  let multiPolygon: polygon[] = [];
  let currentPolygon: polygon = [];

  return {
    start(x: number, y: number) {
      currentPolygon = [[x, y]];
    },
    line(x: number, y: number) {
      currentPolygon.push([x, y]);
    },
    close() {
      currentPolygon.push(currentPolygon[0]);
      multiPolygon.push(currentPolygon);
    },
    get() {
      return [multiPolygon];
    },
    getUnion() {
      const arrMulti = multiPolygon.map((e) => [e]);
      return polygonClipping.union(arrMulti);
    },
  };
}

function makeGlyph(char: string, path: polygon[] = [], config: FontConfig) {
  const { weight, monospaceAdvance } = configToMetrics(config);
  const glyphPolygon = definePolygon();

  // clean path and layers from empty arrays
  path = path
    .filter((layer) => layer.length)
    .map((layer) => layer.filter((coord) => coord.length));

  if (path.length) {
    for (const layer of path) {
      const dotTotal = layer.length;

      let i = 0;
      while (i < dotTotal - 1) {
        const [x1, y1] = layer[i];
        const [x2, y2] = layer[i + 1];

        const polar = cartesian2polar({ x: x2 - x1, y: y2 - y1 });
        const newCoord = polar2cartesian({
          distance: weight,
          angle: polar.angle - Math.PI / 2,
        });

        glyphPolygon.start(
          ...coordToScale(x1 - newCoord.x, y1 - newCoord.y, config)
        );
        glyphPolygon.line(
          ...coordToScale(x1 + newCoord.x, y1 + newCoord.y, config)
        );
        glyphPolygon.line(
          ...coordToScale(x2 + newCoord.x, y2 + newCoord.y, config)
        );
        glyphPolygon.line(
          ...coordToScale(x2 - newCoord.x, y2 - newCoord.y, config)
        );

        glyphPolygon.close();

        i++;
      }
    }
  }

  let uniqueDots: { [key: string]: [number, number] } = {};
  let uniqueCoords: { [key: string]: [number, number] } = {};
  for (const layer of path) {
    for (const coord of layer) {
      // only one coord per layer means this is a dot
      if (layer.length === 1) {
        uniqueDots[coord.join(',')] = coord;
      } else {
        /* I'll try to find this point as an intersection of two different lines */
        let found = false;

        for (const layer of path) {
          let i = 0;
          while (i < layer.length - 1 && !found) {
            const j = i + 1;

            if (layer[i][0] === layer[j][0] && layer[j][0] === coord[0]) {
              if (
                Math.min(layer[i][1], layer[j][1]) < coord[1] &&
                Math.max(layer[i][1], layer[j][1]) > coord[1]
              ) {
                found = true;
              }
            }

            if (layer[i][1] === layer[j][1] && layer[j][1] === coord[1]) {
              if (
                Math.min(layer[i][0], layer[j][0]) < coord[0] &&
                Math.max(layer[i][0], layer[j][0]) > coord[0]
              ) {
                found = true;
              }
            }

            if (layer[i][1] !== layer[j][1] && layer[j][0] !== coord[0]) {
              const diff0 = layer[j][0] - layer[i][0];
              const diff1 = layer[j][1] - layer[i][1];

              const progress0 = (coord[0] - layer[i][0]) / diff0;

              if (progress0 * diff1 === coord[1] - layer[i][1]) {
                if (
                  Math.min(layer[i][0], layer[j][0]) < coord[0] &&
                  Math.max(layer[i][0], layer[j][0]) > coord[0]
                ) {
                  found = true;
                }
              }
            }
            i++;
          }
        }

        if (!found) uniqueCoords[coord.join(',')] = coord;
      }
    }
  }
  for (const uniqueCoordKey of Object.keys(uniqueCoords)) {
    // draw vertice
    const [x, y] = uniqueCoords[uniqueCoordKey];
    let j = 0;
    while (j < CIRCLE_SEGMENTS) {
      const newCoord = polar2cartesian({
        distance: weight,
        angle: (2 * Math.PI * j) / CIRCLE_SEGMENTS,
      });

      // first point of the circle, move
      if (j === 0) {
        glyphPolygon.start(
          ...coordToScale(x + newCoord.x, y + newCoord.y, config)
        );
      } else {
        glyphPolygon.line(
          ...coordToScale(x + newCoord.x, y + newCoord.y, config)
        );
      }
      j++;
    }
    glyphPolygon.close();
  }

  for (const dotCoordKey of Object.keys(uniqueDots)) {
    // draw dot
    const [x, y] = uniqueDots[dotCoordKey];
    let j = 0;
    while (j < CIRCLE_SEGMENTS) {
      const newCoord = polar2cartesian({
        distance: weight * 1.5,
        angle: (2 * Math.PI * j) / CIRCLE_SEGMENTS,
      });

      // first point of the circle, move
      if (j === 0) {
        glyphPolygon.start(
          ...coordToScale(x + newCoord.x, y + newCoord.y, config)
        );
      } else {
        glyphPolygon.line(
          ...coordToScale(x + newCoord.x, y + newCoord.y, config)
        );
      }
      j++;
    }
    glyphPolygon.close();
  }

  const unionPolygon = glyphPolygon.getUnion();

  let remainingSpaceTranslation = 0;
  if (!config.monospace && unionPolygon[0]) {
    remainingSpaceTranslation =
      KERNING / 2 - Math.min(...unionPolygon[0][0].map((e) => e[0]));
  }

  console.warn({ unionPolygon });

  const tmpPath = new Opentype.Path();
  for (const polygon of unionPolygon) {
    for (const layer of polygon) {
      for (const coordIndex in layer) {
        const coord = layer[coordIndex];

        if (coordIndex === '0') {
          tmpPath.moveTo(coord[0] + remainingSpaceTranslation, coord[1]);
        } else {
          tmpPath.lineTo(coord[0] + remainingSpaceTranslation, coord[1]);
        }
      }
    }
  }

  // console.log('>> MAKING glyph,', { char, name, unicode });

  const min = Math.min(
    ...tmpPath.commands.map((e: any) => {
      return e.x;
    })
  );
  const max = Math.max(
    ...tmpPath.commands.map((e: any) => {
      return e.x;
    })
  );

  console.warn('>> KERNING', KERNING);
  console.warn(min);

  const baseDynamicSpacing = max - min;
  const finalSpacing = config.monospace
    ? monospaceAdvance
    : char === ' '
    ? Math.round(monospaceAdvance * 0.8)
    : baseDynamicSpacing + KERNING;

  const tmpGlyph = new Opentype.Glyph({
    name: char,
    unicode: char.charCodeAt(0),
    advanceWidth: finalSpacing,
    xMax: SCALE_X,
    yMax: SCALE_Y,
    xMin: 0,
    yMin: 0,
    path: tmpPath,
  });

  return tmpGlyph;
}

export async function downloadFont(
  definittion: FontDefinition,
  config: FontConfig
) {
  const { monospaceAdvance } = configToMetrics(config);
  // Object.keys(TO_COMBINE).forEach((char) => {
  //   console.log(char);
  //   fontSrc[char] = [
  //     ...fontSrc[TO_COMBINE[char][0]],
  //     ...fontSrc[TO_COMBINE[char][1]],
  //   ];
  // });
  console.log('>> MAKING font', definittion);

  // const unicodeCharNames = await getUnicodeCharNames();

  const notdefGlyph = new Opentype.Glyph({
    name: '.notdef',
    advanceWidth: monospaceAdvance,
    xMax: SCALE_X,
    yMax: SCALE_Y,
    xMin: 0,
    yMin: 0,
    path: new Opentype.Path(),
  });

  const newGlyphs = Object.keys(definittion).map((char) => {
    return makeGlyph(char, definittion[char], config);
  });

  const glyphs = [notdefGlyph, ...newGlyphs];

  console.log('> Font glyphs', glyphs);

  const name = `${config.name} ${config.monospace ? 'Mono' : ''}`;

  const font = new Opentype.Font({
    familyName: name,
    styleName: String(config.weight),
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    glyphs: glyphs,
  });
  font.download();
}
