"use client";

import { useMemo } from "react";
import { GlyphSvg } from "@/components/orthography/glyph-svg";
import { applyAffixesToRoot, dedupeAffixesByCategorySignature } from "@/lib/morphology/engine";
import type { AllomorphyData, MorphologyAffixData } from "@/lib/morphology/engine";
import { composeWordGlyphSequence, resolveGlyphById } from "@/lib/orthography/engine";
import type { OrthographyStageData } from "@/lib/orthography/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

const JUNCTION_LABEL: Record<"adjacency" | "ligature" | "diacritic", string> = {
  adjacency: "·",
  ligature: "‿",
  diacritic: "⁺",
};

/**
 * Demonstrates design doc Section 8.3's boundary-rendering ask: samples one
 * real root + a couple of its real affixes, runs the same
 * applyAffixesToRoot pipeline morphology generation uses (never a separate
 * demo-only concatenation), and renders the actual glyph sequence with the
 * junction treatment (adjacency/ligature/diacritic) visible between glyphs.
 */
export function BoundaryPreviewPanel({
  lexiconItems,
  morphologyItems,
  phonology,
  allomorphy,
  data,
}: {
  lexiconItems: LexiconItemData[];
  morphologyItems: MorphologyAffixData[];
  phonology: PhonologyData;
  allomorphy: AllomorphyData;
  data: OrthographyStageData;
}) {
  const example = useMemo(() => {
    if (data.mapping.kind === "logographic") return null;

    const root = lexiconItems.find((i) => i.partOfSpeech === "noun") ?? lexiconItems.find((i) => i.partOfSpeech === "verb");
    if (!root) return null;

    const domain = root.partOfSpeech === "verb" ? "verbal" : "nominal";
    const affixes = dedupeAffixesByCategorySignature(morphologyItems.filter((a) => a.domain === domain)).slice(0, 2);
    if (affixes.length === 0) return null;

    const assembled = applyAffixesToRoot(root, affixes, phonology, allomorphy);
    const composed = composeWordGlyphSequence(assembled, affixes, phonology, data.mapping, data.params.aesthetic, root.toneValues);
    return { root, affixes, assembled, composed };
  }, [lexiconItems, morphologyItems, phonology, allomorphy, data]);

  if (data.mapping.kind === "logographic") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-base font-semibold text-text-muted">Morpheme boundaries</h3>
        <p className="text-xs text-text-muted">
          Logographic scripts render a whole word as one concept glyph — there&apos;s no per-sound boundary to show.
        </p>
      </div>
    );
  }

  if (!example) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-base font-semibold text-text-muted">Morpheme boundaries</h3>
        <p className="text-xs text-text-muted">Not enough lexicon/morphology data yet to demonstrate a boundary.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-semibold text-text-muted">Morpheme boundaries</h3>
      <p className="text-xs text-text-muted">
        &ldquo;{example.root.meaning}&rdquo; + {example.affixes.length} affix{example.affixes.length > 1 ? "es" : ""} — rendered as
        an actual glyph sequence, junction treatment shown between glyphs.
      </p>
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-bg p-3 text-text">
        {example.composed.steps.map((step, i) => {
          const glyph = resolveGlyphById(step.glyphId, data, phonology);
          const extraGlyphs = (step.extraGlyphIds ?? []).map((id) => resolveGlyphById(id, data, phonology));
          return (
            <span key={`${step.glyphId}-${i}`} className="flex items-center gap-1">
              {step.junctionBefore && (
                <span className="text-sm text-accent" title={step.junctionBefore}>
                  {JUNCTION_LABEL[step.junctionBefore]}
                </span>
              )}
              {glyph ? (
                <GlyphSvg glyph={glyph} style={data.scriptStyle} className="h-8 w-8" />
              ) : (
                <span className="text-xs text-text-muted">?</span>
              )}
              {extraGlyphs.map((extra, j) =>
                extra ? (
                  <GlyphSvg key={`${step.glyphId}-${i}-extra-${j}`} glyph={extra} style={data.scriptStyle} className="h-8 w-8" />
                ) : (
                  <span key={`${step.glyphId}-${i}-extra-${j}`} className="text-xs text-text-muted">
                    ?
                  </span>
                ),
              )}
            </span>
          );
        })}
      </div>
      {example.composed.nonSegmentalTreatment && (
        <p className="text-xs text-accent">
          One affix modifies the root in place (ablaut/templatic) — shown as a whole-word {example.composed.nonSegmentalTreatment}{" "}
          marker rather than a per-glyph junction.
        </p>
      )}
    </div>
  );
}
