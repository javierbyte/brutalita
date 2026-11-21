import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react';
import { Plus, Redo2, Trash2, Undo2 } from 'lucide-react';

import { MARK_ROWS } from '../compose';
import { cornerOptions, sharpPath, strokePath } from '../corners';
import {
  insertPoint,
  movePoints,
  nearestSegment,
  pointsAt,
  replaceStroke,
  samePoint,
  sameStrokes,
} from '../glyph-edit';
import type { Point } from '../glyph-edit';
import { SEGMENTS } from '../types';
import type { CharLayer, CharLayers, FontConfig } from '../types';
import { Key } from './key';

const [DOTSX, DOTSY] = SEGMENTS;

// The canvas covers the whole drawable grid: the mark band above the cap line,
// where the accents of a composed glyph like "Á" live, the cap box, and one
// row below the baseline for descenders. Points sit on half steps of it.
const STEP = 0.5;
const ROW_TOP = -MARK_ROWS;
const ROW_BOTTOM = DOTSY + 1;
const ROWS = ROW_BOTTOM - ROW_TOP;

/** Space around the grid, so a point on its edge still has room to be held. */
const PAD = 18;
const MAX_UNIT = 84;

// Two layouts. A narrow sidebar stacks everything in one column. One with
// room to spare — the sheet a phone opens — moves the character and the
// stroke list beside the canvas, which gives the height they took to the
// grid: on a phone that is the difference between dots a finger can tell
// apart and dots it cannot.
const WIDE_FROM = 250;
const SIDE_COLUMN = 88;
/** Everything in the sidebar above and below the canvas, roughly, in px. */
const CHROME = { stacked: 352, wide: 190 };
const HISTORY = 100;

/** A glyph the font does not have yet: nothing drawn. */
const NO_STROKES: CharLayers = [];

/** The pen and curve settings, so a stroke is drawn as the font will build it. */
type PenConfig = Pick<FontConfig, 'stroke' | 'corners' | 'cornerRadius' | 'slant'>;

/**
 * The strokes and which of them is being drawn. `active` is null between
 * strokes: the next tap starts a new one.
 */
type Doc = { strokes: CharLayers; active: number | null };

/**
 * `emitted` is the last value handed to the parent. A `layers` prop that is
 * anything else came from outside — an import, say — and starts a new session.
 */
type Session = { doc: Doc; past: Doc[]; future: Doc[]; emitted: CharLayers };

const freshSession = (strokes: CharLayers): Session => ({
  doc: { strokes, active: null },
  past: [],
  future: [],
  emitted: strokes,
});

/** What a press landed on: points of a stroke, or a place along one. */
type Grab =
  | { stroke: number; indices: number[] }
  | { stroke: number; insert: number };

type Press = {
  id: number;
  x: number;
  y: number;
  at: Point;
  grab: Grab | null;
  /** How far the pointer may wander and still count as a tap, in px. */
  slop: number;
  /** Set once the press has turned into a drag. */
  move: { base: CharLayers; indices: number[] } | null;
};

type Gesture =
  /** A press on open grid: the next point, shown until it is let go. */
  | { kind: 'draw'; at: Point | null }
  /** A point being dragged, and the glyph as it would be if dropped now. */
  | {
      kind: 'move';
      stroke: number;
      at: Point;
      binned: boolean;
      /** Where the pointer is once it has left the canvas, in editor px. */
      float: { x: number; y: number } | null;
      result: CharLayers;
    };

/**
 * Px per grid step: as large as the sidebar is wide, held back so the canvas
 * and its controls fit the window without scrolling, and even so half steps
 * land on whole pixels.
 */
