import {
  composeGlyph,
  isComposite,
  layerBounds,
  MARK_HEIGHT,
  MARK_ROWS,
} from './compose';
import { DEFAULT_FONT_CONFIG } from './font-config';
import { SEGMENTS } from './types';
import type {
  CharLayers,
  Composite,
  FontConfig,
  FontDefinition,
  MarkSet,
} from './types';
import { MAX_WEIGHT, MIN_WEIGHT, parseWeight } from './weights';
import { CORNER_STYLES, MAX_CORNER_RADIUS, MIN_CORNER_RADIUS, STROKE_STYLES, isCornerStyle, isStrokeStyle, isValidCornerRadius } from './corners';
import { isValidSlant, MAX_SLANT } from './slant';
import { isValidSpacing, SPACING_RANGES } from './spacing';
import type { SpacingKey } from './spacing';

// Validation for a font source ({ config, marks, chars }), shared by the CLI and
// the browser editor. Node-safe on purpose: no DOM, no alert() — callers decide
// how to surface the issues. Composites are resolved here, so everything
// downstream receives plain layers.

// The design grid. x spans the character box; y spans the cap box, the
// descender row below it (glyphs like "g" and "," reach y = 5) and the mark
// band above it, where an accent on a capital sits.
const GRID_MAX_X = SEGMENTS[0];
const GRID_MAX_Y = SEGMENTS[1] + 1;
const GRID_STEP = 0.5;

/** Config fields taken as text, whatever the source wrote. */
const TEXT_FIELDS = ['name', 'designer', 'designerURL', 'styleName', 'version'] as const;

/** Config fields that are either valid or an error, in the order reported. */
const CHECKED_FIELDS: {
  key: keyof FontConfig;
  valid: (value: unknown) => boolean;
  expected: string;
}[] = [
  {
    key: 'slant',
    valid: isValidSlant,
    expected: `a number between 0 and ${MAX_SLANT} degrees`,
  },
  {
    key: 'stroke',
    valid: isStrokeStyle,
    expected: `one of ${STROKE_STYLES.join(', ')}`,
  },
  {
    key: 'corners',
    valid: isCornerStyle,
    expected: `one of ${CORNER_STYLES.join(', ')}`,
  },
  {
    key: 'cornerRadius',
    valid: isValidCornerRadius,
    expected: `a number between ${MIN_CORNER_RADIUS} and ${MAX_CORNER_RADIUS}`,
  },
  ...(Object.keys(SPACING_RANGES) as SpacingKey[]).map((key) => ({
    key,
    valid: (value: unknown) => isValidSpacing(key, value),
    expected: `a number between ${SPACING_RANGES[key].min} and ${SPACING_RANGES[key].max} font units`,
  })),
];

const KNOWN_CONFIG_KEYS: string[] = [
  ...TEXT_FIELDS,
  ...CHECKED_FIELDS.map(({ key }) => key),
  'weight',
  'height',
  'monospace',
  // Written by editor builds that had a single on/off corner setting.
  'continuousCorners',
];

/** Printable ASCII — the range a font is expected to cover end to end. */
export const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
  String.fromCharCode(0x20 + i)
);

export type IssueSeverity = 'error' | 'warning';

export type Issue = {
  severity: IssueSeverity;
  message: string;
  /** The glyph the issue belongs to, when it is glyph-scoped. */
  char?: string;
  /** 0-based layer index within the glyph. */
  layer?: number;
  /** 0-based point index within the layer. */
  point?: number;
  /** Dotted config path, for config-scoped issues (e.g. "config.weight"). */
  field?: string;
};

