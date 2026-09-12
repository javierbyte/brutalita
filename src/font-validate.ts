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

const KNOWN_CONFIG_KEYS = [
  'name',
  'weight',
  'height',
  'monospace',
  'designer',
  'designerURL',
  'styleName',
  'version',
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

function validateConfig(
  raw: unknown,
  errors: Issue[],
  warnings: Issue[]
): FontConfig {
  const config: FontConfig = { ...DEFAULT_FONT_CONFIG };
  if (raw === undefined) return config;

  if (!isPlainObject(raw)) {
    errors.push({
      severity: 'error',
      field: 'config',
      message: 'must be an object',
    });
    return config;
  }

  if (raw.name !== undefined) config.name = String(raw.name);
  if (raw.monospace !== undefined) config.monospace = Boolean(raw.monospace);
  if (raw.designer !== undefined) config.designer = String(raw.designer);
  if (raw.designerURL !== undefined) config.designerURL = String(raw.designerURL);
  if (raw.styleName !== undefined) config.styleName = String(raw.styleName);
  if (raw.version !== undefined) config.version = String(raw.version);
  if (raw.height !== undefined && Number.isFinite(Number(raw.height))) {
    config.height = Number(raw.height);
  }

  if (raw.weight !== undefined) {
    const weight = parseWeight(raw.weight);
    if (weight !== null) {
      config.weight = weight;
    } else {
      warnings.push({
        severity: 'warning',
        field: 'config.weight',
        message:
          `${JSON.stringify(raw.weight)} is not a weight between ` +
          `${MIN_WEIGHT} and ${MAX_WEIGHT} — falling back to ${config.weight}`,
      });
    }
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_CONFIG_KEYS.includes(key)) {
      warnings.push({
        severity: 'warning',
        field: `config.${key}`,
        message: 'unknown config key, ignored',
      });
    }
  }

  return config;
}

type Location = Pick<Issue, 'char' | 'field'>;

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
  band: { minY: number; maxY: number; label: string },
  warnings: Issue[]
) {
  layers.forEach((layer, layerIndex) => {
    layer.forEach(([x, y], pointIndex) => {
      const at = { ...location, layer: layerIndex, point: pointIndex } as const;
      if (x < 0 || x > GRID_MAX_X) {
        warnings.push({
          severity: 'warning',
          ...at,
          message: `x=${x} is outside the 0..${GRID_MAX_X} grid`,
        });
      }
      if (y < band.minY || y > band.maxY) {
        warnings.push({
          severity: 'warning',
          ...at,
          message: `y=${y} is outside the ${band.label}`,
        });
      }
    });
  });
}

function validateGlyph(
  location: Location,
  raw: unknown,
  errors: Issue[],
  warnings: Issue[]
): CharLayers | undefined {
  if (!Array.isArray(raw)) {
    errors.push({
      severity: 'error',
      ...location,
      message: 'must be an array of layers',
    });
    return undefined;
  }

  const layers: CharLayers = [];

  raw.forEach((layer, layerIndex) => {
    if (!Array.isArray(layer)) {
      errors.push({
        severity: 'error',
        ...location,
        layer: layerIndex,
        message: 'must be an array of points',
      });
      return;
    }

    if (!layer.length) {
      warnings.push({
        severity: 'warning',
        ...location,
        layer: layerIndex,
        message: 'empty layer, ignored by the build',
      });
      return;
    }

    const points: [number, number][] = [];
    let layerValid = true;

    layer.forEach((point, pointIndex) => {
      const at = { ...location, layer: layerIndex, point: pointIndex } as const;

      if (!Array.isArray(point) || point.length !== 2) {
        errors.push({
          severity: 'error',
          ...at,
          message: `must be a [x, y] pair (got ${JSON.stringify(point)})`,
        });
        layerValid = false;
        return;
      }

      const [x, y] = point;
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        errors.push({
          severity: 'error',
          ...at,
          message: `coordinates must be finite numbers (got ${JSON.stringify(point)})`,
        });
        layerValid = false;
        return;
      }

      if (!onGrid(x) || !onGrid(y)) {
        warnings.push({
          severity: 'warning',
          ...at,
          message: `[${x}, ${y}] is not on the ${GRID_STEP} step grid`,
        });
      }

      const previous = points[points.length - 1];
      if (previous && previous[0] === x && previous[1] === y) {
        warnings.push({
          severity: 'warning',
          ...at,
          message: 'repeats the previous point',
        });
      }

      points.push([x, y]);
    });

    if (layerValid) layers.push(points);
  });

  return layers;
}

