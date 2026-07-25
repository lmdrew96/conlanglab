"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Header } from "@/components/header";
import { ParamControls } from "@/components/phonology/param-controls";
import { InventoryGrid } from "@/components/phonology/inventory-grid";
import { SuprasegmentalControls } from "@/components/phonology/suprasegmental-controls";
import { LivePreviewPanel } from "@/components/phonology/live-preview-panel";
import { HistorySidebar } from "@/components/phonology/history-sidebar";
import { usePhonologyDraft } from "@/lib/phonology/use-phonology-draft";
import { DEFAULT_PARAMS } from "@/lib/phonology/engine";

export function PhonologyPage({ languageId }: { languageId: Id<"languages"> }) {
  const { isAuthenticated } = useConvexAuth();
  const language = useQuery(api.languages.get, isAuthenticated ? { id: languageId } : "skip");
  const phonologyRow = useQuery(api.phonology.queries.get, isAuthenticated ? { languageId } : "skip");
  const generateInitial = useMutation(api.phonology.mutations.generateInitial);
  const reroll = useMutation(api.phonology.mutations.reroll);
  const nudge = useMutation(api.phonology.mutations.nudge);
  const lockStage = useMutation(api.phonology.mutations.lockStage);
  const unlockStage = useMutation(api.phonology.mutations.unlockStage);

  const committed = phonologyRow?.data ?? null;
  const { draftParams, setDraftParams, preview, isDirty } = usePhonologyDraft(committed);
  const [busy, setBusy] = useState(false);

  if (language === undefined || phonologyRow === undefined) {
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

  const stageLocked = phonologyRow?.locked ?? false;

  async function handleGenerateInitial() {
    setBusy(true);
    try {
      await generateInitial({ languageId, params: draftParams });
    } finally {
      setBusy(false);
    }
  }

  async function handleRerollAll() {
    setBusy(true);
    try {
      await reroll({ languageId, target: "all", params: draftParams });
    } finally {
      setBusy(false);
    }
  }

  async function handleNudgeAll() {
    setBusy(true);
    try {
      await nudge({ languageId, target: "all", params: draftParams });
    } finally {
      setBusy(false);
    }
  }

  async function handleRerollInventory() {
    setBusy(true);
    try {
      await reroll({ languageId, target: "inventory", params: draftParams });
    } finally {
      setBusy(false);
    }
  }

  async function handleNudgeInventory() {
    setBusy(true);
    try {
      await nudge({ languageId, target: "inventory", params: draftParams });
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
            <h1 className="text-2xl font-semibold text-text">Phonology</h1>
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
            <ParamControls params={draftParams ?? DEFAULT_PARAMS} onChange={setDraftParams} />
            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateInitial}
              className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
            >
              Generate initial phonology
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || stageLocked}
                  onClick={handleRerollAll}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text hover:bg-accent-hover disabled:opacity-50"
                >
                  Reroll all (unlocked)
                </button>
                <button
                  type="button"
                  disabled={busy || stageLocked}
                  onClick={handleNudgeAll}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-hover disabled:opacity-50"
                >
                  Nudge all (unlocked)
                </button>
              </div>

              <LivePreviewPanel preview={preview} isDirty={isDirty} />

              <ParamControls params={draftParams} onChange={setDraftParams} />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-text">Inventory</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || stageLocked}
                      onClick={handleNudgeInventory}
                      className="text-xs text-text-muted hover:text-text disabled:opacity-50"
                    >
                      Nudge
                    </button>
                    <button
                      type="button"
                      disabled={busy || stageLocked}
                      onClick={handleRerollInventory}
                      className="text-xs text-text-muted hover:text-text disabled:opacity-50"
                    >
                      Reroll
                    </button>
                  </div>
                </div>
                <InventoryGrid languageId={languageId} data={committed} stageLocked={stageLocked} />
              </div>

              <SuprasegmentalControls languageId={languageId} data={committed} stageLocked={stageLocked} />
            </div>

            <HistorySidebar languageId={languageId} stageLocked={stageLocked} />
          </div>
        )}
      </div>
    </div>
  );
}
