// Pure SVG rendering — zero Convex imports, importable client-side (live
// preview, and eventually M7's client-side PDF export per design doc
// Section 13.3/13.4). Kept deliberately separate from generate.ts: stored
// generation data is the traceable Stroke[] description (Section 13.4 —
// "these strokes, composed this way," not an opaque image), and turning
// that description into an actual SVG path string is a distinct, always-
// re-derivable rendering step, never itself the stored artifact.

import type { Glyph, Point, ScriptStyle, Stroke } from "./types";

export function strokeToSvgPath(stroke: Stroke): string {
  switch (stroke.kind) {
    case "line":
      return `M ${stroke.from.x} ${stroke.from.y} L ${stroke.to.x} ${stroke.to.y}`;
    case "curve":
      return `M ${stroke.from.x} ${stroke.from.y} Q ${stroke.control.x} ${stroke.control.y} ${stroke.to.x} ${stroke.to.y}`;
    case "dot": {
      const { center, radius } = stroke;
      const left = center.x - radius;
      const right = center.x + radius;
      // Full circle via two semicircle arcs — the standard SVG path idiom (a single arc command can't close a full circle since start/end points would coincide).
      return `M ${left} ${center.y} A ${radius} ${radius} 0 1 0 ${right} ${center.y} A ${radius} ${radius} 0 1 0 ${left} ${center.y}`;
    }
    case "hook": {
      const rad = (stroke.angle * Math.PI) / 180;
      const endX = stroke.anchor.x + Math.cos(rad) * stroke.length;
      const endY = stroke.anchor.y + Math.sin(rad) * stroke.length;
      const controlX = stroke.anchor.x + Math.cos(rad) * stroke.length * 0.5 + stroke.curvature;
      const controlY = stroke.anchor.y + Math.sin(rad) * stroke.length * 0.5;
      return `M ${stroke.anchor.x} ${stroke.anchor.y} Q ${controlX} ${controlY} ${endX} ${endY}`;
    }
  }
}

/** The point a stroke's own SVG path physically starts drawing from — a dot's is its arc's own M point (`left`), not its `center`. */
function strokeDrawStart(stroke: Stroke): Point {
  switch (stroke.kind) {
    case "line":
    case "curve":
      return stroke.from;
    case "hook":
      return stroke.anchor;
    case "dot":
      return { x: stroke.center.x - stroke.radius, y: stroke.center.y };
  }
}

/** The point a stroke's own SVG path physically ends at — a dot's two arcs close back to its own start. */
function strokeDrawEnd(stroke: Stroke): Point {
  switch (stroke.kind) {
    case "line":
    case "curve":
      return stroke.to;
    case "dot":
      return strokeDrawStart(stroke);
    case "hook": {
      const rad = (stroke.angle * Math.PI) / 180;
      return { x: stroke.anchor.x + Math.cos(rad) * stroke.length, y: stroke.anchor.y + Math.sin(rad) * stroke.length };
    }
  }
}

// A hook's rendered endpoint is *reconstructed* from angle/length (itself
// derived from a from/to vector via atan2, then round-tripped back through
// degrees→radians and cos/sin) rather than stored directly, and `length`
// floors at 4 units — so it lands within a couple of units of the next
// stroke's true start, essentially never bit-identical. Strict `===` would
// silently fail almost every merge immediately after a hook (hook appears in
// nearly every manner's stroke pool), reproducing the exact fragmentation
// this function exists to fix. Same tolerance the generator's own test suite
// already uses for "is this coordinate shared" checks.
const MERGE_EPSILON = 2;

function pointsMatch(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= MERGE_EPSILON;
}

/** A stroke's path command with its leading moveto stripped — only valid when the pen is already sitting at this stroke's own draw-start point. */
function strokeToSvgPathContinuation(stroke: Stroke): string {
  return strokeToSvgPath(stroke).replace(/^M\s+[\d.-]+\s+[\d.-]+\s+/, "");
}

/**
 * All of a glyph's strokes as one `d` attribute, merging consecutive strokes
 * that already touch at a shared coordinate into a single SVG subpath
 * instead of giving every Stroke object its own "M" — buildConnectedStrokes
 * (generate.ts) guarantees chain segments share endpoints specifically so
 * they read as one continuous letterform, not N independent marks. "dot"
 * strokes always keep their own M regardless of coordinate match: a dot is a
 * closed loop (two arcs back to its own start), not a shape a line/curve can
 * smoothly continue into — it's legitimately its own contour, same as a real
 * "i" dot, whether it's the chain's own decorative dot or the one appended
 * mark a glyph gets (voiced/secondary/overflow).
 */
export function glyphToSvgPath(glyph: Glyph): string {
  const parts: string[] = [];
  let pen: Point | null = null;
  for (const stroke of glyph.strokes) {
    const canContinue = stroke.kind !== "dot" && pen !== null && pointsMatch(pen, strokeDrawStart(stroke));
    parts.push(canContinue ? strokeToSvgPathContinuation(stroke) : strokeToSvgPath(stroke));
    pen = strokeDrawEnd(stroke);
  }
  return parts.join(" ");
}

export function scriptStyleViewBox(style: ScriptStyle): string {
  return `0 0 ${style.viewBoxSize} ${style.viewBoxSize}`;
}
