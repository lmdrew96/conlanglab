"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import { formatWordOrder, wordOrderInfo } from "@/lib/syntax/format";
import { playExamplePhrase } from "@/lib/syntax/audio";
import type { WordOrder, WordOrderPreviewExample } from "@/lib/syntax/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import { SpeakerIcon } from "@/components/icons";

/**
 * Section 7.1/9.5's live-preview ask for the word-order picker: a real
 * example sentence per option, generated from the language's actual
 * lexicon/morphology. The suggested option is a lean, never a gate — same
 * framing as Morphology's TypologyPreviewPanel.
 */
export function WordOrderPreviewPanel({
  previews,
  selected,
  suggested,
  onSelect,
  phonology,
}: {
  previews: WordOrderPreviewExample[];
  selected: WordOrder;
  suggested: WordOrder;
  onSelect: (wordOrder: WordOrder) => void;
  phonology: PhonologyData | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {previews.map((preview) => {
        const isSelected = preview.wordOrder === selected;
        return (
          <div
            key={preview.wordOrder}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(preview.wordOrder)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(preview.wordOrder);
              }
            }}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-4 text-left transition-colors ${
              isSelected ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
                {preview.wordOrder}
                <InfoTooltip text={wordOrderInfo(preview.wordOrder)} />
              </span>
              {preview.wordOrder === suggested && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  Suggested
                </span>
              )}
            </div>
            <div className="text-xs text-text-muted">{formatWordOrder(preview.wordOrder)}</div>
            {preview.clause ? (
              <div>
                <div className="flex items-center gap-1.5 font-mono text-sm text-text">
                  {preview.clause.words.map((w) => w.form).join(" ")}
                  {phonology && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void playExamplePhrase(preview.clause!.words, phonology);
                      }}
                      title={`Play "${preview.clause.words.map((w) => w.form).join(" ")}"`}
                      className="hover:text-accent"
                    >
                      <SpeakerIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-text-muted">&ldquo;{preview.clause.translation}&rdquo;</div>
              </div>
            ) : (
              <div className="text-xs text-text-muted">(no example yet — lexicon needs a pronoun, noun, and verb)</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
