"use client";

import { GlyphSvg } from "@/components/orthography/glyph-svg";
import { SpeakerIcon } from "@/components/icons";
import { resolveGlyphById } from "@/lib/orthography/engine";
import type { GlyphSequenceStep, OrthographyStageData } from "@/lib/orthography/engine";
import { boundaryTreatmentInfo, boundaryTreatmentMark } from "@/lib/orthography/format";
import { formatAffixForm, formatHumanGloss, formatLeipzigGloss, formatValueLabel } from "@/lib/morphology/format";
import { playRoot } from "@/lib/lexicon/audio";
import { playExamplePhrase } from "@/lib/syntax/audio";
import type { PhonologyData } from "@/lib/phonology/engine";
import type { TranslatedSentence, TranslatedWord } from "@/lib/translate/engine";

const ROLE_LABELS: Record<TranslatedWord["role"], string> = {
  subject: "subject",
  object: "object",
  verb: "verb",
  possessor: "possessor",
  modifier: "modifier",
  adposition: "adposition",
  other: "",
};

/**
 * The interlinear gloss line: the root's English meaning followed by each
 * applied affix's Leipzig abbreviation, e.g. "dog-PL-ACC". Leipzig rather
 * than this codebase's usual plain-English default (see
 * src/lib/morphology/format.ts) because an interlinear line has one word's
 * width to work with — the plain-English reading of every affix is
 * default-visible in the grammar breakdown below the sentence, not hidden
 * in a tooltip.
 */
function interlinearGloss(word: TranslatedWord): string {
  if (!word.item) return "?";
  const affixGlosses = word.appliedAffixes.map((a) => formatLeipzigGloss(a.values));
  return [word.item.meaning, ...affixGlosses].join("-");
}

function plainGloss(word: TranslatedWord): string {
  if (!word.item) return "no root for this word";
  const affixGlosses = word.appliedAffixes.map((a) => formatHumanGloss(a.values));
  return affixGlosses.length === 0 ? word.item.meaning : `${word.item.meaning} (${affixGlosses.join(", ")})`;
}

function GlyphRun({
  steps,
  orthography,
  phonology,
}: {
  steps: GlyphSequenceStep[];
  orthography: OrthographyStageData;
  phonology: PhonologyData;
}) {
  if (steps.length === 0) {
    return <span className="text-xs text-text-muted">—</span>;
  }
  return (
    <span className="flex flex-wrap items-center justify-center gap-0.5">
      {steps.map((step, i) => {
        const glyph = resolveGlyphById(step.glyphId, orthography, phonology);
        const diacritic = step.diacriticGlyphId ? resolveGlyphById(step.diacriticGlyphId, orthography, phonology) : null;
        const extras = (step.extraGlyphIds ?? []).map((id) => resolveGlyphById(id, orthography, phonology));
        return (
          <span key={`${step.glyphId}-${i}`} className="flex items-center gap-0.5">
            {step.junctionBefore && (
              <span className="text-sm text-accent" title={boundaryTreatmentInfo(step.junctionBefore)}>
                {boundaryTreatmentMark(step.junctionBefore)}
              </span>
            )}
            {glyph ? (
              // A vowel diacritic composes onto its carrier consonant rather
              // than sitting beside it — overlaid in the same box, which is
              // what an abugida actually does.
              <span className="relative inline-flex">
                <GlyphSvg glyph={glyph} style={orthography.scriptStyle} className="h-10 w-10" />
                {diacritic && (
                  <GlyphSvg
                    glyph={diacritic}
                    style={orthography.scriptStyle}
                    className="absolute inset-0 h-10 w-10 text-accent"
                  />
                )}
              </span>
            ) : (
              <span className="text-xs text-text-muted" title={`No glyph for ${step.glyphId}`}>
                ?
              </span>
            )}
            {extras.map((extra, j) =>
              extra ? (
                <GlyphSvg
                  key={`${step.glyphId}-${i}-extra-${j}`}
                  glyph={extra}
                  style={orthography.scriptStyle}
                  className="h-10 w-10"
                />
              ) : null,
            )}
          </span>
        );
      })}
    </span>
  );
}

