"use client";

import { useMemo, useState } from "react";
import { ALL_TARGETS, DEFAULT_PARAMS, freshSeed, generatePhonology } from "@/lib/phonology/engine";
import type { PhonologyData } from "@/lib/phonology/engine";
import { LivePreviewPanel } from "@/components/phonology/live-preview-panel";

/**
 * Signed-out landing page teaser: a real phonology inventory generated and
 * played entirely client-side (see src/lib/phonology/engine.ts's re-export
 * barrel — zero Convex imports, nothing persisted, no auth required).
 */
export function LandingDemo() {
  const [seed, setSeed] = useState(() => freshSeed());

  const preview = useMemo<PhonologyData>(
    () =>
      generatePhonology({
        seed: { base: seed, variation: 0 },
        params: DEFAULT_PARAMS,
        previous: null,
        targets: ALL_TARGETS,
        mode: "initial",
        now: Date.now(),
      }),
    [seed],
  );

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <LivePreviewPanel preview={preview} isDirty={false} />
      <button
        type="button"
        onClick={() => setSeed(freshSeed())}
        className="self-center rounded-md border border-border px-3 py-1.5 text-sm text-text shadow-sm shadow-accent/5 hover:bg-surface-hover"
      >
        Generate another
      </button>
    </div>
  );
}
