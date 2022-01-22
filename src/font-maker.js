import Opentype from 'opentype.js';

const PRODUCTION = window.location.search.includes('production');

const WEIGHT = 0.25;
const SCALE_X = 180;
const SCALE_Y = -170;
const DRIFT_X = 100;
const DRIFT_Y = 720;

const TO_COMBINE = {
  á: ['a', '´'],
  é: ['e', '´'],
  í: ['i', '´'],
  ó: ['o', '´'],
  ú: ['u', '´'],
};

const CIRCLE_SEGMENTS = 16;

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

function makeGlyph(char, path = []) {
  // console.log('> Making glyph', char, char.charCodeAt(0), path);
  const tmpPath = new Opentype.Path();

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

        tmpPath.moveTo(
          (x1 - newCoord.x * 0) * SCALE_X + DRIFT_X,
          (y1 - newCoord.y * 0) * SCALE_Y + DRIFT_Y
        );
        tmpPath.lineTo(
          (x1 + newCoord.x) * SCALE_X + DRIFT_X,
          (y1 + newCoord.y) * SCALE_Y + DRIFT_Y
        );
        tmpPath.lineTo(
          (x2 + newCoord.x) * SCALE_X + DRIFT_X,
          (y2 + newCoord.y) * SCALE_Y + DRIFT_Y
        );
        tmpPath.lineTo(
          (x2 - newCoord.x * 0) * SCALE_X + DRIFT_X,
          (y2 - newCoord.y * 0) * SCALE_Y + DRIFT_Y
        );

        tmpPath.moveTo(
          (x1 - newCoord.x) * SCALE_X + DRIFT_X,
          (y1 - newCoord.y) * SCALE_Y + DRIFT_Y
        );
        tmpPath.lineTo(
          (x1 + newCoord.x * 0) * SCALE_X + DRIFT_X,
          (y1 + newCoord.y * 0) * SCALE_Y + DRIFT_Y
        );
        tmpPath.lineTo(
          (x2 + newCoord.x * 0) * SCALE_X + DRIFT_X,
          (y2 + newCoord.y * 0) * SCALE_Y + DRIFT_Y
        );
        tmpPath.lineTo(
          (x2 - newCoord.x) * SCALE_X + DRIFT_X,
          (y2 - newCoord.y) * SCALE_Y + DRIFT_Y
        );

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
        uniqueCoords[coord.join(',')] = coord;
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
      if (j === 0)
        tmpPath.moveTo(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      else
        tmpPath.lineTo(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      j++;
    }
  }

  for (const uniqueCoordKey of Object.keys(uniqueDots)) {
    // draw dot
    const [x, y] = uniqueDots[uniqueCoordKey];
    let j = 0;
    while (j < CIRCLE_SEGMENTS) {
      const newCoord = polar2cartesian({
        distance: WEIGHT * 1.5,
        angle: (2 * Math.PI * j) / CIRCLE_SEGMENTS,
      });

      // first point of the circle, move
      if (j === 0)
        tmpPath.moveTo(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      else
        tmpPath.lineTo(
          (x + newCoord.x) * SCALE_X + DRIFT_X,
          (y + newCoord.y) * SCALE_Y + DRIFT_Y
        );
      j++;
    }
  }

  const tmpGlyph = new Opentype.Glyph({
    name: char,
    unicode: char.charCodeAt(0),
    advanceWidth: 600,
    path: tmpPath,
  });

  tmpGlyph.addUnicode(char.toUpperCase().charCodeAt(0));

  return tmpGlyph;
}

export function downloadFont(fontSrc) {
  Object.keys(TO_COMBINE).forEach((char) => {
    console.log(char);
    fontSrc[char] = [
      ...fontSrc[TO_COMBINE[char][0]],
      ...fontSrc[TO_COMBINE[char][1]],
    ];
  });
  console.log('> Making font', fontSrc);

  const notdefGlyph = new Opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 600,
    path: new Opentype.Path(),
  });

  const newGlyphs = Object.keys(fontSrc).map((char) => {
    return makeGlyph(char, fontSrc[char]);
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
