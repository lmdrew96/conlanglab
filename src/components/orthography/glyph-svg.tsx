import { glyphToSvgPath, scriptStyleViewBox } from "@/lib/orthography/engine";
import type { Glyph, ScriptStyle } from "@/lib/orthography/engine";

export function GlyphSvg({
  glyph,
  style,
  className = "h-10 w-10",
}: {
  glyph: Glyph;
  style: ScriptStyle;
  className?: string;
}) {
  return (
    <svg viewBox={scriptStyleViewBox(style)} className={className} aria-label={`Glyph for ${glyph.id}`}>
      {style.connectorBar && (
        <line
          x1={0}
          y1={style.connectorBar.y}
          x2={style.viewBoxSize}
          y2={style.connectorBar.y}
          stroke="currentColor"
          strokeWidth={style.strokeWidth * 0.5}
          opacity={0.4}
        />
      )}
      <path
        d={glyphToSvgPath(glyph)}
        fill="none"
        stroke="currentColor"
        strokeWidth={style.strokeWidth}
        strokeLinecap={style.cornerStyle === "rounded" ? "round" : "square"}
        strokeLinejoin={style.cornerStyle === "rounded" ? "round" : "miter"}
      />
    </svg>
  );
}
