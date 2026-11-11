import type { CharLayer } from './types';

type Point = [number, number];
export type StrokeCommand =
  | { type: 'M' | 'L'; point: Point }
  | { type: 'C'; control1: Point; control2: Point; point: Point }
  | { type: 'Z' };

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const along = (p: Point, direction: Point, distance: number): Point => [
  p[0] + direction[0] * distance,
  p[1] + direction[1] * distance,
];

export const CORNER_STYLES = ['chamfer', 'round', 'continuous'] as const;
/**
 * How the bends of a stroke are drawn. `chamfer` leaves them as the source
 * draws them; `round` turns them into circular arcs; `continuous` into
 * curvature-continuous bends that ease in and out of the straights.
 */
export type CornerStyle = (typeof CORNER_STYLES)[number];

/**
 * Radius of a round corner as a percent of one grid step. Below the minimum a
 * rounded chamfer reads as a square corner, and "D" can no longer be told
 * from "O".
 */
export const MIN_CORNER_RADIUS = 20;
export const MAX_CORNER_RADIUS = 100;
export const DEFAULT_CORNER_RADIUS = 100;

export function isCornerStyle(value: unknown): value is CornerStyle {
  return CORNER_STYLES.includes(value as CornerStyle);
}

export function isValidCornerRadius(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_CORNER_RADIUS && value <= MAX_CORNER_RADIUS;
}

export type CornerOptions = {
  continuous: boolean;
  /** Radius of the arc that rounds a right angle, in drawing units. */
  radius: number;
  /** One grid step in drawing units; bounds what counts as a chamfer. */
  unit: number;
};

/** Curve settings for a drawing whose grid step is `unit`; none for chamfers. */
export function cornerOptions(
  config: { corners?: CornerStyle; cornerRadius?: number },
  unit: number,
): CornerOptions | undefined {
  if (!config.corners || config.corners === 'chamfer') return undefined;
  return {
    continuous: config.corners === 'continuous',
    radius: (config.cornerRadius ?? DEFAULT_CORNER_RADIUS) / MAX_CORNER_RADIUS * unit,
    unit,
  };
}

// A turn of a right angle or more is a drawn corner or an apex and stays sharp.
const MAX_BEND_DOT = 0.02;
// The longest diagonal the grid uses to cut a corner is one step on each axis.
const MAX_CHAMFER_STEPS = 1.5;
// Two bends may share a curve while together they turn about a right angle.
const MIN_CHAMFER_DOT = -0.2;
// An eased bend starts earlier than an arc of the same setting, as far as the
// straights allow, so both pass the corner at a similar distance.
const CONTINUOUS_REACH = 1.5;
const MAX_REACH_RATIO = 2;

type Corner = { vertex: Point; u: Point; v: Point; bend: boolean; dIn: number; dOut: number };

/** Tangent length of an arc of radius 1 that turns from `u` to `v`. */
const tangent = (u: Point, v: Point) => {
  const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  return Math.tan(turn / 2);
};

/**
 * The stroke as drawing commands. Without `corners` it is the polyline itself.
 *
 * With them, a bend of less than a right angle becomes a curve tangent to both
 * of its straights. A short diagonal between two such bends is the grid's way
 * of writing one round corner, so the pair is drawn as a single curve around
 * the point where the straights would have met. Right angles, apexes and reversals are left alone: "E" keeps its
 * corners and "V" its point while "O" turns round.
 *
 * `round` is the usual cubic approximation of a circular arc. `continuous` is
 * two cubics with collinear end controls, so curvature is zero where the curve
 * meets a straight and the halves share first and second derivatives where
 * they join. It is inspired by Apple's corners, not a reproduction of them.
 */