/** The `marks` map: accents drawn once, placed on letters by ./compose. */
function validateMarks(raw: unknown, errors: Issue[], warnings: Issue[]): MarkSet {
  if (raw === undefined) return {};

  if (!isPlainObject(raw)) {
    errors.push({ severity: 'error', field: 'marks', message: 'must be an object' });
    return {};
  }

  const marks: MarkSet = {};
  for (const name of Object.keys(raw)) {
    const location = { field: `marks.${name}` };
    const layers = validateGlyph(location, raw[name], errors, warnings);
    if (!layers) continue;

    checkBounds(location, layers, MARK_BAND, warnings);

    const bounds = layerBounds(layers);
    if (bounds && bounds.maxY !== 0) {
      warnings.push({
        severity: 'warning',
        ...location,
        message: `foot sits on y=${bounds.maxY}; marks are drawn with their foot on y = 0`,
      });
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
  errors: Issue[],
  warnings: Issue[]
): Composite | undefined {
  let valid = true;

  if (raw.mark !== undefined && !(raw.mark in marks)) {
    errors.push({
      severity: 'error',
      char,
      message: `no mark named ${JSON.stringify(raw.mark)} in "marks"`,
    });
    valid = false;
  }

  if (raw.rotate !== undefined && raw.rotate !== HALF_TURN) {
    errors.push({
      severity: 'error',
      char,
      message: `rotate must be ${HALF_TURN} (got ${JSON.stringify(raw.rotate)})`,
    });
    valid = false;
  }

  if (raw.mark === undefined && raw.rotate === undefined) {
    warnings.push({
      severity: 'warning',
      char,
      message: 'composite has neither "mark" nor "rotate", so it copies its base',
    });
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_COMPOSITE_KEYS.includes(key)) {
      warnings.push({
        severity: 'warning',
        char,
        message: `unknown composite key ${JSON.stringify(key)}, ignored`,
      });
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
  errors: Issue[],
  warnings: Issue[]
): FontDefinition {
  const chars: FontDefinition = { ...drawn };
  const pending = new Set<string>();

  function resolve(char: string): CharLayers | undefined {
    if (char in chars) return chars[char];

    const composite = composites[char];
    if (!composite) return undefined;

    if (pending.has(char)) {
      errors.push({
        severity: 'error',
        char,
        message: `is built from itself through ${JSON.stringify(composite.base)}`,
      });
      return undefined;
    }

    pending.add(char);
    const base = resolve(composite.base);
    pending.delete(char);

    if (!base) {
      errors.push({
        severity: 'error',
        char,
        message: `no glyph for base ${JSON.stringify(composite.base)}`,
      });
      return undefined;
    }

    const layers = composeGlyph(base, composite, marks);
    checkBounds({ char }, layers, GLYPH_BAND, warnings);
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
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  if (!isPlainObject(json)) {
    errors.push({
      severity: 'error',
      message: 'the source must be an object with "config" and "chars"',
    });
    return {
      ok: false,
      config: { ...DEFAULT_FONT_CONFIG },
      chars: {},
      errors,
      warnings,
    };
  }

  const config = validateConfig(json.config, errors, warnings);
  const marks = validateMarks(json.marks, errors, warnings);

  const rawChars = json.chars;
  if (!isPlainObject(rawChars)) {
    errors.push({
      severity: 'error',
      field: 'chars',
      message: 'missing or not an object — expected { config, chars }',
    });
    return { ok: false, config, chars: {}, errors, warnings };
  }

  const charKeys = Object.keys(rawChars);
  if (!charKeys.length) {
    errors.push({ severity: 'error', field: 'chars', message: 'no characters found' });
    return { ok: false, config, chars: {}, errors, warnings };
  }

  const drawn: FontDefinition = {};
  const composites: { [char: string]: Composite } = {};
  for (const char of charKeys) {
    // The build encodes a glyph as char.charCodeAt(0), so a multi-character key
    // would silently produce a glyph for its first character only.
    if (Array.from(char).length !== 1) {
      errors.push({
        severity: 'error',
        char,
        message: 'keys must be exactly one character',
      });
      continue;
    }
    if (char.charCodeAt(0) > 0xffff || char.codePointAt(0)! > 0xffff) {
      errors.push({
        severity: 'error',
        char,
        message: 'characters outside the Basic Multilingual Plane are not supported',
      });
      continue;
    }

    const raw = rawChars[char];
    if (isComposite(raw)) {
      const composite = validateComposite(char, raw, marks, errors, warnings);
      if (composite) composites[char] = composite;
      continue;
    }

    const layers = validateGlyph({ char }, raw, errors, warnings);
    if (layers) {
      checkBounds({ char }, layers, GLYPH_BAND, warnings);
      drawn[char] = layers;
    }
  }

  const chars = resolveComposites(drawn, composites, marks, errors, warnings);

  const missing = PRINTABLE_ASCII.filter((char) => !(char in chars));
  if (missing.length) {
    warnings.push({
      severity: 'warning',
      field: 'chars',
      message: `no glyph for ${missing.length} printable ASCII character${
        missing.length === 1 ? '' : 's'
      }: ${missing.map((c) => JSON.stringify(c)).join(' ')}`,
    });
  }

  return { ok: errors.length === 0, config, chars, errors, warnings };
}
