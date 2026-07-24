"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const TRIGGER_LABELS: Record<string, string> = {
  nudge: "Nudge",
  reroll: "Reroll",
  edit: "Edit",
};

export function HistorySidebar({ languageId, stageLocked }: { languageId: Id<"languages">; stageLocked: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const history = useQuery(api.lexicon.queries.historyList, isAuthenticated ? { languageId } : "skip");
  const revert = useMutation(api.lexicon.mutations.revertToHistoryEntry);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-muted">History</h3>
      {history === undefined && <p className="text-xs text-text-muted">Loading...</p>}
      {history?.length === 0 && <p className="text-xs text-text-muted">No changes yet.</p>}
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {history?.map((entry) => (
          <li
            key={entry._id}
            className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-surface-hover"
          >
            <span className="text-text-muted">
              #{entry.seq} — {TRIGGER_LABELS[entry.trigger] ?? entry.trigger}
              {entry.kind === "snapshot" && <span className="ml-1 text-accent">(snapshot)</span>}
              <br />
              {new Date(entry.createdAt).toLocaleString()}
            </span>
            <button
              type="button"
              disabled={stageLocked}
              onClick={() => revert({ languageId, historyEntryId: entry._id })}
              className="text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Revert
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