export function strokeCommands(layer: CharLayer, corners?: CornerOptions): StrokeCommand[] {
  const points = layer.filter((p, i) => !i || !same(p, layer[i - 1]));
  if (!points.length) return [];
  const polyline = (): StrokeCommand[] =>
    points.map((point, i) => ({ type: i ? 'L' : 'M', point }));
  if (!corners || points.length < 3) return polyline();

  const closed = same(points[0], points[points.length - 1]);
  const ring = closed ? points.slice(0, -1) : points;
  const n = ring.length;
  const nodes = ring.map((p, i) => {
    const none = { u: [0, 0] as Point, v: [0, 0] as Point, sign: 0, bend: false };
    if (!closed && (i === 0 || i === n - 1)) return none;
    const before = ring[(i + n - 1) % n];
    const after = ring[(i + 1) % n];
    const inLength = Math.hypot(p[0] - before[0], p[1] - before[1]);
    const outLength = Math.hypot(after[0] - p[0], after[1] - p[1]);
    if (!inLength || !outLength) return none;
    const u: Point = [(p[0] - before[0]) / inLength, (p[1] - before[1]) / inLength];
    const v: Point = [(after[0] - p[0]) / outLength, (after[1] - p[1]) / outLength];
    const cross = u[0] * v[1] - u[1] * v[0];
    const dot = u[0] * v[0] + u[1] * v[1];
    return { u, v, sign: Math.sign(cross), bend: Math.abs(cross) > 1e-8 && dot > MAX_BEND_DOT };
  });

  // Pair up the two ends of each chamfer, shortest first so that the diagonal
  // of a bowl is taken before the side it leads into.
  const meeting = new Map<number, Point>();
  const second = new Set<number>();
  const epsilon = corners.unit * 1e-6;
  const chamfers = ring.flatMap((p, i) => {
    const j = (i + 1) % n;
    if (j === i || (!closed && j === 0)) return [];
    const a = nodes[i], b = nodes[j], q = ring[j];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const length = Math.hypot(dx, dy);
    if (!a.bend || !b.bend || a.sign !== b.sign) return [];
    if (Math.abs(dx) < epsilon || Math.abs(dy) < epsilon) return [];
    if (length > MAX_CHAMFER_STEPS * corners.unit) return [];
    const cross = a.u[0] * b.v[1] - a.u[1] * b.v[0];
    if (a.u[0] * b.v[0] + a.u[1] * b.v[1] < MIN_CHAMFER_DOT || Math.abs(cross) < 1e-8) return [];
    // Where the straight coming in would meet the straight going out.
    const t = (dx * b.v[1] - dy * b.v[0]) / cross;
    const vertex = along(p, a.u, t);
    const back = (vertex[0] - q[0]) * b.v[0] + (vertex[1] - q[1]) * b.v[1];
    if (t <= 0 || back >= 0) return [];
    return [{ i, j, length, vertex }];
  }).sort((a, b) => a.length - b.length);
  const used = new Set<number>();
  for (const { i, j, vertex } of chamfers) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i).add(j);
    meeting.set(i, vertex);
    second.add(j);
  }

  const reach = corners.radius * (corners.continuous ? CONTINUOUS_REACH : 1);
  const list: Corner[] = [];
  // A closed stroke starts after the chamfer that spans its seam, if any.
  const start = second.has(0) ? 1 : 0;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (second.has(i)) continue;
    const vertex = meeting.get(i);
    const u = nodes[i].u;
    const v = vertex ? nodes[(i + 1) % n].v : nodes[i].v;
    const bend = !!vertex || nodes[i].bend;
    // One radius for every curve: a shallow bend takes less of its straights
    // than a corner does, so "A" keeps its shoulders while "O" turns round.
    const want = bend ? reach * tangent(u, v) : 0;
    list.push({ vertex: vertex ?? ring[i], u, v, bend, dIn: want, dOut: want });
  }

  // Two curves on one straight share it in proportion to what each asked for.
  list.forEach((corner, k) => {
    if (!closed && k === list.length - 1) return;
    const next = list[(k + 1) % list.length];
    const length = Math.hypot(next.vertex[0] - corner.vertex[0], next.vertex[1] - corner.vertex[1]);
    const asked = corner.dOut + next.dIn;
    if (asked > length) {
      corner.dOut *= length / asked;
      next.dIn *= length / asked;
    }
  });

  const commands: StrokeCommand[] = [];
  let pen: Point | undefined;
  const lineTo = (point: Point) => {
    if (pen && Math.hypot(point[0] - pen[0], point[1] - pen[1]) < epsilon) return;
    commands.push({ type: pen ? 'L' : 'M', point });
    pen = point;
  };
  for (const { vertex, u, v, bend, dIn, dOut } of list) {
    if (!bend || Math.min(dIn, dOut) < epsilon) {
      lineTo(vertex);
      continue;
    }
    if (!corners.continuous) {
      // Equal tangent lengths make the curve a true arc.
      const d = Math.min(dIn, dOut);
      const turn = 2 * Math.atan(tangent(u, v));
      const handle = d * (4 / 3) * Math.tan(turn / 4) / tangent(u, v);
      const entry = along(vertex, u, -d);
      const exit = along(vertex, v, d);
      lineTo(entry);
      commands.push({
        type: 'C',
        control1: along(entry, u, handle),
        control2: along(exit, v, -handle),
        point: exit,
      });
      pen = exit;
      continue;
    }
    const a = Math.min(dIn, dOut * MAX_REACH_RATIO);
    const b = Math.min(dOut, dIn * MAX_REACH_RATIO);
    const exit = along(vertex, v, b);
    const control2 = along(vertex, u, -a / 3);
    const control1 = along(vertex, v, b / 3);
    lineTo(along(vertex, u, -a));
    commands.push(
      { type: 'C', control1: along(vertex, u, -2 * a / 3), control2, point: midpoint(control2, control1) },
      { type: 'C', control1, control2: along(vertex, v, 2 * b / 3), point: exit },
    );
    pen = exit;
  }
  if (closed) commands.push({ type: 'Z' });
  return commands;
}

