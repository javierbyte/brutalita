import Opentype from 'opentype.js';
import polygonClipping from 'polygon-clipping';

import unicodeCsvSrc from './lib/named-character-references.csv';

const PRODUCTION = window.location.search.includes('production');

const WEIGHT = 0.25;
const SCALE_X = 180;
const SCALE_Y = -170;
const DRIFT_X = 100;
const DRIFT_Y = 720;

// const TO_COMBINE = {
//   á: ['a', '´'],
//   é: ['e', '´'],
//   í: ['i', '´'],
//   ó: ['o', '´'],
//   ú: ['u', '´'],
// };

const CIRCLE_SEGMENTS = 16;

async function getUnicodeCharNames() {
  return fetch(unicodeCsvSrc)
    .then((response) => response.text())
    .then((dataRaw) => {
      return dataRaw
        .trim()
        .split(`\n`)
        .map((e) => e.split(','))
        .reduce((res, row) => {
          const unicodeNumber = parseInt(row[1], 16);
          res[unicodeNumber] = row[0];
          return res;
        }, {});
    });
}

function polar2cartesian({ distance, angle }) {
  return {
    x: distance * Math.cos(angle),
    y: distance * Math.sin(angle),
  };
}

function cartesian2polar({ x, y }) {
  return {
    distance: Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)),
    angle: Math.atan2(y, x),
  };
}

function definePolygon() {
  let multiPolygon = [];
  let currentPolygon = [];

  return {
    start(x, y) {
      currentPolygon = [[x, y]];
    },
    line(x, y) {
      currentPolygon.push([x, y]);
    },
    close() {
      currentPolygon.push(currentPolygon[0]);
      multiPolygon.push(currentPolygon);
    },
    get() {
      return multiPolygon;
    },
    getUnion() {
      const arrMulti = multiPolygon.map((e) => [e]);
      return polygonClipping.union(arrMulti);
    },
  };
}

function makeGlyph(char, name, unicode, path = []) {
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
          distance: WEIGHT,
          angle: polar.angle - Math.PI / 2,
        });

        glyphPolygon.start(
          (x1 - newCoord.x) * SCALE_X + DRIFT_X,
          (y1 - newCoord.y) * SCALE_Y + DRIFT_Y
        );
        glyphPolygon.line(
          (x1 + newCoord.x) * SCALE_X + DRIFT_X,
          (y1 + newCoord.y) * SCALE_Y + DRIFT_Y
        );
        glyphPolygon.line(
          (x2 + newCoord.x) * SCALE_X + DRIFT_X,
          (y2 + newCoord.y) * SCALE_Y + DRIFT_Y
        );
        glyphPolygon.line(
          (x2 - newCoord.x) * SCALE_X + DRIFT_X,
          (y2 - newCoord.y) * SCALE_Y + DRIFT_Y
        );
        glyphPolygon.close();

        i++;
      }
    }
  }

  let uniqueDots = {};
  let uniqueCoords = {};
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
        distance: WEIGHT,
        angle: (2 * Math.PI * j) / CIRCLE_SEGMENTS,
      });

      // first point of the circle, move
      if (j === 0) {
        glyphPolygon.start(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      } else {
        glyphPolygon.line(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
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
        distance: WEIGHT * 1.5,
        angle: (2 * Math.PI * j) / CIRCLE_SEGMENTS,
      });

      // first point of the circle, move
      if (j === 0) {
        glyphPolygon.start(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      } else {
        glyphPolygon.line(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      }
      j++;
    }
    glyphPolygon.close();
  }

  // console.info({
  //   char,
  //   polygon: glyphPolygon.get(),
  //   union: glyphPolygon.getUnion(),
  // });

  const unionPolygon = glyphPolygon.getUnion();
  const tmpPath = new Opentype.Path();
  for (const polygon of unionPolygon) {
    for (const layer of polygon) {
      for (const coordIndex in layer) {
        const coord = layer[coordIndex];

        if (coordIndex === '0') {
          tmpPath.moveTo(coord[0], coord[1]);
        } else {
          tmpPath.lineTo(coord[0], coord[1]);
        }
      }
    }
  }

  // console.log('>> MAKING glyph,', { char, name, unicode });

  const tmpGlyph = new Opentype.Glyph({
    name: char,
    unicode: char.charCodeAt(0),
    advanceWidth: 600,
    path: tmpPath,
  });

  return tmpGlyph;
}

export async function downloadFont(fontSrc) {
  // Object.keys(TO_COMBINE).forEach((char) => {
  //   console.log(char);
  //   fontSrc[char] = [
  //     ...fontSrc[TO_COMBINE[char][0]],
  //     ...fontSrc[TO_COMBINE[char][1]],
  //   ];
  // });
  console.log('>> MAKING font', fontSrc);

  const unicodeCharNames = await getUnicodeCharNames();

  const notdefGlyph = new Opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 600,
    path: new Opentype.Path(),
  });

  const newGlyphs = Object.keys(fontSrc).map((char) => {
    const unicode = char.charCodeAt(0);
    const name = unicodeCharNames[unicode] || char;
    return makeGlyph(char, name, unicode, fontSrc[char]);
  });

  const glyphs = [notdefGlyph, ...newGlyphs];

  console.log('> Font glyphs', glyphs);

  const font = new Opentype.Font({
    familyName: PRODUCTION ? 'Brutalita' : 'Brutalita Custom',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 1000,
    descender: -200,
    glyphs: glyphs,
  });
  font.download();
}
