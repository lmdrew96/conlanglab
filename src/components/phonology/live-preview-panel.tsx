"use client";

import { useMemo } from "react";
import { sampleClusters, sampleSyllables } from "@/lib/phonology/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

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
        <p className="font-mono text-lg text-text">{syllables.join("  ")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-xs text-text-muted">Onset clusters</span>
          <p className="font-mono text-text">{onsetClusters.join("  ")}</p>
        </div>
        <div>
          <span className="mb-1 block text-xs text-text-muted">Coda clusters</span>
          <p className="font-mono text-text">{codaClusters.join("  ")}</p>
        </div>
      </div>
    </div>
  );
}