/** The browser and SVG export use the same exact curves. */
export function strokePath(layer: CharLayer, corners?: CornerOptions): string {
  const num = (n: number) => String(Math.round(n * 1e6) / 1e6);
  const point = (p: Point) => `${num(p[0])},${num(p[1])}`;
  return strokeCommands(layer, corners).map((command) => {
    if (command.type === 'Z') return 'Z';
    if (command.type === 'C') {
      return `C ${point(command.control1)} ${point(command.control2)} ${point(command.point)}`;
    }
    return `${command.type} ${point(command.point)}`;
  }).join(' ');
}

/**
 * The stroke as a polyline, curves flattened adaptively, with a flag for each
 * point that is a corner between two straights rather than a point on a curve.
 */
function trace(layer: CharLayer, corners: CornerOptions | undefined, tolerance: number) {
  const points: CharLayer = [];
  const hard: boolean[] = [];
  const append = (point: Point, corner: boolean) => {
    if (points.length && same(points[points.length - 1], point)) {
      hard[hard.length - 1] &&= corner;
      return;
    }
    points.push(point);
    hard.push(corner);
  };
  const flatten = (a: Point, b: Point, c: Point, d: Point, depth = 0) => {
    const dx = d[0] - a[0], dy = d[1] - a[1];
    const length = Math.hypot(dx, dy);
    const distance = (p: Point) => length
      ? Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / length
      : Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (depth >= 16 || Math.max(distance(b), distance(c)) <= tolerance) {
      append(d, false);
      return;
    }
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
    const abc = midpoint(ab, bc), bcd = midpoint(bc, cd);
    const middle = midpoint(abc, bcd);
    flatten(a, ab, abc, middle, depth + 1);
    flatten(middle, bcd, cd, d, depth + 1);
  };
  for (const command of strokeCommands(layer, corners)) {
    if (command.type === 'C') {
      hard[hard.length - 1] = false;
      flatten(points[points.length - 1], command.control1, command.control2, command.point);
    } else if (command.type === 'Z') {
      if (same(points[points.length - 1], points[0])) hard[0] &&= hard.pop()!, points.pop();
      points.push(points[0]);
      hard.push(hard[0]);
    } else {
      append(command.point, true);
    }
  }
  return { points, hard };
}

