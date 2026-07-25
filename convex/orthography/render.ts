// Pure SVG rendering — zero Convex imports, importable client-side (live
// preview, and eventually M7's client-side PDF export per design doc
// Section 13.3/13.4). Kept deliberately separate from generate.ts: stored
// generation data is the traceable Stroke[] description (Section 13.4 —
// "these strokes, composed this way," not an opaque image), and turning
// that description into an actual SVG path string is a distinct, always-
// re-derivable rendering step, never itself the stored artifact.

import type { Glyph, ScriptStyle, Stroke } from "./types";

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

/** All of a glyph's strokes as one multi-subpath `d` attribute. */
export function glyphToSvgPath(glyph: Glyph): string {
  return glyph.strokes.map(strokeToSvgPath).join(" ");
}

export function scriptStyleViewBox(style: ScriptStyle): string {
  return `0 0 ${style.viewBoxSize} ${style.viewBoxSize}`;
}
