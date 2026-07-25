"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Header } from "@/components/header";
import { LockIcon } from "@/components/icons";
import { WordOrderPreviewPanel } from "@/components/syntax/word-order-preview-panel";
import { PhraseRulesPanel } from "@/components/syntax/phrase-rules-panel";
import { ExampleSentencesPanel } from "@/components/syntax/example-sentences-panel";
import { HistorySidebar } from "@/components/syntax/history-sidebar";
import { useSyntaxDraft } from "@/lib/syntax/use-syntax-draft";
import { suggestWordOrder } from "@/lib/syntax/engine";
import type { SyntaxStageData } from "@/lib/syntax/engine";
import { buildAllomorphy } from "@/lib/morphology/engine";
import type { MorphologyAffixData, MorphologyStageData } from "@/lib/morphology/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

export function SyntaxPage({ languageId }: { languageId: Id<"languages"> }) {
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

  const generateInitial = useMutation(api.syntax.mutations.generateInitial);
  const reroll = useMutation(api.syntax.mutations.reroll);
  const nudge = useMutation(api.syntax.mutations.nudge);
  const setWordOrder = useMutation(api.syntax.mutations.setWordOrder);
  const lockStage = useMutation(api.syntax.mutations.lockStage);
  const unlockStage = useMutation(api.syntax.mutations.unlockStage);

  const [busy, setBusy] = useState(false);

  const phonologyData = (phonologyRow?.data as PhonologyData | undefined) ?? null;
  const morphologyData = (morphologyRow?.data as MorphologyStageData | undefined) ?? null;
  const committed = (syntaxRow?.data as SyntaxStageData | undefined) ?? null;

  const lexiconItems = useMemo(
    () => (lexiconItemRows ?? []).map((r) => r.data as LexiconItemData).filter(Boolean),
    [lexiconItemRows],
  );
  const morphologyItems = useMemo(
    () => (morphologyItemRows ?? []).map((r) => r.data as MorphologyAffixData).filter(Boolean),
    [morphologyItemRows],
  );
  const allomorphy = useMemo(
    () => (morphologyData && phonologyData ? (morphologyData.allomorphy ?? buildAllomorphy(phonologyData)) : null),
    [morphologyData, phonologyData],
  );

  const { draftWordOrder, setDraftWordOrder, previews, isDirty } = useSyntaxDraft(
    committed?.params,
    lexiconItems,
    morphologyItems,
    phonologyData,
    allomorphy,
    morphologyData?.seed.base ?? 0,
  );

  if (
    language === undefined ||
    phonologyRow === undefined ||
    lexiconRow === undefined ||
    morphologyRow === undefined ||
    syntaxRow === undefined
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

  if (!lexiconRow) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
          <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
            ← {language.name}
          </Link>
          <p className="text-sm text-text-muted">
            Syntax arranges words from your language&apos;s lexicon — generate Lexicon first.
          </p>
          <Link
            href={`/language/${languageId}/lexicon`}
            className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover"
          >
            Go to Lexicon
          </Link>
        </div>
      </div>
    );
  }

  if (!morphologyData) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
          <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
            ← {language.name}
          </Link>
          <p className="text-sm text-text-muted">
            Word order leans on your language&apos;s morphological typology — generate Morphology first.
          </p>
          <Link
            href={`/language/${languageId}/morphology`}
            className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover"
          >
            Go to Morphology
          </Link>
        </div>
      </div>
    );
  }

  const stageLocked = syntaxRow?.locked ?? false;
  const suggested = suggestWordOrder(morphologyData);

  async function handleGenerateInitial() {
    setBusy(true);
    try {
      await generateInitial({ languageId, params: { wordOrder: draftWordOrder } });
    } finally {
      setBusy(false);
    }
  }

  async function handleReroll() {
    setBusy(true);
    try {
      await reroll({ languageId, params: { wordOrder: draftWordOrder } });
    } finally {
      setBusy(false);
    }
  }

  async function handleNudge() {
    setBusy(true);
    try {
      await nudge({ languageId, params: { wordOrder: draftWordOrder } });
    } finally {
      setBusy(false);
    }
  }

  async function handleSetWordOrder() {
    setBusy(true);
    try {
      await setWordOrder({ languageId, wordOrder: draftWordOrder });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <div className="mx-auto flex w-full max-w-[80vw] flex-1 flex-col gap-6 p-6">
        <div>
          <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
            ← {language.name}
          </Link>
          <div className="mt-1 flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-text">Syntax</h1>
            {committed && (
              <button
                type="button"
                onClick={() => (stageLocked ? unlockStage({ languageId }) : lockStage({ languageId }))}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text"
              >
                {stageLocked ? (
                  <span className="inline-flex items-center gap-1">
                    <LockIcon className="h-3.5 w-3.5" /> Locked — unlock stage
                  </span>
                ) : (
                  "Lock stage"
                )}
              </button>
            )}
          </div>
        </div>

        {!committed ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Pick a word order — each option below previews a real example sentence built from your language&apos;s
              current lexicon and morphology. This drives the basic phrase-structure rules (noun phrases, possessive
              phrases, adpositional phrases) once you generate.
            </p>
            <WordOrderPreviewPanel
              previews={previews}
              selected={draftWordOrder}
              suggested={suggested}
              onSelect={setDraftWordOrder}
              phonology={phonologyData}
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateInitial}
              className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
            >
              Generate initial syntax
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || stageLocked}
                  onClick={handleReroll}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
                >
                  Reroll (unlocked)
                </button>
                <button
                  type="button"
                  disabled={busy || stageLocked}
                  onClick={handleNudge}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-hover disabled:opacity-50"
                >
                  Nudge (unlocked)
                </button>
                {isDirty && (
                  <button
                    type="button"
                    disabled={busy || stageLocked}
                    onClick={handleSetWordOrder}
                    className="rounded-md border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    Apply word order change
                  </button>
                )}
              </div>

              <WordOrderPreviewPanel
                previews={previews}
                selected={draftWordOrder}
                suggested={suggested}
                onSelect={setDraftWordOrder}
                phonology={phonologyData}
              />
              {isDirty && (
                <p className="text-xs text-accent">Word order changed — apply above to update the phrase rules.</p>
              )}

              <PhraseRulesPanel phraseStructure={committed.phraseStructure} />

              {phonologyData && allomorphy && (
                <ExampleSentencesPanel
                  phraseStructure={committed.phraseStructure}
                  exampleConcepts={committed.exampleConcepts}
                  lexiconItems={lexiconItems}
                  morphologyItems={morphologyItems}
                  phonology={phonologyData}
                  allomorphy={allomorphy}
                />
              )}
            </div>

            <HistorySidebar languageId={languageId} stageLocked={stageLocked} />
          </div>
        )}
      </div>
    </div>
  );
}
