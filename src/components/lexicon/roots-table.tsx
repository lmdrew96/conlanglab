"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatPartOfSpeech } from "@/lib/lexicon/format";
import { playRoot } from "@/lib/lexicon/audio";
import { SpeakerIcon } from "@/components/icons";
import type { LexiconItemData, PartOfSpeech } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

type ItemRow = Doc<"lexiconItems">;

const KIND_LABELS: Record<LexiconItemData["kind"], string> = {
  core: "Core",
  flexible: "Flavor",
  compound: "Compound",
  derived: "Derived",
};

export function RootsTable({
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
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [posFilter, setPosFilter] = useState<PartOfSpeech | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleLock = useMutation(api.lexicon.mutations.toggleItemLock);
  const regenerateItem = useMutation(api.lexicon.mutations.regenerateItem);
  const regenerateStale = useMutation(api.lexicon.mutations.regenerateStale);

  const domains = useMemo(() => {
    const set = new Set(items.map((r) => (r.data as LexiconItemData).domain));
    return Array.from(set).sort();
  }, [items]);

  const meaningByConceptId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of items) {
      const data = row.data as LexiconItemData;
      map.set(data.id, data.meaning);
    }
    return map;
  }, [items]);

  const staleCount = useMemo(() => items.filter((r) => r.staleSince != null).length, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((r) => {
        const data = r.data as LexiconItemData;
        if (domainFilter !== "all" && data.domain !== domainFilter) return false;
        if (posFilter !== "all" && data.partOfSpeech !== posFilter) return false;
        if (q && !data.meaning.toLowerCase().includes(q) && !data.phonologicalForm.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (a.data as LexiconItemData).meaning.localeCompare((b.data as LexiconItemData).meaning));
  }, [items, search, domainFilter, posFilter]);

  async function handleRegenerate(conceptId: string, mode: "nudge" | "reroll") {
    setBusyId(conceptId);
    try {
      await regenerateItem({ languageId, conceptId, mode });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-muted">Roots ({items.length})</h3>
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
          onChange={(e) => setDomainFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
        >
          <option value="all">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value as PartOfSpeech | "all")}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
        >
          <option value="all">All parts of speech</option>
          {(["noun", "verb", "adjective", "adverb", "pronoun", "numeral", "function"] as PartOfSpeech[]).map((pos) => (
            <option key={pos} value={pos}>
              {formatPartOfSpeech(pos)}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[32rem] overflow-y-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">Form</th>
              <th className="px-2 py-1.5 font-medium">Meaning</th>
              <th className="px-2 py-1.5 font-medium">POS</th>
              <th className="px-2 py-1.5 font-medium">Kind</th>
              <th className="px-2 py-1.5 font-medium">Domain</th>
              <th className="px-2 py-1.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const data = row.data as LexiconItemData;
              const isBusy = busyId === data.id;
              return (
                <tr key={row._id} className="border-t border-border hover:bg-surface-hover">
                  <td className="px-2 py-1.5 font-mono text-text">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        disabled={row.staleSince != null}
                        onClick={() => playRoot(data.phonemeIds, phonology, data.stressedPhonemeIndex)}
                        title={row.staleSince != null ? "Regenerate to hear pronunciation" : `Play /${data.phonologicalForm}/`}
                        className="hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <SpeakerIcon className="h-3 w-3" />
                      </button>
                      {data.phonologicalForm}
                    </span>
                    {row.staleSince != null && (
                      <span className="ml-1.5 rounded bg-amber-500/20 px-1 text-[10px] text-amber-600">stale</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-text">
                    {data.meaning}
                    {data.derivedFrom && (
                      <span className="ml-1.5 text-[10px] text-text-muted">
                        (derived from &ldquo;{meaningByConceptId.get(data.derivedFrom.conceptId) ?? data.derivedFrom.conceptId}&rdquo;)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-text-muted">{formatPartOfSpeech(data.partOfSpeech)}</td>
                  <td className="px-2 py-1.5 text-text-muted">{KIND_LABELS[data.kind]}</td>
                  <td className="px-2 py-1.5 text-text-muted">{data.domain}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-2 text-xs">
                      {data.kind === "derived" ? (
                        <span className="text-text-muted" title="Derived items regenerate with the whole Lexicon stage, not individually">
                          Word family
                        </span>
                      ) : (
                        <>
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
                        </>
                      )}
                      <button
                        type="button"
                        disabled={stageLocked}
                        onClick={() => toggleLock({ languageId, conceptId: data.id, locked: !row.locked })}
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
        {filtered.length === 0 && <p className="p-3 text-xs text-text-muted">No roots match this filter.</p>}
      </div>
    </div>
  );
}
