"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Header } from "@/components/header";
import { DomainWeightControls } from "@/components/lexicon/domain-weight-controls";
import { LivePreviewPanel } from "@/components/lexicon/live-preview-panel";
import { RootsTable } from "@/components/lexicon/roots-table";
import { HistorySidebar } from "@/components/lexicon/history-sidebar";
import { useLexiconDraft } from "@/lib/lexicon/use-lexicon-draft";
import { DEFAULT_LEXICON_PARAMS, ROOT_TARGET } from "@/lib/lexicon/engine";
import type { LexiconStageData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

export function LexiconPage({ languageId }: { languageId: Id<"languages"> }) {
  const { isAuthenticated } = useConvexAuth();
  const language = useQuery(api.languages.get, isAuthenticated ? { id: languageId } : "skip");
  const phonologyRow = useQuery(api.phonology.queries.get, isAuthenticated ? { languageId } : "skip");
  const lexiconRow = useQuery(api.lexicon.queries.get, isAuthenticated ? { languageId } : "skip");
  const items = useQuery(api.lexicon.queries.listItems, isAuthenticated && lexiconRow ? { languageId } : "skip");

  const generateInitial = useMutation(api.lexicon.mutations.generateInitial);
  const reroll = useMutation(api.lexicon.mutations.reroll);
  const nudge = useMutation(api.lexicon.mutations.nudge);
  const lockStage = useMutation(api.lexicon.mutations.lockStage);
  const unlockStage = useMutation(api.lexicon.mutations.unlockStage);

  const phonologyData = (phonologyRow?.data as PhonologyData | undefined) ?? null;
  const committed = (lexiconRow?.data as LexiconStageData | undefined) ?? null;
  const { draftWeights, setDraftWeights, preview, isDirty } = useLexiconDraft(
    committed?.params,
    phonologyData,
    committed?.seed.base ?? 0,
  );
  const [busy, setBusy] = useState(false);

  if (language === undefined || phonologyRow === undefined || lexiconRow === undefined) {
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
            The Lexicon builds roots from the language&apos;s sound inventory — generate Phonology first.
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

  const stageLocked = lexiconRow?.locked ?? false;

  async function handleGenerateInitial() {
    setBusy(true);
    try {
      await generateInitial({ languageId, params: draftWeights });
    } finally {
      setBusy(false);
    }
  }

  async function handleReroll() {
    setBusy(true);
    try {
      await reroll({ languageId, params: draftWeights });
    } finally {
      setBusy(false);
    }
  }

  async function handleNudge() {
    setBusy(true);
    try {
      await nudge({ languageId, params: draftWeights });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
        <div>
          <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
            ← {language.name}
          </Link>
          <div className="mt-1 flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-text">Lexicon</h1>
            {committed && (
              <button
                type="button"
                onClick={() => (stageLocked ? unlockStage({ languageId }) : lockStage({ languageId }))}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text"
              >
                {stageLocked ? "🔒 Locked — unlock stage" : "Lock stage"}
              </button>
            )}
          </div>
        </div>

        {!committed ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Generates a {ROOT_TARGET}-root lexicon: a broad core list (always included) plus culture-flavor
              vocabulary drawn from the domains you weight below.
            </p>
            <DomainWeightControls params={draftWeights ?? DEFAULT_LEXICON_PARAMS} onChange={setDraftWeights} />
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateInitial}
              className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
            >
              Generate initial lexicon
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

              <LivePreviewPanel preview={preview} isDirty={isDirty} />

              <DomainWeightControls params={draftWeights} onChange={setDraftWeights} />

              {items === undefined ? (
                <p className="text-sm text-text-muted">Loading roots...</p>
              ) : (
                <RootsTable languageId={languageId} items={items} stageLocked={stageLocked} />
              )}
            </div>

            <HistorySidebar languageId={languageId} stageLocked={stageLocked} />
          </div>
        )}
      </div>
    </div>
  );
}