export type ValidationResult = {
  /** True when there are no errors. Warnings do not clear this. */
  ok: boolean;
  /** Normalized config, usable even when `ok` is false. */
  config: FontConfig;
  /** The chars map, or {} when it was unusable. */
  chars: FontDefinition;
  errors: Issue[];
  warnings: Issue[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onGrid(value: number): boolean {
  return Math.abs(value / GRID_STEP - Math.round(value / GRID_STEP)) < 1e-9;
}

/** "A" layer 2 point 3 — the location prefix used in formatted messages. */
export function issueLocation(issue: Issue): string {
  if (issue.char === undefined && issue.field === undefined) return '';
  const parts = [issue.field ?? JSON.stringify(issue.char)];
  if (issue.layer !== undefined) parts.push(`layer ${issue.layer + 1}`);
  if (issue.point !== undefined) parts.push(`point ${issue.point + 1}`);
  return parts.join(' ');
}

/** One line per issue: `src/font.json "A" layer 2 point 3: message`. */
export function formatIssue(issue: Issue, label?: string): string {
  const location = issueLocation(issue);
  const prefix = [label, location].filter(Boolean).join(' ');
  return prefix ? `${prefix}: ${issue.message}` : issue.message;
}

/** Where an issue is, in the terms `Issue` reports it. */
type Location = Pick<Issue, 'char' | 'field' | 'layer' | 'point'>;

/** The issues found so far, collected as the source is walked. */
type Report = { errors: Issue[]; warnings: Issue[] };

function fail(report: Report, at: Location, message: string) {
  report.errors.push({ severity: 'error', ...at, message });
}

function warn(report: Report, at: Location, message: string) {
  report.warnings.push({ severity: 'warning', ...at, message });
}

function validateConfig(raw: unknown, report: Report): FontConfig {
  const config: FontConfig = { ...DEFAULT_FONT_CONFIG };
  if (raw === undefined) return config;

  if (!isPlainObject(raw)) {
    fail(report, { field: 'config' }, 'must be an object');
    return config;
  }

  for (const key of TEXT_FIELDS) {
    if (raw[key] !== undefined) config[key] = String(raw[key]);
  }
  for (const { key, valid, expected } of CHECKED_FIELDS) {
    if (raw[key] === undefined) continue;
    if (valid(raw[key])) Object.assign(config, { [key]: raw[key] });
    else fail(report, { field: `config.${key}` }, `must be ${expected}`);
  }
  if (raw.corners === undefined && raw.continuousCorners === true) {
    config.corners = 'continuous';
  }
  if (raw.monospace !== undefined) config.monospace = Boolean(raw.monospace);
  if (raw.height !== undefined && Number.isFinite(Number(raw.height))) {
    config.height = Number(raw.height);
  }

  if (raw.weight !== undefined) {
    const weight = parseWeight(raw.weight);
    if (weight !== null) {
      config.weight = weight;
    } else {
      warn(
        report,
        { field: 'config.weight' },
        `${JSON.stringify(raw.weight)} is not a weight between ` +
          `${MIN_WEIGHT} and ${MAX_WEIGHT} — falling back to ${config.weight}`
      );
    }
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_CONFIG_KEYS.includes(key)) {
      warn(report, { field: `config.${key}` }, 'unknown config key, ignored');
    }
  }

  return config;
}

/**
 * Where a point may sit. Glyphs span the cap box plus the descender row below
 * and the mark band above; a mark is drawn in its own frame, foot on y = 0.
 */
const GLYPH_BAND = {
  minY: -MARK_ROWS,
  maxY: GRID_MAX_Y,
  label: `${-MARK_ROWS}..${GRID_MAX_Y} grid`,
};
const MARK_BAND = {
  minY: -MARK_HEIGHT,
  maxY: 0,
  label: `${-MARK_HEIGHT}..0 mark band`,
};

/** Points outside the design box, reported once a glyph's shape is known. */
function checkBounds(
  location: Location,
  layers: CharLayers,
  band: typeof GLYPH_BAND,
  report: Report
) {
  layers.forEach((layer, layerIndex) => {
    layer.forEach(([x, y], point) => {
      const at = { ...location, layer: layerIndex, point };
      if (x < 0 || x > GRID_MAX_X) {
        warn(report, at, `x=${x} is outside the 0..${GRID_MAX_X} grid`);
      }
      if (y < band.minY || y > band.maxY) {
        warn(report, at, `y=${y} is outside the ${band.label}`);
      }
    });
  });
}

function validateGlyph(
  location: Location,
  raw: unknown,
  report: Report
): CharLayers | undefined {
  if (!Array.isArray(raw)) {
    fail(report, location, 'must be an array of layers');
    return undefined;
  }

  const layers: CharLayers = [];

  raw.forEach((layer, layerIndex) => {
    const inLayer = { ...location, layer: layerIndex };
    if (!Array.isArray(layer)) {
      fail(report, inLayer, 'must be an array of points');
      return;
    }
    if (!layer.length) {
      warn(report, inLayer, 'empty layer, ignored by the build');
      return;
    }

    const points: [number, number][] = [];
    let layerValid = true;

    layer.forEach((point, pointIndex) => {
      const at = { ...inLayer, point: pointIndex };
      const got = `(got ${JSON.stringify(point)})`;

      if (!Array.isArray(point) || point.length !== 2) {
        fail(report, at, `must be a [x, y] pair ${got}`);
        layerValid = false;
        return;
      }

      const [x, y] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        fail(report, at, `coordinates must be finite numbers ${got}`);
        layerValid = false;
        return;
      }

      if (!onGrid(x) || !onGrid(y)) {
        warn(report, at, `[${x}, ${y}] is not on the ${GRID_STEP} step grid`);
      }

      const previous = points[points.length - 1];
      if (previous && previous[0] === x && previous[1] === y) {
        warn(report, at, 'repeats the previous point');
      }

      points.push([x, y]);
    });

    if (layerValid) layers.push(points);
  });

  return layers;
}

/** The `marks` map: accents drawn once, placed on letters by ./compose. */
function validateMarks(raw: unknown, report: Report): MarkSet {
  if (raw === undefined) return {};

  if (!isPlainObject(raw)) {
    fail(report, { field: 'marks' }, 'must be an object');
    return {};
  }

  const marks: MarkSet = {};
  for (const name of Object.keys(raw)) {
    const location = { field: `marks.${name}` };
    const layers = validateGlyph(location, raw[name], report);
    if (!layers) continue;

    checkBounds(location, layers, MARK_BAND, report);

    const bounds = layerBounds(layers);
    if (bounds && bounds.maxY !== 0) {
      warn(
        report,
        location,
        `foot sits on y=${bounds.maxY}; marks are drawn with their foot on y = 0`
      );
    }

    marks[name] = layers;
  }

  return marks;
}

