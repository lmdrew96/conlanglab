"use client";

import { useMemo } from "react";
import { formatAffixForm, formatHumanGloss } from "@/lib/morphology/format";
import type { MorphologyAffixData } from "@/lib/morphology/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { Doc } from "../../../convex/_generated/dataModel";

/** Strips the stress mark/syllable-dot notation lexicon roots carry, matching the convention lexicon's buildCompoundItem already uses when concatenating forms. */
function bareForm(phonologicalForm: string): string {
  return phonologicalForm.replace(/[ˈ.]/g, "");
}

function attach(rootForm: string, affixes: MorphologyAffixData[]): string {
  const prefixes = affixes.filter((a) => a.slot === "prefix");
  const suffixes = affixes.filter((a) => a.slot === "suffix");
  return [...prefixes.map((a) => a.form), rootForm, ...suffixes.map((a) => a.form)].join("");
}

/**
 * Read-only demo, nothing persisted: samples one real noun and one real
 * verb from the M2 lexicon and shows them inflected with a couple of this
 * language's generated affixes, so the milestone reads as attached to a
 * real language rather than a synthetic example only. Naive concatenation,
 * same no-allomorphy scope boundary as the rest of M3 (Section 5.4 is M4).
 */
export function ExampleWordsPanel({
  lexiconItems,
  morphologyItems,
}: {
  lexiconItems: Array<Doc<"lexiconItems">> | undefined;
  morphologyItems: Array<Doc<"morphologyItems">>;
}) {
  const example = useMemo(() => {
    if (!lexiconItems || lexiconItems.length === 0) return null;

    const items = lexiconItems.map((r) => r.data as LexiconItemData);
    const affixes = morphologyItems.map((r) => r.data as MorphologyAffixData);

    const noun = items.find((i) => i.partOfSpeech === "noun");
    const verb = items.find((i) => i.partOfSpeech === "verb");
    if (!noun && !verb) return null;

    const nominalAffixes = affixes.filter((a) => a.domain === "nominal").slice(0, 2);
    const verbalAffixes = affixes.filter((a) => a.domain === "verbal").slice(0, 2);

    return {
      noun: noun ? { meaning: noun.meaning, word: attach(bareForm(noun.phonologicalForm), nominalAffixes) } : null,
      verb: verb ? { meaning: verb.meaning, word: attach(bareForm(verb.phonologicalForm), verbalAffixes) } : null,
      nominalAffixes,
      verbalAffixes,
    };
  }, [lexiconItems, morphologyItems]);

  if (!example || (!example.noun && !example.verb)) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-muted">Example words from your lexicon</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {example.noun && (
          <div>
            <div className="font-mono text-base text-text">{example.noun.word}</div>
            <div className="text-xs text-text-muted">
              &ldquo;{example.noun.meaning}&rdquo;
              {example.nominalAffixes.length > 0 && (
                <>
                  {" "}
                  ({example.nominalAffixes.map((a) => `${formatAffixForm(a)} = ${formatHumanGloss(a.values)}`).join(", ")})
                </>
              )}
            </div>
          </div>
        )}
        {example.verb && (
          <div>
            <div className="font-mono text-base text-text">{example.verb.word}</div>
            <div className="text-xs text-text-muted">
              &ldquo;{example.verb.meaning}&rdquo;
              {example.verbalAffixes.length > 0 && (
                <>
                  {" "}
                  ({example.verbalAffixes.map((a) => `${formatAffixForm(a)} = ${formatHumanGloss(a.values)}`).join(", ")})
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
