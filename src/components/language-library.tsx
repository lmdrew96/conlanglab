"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import { inLivingColor } from "@/lib/title-fonts";

export function LanguageLibrary() {
  const { isAuthenticated } = useConvexAuth();
  // Skip until Clerk's client SDK has actually attached an auth token —
  // otherwise this fires during the brief unauthenticated window on first
  // load and throws instead of just waiting (a real race, not hypothetical:
  // reproduces on every fresh page load without this guard).
  const languages = useQuery(api.languages.list, isAuthenticated ? {} : "skip");
  const create = useMutation(api.languages.create);
  const remove = useMutation(api.languages.remove);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await create({ name: trimmed });
      setName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name your new language..."
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text shadow-sm shadow-accent/30 hover:bg-accent-hover disabled:opacity-50 disabled:shadow-none"
        >
          Create
        </button>
      </form>

      {languages === undefined && (
        <p className="text-sm text-text-muted">Loading your languages...</p>
      )}

      {languages?.length === 0 && (
        <p className="text-sm text-text-muted">
          No languages yet — name one above to generate your first phonology.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {languages?.map((lang) => (
          <li
            key={lang._id}
            className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 shadow-sm shadow-accent/5 transition-colors hover:border-accent/40 hover:bg-surface-hover"
          >
            <Link href={`/language/${lang._id}`} className="flex-1">
              <span className={`${inLivingColor.className} text-xl font-medium text-text`}>{lang.name}</span>
              <span className="ml-2 text-xs text-text-muted">
                {Object.values(lang.lockedStages).filter(Boolean).length} stage(s) locked
              </span>
            </Link>
            {confirmingId === lang._id ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingId(null);
                    remove({ id: lang._id });
                  }}
                  className="text-xs font-medium text-red-500 hover:text-red-400"
                >
                  Confirm delete?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="text-xs text-text-muted hover:text-text"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingId(lang._id)}
                className="text-xs text-text-muted hover:text-text"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
