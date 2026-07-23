"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_TARGETS, DEFAULT_PARAMS, generatePhonology } from "./engine";
import type { PhonologyData, PhonologyParams } from "./engine";

const DEBOUNCE_MS = 120;

/**
 * Draft parameter state for the phonology wizard step, plus a debounced,
 * client-side-only preview. The preview stays pinned to the committed
 * document's base seed — only an explicit Nudge/Reroll commit ever advances
 * the real stored seed (Section 13.5) — so dragging a slider evolves the
 * preview smoothly instead of flickering between unrelated random draws.
 */
export function usePhonologyDraft(committed: PhonologyData | null | undefined) {
  const [draftParams, setDraftParams] = useState<PhonologyParams>(committed?.params ?? DEFAULT_PARAMS);
  const [debouncedParams, setDebouncedParams] = useState<PhonologyParams>(draftParams);

  // `committed` starts undefined (query still loading) and later resolves.
  // Sync draftParams from it exactly once, the first time real data shows
  // up — not on every subsequent params change, which would fight the
  // user's in-progress slider edits. This adjusts state during render
  // (React's documented pattern for deriving state from a prop transition)
  // rather than in an effect, comparing against tracked state rather than a
  // ref since ref reads aren't allowed during render.
  const [hasLoadedCommitted, setHasLoadedCommitted] = useState(committed != null);
  if (committed && !hasLoadedCommitted) {
    setHasLoadedCommitted(true);
    setDraftParams(committed.params);
  }

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedParams(draftParams), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draftParams]);

  const preview = useMemo<PhonologyData | null>(() => {
    if (!committed) return null;
    return generatePhonology({
      seed: committed.seed,
      params: debouncedParams,
      previous: committed,
      targets: ALL_TARGETS,
      mode: "reroll",
      now: committed.generatedAt,
    });
  }, [committed, debouncedParams]);

  const isDirty = committed != null && JSON.stringify(draftParams) !== JSON.stringify(committed.params);

  return { draftParams, setDraftParams, preview, isDirty };
}
