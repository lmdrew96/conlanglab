"use client";

import { formatDomain, formatPartOfSpeech } from "@/lib/lexicon/format";
import { playRoot } from "@/lib/lexicon/audio";
import { SpeakerIcon } from "@/components/icons";
import type { FlexibleDomain, LexiconItemData } from "@/lib/lexicon/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

export function LivePreviewPanel({
  preview,
  isDirty,
  phonology,
}: {
  preview: LexiconItemData[];
  isDirty: boolean;
  phonology: PhonologyData;
}) {
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
              <span className="inline-flex items-center gap-1 font-mono text-text">
                <button
                  type="button"
                  onClick={() => playRoot(item.phonemeIds, phonology, item.stressedPhonemeIndex)}
                  title={`Play /${item.phonologicalForm}/`}
                  className="hover:text-accent"
                >
                  <SpeakerIcon className="h-3 w-3" />
                </button>
                {item.phonologicalForm}
              </span>
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
