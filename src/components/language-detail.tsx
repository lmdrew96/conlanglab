"use client";

import { useState } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Header } from "@/components/header";

const STAGES: { key: keyof typeof STAGE_MILESTONE; label: string }[] = [
  { key: "phonology", label: "Phonology" },
  { key: "lexicon", label: "Lexicon" },
  { key: "morphology", label: "Morphology" },
  { key: "syntax", label: "Syntax" },
  { key: "orthography", label: "Orthography" },
];

const STAGE_MILESTONE = {
  phonology: "M1",
  lexicon: "M2",
  morphology: "M3–M4",
  syntax: "M5",
  orthography: "M6",
};

const STAGE_ROUTES: Partial<Record<keyof typeof STAGE_MILESTONE, string>> = {
  phonology: "phonology",
  lexicon: "lexicon",
  morphology: "morphology",
  syntax: "syntax",
  orthography: "orthography",
};

export function LanguageDetail({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const language = useQuery(api.languages.get, isAuthenticated ? { id: id as Id<"languages"> } : "skip");
  const rename = useMutation(api.languages.rename);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");

  if (language === undefined) {
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

  const startEditing = () => {
    setDraftName(language.name);
    setEditingName(true);
  };

  const commitRename = async () => {
    setEditingName(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === language.name) return;
    await rename({ id: id as Id<"languages">, name: trimmed });
  };

  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
        <div>
          <Link href="/" className="text-sm text-text-muted hover:text-text">
            ← Library
          </Link>
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-2xl font-semibold text-text focus:outline-none focus:ring-2 focus:ring-accent"
            />
          ) : (
            <h1 className="mt-1 text-2xl font-semibold text-text">
              <button
                type="button"
                onClick={startEditing}
                title="Click to rename"
                className="text-left hover:text-accent"
              >
                {language.name}
              </button>
            </h1>
          )}
        </div>

        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">Generation stages</h2>
        <ul className="flex flex-col gap-2">
          {STAGES.map(({ key, label }) => {
            const content = (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text">{label}</span>
                  {language.lockedStages[key] && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-text">
                      Locked
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  {STAGE_ROUTES[key] ? "Open →" : `Generation engine ships in ${STAGE_MILESTONE[key]}`}
                </span>
              </>
            );

            const route = STAGE_ROUTES[key];
            if (route) {
              return (
                <li key={key}>
                  <Link
                    href={`/language/${id}/${route}`}
                    className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 hover:bg-surface-hover"
                  >
                    {content}
                  </Link>
                </li>
              );
            }

            return (
              <li
                key={key}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3"
              >
                {content}
              </li>
            );
          })}
        </ul>

        {/* Deliberately its own group, not a sixth stage: Translate generates
            no language material — it reads the five stages above and writes
            English through them. */}
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">Tools</h2>
          <Link
            href={`/language/${id}/translate`}
            className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 hover:bg-surface-hover"
          >
            <span className="font-medium text-text">Translate</span>
            <span className="text-xs text-text-muted">Write English in your script — Open →</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