const KNOWN_COMPOSITE_KEYS = ['base', 'mark', 'rotate'];

/** The half turn "¿" is to "?" is the only rotation the grid can express. */
const HALF_TURN = 180;

function validateComposite(
  char: string,
  raw: Composite,
  marks: MarkSet,
  report: Report
): Composite | undefined {
  let valid = true;

  if (raw.mark !== undefined && !(raw.mark in marks)) {
    fail(report, { char }, `no mark named ${JSON.stringify(raw.mark)} in "marks"`);
    valid = false;
  }

  if (raw.rotate !== undefined && raw.rotate !== HALF_TURN) {
    fail(
      report,
      { char },
      `rotate must be ${HALF_TURN} (got ${JSON.stringify(raw.rotate)})`
    );
    valid = false;
  }

  if (raw.mark === undefined && raw.rotate === undefined) {
    warn(
      report,
      { char },
      'composite has neither "mark" nor "rotate", so it copies its base'
    );
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_COMPOSITE_KEYS.includes(key)) {
      warn(report, { char }, `unknown composite key ${JSON.stringify(key)}, ignored`);
    }
  }

  return valid ? raw : undefined;
}

/**
 * Build every composite's layers from its base, which may itself be one. The
 * result is a plain map of drawn layers: nothing downstream — the editor, the
 * SVG renderer, the .otf build — needs to know a glyph was composed.
 */
function resolveComposites(
  drawn: FontDefinition,
  composites: { [char: string]: Composite },
  marks: MarkSet,
  report: Report
): FontDefinition {
  const chars: FontDefinition = { ...drawn };
  const pending = new Set<string>();

  function resolve(char: string): CharLayers | undefined {
    if (char in chars) return chars[char];

    const composite = composites[char];
    if (!composite) return undefined;
    const base = JSON.stringify(composite.base);

    if (pending.has(char)) {
      fail(report, { char }, `is built from itself through ${base}`);
      return undefined;
    }

    pending.add(char);
    const baseLayers = resolve(composite.base);
    pending.delete(char);

    if (!baseLayers) {
      fail(report, { char }, `no glyph for base ${base}`);
      return undefined;
    }

    const layers = composeGlyph(baseLayers, composite, marks);
    checkBounds({ char }, layers, GLYPH_BAND, report);
    chars[char] = layers;
    return layers;
  }

  for (const char of Object.keys(composites)) resolve(char);
  return chars;
}

/**
 * Validate a parsed font source. Always returns a usable (normalized) config and
 * chars map so callers can report every issue at once instead of throwing on the
 * first one.
 */
export function validateFontSource(json: unknown): ValidationResult {
  const report: Report = { errors: [], warnings: [] };
  const result = (config: FontConfig, chars: FontDefinition = {}) => ({
    ok: report.errors.length === 0,
    config,
    chars,
    ...report,
  });

  if (!isPlainObject(json)) {
    fail(report, {}, 'the source must be an object with "config" and "chars"');
    return result({ ...DEFAULT_FONT_CONFIG });
  }

  const config = validateConfig(json.config, report);
  const marks = validateMarks(json.marks, report);

  const rawChars = json.chars;
  if (!isPlainObject(rawChars)) {
    fail(
      report,
      { field: 'chars' },
      'missing or not an object — expected { config, chars }'
    );
    return result(config);
  }

  const charKeys = Object.keys(rawChars);
  if (!charKeys.length) {
    fail(report, { field: 'chars' }, 'no characters found');
    return result(config);
  }

  const drawn: FontDefinition = {};
  const composites: { [char: string]: Composite } = {};
  for (const char of charKeys) {
    // The build encodes a glyph by its one code point, so a multi-character
    // key would silently produce a glyph for its first character only.
    if (Array.from(char).length !== 1) {
      fail(report, { char }, 'keys must be exactly one character');
      continue;
    }
    if (char.codePointAt(0)! > 0xffff) {
      fail(
        report,
        { char },
        'characters outside the Basic Multilingual Plane are not supported'
      );
      continue;
    }

    const raw = rawChars[char];
    if (isComposite(raw)) {
      const composite = validateComposite(char, raw, marks, report);
      if (composite) composites[char] = composite;
      continue;
    }

    const layers = validateGlyph({ char }, raw, report);
    if (layers) {
      checkBounds({ char }, layers, GLYPH_BAND, report);
      drawn[char] = layers;
    }
  }

  const chars = resolveComposites(drawn, composites, marks, report);

  const missing = PRINTABLE_ASCII.filter((char) => !(char in chars));
  if (missing.length) {
    warn(
      report,
      { field: 'chars' },
      `no glyph for ${missing.length} printable ASCII character${
        missing.length === 1 ? '' : 's'
      }: ${missing.map((c) => JSON.stringify(c)).join(' ')}`
    );
  }

  return result(config, chars);
}
