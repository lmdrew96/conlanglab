"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { Dial } from "@/components/dial";
import { GlyphSvg } from "@/components/orthography/glyph-svg";
import {
  aestheticInfo,
  ancestorScriptInfo,
  formatAesthetic,
  formatAncestorScript,
  formatOverflowStrategy,
  formatScriptCategory,
  overflowStrategyInfo,
  scriptCategoryInfo,
} from "@/lib/orthography/format";
import { AESTHETICS, ANCESTOR_SCRIPT_FAMILIES, OVERFLOW_STRATEGIES, SCRIPT_CATEGORIES } from "@/lib/orthography/engine";
import type { AncestorScriptFamily, Glyph, OrthographyParams, OverflowStrategy, ScriptStyle } from "@/lib/orthography/engine";

/**
 * Pre-generation picker for Orthography's knobs — scriptCategory/aesthetic
 * were Section 9.5's original two (discrete/categorical, every option shown
 * up front rather than dragged toward, same idiom as Syntax's word-order
 * picker); ancestorScript/overflowStrategy/orthographicDepth are v2
 * follow-ups (see convex/orthography/types.ts's OrthographyParams comment).
 * `preview`/`previewStyle` are the live sample-glyph set and its matching
 * ScriptStyle for the CURRENTLY selected combination (both from
 * useOrthographyDraft), so switching any axis regenerates them immediately
 * with no debounce needed. `previewStyle` must come from the same
 * sampleGlyphs call that produced `preview` — ScriptStyle is seed-derived
 * now (stroke width, count range all vary per script), so rebuilding a
 * style locally from just `params.aesthetic` would render these glyphs'
 * baked-in coordinates against a mismatched viewBox/stroke-width.
 */
export function ScriptPickerPanel({
  params,
  onChange,
  preview,
  previewStyle,
}: {
  params: OrthographyParams;
  onChange: (params: OrthographyParams) => void;
  preview: Glyph[];
  previewStyle: ScriptStyle | null;
}) {
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
        <h3 className="mb-2 flex items-center gap-1.5 text-base font-semibold text-text-muted">
          Ancestor script
          <InfoTooltip text="Optional structural starting point — biases procedural generation toward a real script family's overall character (stroke curviness, shape vocabulary) without reproducing its actual letterforms. Still fully procedural." />
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <ScriptOptionCard
            selected={params.ancestorScript === null}
            label="None"
            info="Fully free generation — no structural bias toward any real script family."
            onSelect={() => onChange({ ...params, ancestorScript: null })}
          />
          {ANCESTOR_SCRIPT_FAMILIES.map((family: AncestorScriptFamily) => (
            <ScriptOptionCard
              key={family}
              selected={params.ancestorScript === family}
              label={formatAncestorScript(family)}
              info={ancestorScriptInfo(family)}
              onSelect={() => onChange({ ...params, ancestorScript: family })}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-base font-semibold text-text-muted">
          Overflow strategy
          <InfoTooltip text="How the generator handles a phoneme inventory that outgrows the script's base glyph budget." />
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {OVERFLOW_STRATEGIES.map((strategy: OverflowStrategy) => (
            <ScriptOptionCard
              key={strategy}
              selected={params.overflowStrategy === strategy}
              label={formatOverflowStrategy(strategy)}
              info={overflowStrategyInfo(strategy)}
              onSelect={() => onChange({ ...params, overflowStrategy: strategy })}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          Orthographic depth
          <InfoTooltip text="0 = shallow/transparent, near-1:1 phoneme-to-letter mapping (like Spanish). Higher = deep/opaque, with irregular, context-dependent spellings (like English)." />
        </span>
        <Dial value={params.orthographicDepth} onChange={(orthographicDepth) => onChange({ ...params, orthographicDepth })} label="Orthographic depth" />
        <span className="text-xs text-text-muted">{Math.round(params.orthographicDepth * 100)}%</span>
      </div>

      <div>
        <h3 className="mb-2 text-base font-semibold text-text-muted">Preview</h3>
        {preview.length === 0 || !previewStyle ? (
          <p className="text-xs text-text-muted">Not enough data yet to preview this combination.</p>
        ) : (
          <div className="flex flex-wrap gap-3 rounded-md border border-border bg-bg p-3 text-text">
            {preview.map((glyph) => (
              <GlyphSvg key={glyph.id} glyph={glyph} style={previewStyle} />
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