function WordColumn({
  word,
  orthography,
  phonology,
  onSuggestion,
}: {
  word: TranslatedWord;
  orthography: OrthographyStageData;
  phonology: PhonologyData;
  onSuggestion: (surface: string, replacement: string) => void;
}) {
  const role = ROLE_LABELS[word.role];

  if (!word.item) {
    return (
      <div className="flex min-w-20 flex-col items-center gap-1 rounded-md border border-dashed border-border px-3 py-2">
        <span className="text-xs text-text-muted">no root</span>
        <span className="font-medium text-text">{word.source}</span>
        {word.suggestions.length > 0 && (
          <span className="flex flex-wrap justify-center gap-1">
            {word.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestion(word.surface, suggestion)}
                title={`Replace "${word.surface}" with "${suggestion}"`}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent hover:text-accent"
              >
                {suggestion}
              </button>
            ))}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-20 flex-col items-center gap-1">
      <GlyphRun steps={word.glyphSteps} orthography={orthography} phonology={phonology} />
      <span className="inline-flex items-center gap-1 font-mono text-sm text-text">
        <button
          type="button"
          onClick={() => playRoot(word.phonemeIds, phonology, word.stressedPhonemeIndex)}
          title={`Play /${word.form}/`}
          className="hover:text-accent"
        >
          <SpeakerIcon className="h-3 w-3" />
        </button>
        {word.form}
      </span>
      <span className="text-center text-[11px] text-text-muted" title={plainGloss(word)}>
        {interlinearGloss(word)}
      </span>
      <span className="text-center text-[10px] text-text-muted/70">
        {word.source}
        {role && ` · ${role}`}
      </span>
      {word.nonSegmentalTreatment && (
        <span className="text-[10px] text-accent" title={boundaryTreatmentInfo(word.nonSegmentalTreatment)}>
          root modified in place
        </span>
      )}
    </div>
  );
}

/**
 * Plain-English breakdown of every affix the sentence actually used, listed
 * once each with its real surface form — this is where the human-readable
 * reading of the compact interlinear line lives, and it doubles as the
 * "why does this word look like that" answer.
 */
function GrammarBreakdown({ sentence, phonology }: { sentence: TranslatedSentence; phonology: PhonologyData }) {
  const seen = new Map<string, { form: string; gloss: string }>();
  for (const word of sentence.words) {
    for (const affix of word.appliedAffixes) {
      if (!seen.has(affix.id)) {
        seen.set(affix.id, { form: formatAffixForm(affix, phonology), gloss: formatHumanGloss(affix.values) });
      }
    }
  }

  const unmarked = new Map<string, string>();
  for (const word of sentence.words) {
    for (const feature of word.unmarkedFeatures) {
      unmarked.set(`${feature.category}:${feature.value}`, formatValueLabel(feature));
    }
  }

  const incidental = new Map<string, string>();
  for (const word of sentence.words) {
    for (const value of word.incidentalValues) {
      incidental.set(`${value.category}:${value.value}`, formatValueLabel(value));
    }
  }

  if (seen.size === 0 && unmarked.size === 0 && incidental.size === 0) return null;

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-text-muted">
      {seen.size > 0 && (
        <p>
          <span className="text-text">Marked:</span>{" "}
          {Array.from(seen.values())
            .map((a) => `${a.form} = ${a.gloss}`)
            .join(" · ")}
        </p>
      )}
      {incidental.size > 0 && (
        <p>
          <span className="text-text">Came along:</span> {Array.from(incidental.values()).join(", ")} — your language
          fuses {incidental.size > 1 ? "these" : "this"} into the same affix, so {incidental.size > 1 ? "they" : "it"}{" "}
          can&apos;t be left off even though the English didn&apos;t say so.
        </p>
      )}
      {unmarked.size > 0 && (
        <p>
          <span className="text-text">Not marked:</span> {Array.from(unmarked.values()).join(", ")} — your language has no
          affix for {unmarked.size > 1 ? "these" : "this"}, so the bare root is the correct form.
        </p>
      )}
    </div>
  );
}

export function TranslationOutput({
  sentences,
  orthography,
  phonology,
  wordOrder,
  onSuggestion,
}: {
  sentences: TranslatedSentence[];
  orthography: OrthographyStageData;
  phonology: PhonologyData;
  /** Null when Syntax hasn't been generated — the UI then says so rather than implying an order was applied. */
  wordOrder: string | null;
  onSuggestion: (surface: string, replacement: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {sentences.map((sentence, index) => {
        const playable = sentence.words.filter((w) => w.item != null);
        return (
          <div key={index} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">
                {wordOrder == null
                  ? "Source order — generate Syntax to reorder into your language's own constituent order."
                  : sentence.reordered
                    ? `Reordered to ${wordOrder}`
                    : "Source order kept — this isn't a simple clause, so the words weren't reordered."}
              </span>
              {playable.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    void playExamplePhrase(
                      playable.map((w) => ({
                        form: w.form,
                        gloss: w.item?.meaning ?? "",
                        phonemeIds: w.phonemeIds,
                        stressedPhonemeIndex: w.stressedPhonemeIndex,
                      })),
                      phonology,
                    )
                  }
                  title="Play the whole phrase"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:text-accent"
                >
                  <SpeakerIcon className="h-3 w-3" /> Play
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-x-7 gap-y-6 rounded-md border border-border bg-bg p-4 text-text">
              {sentence.words.map((word, i) => (
                <WordColumn
                  key={`${word.source}-${i}`}
                  word={word}
                  orthography={orthography}
                  phonology={phonology}
                  onSuggestion={onSuggestion}
                />
              ))}
            </div>

            <GrammarBreakdown sentence={sentence} phonology={phonology} />
          </div>
        );
      })}
    </div>
  );
}
