"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatAffixForm, formatCategoryList, formatDomain, formatHumanGloss } from "@/lib/morphology/format";
import { playAffix } from "@/lib/morphology/audio";
import type { GrammaticalDomain, MorphologyAffixData } from "@/lib/morphology/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

type ItemRow = Doc<"morphologyItems">;

export function AffixTable({
  languageId,
  items,
  stageLocked,
  phonology,
}: {
  languageId: Id<"languages">;
  items: ItemRow[];
  stageLocked: boolean;
  phonology: PhonologyData;
}) {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<GrammaticalDomain | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleLock = useMutation(api.morphology.mutations.toggleItemLock);
  const regenerateItem = useMutation(api.morphology.mutations.regenerateItem);
  const regenerateStale = useMutation(api.morphology.mutations.regenerateStale);

  const staleCount = useMemo(() => items.filter((r) => r.staleSince != null).length, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((r) => {
        const data = r.data as MorphologyAffixData;
        if (domainFilter !== "all" && data.domain !== domainFilter) return false;
        const meaning = formatHumanGloss(data.values).toLowerCase();
        if (q && !meaning.includes(q) && !data.gloss.toLowerCase().includes(q) && !data.form.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) =>
        formatHumanGloss((a.data as MorphologyAffixData).values).localeCompare(
          formatHumanGloss((b.data as MorphologyAffixData).values),
        ),
      );
  }, [items, search, domainFilter]);

  async function handleRegenerate(affixId: string, mode: "nudge" | "reroll") {
    setBusyId(affixId);
    try {
      await regenerateItem({ languageId, affixId, mode });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-muted">Affixes ({items.length})</h3>
        {staleCount > 0 && (
          <button
            type="button"
            disabled={stageLocked}
            onClick={() => regenerateStale({ languageId })}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text hover:bg-surface-hover disabled:opacity-50"
          >
            {staleCount} stale — regenerate
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search meaning or form..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-40 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted"
        />
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value as GrammaticalDomain | "all")}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
        >
          <option value="all">All domains</option>
          <option value="nominal">Nominal</option>
          <option value="verbal">Verbal</option>
        </select>
      </div>

      <div className="max-h-[32rem] overflow-y-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">Form</th>
              <th className="px-2 py-1.5 font-medium">Meaning</th>
              <th className="px-2 py-1.5 font-medium">Category</th>
              <th className="px-2 py-1.5 font-medium">Domain</th>
              <th className="px-2 py-1.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const data = row.data as MorphologyAffixData;
              const isBusy = busyId === data.id;
              return (
                <tr key={row._id} className="border-t border-border hover:bg-surface-hover">
                  <td className="px-2 py-1.5 font-mono text-text">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={row.staleSince != null}
                        onClick={() => playAffix(data.phonemeIds, phonology)}
                        title={row.staleSince != null ? "Regenerate to hear pronunciation" : `Play /${data.form}/`}
                        className="hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <span aria-hidden>🔊</span>
                      </button>
                      {formatAffixForm(data)}
                    </span>
                    {row.staleSince != null && (
                      <span className="ml-1.5 rounded bg-amber-500/20 px-1 text-[10px] text-amber-600">stale</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-text">
                    {formatHumanGloss(data.values)}{" "}
                    <span className="text-[10px] text-text-muted">({data.gloss})</span>
                  </td>
                  <td className="px-2 py-1.5 text-text-muted">{formatCategoryList(data.categories)}</td>
                  <td className="px-2 py-1.5 text-text-muted">{formatDomain(data.domain)}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-2 text-xs">
                      <button
                        type="button"
                        disabled={stageLocked || row.locked || isBusy}
                        onClick={() => handleRegenerate(data.id, "nudge")}
                        className="text-text-muted hover:text-text disabled:opacity-40"
                      >
                        Nudge
                      </button>
                      <button
                        type="button"
                        disabled={stageLocked || row.locked || isBusy}
                        onClick={() => handleRegenerate(data.id, "reroll")}
                        className="text-text-muted hover:text-text disabled:opacity-40"
                      >
                        Reroll
                      </button>
                      <button
                        type="button"
                        disabled={stageLocked}
                        onClick={() => toggleLock({ languageId, affixId: data.id, locked: !row.locked })}
                        className="text-accent hover:underline disabled:opacity-40"
                      >
                        {row.locked ? "Unlock" : "Lock"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-3 text-xs text-text-muted">No affixes match this filter.</p>}
      </div>
    </div>
  );
}