function useCanvasLayout(wrap: RefObject<HTMLDivElement | null>) {
  const [layout, layoutSet] = useState({ unit: 60, wide: false });

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const coarse = window.matchMedia('(pointer: coarse)');

    const measure = () => {
      const wide = element.clientWidth >= WIDE_FROM;
      const room = element.clientWidth - (wide ? SIDE_COLUMN : 0);
      const chrome = wide ? CHROME.wide : CHROME.stacked;
      const fitWidth = (room - 2 * PAD) / DOTSX;
      const fitHeight = (window.innerHeight - chrome - 2 * PAD) / ROWS;
      // A finger needs half steps it can tell apart; below this the sidebar
      // scrolls instead.
      const smallest = coarse.matches ? 48 : 40;
      const fit = Math.min(
        fitWidth,
        Math.max(smallest, Math.min(fitHeight, MAX_UNIT))
      );
      const unit = Math.max(16, Math.floor(fit / 2) * 2);
      layoutSet((previous) =>
        previous.unit === unit && previous.wide === wide ? previous : { unit, wide }
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wrap]);

  return layout;
}

/** One stroke in grid units, drawn with the font's pen. */
function StrokeShape({
  stroke,
  pen,
  unit,
  config,
}: {
  stroke: CharLayer;
  /** Stroke width in px. */
  pen: number;
  unit: number;
  config: PenConfig;
}) {
  const curves = cornerOptions(config, 1);

  if (config.stroke === 'sharp') {
    return <path d={sharpPath([stroke], pen / 2 / unit, curves)} fill="currentColor" />;
  }
  // A stroke of a single point is a dot, a little wider than the pen.
  if (stroke.length === 1) {
    return (
      <circle
        cx={stroke[0][0]}
        cy={stroke[0][1]}
        r={(pen * 0.75) / unit}
        fill="currentColor"
      />
    );
  }
  return (
    <path
      d={strokePath(stroke, curves)}
      strokeWidth={pen}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/** The glyph in miniature with one stroke picked out, for the stroke list. */
function StrokeThumb({
  strokes,
  index,
  config,
}: {
  strokes: CharLayers;
  index: number;
  config: PenConfig;
}) {
  const margin = 0.5;
  const width = DOTSX + 2 * margin;
  const height = ROWS + 2 * margin;
  const scale = 4.5;
  const order = [
    ...strokes.map((_, i) => i).filter((i) => i !== index),
    index,
  ];

  return (
    <svg
      viewBox={`${-margin} ${ROW_TOP - margin} ${width} ${height}`}
      width={width * scale}
      height={height * scale}
      aria-hidden="true"
    >
      {order.map((i) => (
        <g key={i} className="glyph-thumb" data-on={i === index || undefined}>
          <StrokeShape
            stroke={strokes[i]}
            pen={1.5}
            unit={scale}
            config={{ ...config, stroke: 'round' }}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * The canvas: every stroke of the glyph on one grid.
 *
 * A tap draws and a drag reshapes. Tapping a dot draws a line to it from the
 * highlighted one, the end of the stroke being drawn, and the new dot takes
 * the highlight; tapping the highlighted dot itself ends the stroke. Dragging
 * a point moves it, dragging a line puts a point between the two it joins, and
 * either can be dropped on the bin that appears under the canvas. Because a
 * tap always draws, a stroke can run through points that are already there: that is how
 * "O" closes and how the slash of "0" meets its bowl.
 */
function StrokeEditor({
  header,
  char,
  layers,
  onChange,
  config,
}: {
  /** The character being edited and its preview; laid out with the canvas. */
  header: ReactNode;
  char: string;
  layers: CharLayers | undefined;
  onChange: (layers: CharLayers) => void;
  config: PenConfig;
}) {
  const incoming = layers ?? NO_STROKES;
  const [session, sessionSet] = useState(() => freshSession(incoming));
  const [gesture, gestureSet] = useState<Gesture | null>(null);
  const [hover, hoverSet] = useState<Point | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const binRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);

  const { unit, wide } = useCanvasLayout(wrapRef);

  if (incoming !== session.emitted) {
    sessionSet(freshSession(incoming));
    gestureSet(null);
  }

  const { doc, past, future } = session;
  const moving = gesture?.kind === 'move' ? gesture : null;

  // What is on screen: mid-drag, the glyph as the drag would leave it.
  const strokes = moving ? moving.result : doc.strokes;
  const active = moving
    ? moving.result.length < doc.strokes.length
      ? null
      : moving.stroke
    : doc.active;
  const activeStroke = active === null ? undefined : strokes[active];
  const end = activeStroke?.[activeStroke.length - 1];

  const width = DOTSX * unit + 2 * PAD;
  const height = ROWS * unit + 2 * PAD;
  const px = (x: number) => PAD + x * unit;
  const py = (y: number) => PAD + (y - ROW_TOP) * unit;
  const pen = Math.max(5, Math.round(unit * 0.11));

  function emit(next: CharLayers) {
    if (next === session.emitted) return;
    onChange(next);
    sessionSet((current) => ({ ...current, emitted: next }));
  }

  /** Make `next` the glyph. A change to the strokes is one step of undo. */
  function commit(next: Doc) {
    const changed = next.strokes !== doc.strokes;
    if (next.strokes !== session.emitted) onChange(next.strokes);
    sessionSet({
      doc: next,
      past: changed ? [...past, doc].slice(-HISTORY) : past,
      future: changed ? [] : future,
      emitted: next.strokes,
    });
  }

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    onChange(previous.strokes);
    sessionSet({
      doc: previous,
      past: past.slice(0, -1),
      future: [doc, ...future],
      emitted: previous.strokes,
    });
  }

  function redo() {
    const [next, ...rest] = future;
    if (!next) return;
    onChange(next.strokes);
    sessionSet({
      doc: next,
      past: [...past, doc],
      future: rest,
      emitted: next.strokes,
    });
  }

  function select(index: number | null) {
    commit({ strokes: doc.strokes, active: index });
  }

  /** Draw to `at`: extend the stroke in hand, end it, or start a new one. */
  function tap(at: Point) {
    const stroke = doc.active === null ? undefined : doc.strokes[doc.active];
    if (!stroke) {
      commit({ strokes: [...doc.strokes, [at]], active: doc.strokes.length });
    } else if (samePoint(stroke[stroke.length - 1], at)) {
      select(null);
    } else {
      commit({
        strokes: doc.strokes.map((existing, i) =>
          i === doc.active ? [...existing, at] : existing
        ),
        active: doc.active,
      });
    }
  }

  /** Put an edit of one stroke in place; a stroke it emptied is gone. */
  function commitStroke(next: CharLayers, stroke: number) {
    const result = sameStrokes(next, doc.strokes) ? doc.strokes : next;
    commit({
      strokes: result,
      active: result.length < doc.strokes.length ? null : stroke,
    });
  }

  function removeEnd() {
    if (doc.active === null) return;
    const stroke = doc.strokes[doc.active];
    commitStroke(
      replaceStroke(doc.strokes, doc.active, stroke.slice(0, -1)),
      doc.active
    );
  }

  function removeStroke() {
    if (doc.active === null) return;
    commit({
      strokes: doc.strokes.filter((_, i) => i !== doc.active),
      active: null,
    });
  }

  /** Where a pointer is on the grid: as it is, and snapped to a point. */
  function locate(event: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * (width / rect.width) - PAD) / unit;
    const y =
      ((event.clientY - rect.top) * (height / rect.height) - PAD) / unit + ROW_TOP;
    const snap = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, Math.round(value / STEP) * STEP));
    return {
      raw: [x, y] as Point,
      at: [snap(x, 0, DOTSX), snap(y, ROW_TOP, ROW_BOTTOM)] as Point,
      inside:
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    };
  }

  function overBin(event: { clientX: number; clientY: number }) {
    const rect = binRef.current?.getBoundingClientRect();
    const reach = 10;
    return (
      !!rect &&
      event.clientX >= rect.left - reach &&
      event.clientX <= rect.right + reach &&
      event.clientY >= rect.top - reach &&
      event.clientY <= rect.bottom + reach
    );
  }

  /**
   * What a press at `raw` would drag. The stroke being drawn is tried first,
   * then the rest from the top down; a point wins over a line.
   */
  function findGrab(raw: Point, at: Point, tolerance: number): Grab | null {
    const order = doc.strokes
      .map((_, i) => i)
      .sort((a, b) => Number(b === doc.active) - Number(a === doc.active) || b - a);

    for (const stroke of order) {
      const indices = pointsAt(doc.strokes[stroke], at);
      if (indices.length) return { stroke, indices };
    }
    for (const stroke of order) {
      const segment = nearestSegment(doc.strokes[stroke], raw);
      if (segment && segment.distance <= tolerance) {
        return { stroke, insert: segment.index };
      }
    }
    return null;
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (press.current) return;
    const mouse = event.pointerType === 'mouse';
    if (mouse && event.button !== 0 && event.button !== 2) return;

    svgRef.current?.focus({ preventScroll: true });
    const { raw, at } = locate(event);
    const grab = findGrab(raw, at, (mouse ? 8 : 14) / unit);

    // Right click, or control-click, removes the point under it. Touch has no
    // such button: a long press must not delete, so it is never read as one.
    if (mouse && (event.button === 2 || event.ctrlKey)) {
      if (grab && 'indices' in grab) {
        commitStroke(
          movePoints(doc.strokes, grab.stroke, grab.indices, null),
          grab.stroke
        );
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at,
      grab,
      slop: mouse ? 4 : 10,
      move: null,
    };
    hoverSet(null);
    // On open grid the line to come shows at once and follows the pointer, so
    // a finger can settle on the right dot before letting go.
    if (!grab) gestureSet({ kind: 'draw', at });
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const current = press.current;
    const { at, inside } = locate(event);

    if (!current) {
      if (event.pointerType === 'mouse') {
        hoverSet((previous) => (previous && samePoint(previous, at) ? previous : at));
      }
      return;
    }
    if (event.pointerId !== current.id) return;
    const binned = overBin(event);

    if (!current.grab) {
      const next = binned ? null : at;
      gestureSet((previous) =>
        previous?.kind === 'draw' &&
        (previous.at && next ? samePoint(previous.at, next) : previous.at === next)
          ? previous
          : { kind: 'draw', at: next }
      );
      return;
    }

    if (!current.move) {
      const travelled = Math.hypot(
        event.clientX - current.x,
        event.clientY - current.y
      );
      if (travelled < current.slop) return;
      const { grab } = current;
      current.move =
        'insert' in grab
          ? {
              base: insertPoint(doc.strokes, grab.stroke, grab.insert, current.at),
              indices: [grab.insert],
            }
          : { base: doc.strokes, indices: grab.indices };
    } else if (!moving) {
      // The session was replaced under the drag; there is nothing to move.
      press.current = null;
      return;
    }

    const wrap = wrapRef.current!.getBoundingClientRect();
    const float = inside
      ? null
      : { x: event.clientX - wrap.left, y: event.clientY - wrap.top };

    let result: CharLayers;
    if (moving && moving.binned === binned && samePoint(moving.at, at)) {
      result = moving.result;
    } else {
      const { base, indices } = current.move;
      const next = movePoints(base, current.grab.stroke, indices, binned ? null : at);
      result = sameStrokes(next, doc.strokes) ? doc.strokes : next;
    }

    gestureSet({
      kind: 'move',
      stroke: current.grab.stroke,
      at,
      binned,
      float,
      result,
    });
    // The font follows the drag, so the text beside the editor does too.
    emit(result);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const current = press.current;
    if (!current || event.pointerId !== current.id) return;
    press.current = null;
    gestureSet(null);

    if (!current.grab) {
      if (gesture?.kind === 'draw' && gesture.at) tap(gesture.at);
    } else if (!current.move) {
      tap(current.at);
    } else if (moving) {
      commitStroke(moving.result, current.grab.stroke);
    }
  }

  function onPointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (press.current?.id !== event.pointerId) return;
    press.current = null;
    gestureSet(null);
    emit(doc.strokes);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
      return;
    }
    if (event.target !== svgRef.current) return;
    if (key === 'backspace' || key === 'delete') {
      event.preventDefault();
      removeEnd();
    } else if ((key === 'escape' || key === 'enter') && doc.active !== null) {
      event.preventDefault();
      event.stopPropagation();
      select(null);
    }
  }

  const dots: { x: number; y: number; major: boolean }[] = [];
  for (let x = 0; x <= DOTSX; x += STEP) {
    for (let y = ROW_TOP; y <= ROW_BOTTOM; y += STEP) {
      // Whole steps inside the cap box read as the main grid.
      const major =
        Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y <= DOTSY;
      dots.push({ x, y, major });
    }
  }

  // The point a tap would draw to: under a press on open grid, or the mouse.
  const aim = gesture?.kind === 'draw' ? gesture.at : gesture ? null : hover;
  const held = moving && !moving.binned ? moving.at : null;
  const state = (index: number) =>
    active === null ? 'rest' : index === active ? 'active' : 'idle';

  const hint = !strokes.length
    ? 'Tap a dot to start drawing.'
    : active === null
      ? 'Tap a dot to start a stroke. Drag a dot to move it.'
      : 'Tap a dot to draw from the blue one. Drag a line to add a point.';

  return (
    <div
      className="glyph-editor"
      data-wide={wide || undefined}
      ref={wrapRef}
      onKeyDown={onKeyDown}
    >
      <div className="glyph-header">{header}</div>
      <svg
        ref={svgRef}
        className="glyph-canvas"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        tabIndex={0}
        role="application"
        aria-label={`Strokes of “${char}”. Tap a dot to draw, drag a dot to move it.`}
        data-moving={moving ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={() => hoverSet(null)}
        onContextMenu={(event) => event.preventDefault()}
      >
        {dots.map(({ x, y, major }) => (
          <circle
            key={`${x},${y}`}
            className="glyph-dot"
            data-major={major || undefined}
            cx={px(x)}
            cy={py(y)}
            r={major ? 4 : 2}
          />
        ))}

        {held && (
          <g className="glyph-guide">
            <line x1={0} x2={width} y1={py(held[1])} y2={py(held[1])} />
            <line y1={0} y2={height} x1={px(held[0])} x2={px(held[0])} />
          </g>
        )}

        <g transform={`translate(${px(0)} ${py(0)}) scale(${unit})`}>
          {strokes.map((stroke, index) => (
            <g key={index} className="glyph-stroke" data-state={state(index)}>
              <StrokeShape stroke={stroke} pen={pen} unit={unit} config={config} />
            </g>
          ))}
        </g>

        {activeStroke?.map(([x, y], i) => (
          <circle key={i} className="glyph-node" cx={px(x)} cy={py(y)} r={6} />
        ))}

        {/* Halfway along each line of the stroke in hand: dragging a line
            puts a point into it, and these say so. */}
        {!gesture &&
          activeStroke?.slice(1).map(([x, y], i) => {
            const [fromX, fromY] = activeStroke[i];
            return Math.hypot(x - fromX, y - fromY) < 1 ? null : (
              <circle
                key={i}
                className="glyph-mid"
                cx={px((x + fromX) / 2)}
                cy={py((y + fromY) / 2)}
                r={3}
              />
            );
          })}

        {aim && end && !samePoint(aim, end) && (
          <line
            className="glyph-aim-line"
            x1={px(end[0])}
            y1={py(end[1])}
            x2={px(aim[0])}
            y2={py(aim[1])}
          />
        )}
        {end && (
          <circle className="glyph-end" cx={px(end[0])} cy={py(end[1])} r={8} />
        )}
        {aim && (!end || !samePoint(aim, end)) && (
          <circle className="glyph-aim" cx={px(aim[0])} cy={py(aim[1])} r={8} />
        )}
        {held && (
          <circle className="glyph-held" cx={px(held[0])} cy={py(held[1])} r={8} />
        )}
      </svg>

      {/* The toolbar is the bin: while a point is dragged it gives its whole
          width over to being dropped on, which a thumb can find without
          looking. */}
      <div className="glyph-toolbar" ref={binRef}>
        {moving ? (
          <div className="glyph-bin" data-over={moving.binned || undefined}>
            <Trash2 size={16} aria-hidden="true" />
            {moving.binned ? 'Release to remove' : 'Drop to remove'}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="glyph-tool"
              onClick={undo}
              disabled={!past.length}
              aria-label="Undo"
              title="Undo"
            >
              <Undo2 size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="glyph-tool"
              onClick={redo}
              disabled={!future.length}
              aria-label="Redo"
              title="Redo"
            >
              <Redo2 size={18} aria-hidden="true" />
            </button>
            <div className="glyph-toolbar-space" />
            <button
              type="button"
              className="glyph-tool"
              onClick={removeStroke}
              disabled={doc.active === null}
              aria-label="Delete stroke"
              title="Delete this stroke. Drag a dot here to remove just the dot"
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="glyph-strokes" role="group" aria-label="Strokes">
        {strokes.map((_, index) => (
          <button
            key={index}
            type="button"
            className="glyph-chip"
            aria-pressed={index === active}
            aria-label={`Stroke ${index + 1}`}
            title={`Stroke ${index + 1}`}
            onClick={() => select(index === doc.active ? null : index)}
          >
            <StrokeThumb strokes={strokes} index={index} config={config} />
          </button>
        ))}
        <button
          type="button"
          className="glyph-chip glyph-chip-new"
          aria-pressed={active === null}
          aria-label="New stroke"
          title="New stroke"
          onClick={() => select(null)}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>

      <p className="glyph-hint">{hint}</p>

      {/* Over the bin the bin itself answers, and the dot would cover it. */}
      {moving?.float && !moving.binned && (
        <div
          className="glyph-float"
          style={{ left: moving.float.x, top: moving.float.y }}
        />
      )}
    </div>
  );
}

/**
 * The sidebar's glyph tab: which character is being edited, a preview of it,
 * and the canvas its strokes are drawn on. `layers` is undefined for a
 * character the font does not have yet; the first stroke creates it.
 */
export function GlyphEditor({
  char,
  onChangeChar,
  layers,
  onChange,
  config,
}: {
  char: string;
  onChangeChar: (char: string) => void;
  layers: CharLayers | undefined;
  onChange: (layers: CharLayers) => void;
  config: PenConfig;
}) {
  return (
    <div className="editor-container">
      {/* Keyed by character: each glyph gets its own undo history. */}
      <StrokeEditor
        key={char}
        char={char}
        layers={layers}
        onChange={onChange}
        config={config}
        header={
          <>
            <div className="editor-input-container">
              <div className="editor-input-label">Editing</div>
              <input
                className="editor-input"
                value={char}
                onChange={(e) => {
                  // Whatever was typed last replaces the character being edited.
                  const typed = e.target.value.slice(-1);
                  if (typed) onChangeChar(typed);
                }}
              />
            </div>
            <div className="editor-input-container">
              <div className="editor-input-label">Preview</div>
              <Key
                path={layers ?? NO_STROKES}
                fontSize={8 * 5}
                strokeWidth={4}
                stroke={config.stroke}
                corners={config.corners}
                cornerRadius={config.cornerRadius}
                slant={config.slant}
              />
            </div>
          </>
        }
      />
    </div>
  );
}
