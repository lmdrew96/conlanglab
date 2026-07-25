"use client";

import { useMemo } from "react";
import { buildExampleSentences } from "@/lib/syntax/engine";
import { playExamplePhrase } from "@/lib/syntax/audio";
import type { ExampleConceptRefs, PhraseStructureData } from "@/lib/syntax/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { AllomorphyData, MorphologyAffixData } from "@/lib/morphology/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import { SpeakerIcon } from "@/components/icons";

/**
 * Composes live from current lexicon/morphology data every render — never
 * from cached/persisted sentences (see convex/syntax/types.ts's
 * ExampleConceptRefs comment) — the same "compose live, don't cache"
 * pattern src/components/morphology/example-words-panel.tsx uses.
 */
export function ExampleSentencesPanel({
  phraseStructure,
  exampleConcepts,
  lexiconItems,
  morphologyItems,
  phonology,
  allomorphy,
}: {
  phraseStructure: PhraseStructureData;
  exampleConcepts: ExampleConceptRefs;
  lexiconItems: LexiconItemData[];
  morphologyItems: MorphologyAffixData[];
  phonology: PhonologyData;
  allomorphy: AllomorphyData;
}) {
  const phrases = useMemo(
    () =>
      buildExampleSentences({
        phraseStructure,
        exampleConcepts,
        lexiconItems,
        morphologyItems,
        phonology,
        allomorphy,
      }),
    [phraseStructure, exampleConcepts, lexiconItems, morphologyItems, phonology, allomorphy],
  );

  if (phrases.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-base font-semibold text-text-muted">Example sentences</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {phrases.map((phrase) => (
          <div key={phrase.label}>
            <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
              {phrase.label}
              <button
                type="button"
                onClick={() => void playExamplePhrase(phrase.words, phonology)}
                title={`Play "${phrase.words.map((w) => w.form).join(" ")}"`}
                className="hover:text-accent"
              >
                <SpeakerIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 font-mono text-sm text-text">
              {phrase.words.map((word, i) => (
                <div key={i} className="flex flex-col items-center">
                  <span>{word.form}</span>
                  <span className="font-sans text-[10px] text-text-muted">{word.gloss}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 text-xs text-text-muted">&ldquo;{phrase.translation}&rdquo;</div>
          </div>
        ))}
      </div>
    </div>
  );
}