/** Adaptive flattening for the font builder's polygon union, in font units. */
export function flattenStroke(layer: CharLayer, corners: CornerOptions, tolerance = 0.5): CharLayer {
  return trace(layer, corners, tolerance).points;
}

/**
 * A stroke that ends on another stroke's chamfer is left hanging once that
 * chamfer is a curve: the slash of "0", the tail of "y". Slide each such end
 * along its own direction until it is back on the curve.
 */
export function anchorEnds(layers: CharLayer[], corners: CornerOptions): CharLayer[] {
  const epsilon = corners.unit * 1e-6;
  const toSegment = (p: Point, a: Point, b: Point) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const off = (p: Point, line: CharLayer) =>
    Math.min(...line.slice(1).map((b, i) => toSegment(p, line[i], b)));
  const curves = layers.map((layer) =>
    strokeCommands(layer, corners).some((c) => c.type === 'C')
      ? flattenStroke(layer, corners, corners.unit / 200)
      : undefined);

  return layers.map((layer, index) => {
    if (layer.length < 2 || same(layer[0], layer[layer.length - 1])) return layer;
    let moved = layer;
    for (const [end, neighbour] of [[0, 1], [layer.length - 1, layer.length - 2]]) {
      const p = layer[end], q = layer[neighbour];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!length) continue;
      const direction: Point = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
      layers.forEach((other, otherIndex) => {
        const curve = curves[otherIndex];
        if (otherIndex === index || !curve) return;
        if (off(p, other) > epsilon || off(p, curve) <= corners.unit / 100) return;
        // Nearest crossing of this end's own line with the curve, either way.
        let best: number | undefined;
        for (let i = 1; i < curve.length; i++) {
          const a = curve[i - 1], b = curve[i];
          const ex = b[0] - a[0], ey = b[1] - a[1];
          const cross = direction[0] * ey - direction[1] * ex;
          if (Math.abs(cross) < 1e-12) continue;
          const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / cross;
          const w = ((a[0] - p[0]) * direction[1] - (a[1] - p[1]) * direction[0]) / cross;
          if (w < 0 || w > 1 || t > Math.min(length, corners.unit) || t < -corners.unit) continue;
          if (best === undefined || Math.abs(t) < Math.abs(best)) best = t;
        }
        if (best === undefined) return;
        if (moved === layer) moved = [...layer];
        moved[end] = along(p, direction, best);
      });
    }
    return moved;
  });
}

export const STROKE_STYLES = ['round', 'sharp'] as const;
/**
 * The pen. `round` gives every end and corner a radius of half the stroke.
 * `sharp` squares them: ends are cut flat, corners come to a point, dots are
 * squares.
 */
export type StrokeStyle = (typeof STROKE_STYLES)[number];

export function isStrokeStyle(value: unknown): value is StrokeStyle {
  return STROKE_STYLES.includes(value as StrokeStyle);
}

/** Half the side of a sharp dot, in half strokes: the area of the round one. */
const SHARP_DOT = 4 / 3;

/**
 * A sharp stroke as convex pieces whose union is its ink: a rectangle for each
 * segment, and at each end and corner whatever the stroke would cover if it
 * ran on, kept to the square a stroke wide around that point. That square is
 * what makes the result type rather than geometry. A stem ends flat on the
 * line it was drawn to, a diagonal is cut level with it, and the point of "V"
 * or "N" stops where a stem would instead of running out to a spike.
 *
 * Pieces all wind the same way, so they can share one nonzero-filled path.
 * `ring` trades the rectangles of a curved stroke for one outline of it.
 */
