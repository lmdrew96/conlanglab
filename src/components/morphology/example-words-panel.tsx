"use client";

import { useMemo } from "react";
import { formatAffixForm, formatHumanGloss } from "@/lib/morphology/format";
import { playRoot } from "@/lib/lexicon/audio";
import type { MorphologyAffixData } from "@/lib/morphology/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import type { Doc } from "../../../convex/_generated/dataModel";
import { SpeakerIcon } from "@/components/icons";

/** Strips the stress mark/syllable-dot notation lexicon roots carry, matching the convention lexicon's buildCompoundItem already uses when concatenating forms. */
function bareForm(phonologicalForm: string): string {
  return phonologicalForm.replace(/[ˈ.]/g, "");
}

function attach(rootForm: string, affixes: MorphologyAffixData[]): string {
  const prefixes = affixes.filter((a) => a.slot === "prefix");
  const suffixes = affixes.filter((a) => a.slot === "suffix");
  return [...prefixes.map((a) => a.form), rootForm, ...suffixes.map((a) => a.form)].join("");
}

/** Same prefix/root/suffix ordering as `attach`, but over phoneme-id sequences so the assembled word can be played — see src/lib/lexicon/audio.ts's resolveRootPhonemes. Shifts the root's stressedPhonemeIndex by however many prefix phonemes now sit ahead of it. */
function attachPhonemeIds(
  root: LexiconItemData,
  affixes: MorphologyAffixData[],
): { phonemeIds: string[]; stressedPhonemeIndex: number | undefined } {
  const prefixes = affixes.filter((a) => a.slot === "prefix");
  const suffixes = affixes.filter((a) => a.slot === "suffix");
  const prefixPhonemeIds = prefixes.flatMap((a) => a.phonemeIds);
  return {
    phonemeIds: [...prefixPhonemeIds, ...root.phonemeIds, ...suffixes.flatMap((a) => a.phonemeIds)],
    stressedPhonemeIndex:
      root.stressedPhonemeIndex !== undefined ? prefixPhonemeIds.length + root.stressedPhonemeIndex : undefined,
  };
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
  phonology,
}: {
  lexiconItems: Array<Doc<"lexiconItems">> | undefined;
  morphologyItems: Array<Doc<"morphologyItems">>;
  phonology: PhonologyData;
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
      noun: noun
        ? {
            meaning: noun.meaning,
            word: attach(bareForm(noun.phonologicalForm), nominalAffixes),
            ...attachPhonemeIds(noun, nominalAffixes),
          }
        : null,
      verb: verb
        ? {
            meaning: verb.meaning,
            word: attach(bareForm(verb.phonologicalForm), verbalAffixes),
            ...attachPhonemeIds(verb, verbalAffixes),
          }
        : null,
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
            <span className="inline-flex items-center gap-1 font-mono text-base text-text">
              <button
                type="button"
                onClick={() => playRoot(example.noun!.phonemeIds, phonology, example.noun!.stressedPhonemeIndex)}
                title={`Play /${example.noun.word}/`}
                className="hover:text-accent"
              >
                <SpeakerIcon className="h-3.5 w-3.5" />
              </button>
              {example.noun.word}
            </span>
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
            <span className="inline-flex items-center gap-1 font-mono text-base text-text">
              <button
                type="button"
                onClick={() => playRoot(example.verb!.phonemeIds, phonology, example.verb!.stressedPhonemeIndex)}
                title={`Play /${example.verb.word}/`}
                className="hover:text-accent"
              >
                <SpeakerIcon className="h-3.5 w-3.5" />
              </button>
              {example.verb.word}
            </span>
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
