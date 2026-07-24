"use client";

import { formatDomain, formatPartOfSpeech } from "@/lib/lexicon/format";
import type { FlexibleDomain, LexiconItemData } from "@/lib/lexicon/engine";

export function LivePreviewPanel({ preview, isDirty }: { preview: LexiconItemData[]; isDirty: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-muted">Live preview</h3>
        {isDirty && <span className="text-xs text-accent">Unsaved slider changes — commit to apply</span>}
      </div>
      {preview.length === 0 ? (
        <p className="text-xs text-text-muted">No flavor domains weighted above zero yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {preview.map((item) => (
            <li key={item.id} className="flex flex-col text-sm">
              <span className="font-mono text-text">{item.phonologicalForm}</span>
              <span className="text-xs text-text-muted">
                {formatPartOfSpeech(item.partOfSpeech)} {item.meaning} ·{" "}
                <span className="italic">{formatDomain(item.domain as FlexibleDomain)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