export function sharpPieces(
  layer: CharLayer,
  half: number,
  corners?: CornerOptions,
  tolerance = half / 20,
  caps: [boolean, boolean] = [true, true],
  ring?: (points: CharLayer) => CharLayer,
): CharLayer[] {
  const { points, hard } = trace(layer, corners, tolerance);
  if (!points.length) return [];
  // One outline for the whole of a curved stroke, where the caller has a use
  // for it: only its ends and drawn corners are left to square off.
  const body = ring && hard.includes(false) ? ring(points) : undefined;
  const pieces: CharLayer[] = [];
  const push = (piece: CharLayer, centre?: Point) => {
    let ring = piece;
    if (centre) {
      // Sutherland–Hodgman against the four sides of the square.
      for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
        const limit = centre[axis] * sign + half;
        const inside = (p: Point) => p[axis] * sign <= limit + 1e-9;
        const clipped: CharLayer = [];
        ring.forEach((a, i) => {
          const b = ring[(i + 1) % ring.length];
          if (inside(a)) clipped.push(a);
          if (inside(a) !== inside(b)) {
            const t = (limit - a[axis] * sign) / ((b[axis] - a[axis]) * sign);
            clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        });
        ring = clipped;
      }
    }
    const area = ring.reduce((sum, [x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length];
      return sum + x * ny - nx * y;
    }, 0);
    if (ring.length >= 3 && Math.abs(area) > 1e-12) pieces.push(area < 0 ? ring.reverse() : ring);
  };

  if (points.length === 1) {
    const [x, y] = points[0], d = half * SHARP_DOT;
    push([[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d]]);
    return pieces;
  }

  const closed = points.length > 3 && same(points[0], points[points.length - 1]);
  const directions = points.slice(1).map((p, i): Point => {
    const dx = p[0] - points[i][0], dy = p[1] - points[i][1];
    const length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  });
  const cap = (p: Point, d: Point) => {
    const n: Point = [-d[1] * half, d[0] * half];
    const far = along(p, d, 2 * half);
    push([[p[0] - n[0], p[1] - n[1]], [p[0] + n[0], p[1] + n[1]],
      [far[0] + n[0], far[1] + n[1]], [far[0] - n[0], far[1] - n[1]]], p);
  };
  const join = (p: Point, u: Point, v: Point) => {
    const cross = u[0] * v[1] - u[1] * v[0];
    const dot = u[0] * v[0] + u[1] * v[1];
    if (dot < -0.999999) return cap(p, u);
    if (Math.abs(cross) < 1e-9) return;
    // Normals on the outside of the turn, and where their offset lines meet.
    const side = cross > 0 ? 1 : -1;
    const n1: Point = [u[1] * side, -u[0] * side];
    const n2: Point = [v[1] * side, -v[0] * side];
    const reach = half / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    push([p, along(p, n1, half), [p[0] + (n1[0] + n2[0]) * reach, p[1] + (n1[1] + n2[1]) * reach],
      along(p, n2, half)], p);
  };

  // The outline already follows a flattened bend; it only rounds real turns.
  const corner = (u: Point, v: Point) => !body || u[0] * v[0] + u[1] * v[1] < 0.9;
  directions.forEach((d, i) => {
    const a = points[i], b = points[i + 1];
    const n: Point = [-d[1] * half, d[0] * half];
    if (!body) {
      push([[a[0] - n[0], a[1] - n[1]], [a[0] + n[0], a[1] + n[1]],
        [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]]]);
    }
    if (i && corner(directions[i - 1], d)) join(a, directions[i - 1], d);
  });
  const last = directions[directions.length - 1];
  if (body) pieces.push(body);
  if (closed) {
    if (corner(last, directions[0])) join(points[0], last, directions[0]);
  } else {
    if (caps[0]) cap(points[0], [-directions[0][0], -directions[0][1]]);
    if (caps[1]) cap(points[points.length - 1], last);
  }
  return pieces;
}

/**
 * Every sharp stroke of one glyph. An end that lands on another stroke stops
 * there, flat, inside it: the square it would otherwise get shows through a
 * thinner or curved neighbour, as the slash of "0" would through its bowl.
 */
