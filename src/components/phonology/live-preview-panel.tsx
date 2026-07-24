"use client";

import { useMemo } from "react";
import { sampleClusters, sampleSyllables } from "@/lib/phonology/engine";
import type { ConsonantPhoneme, PhonologyData, SampledUnit } from "@/lib/phonology/engine";
import { playCluster, playSequence } from "@/lib/phonology/audio";

function PlayableUnit({ unit, kind }: { unit: SampledUnit; kind: "syllable" | "onset" | "coda" }) {
  const onClick =
    kind === "syllable"
      ? () => playSequence(unit.phonemes)
      // Cluster units never contain a vowel (see sampleClusters) — safe to narrow.
      : () => playCluster(unit.phonemes as ConsonantPhoneme[], kind);
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Play /${unit.ipa}/`}
      className="rounded px-1 font-mono hover:bg-surface-hover hover:text-accent"
    >
      {unit.ipa}
    </button>
  );
}

export function LivePreviewPanel({ preview, isDirty }: { preview: PhonologyData | null; isDirty: boolean }) {
  const syllables = useMemo(() => (preview ? sampleSyllables(preview, 10) : []), [preview]);
  const onsetClusters = useMemo(() => (preview ? sampleClusters(preview, 6, "onset") : []), [preview]);
  const codaClusters = useMemo(() => (preview ? sampleClusters(preview, 6, "coda") : []), [preview]);

  if (!preview) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
        Generate an initial phonology to see a live preview.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-muted">Live preview</h3>
        {isDirty && <span className="text-xs text-accent">Unsaved parameter changes</span>}
      </div>
      <div>
        <span className="mb-1 block text-xs text-text-muted">Example syllables</span>
        <p className="flex flex-wrap items-center gap-x-1 text-lg text-text">
          {syllables.map((s, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && (
                <span className="mx-1 text-text-muted" aria-hidden>
                  ·
                </span>
              )}
              <PlayableUnit unit={s} kind="syllable" />
            </span>
          ))}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs text-text-muted">Onset clusters</span>
          <p className="flex flex-wrap items-center gap-x-1 text-text">
            {onsetClusters.length > 0 ? (
              onsetClusters.map((c, i) => (
                <span key={i} className="flex items-center">
                  {i > 0 && (
                    <span className="mx-1 text-text-muted" aria-hidden>
                      ·
                    </span>
                  )}
                  <PlayableUnit unit={c} kind="onset" />
                </span>
              ))
            ) : (
              <span className="text-text-muted">None at this complexity</span>
            )}
          </p>
        </div>
        <div>
          <span className="mb-1 block text-xs text-text-muted">Coda clusters</span>
          <p className="flex flex-wrap items-center gap-x-1 text-text">
            {codaClusters.length > 0 ? (
              codaClusters.map((c, i) => (
                <span key={i} className="flex items-center">
                  {i > 0 && (
                    <span className="mx-1 text-text-muted" aria-hidden>
                      ·
                    </span>
                  )}
                  <PlayableUnit unit={c} kind="coda" />
                </span>
              ))
            ) : (
              <span className="text-text-muted">None at this complexity</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
