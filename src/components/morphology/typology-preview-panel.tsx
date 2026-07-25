"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { formatHumanGloss, formatTypology, typologyInfo } from "@/lib/morphology/format";
import type { MorphologicalType, TypologyPreviewExample } from "@/lib/morphology/engine";

/**
 * Section 5.1's core ask: a live, side-by-side example of what a word looks
 * like under each typological option, generated from the language's actual
 * phonology — not a blind dropdown. The suggested option is a lean, never a
 * gate (Section 5.1: "may suggest a lean... but never forces it") — every
 * card stays equally clickable.
 */
export function TypologyPreviewPanel({
  previews,
  selected,
  suggested,
  onSelect,
}: {
  previews: TypologyPreviewExample[];
  selected: MorphologicalType;
  suggested: MorphologicalType;
  onSelect: (typology: MorphologicalType) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {previews.map((preview) => {
        const isSelected = preview.typology === selected;
        return (
          // A <div role="button">, not a <button> — InfoTooltip renders its
          // own <button> below, and nesting <button> inside <button> is
          // invalid HTML that breaks hydration.
          <div
            key={preview.typology}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(preview.typology)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(preview.typology);
              }
            }}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-4 text-left transition-colors ${
              isSelected ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
                {formatTypology(preview.typology)}
                <InfoTooltip text={typologyInfo(preview.typology)} />
              </span>
              {preview.typology === suggested && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  Suggested
                </span>
              )}
            </div>
            <div className="font-mono text-base text-text">
              {preview.word || <span className="text-text-muted">(bare root)</span>}
            </div>
            <div className="text-xs text-text-muted">
              {preview.markedValues.length > 0 ? formatHumanGloss(preview.markedValues) : "nothing marked"} ·{" "}
              {preview.affixCount} affix{preview.affixCount === 1 ? "" : "es"} total
            </div>
          </div>
        );
      })}
    </div>
  );
}
