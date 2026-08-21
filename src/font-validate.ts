import { DEFAULT_FONT_CONFIG } from './font-config';
import { SEGMENTS } from './types';
import type { CharLayers, FontConfig, FontDefinition } from './types';

// Validation for a font source ({ config, chars }), shared by the CLI and the
// browser editor. Node-safe on purpose: no DOM, no alert() — callers decide how
// to surface the issues.

// The design grid. x spans the character box; y spans the cap box plus one row
// of descender (glyphs like "g" and "," reach y = 5).
const GRID_MAX_X = SEGMENTS[0];
const GRID_MAX_Y = SEGMENTS[1] + 1;
const GRID_STEP = 0.5;

const VALID_WEIGHTS = [300, 400, 700] as const;
const KNOWN_CONFIG_KEYS = [
  'name',
  'weight',
  'height',
  'monospace',
  'designer',
  'designerURL',
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
  if (issue.field) return issue.field;
  if (issue.char === undefined) return '';
  const parts = [JSON.stringify(issue.char)];
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
  if (raw.height !== undefined && Number.isFinite(Number(raw.height))) {
    config.height = Number(raw.height);
  }

  if (raw.weight !== undefined) {
    const weight = Number(raw.weight);
    if (weight === 300 || weight === 400 || weight === 700) {
      config.weight = weight;
    } else {
      warnings.push({
        severity: 'warning',
        field: 'config.weight',
        message: `${JSON.stringify(raw.weight)} is not one of ${VALID_WEIGHTS.join(
          ', '
        )} — falling back to ${config.weight}`,
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

function validateGlyph(
  char: string,
  raw: unknown,
  errors: Issue[],
  warnings: Issue[]
): CharLayers | undefined {
  if (!Array.isArray(raw)) {
    errors.push({ severity: 'error', char, message: 'must be an array of layers' });
    return undefined;
  }

  const layers: CharLayers = [];

  raw.forEach((layer, layerIndex) => {
    if (!Array.isArray(layer)) {
      errors.push({
        severity: 'error',
        char,
        layer: layerIndex,
        message: 'must be an array of points',
      });
      return;
    }

    if (!layer.length) {
      warnings.push({
        severity: 'warning',
        char,
        layer: layerIndex,
        message: 'empty layer, ignored by the build',
      });
      return;
    }

    const points: [number, number][] = [];
    let layerValid = true;

    layer.forEach((point, pointIndex) => {
      const at = { char, layer: layerIndex, point: pointIndex } as const;

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

      if (x < 0 || x > GRID_MAX_X) {
        warnings.push({
          severity: 'warning',
          ...at,
          message: `x=${x} is outside the 0..${GRID_MAX_X} grid`,
        });
      }
      if (y < 0 || y > GRID_MAX_Y) {
        warnings.push({
          severity: 'warning',
          ...at,
          message: `y=${y} is outside the 0..${GRID_MAX_Y} grid`,
        });
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

  const chars: FontDefinition = {};
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

    const layers = validateGlyph(char, rawChars[char], errors, warnings);
    if (layers) chars[char] = layers;
  }

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