export function sharpGlyph(
  layers: CharLayer[],
  half: number,
  corners?: CornerOptions,
  tolerance = half / 20,
  ring?: (points: CharLayer) => CharLayer,
): CharLayer[] {
  const drawn = corners ? anchorEnds(layers, corners) : layers;
  const skeletons = drawn.map((layer) =>
    corners ? flattenStroke(layer, corners, tolerance) : layer);
  const near = half / 5;
  const apart = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const lands = (p: Point, index: number) => skeletons.some((other, o) => {
    if (o === index || other.length < 2) return false;
    const first = other[0], last = other[other.length - 1];
    // Two ends that meet make a corner, and each needs its square to fill it.
    if (!same(first, last) && (apart(p, first) < near || apart(p, last) < near)) return false;
    return other.slice(1).some((b, i) => {
      const a = other[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return apart(p, [a[0] + t * dx, a[1] + t * dy]) < near;
    });
  });
  return drawn.flatMap((layer, index) => layer.length
    ? sharpPieces(layer, half, corners, tolerance,
      [!lands(layer[0], index), !lands(layer[layer.length - 1], index)], ring)
    : []);
}

/** The sharp strokes of one glyph as a single filled SVG path. */
export function sharpPath(layers: CharLayer[], half: number, corners?: CornerOptions): string {
  const num = (n: number) => String(Math.round(n * 1e4) / 1e4);
  return sharpGlyph(layers, half, corners)
    .map((piece) => `M ${piece.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')} Z`)
    .join(' ');
}

/**
 * Sweep a round pen over a flattened curve as one ring for polygon union.
 * Without `caps` the ends are cut flat across the stroke.
 */
export function strokeOutline(
  points: CharLayer,
  radius: number,
  circleSegments = 64,
  caps = true,
): CharLayer {
  if (points.length < 2) return [];
  const directions = points.slice(1).map((p, i): Point => {
    const dx = p[0] - points[i][0], dy = p[1] - points[i][1];
    const length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  });
  const arc = (p: Point, angle: number, turn: number): CharLayer => {
    const steps = Math.max(1, Math.ceil(Math.abs(turn) * circleSegments / (2 * Math.PI)));
    return Array.from({ length: steps + 1 }, (_, i): Point => [
      p[0] + radius * Math.cos(angle + turn * i / steps),
      p[1] + radius * Math.sin(angle + turn * i / steps),
    ]);
  };
  const side = (sign: number): CharLayer => points.flatMap((p, i): CharLayer => {
    const u = directions[Math.max(0, i - 1)];
    const v = directions[Math.min(i, directions.length - 1)];
    const n1: Point = [-u[1] * sign, u[0] * sign];
    const n2: Point = [-v[1] * sign, v[0] * sign];
    const cross = u[0] * v[1] - u[1] * v[0];
    const dot = u[0] * v[0] + u[1] * v[1];
    // Two curves that meet tip to tip turn back by just under a half turn.
    // The offset lines of such a turn cross far away, so cap it like a
    // reversal on both sides instead of joining them.
    const reversal = dot < -0.99;
    if (cross * sign < -1e-10 || reversal) {
      let turn = Math.atan2(cross, dot);
      if (reversal && turn * sign >= 0) turn -= sign * 2 * Math.PI;
      return arc(p, Math.atan2(n1[1], n1[0]), turn);
    }
    return [[
      p[0] + radius * (n1[0] + n2[0]) / (1 + dot),
      p[1] + radius * (n1[1] + n2[1]) / (1 + dot),
    ]];
  });
  const first = directions[0], last = directions[directions.length - 1];
  return [
    ...side(1),
    ...(caps ? arc(points[points.length - 1], Math.atan2(last[0], -last[1]), -Math.PI).slice(1) : []),
    ...side(-1).reverse(),
    ...(caps ? arc(points[0], Math.atan2(-first[0], first[1]), -Math.PI).slice(1) : []),
  ];
}
