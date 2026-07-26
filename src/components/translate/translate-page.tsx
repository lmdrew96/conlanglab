"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Header } from "@/components/header";
import { TranslationOutput } from "@/components/translate/translation-output";
import { STARTER_PHRASES, buildGlossIndex, translate } from "@/lib/translate/engine";
import { buildAllomorphy } from "@/lib/morphology/engine";
import type { MorphologyAffixData, MorphologyStageData } from "@/lib/morphology/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { OrthographyStageData } from "@/lib/orthography/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import type { SyntaxStageData } from "@/lib/syntax/engine";

/** Stages Translate can't do anything without: roots to look up, sounds to build them from, and a script to write them in. */
interface MissingStage {
  label: string;
  route: string;
  why: string;
}

export function TranslatePage({ languageId }: { languageId: Id<"languages"> }) {
  const { isAuthenticated } = useConvexAuth();
  const language = useQuery(api.languages.get, isAuthenticated ? { id: languageId } : "skip");
  const phonologyRow = useQuery(api.phonology.queries.get, isAuthenticated ? { languageId } : "skip");
  const lexiconRow = useQuery(api.lexicon.queries.get, isAuthenticated ? { languageId } : "skip");
  const lexiconItemRows = useQuery(
    api.lexicon.queries.listItems,
    isAuthenticated && lexiconRow ? { languageId } : "skip",
  );
  const morphologyRow = useQuery(api.morphology.queries.get, isAuthenticated ? { languageId } : "skip");
  const morphologyItemRows = useQuery(
    api.morphology.queries.listItems,
    isAuthenticated && morphologyRow ? { languageId } : "skip",
  );
  const syntaxRow = useQuery(api.syntax.queries.get, isAuthenticated ? { languageId } : "skip");
  const orthographyRow = useQuery(api.orthography.queries.get, isAuthenticated ? { languageId } : "skip");

  const [text, setText] = useState("");

  const phonologyData = (phonologyRow?.data as PhonologyData | undefined) ?? null;
  const morphologyData = (morphologyRow?.data as MorphologyStageData | undefined) ?? null;
  const syntaxData = (syntaxRow?.data as SyntaxStageData | undefined) ?? null;
  const orthographyData = (orthographyRow?.data as OrthographyStageData | undefined) ?? null;

  const lexiconItems = useMemo(
    () => (lexiconItemRows ?? []).map((r) => r.data as LexiconItemData).filter(Boolean),
    [lexiconItemRows],
  );
  const morphologyItems = useMemo(
    () => (morphologyItemRows ?? []).map((r) => r.data as MorphologyAffixData).filter(Boolean),
    [morphologyItemRows],
  );
  const allomorphy = useMemo(
    () => (phonologyData ? (morphologyData?.allomorphy ?? buildAllomorphy(phonologyData)) : null),
    [morphologyData, phonologyData],
  );

  // Built once per lexicon rather than once per keystroke — 500 roots is
  // cheap but not free, and the user types into this box continuously.
  const glossIndex = useMemo(() => buildGlossIndex(lexiconItems), [lexiconItems]);

  const result = useMemo(() => {
    if (!phonologyData || !orthographyData || !allomorphy || lexiconItems.length === 0 || !text.trim()) return null;
    return translate({
      text,
      lexiconItems,
      morphologyItems,
      phonology: phonologyData,
      allomorphy,
      mapping: orthographyData.mapping,
      aesthetic: orthographyData.params.aesthetic,
      phraseStructure: syntaxData?.phraseStructure ?? null,
      glossIndex,
    });
  }, [text, lexiconItems, morphologyItems, phonologyData, allomorphy, orthographyData, syntaxData, glossIndex]);

  const replaceWord = (surface: string, replacement: string) => {
    // Word-boundary replacement so "the ash" doesn't get mangled by a
    // suggestion for "ash". Escaped because a gloss can contain regex
    // metacharacters (parentheses, periods).
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setText((current) => current.replace(new RegExp(`\\b${escaped}\\b`, "i"), replacement));
  };

  if (
    language === undefined ||
    phonologyRow === undefined ||
    lexiconRow === undefined ||
    morphologyRow === undefined ||
    syntaxRow === undefined ||
    orthographyRow === undefined
  ) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <p className="p-6 text-sm text-text-muted">Loading...</p>
      </div>
    );
  }

  if (language === null) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <p className="p-6 text-sm text-text-muted">
          Language not found.{" "}
          <Link href="/" className="text-accent">
            Back to library
          </Link>
        </p>
      </div>
    );
  }

  const missing: MissingStage[] = [];
  if (!phonologyData) {
    missing.push({ label: "Phonology", route: "phonology", why: "the sounds every word is built from" });
  }
  if (lexiconItems.length === 0) {
    missing.push({ label: "Lexicon", route: "lexicon", why: "the roots your English words map onto" });
  }
  if (!orthographyData) {
    missing.push({ label: "Orthography", route: "orthography", why: "the script the result is written in" });
  }

  const header = (
    <div>
      <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
        ← {language.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-text">Translate</h1>
    </div>
  );

  if (missing.length > 0) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
          {header}
          <p className="text-sm text-text-muted">
            Translate writes English into your language using what the other stages already generated — it invents
            nothing of its own. It still needs:
          </p>
          <ul className="flex flex-col gap-2">
            {missing.map((stage) => (
              <li key={stage.route}>
                <Link
                  href={`/language/${languageId}/${stage.route}`}
                  className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 hover:bg-surface-hover"
                >
                  <span className="font-medium text-text">{stage.label}</span>
                  <span className="text-xs text-text-muted">{stage.why} — generate →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // Narrowing for the render path below — `missing` being empty already
  // guarantees these, but the compiler doesn't know that.
  if (!phonologyData || !orthographyData || !allomorphy) return null;

  const scriptOutdated = orthographyData.scriptStyle.version !== 2;
  const coverage = result ? `${result.resolvedCount} of ${result.totalCount} words` : null;

  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        {header}

        <p className="text-sm text-text-muted">
          Type English and see it written in your language — real roots from your lexicon, inflected with your own
          affixes, ordered by your own syntax, rendered in your own glyphs. Nothing here is saved.
        </p>

        <div className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="the child sees the big mountain"
            aria-label="English to translate"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">Try:</span>
            {STARTER_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => setText(phrase)}
                className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:border-accent hover:text-accent"
              >
                {phrase}
              </button>
            ))}
            {text && (
              <button
                type="button"
                onClick={() => setText("")}
                className="ml-auto text-xs text-text-muted hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {scriptOutdated && (
          <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
            This script was generated before the glyph engine was rebuilt around a shared armature.{" "}
            <Link href={`/language/${languageId}/orthography`} className="underline">
              Reroll it in Orthography
            </Link>{" "}
            for the current letterforms.
          </p>
        )}

        {morphologyItems.length === 0 && (
          <p className="text-xs text-text-muted">
            No morphology yet, so every word comes out as a bare root —{" "}
            <Link href={`/language/${languageId}/morphology`} className="underline hover:text-text">
              generate Morphology
            </Link>{" "}
            to see plurals, tense and case marked.
          </p>
        )}
        {!syntaxData && (
          <p className="text-xs text-text-muted">
            No syntax yet, so words stay in the order you typed them —{" "}
            <Link href={`/language/${languageId}/syntax`} className="underline hover:text-text">
              generate Syntax
            </Link>{" "}
            to reorder them into your language&apos;s own constituent order.
          </p>
        )}

        {result && result.sentences.length > 0 ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-text-muted">Translation</h2>
              <span className="text-xs text-text-muted">{coverage} found in your lexicon</span>
            </div>
            <TranslationOutput
              sentences={result.sentences}
              orthography={orthographyData}
              phonology={phonologyData}
              wordOrder={syntaxData?.phraseStructure.wordOrder ?? null}
              onSuggestion={replaceWord}
            />
            <p className="text-xs text-text-muted">
              Translate reads a word, a phrase, or a simple declarative clause. It maps English onto your lexicon by
              meaning and marks whichever grammatical categories your language actually generated — a sentence it
              can&apos;t read confidently keeps the order you typed rather than guessing at one.
            </p>
          </>
        ) : (
          <p className="text-sm text-text-muted">
            {text.trim() ? "Nothing to translate yet." : "Type something above, or pick one of the phrases."}
          </p>
        )}
      </div>
    </div>
  );
}
