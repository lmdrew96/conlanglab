"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Header } from "@/components/header";
import { LockIcon } from "@/components/icons";
import { TypologyPreviewPanel } from "@/components/morphology/typology-preview-panel";
import { AffixTable } from "@/components/morphology/affix-table";
import { ExampleWordsPanel } from "@/components/morphology/example-words-panel";
import { HistorySidebar } from "@/components/morphology/history-sidebar";
import { useMorphologyDraft } from "@/lib/morphology/use-morphology-draft";
import { suggestTypology } from "@/lib/morphology/engine";
import type { MorphologyStageData } from "@/lib/morphology/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

export function MorphologyPage({ languageId }: { languageId: Id<"languages"> }) {
  const { isAuthenticated } = useConvexAuth();
  const language = useQuery(api.languages.get, isAuthenticated ? { id: languageId } : "skip");
  const phonologyRow = useQuery(api.phonology.queries.get, isAuthenticated ? { languageId } : "skip");
  const morphologyRow = useQuery(api.morphology.queries.get, isAuthenticated ? { languageId } : "skip");
  const items = useQuery(api.morphology.queries.listItems, isAuthenticated && morphologyRow ? { languageId } : "skip");
  const lexiconItems = useQuery(api.lexicon.queries.listItems, isAuthenticated ? { languageId } : "skip");

  const generateInitial = useMutation(api.morphology.mutations.generateInitial);
  const reroll = useMutation(api.morphology.mutations.reroll);
  const nudge = useMutation(api.morphology.mutations.nudge);
  const lockStage = useMutation(api.morphology.mutations.lockStage);
  const unlockStage = useMutation(api.morphology.mutations.unlockStage);

  const phonologyData = (phonologyRow?.data as PhonologyData | undefined) ?? null;
  const committed = (morphologyRow?.data as MorphologyStageData | undefined) ?? null;
  const { draftTypology, setDraftTypology, previews, isDirty } = useMorphologyDraft(
    committed?.params,
    phonologyData,
    phonologyData?.seed.base ?? 0,
  );
  const [busy, setBusy] = useState(false);

  if (language === undefined || phonologyRow === undefined || morphologyRow === undefined) {
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

  if (!phonologyData) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
          <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
            ← {language.name}
          </Link>
          <p className="text-sm text-text-muted">
            Morphology builds affixes from the language&apos;s sound inventory — generate Phonology first.
          </p>
          <Link
            href={`/language/${languageId}/phonology`}
            className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover"
          >
            Go to Phonology
          </Link>
        </div>
      </div>
    );
  }

  const stageLocked = morphologyRow?.locked ?? false;
  const suggested = suggestTypology(phonologyData);

  async function handleGenerateInitial() {
    setBusy(true);
    try {
      await generateInitial({ languageId, params: { typology: draftTypology } });
    } finally {
      setBusy(false);
    }
  }

  async function handleReroll() {
    setBusy(true);
    try {
      await reroll({ languageId, params: { typology: draftTypology } });
    } finally {
      setBusy(false);
    }
  }

  async function handleNudge() {
    setBusy(true);
    try {
      await nudge({ languageId, params: { typology: draftTypology } });
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
            <h1 className="text-2xl font-semibold text-text">Morphology</h1>
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
              Pick a morphological typology — each option below previews a real example word built from your
              language&apos;s current phonology. This drives how grammatical categories (case, tense, agreement,
              and more) get marked once you generate.
            </p>
            <TypologyPreviewPanel
              previews={previews}
              selected={draftTypology}
              suggested={suggested}
              onSelect={setDraftTypology}
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateInitial}
              className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
            >
              Generate initial morphology
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || stageLocked}
                  onClick={handleReroll}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
                >
                  Reroll all (unlocked)
                </button>
                <button
                  type="button"
                  disabled={busy || stageLocked}
                  onClick={handleNudge}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-hover disabled:opacity-50"
                >
                  Nudge all (unlocked)
                </button>
              </div>

              <TypologyPreviewPanel
                previews={previews}
                selected={draftTypology}
                suggested={suggested}
                onSelect={setDraftTypology}
              />
              {isDirty && (
                <p className="text-xs text-accent">
                  Typology changed — Reroll or Nudge above to apply it.
                </p>
              )}

              {items && items.length > 0 && (
                <ExampleWordsPanel lexiconItems={lexiconItems} morphologyItems={items} />
              )}

              {items === undefined ? (
                <p className="text-sm text-text-muted">Loading affixes...</p>
              ) : (
                <AffixTable languageId={languageId} items={items} stageLocked={stageLocked} phonology={phonologyData} />
              )}
            </div>

            <HistorySidebar languageId={languageId} stageLocked={stageLocked} />
          </div>
        )}
      </div>
    </div>
  );
}
