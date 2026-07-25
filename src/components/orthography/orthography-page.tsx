"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Header } from "@/components/header";
import { LockIcon } from "@/components/icons";
import { ScriptPickerPanel } from "@/components/orthography/script-picker-panel";
import { GlyphSetPanel } from "@/components/orthography/glyph-set-panel";
import { BoundaryPreviewPanel } from "@/components/orthography/boundary-preview-panel";
import { HistorySidebar } from "@/components/orthography/history-sidebar";
import { useOrthographyDraft } from "@/lib/orthography/use-orthography-draft";
import type { OrthographyStageData } from "@/lib/orthography/engine";
import { buildAllomorphy } from "@/lib/morphology/engine";
import type { MorphologyAffixData, MorphologyStageData } from "@/lib/morphology/engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

export function OrthographyPage({ languageId }: { languageId: Id<"languages"> }) {
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
  const orthographyRow = useQuery(api.orthography.queries.get, isAuthenticated ? { languageId } : "skip");

  const generateInitial = useMutation(api.orthography.mutations.generateInitial);
  const reroll = useMutation(api.orthography.mutations.reroll);
  const nudge = useMutation(api.orthography.mutations.nudge);
  const lockStage = useMutation(api.orthography.mutations.lockStage);
  const unlockStage = useMutation(api.orthography.mutations.unlockStage);

  const [busy, setBusy] = useState(false);

  const phonologyData = (phonologyRow?.data as PhonologyData | undefined) ?? null;
  const morphologyData = (morphologyRow?.data as MorphologyStageData | undefined) ?? null;
  const committed = (orthographyRow?.data as OrthographyStageData | undefined) ?? null;

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

  const { draftParams, setDraftParams, preview, previewStyle, isDirty } = useOrthographyDraft(
    committed?.params,
    phonologyData,
    phonologyData?.seed.base ?? 0,
  );

  if (
    language === undefined ||
    phonologyRow === undefined ||
    lexiconRow === undefined ||
    morphologyRow === undefined ||
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

  if (!phonologyData) {
    return (
      <div className="flex flex-1 flex-col">
        <Header />
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
          <Link href={`/language/${languageId}`} className="text-sm text-text-muted hover:text-text">
            ← {language.name}
          </Link>
          <p className="text-sm text-text-muted">
            Orthography maps your language&apos;s sound inventory onto written symbols — generate Phonology first.
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

  const stageLocked = orthographyRow?.locked ?? false;
  const needsLexicon = draftParams.scriptCategory === "syllabic" || draftParams.scriptCategory === "logographic";
  const lexiconMissing = needsLexicon && !lexiconRow;

  async function handleGenerateInitial() {
    setBusy(true);
    try {
      await generateInitial({ languageId, params: draftParams });
    } finally {
      setBusy(false);
    }
  }

  async function handleReroll() {
    setBusy(true);
    try {
      await reroll({ languageId, params: draftParams });
    } finally {
      setBusy(false);
    }
  }

  async function handleNudge() {
    setBusy(true);
    try {
      await nudge({ languageId });
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
            <h1 className="text-2xl font-semibold text-text">Orthography</h1>
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
              Choose a script category and aesthetic — glyphs are procedurally generated from your language&apos;s own
              sound inventory, not selected from an existing font.
            </p>
            <ScriptPickerPanel params={draftParams} onChange={setDraftParams} preview={preview} previewStyle={previewStyle} />
            {lexiconMissing && (
              <p className="text-xs text-accent">
                {draftParams.scriptCategory === "syllabic" ? "Syllabic" : "Logographic"} scripts key off your generated
                lexicon —{" "}
                <Link href={`/language/${languageId}/lexicon`} className="underline">
                  generate Lexicon first
                </Link>
                .
              </p>
            )}
            <button
              type="button"
              disabled={busy || lexiconMissing}
              onClick={handleGenerateInitial}
              className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
            >
              Generate initial orthography
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
                    disabled={busy || stageLocked || lexiconMissing}
                    onClick={handleReroll}
                    className="rounded-md border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    Apply script change (reroll)
                  </button>
                )}
              </div>

              <ScriptPickerPanel params={draftParams} onChange={setDraftParams} preview={preview} previewStyle={previewStyle} />
              {isDirty && (
                <p className="text-xs text-accent">Script settings changed — apply above to regenerate the glyph set.</p>
              )}

              <GlyphSetPanel
                languageId={languageId}
                data={committed}
                phonology={phonologyData}
                lexiconItems={lexiconItems}
                stageLocked={stageLocked}
              />

              {morphologyData && allomorphy && (
                <BoundaryPreviewPanel
                  lexiconItems={lexiconItems}
                  morphologyItems={morphologyItems}
                  phonology={phonologyData}
                  allomorphy={allomorphy}
                  data={committed}
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
