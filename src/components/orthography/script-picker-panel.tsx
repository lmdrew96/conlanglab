"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { GlyphSvg } from "@/components/orthography/glyph-svg";
import { aestheticInfo, formatAesthetic, formatScriptCategory, scriptCategoryInfo } from "@/lib/orthography/format";
import { AESTHETICS, SCRIPT_CATEGORIES, buildScriptStyle } from "@/lib/orthography/engine";
import type { Glyph, OrthographyParams } from "@/lib/orthography/engine";

/**
 * Pre-generation picker for Section 9.5's two Orthography knobs. Both axes
 * are discrete/categorical, so — unlike a continuous slider — every option
 * is shown up front rather than dragged toward (same idiom as Syntax's
 * word-order picker). `preview` is the live sample-glyph set for the
 * CURRENTLY selected combination (from useOrthographyDraft), so switching
 * either axis regenerates it immediately with no debounce needed.
 */
export function ScriptPickerPanel({
  params,
  onChange,
  preview,
}: {
  params: OrthographyParams;
  onChange: (params: OrthographyParams) => void;
  preview: Glyph[];
}) {
  const style = buildScriptStyle(params.aesthetic);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h3 className="mb-2 text-base font-semibold text-text-muted">Script category</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SCRIPT_CATEGORIES.map((category) => (
            <ScriptOptionCard
              key={category}
              selected={params.scriptCategory === category}
              label={formatScriptCategory(category)}
              info={scriptCategoryInfo(category)}
              onSelect={() => onChange({ ...params, scriptCategory: category })}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-text-muted">Aesthetic</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AESTHETICS.map((aesthetic) => (
            <ScriptOptionCard
              key={aesthetic}
              selected={params.aesthetic === aesthetic}
              label={formatAesthetic(aesthetic)}
              info={aestheticInfo(aesthetic)}
              onSelect={() => onChange({ ...params, aesthetic })}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-text-muted">Preview</h3>
        {preview.length === 0 ? (
          <p className="text-xs text-text-muted">Not enough data yet to preview this combination.</p>
        ) : (
          <div className="flex flex-wrap gap-3 rounded-md border border-border bg-bg p-3 text-text">
            {preview.map((glyph) => (
              <GlyphSvg key={glyph.id} glyph={glyph} style={style} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptOptionCard({
  selected,
  label,
  info,
  onSelect,
}: {
  selected: boolean;
  label: string;
  info: string;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-border bg-bg hover:bg-surface-hover"
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
        {label}
        <InfoTooltip text={info} />
      </span>
    </div>
  );
}
