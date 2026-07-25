"use client";

import { useMemo } from "react";
import { formatAffixForm, formatHumanGloss } from "@/lib/morphology/format";
import { playRoot } from "@/lib/lexicon/audio";
import { applyAffixesToRoot, dedupeAffixesByCategorySignature } from "@/lib/morphology/engine";
import type { AllomorphyData, MorphologyAffixData } from "@/lib/morphology/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import type { Doc } from "../../../convex/_generated/dataModel";
import { SpeakerIcon } from "@/components/icons";

/**
 * Read-only demo, nothing persisted: samples one real noun and one real
 * verb from the M2 lexicon and shows them inflected with a couple of this
 * language's generated affixes, so the milestone reads as attached to a
 * real language rather than a synthetic example only. Runs the same
 * `applyAffixesToRoot` pipeline (all M4 strategies + allomorphy) real
 * generation uses — no separate demo-only concatenation logic.
 */
export function ExampleWordsPanel({
  lexiconItems,
  morphologyItems,
  phonology,
  allomorphy,
}: {
  lexiconItems: Array<Doc<"lexiconItems">> | undefined;
  morphologyItems: Array<Doc<"morphologyItems">>;
  phonology: PhonologyData;
  allomorphy: AllomorphyData;
}) {
  const example = useMemo(() => {
    if (!lexiconItems || lexiconItems.length === 0) return null;

    const items = lexiconItems.map((r) => r.data as LexiconItemData);
    const affixes = morphologyItems.map((r) => r.data as MorphologyAffixData);

    const noun = items.find((i) => i.partOfSpeech === "noun");
    const verb = items.find((i) => i.partOfSpeech === "verb");
    if (!noun && !verb) return null;

    const nominalAffixes = dedupeAffixesByCategorySignature(affixes.filter((a) => a.domain === "nominal")).slice(
      0,
      2,
    );
    const verbalAffixes = dedupeAffixesByCategorySignature(affixes.filter((a) => a.domain === "verbal")).slice(0, 2);

    return {
      noun: noun
        ? {
            meaning: noun.meaning,
            ...applyAffixesToRoot(noun, nominalAffixes, phonology, allomorphy),
          }
        : null,
      verb: verb
        ? {
            meaning: verb.meaning,
            ...applyAffixesToRoot(verb, verbalAffixes, phonology, allomorphy),
          }
        : null,
      nominalAffixes,
      verbalAffixes,
    };
  }, [lexiconItems, morphologyItems, phonology, allomorphy]);

  if (!example || (!example.noun && !example.verb)) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-muted">Example words from your lexicon</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {example.noun && (
          <div>
            <span className="inline-flex items-center gap-1 font-mono text-base text-text">
              <button
                type="button"
                onClick={() => playRoot(example.noun!.phonemeIds, phonology, example.noun!.stressedPhonemeIndex)}
                title={`Play /${example.noun.form}/`}
                className="hover:text-accent"
              >
                <SpeakerIcon className="h-3.5 w-3.5" />
              </button>
              {example.noun.form}
            </span>
            <div className="text-xs text-text-muted">
              &ldquo;{example.noun.meaning}&rdquo;
              {example.nominalAffixes.length > 0 && (
                <>
                  {" "}
                  ({example.nominalAffixes.map((a) => `${formatAffixForm(a, phonology)} = ${formatHumanGloss(a.values)}`).join(", ")})
                </>
              )}
            </div>
          </div>
        )}
        {example.verb && (
          <div>
            <span className="inline-flex items-center gap-1 font-mono text-base text-text">
              <button
                type="button"
                onClick={() => playRoot(example.verb!.phonemeIds, phonology, example.verb!.stressedPhonemeIndex)}
                title={`Play /${example.verb.form}/`}
                className="hover:text-accent"
              >
                <SpeakerIcon className="h-3.5 w-3.5" />
              </button>
              {example.verb.form}
            </span>
            <div className="text-xs text-text-muted">
              &ldquo;{example.verb.meaning}&rdquo;
              {example.verbalAffixes.length > 0 && (
                <>
                  {" "}
                  ({example.verbalAffixes.map((a) => `${formatAffixForm(a, phonology)} = ${formatHumanGloss(a.values)}`).join(", ")})
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
