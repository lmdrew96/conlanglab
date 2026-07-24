"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_LEXICON_PARAMS, samplePreviewRoots } from "./engine";
import type { LexiconItemData, LexiconParams } from "./engine";
import type { PhonologyData } from "@/lib/phonology/engine";

const DEBOUNCE_MS = 150;
const PREVIEW_COUNT = 10;

/**
 * Draft domain-weight state plus a debounced, client-side-only live
 * preview (Section 9.5: "preview example roots/words as domain-weighting
 * sliders shift"). Mirrors usePhonologyDraft's shape and rationale — see
 * that file for why draft state is synced from `committed` during render
 * rather than in an effect.
 */
export function useLexiconDraft(
  committedParams: LexiconParams | null | undefined,
  phonology: PhonologyData | null,
  seedBase: number,
) {
  const [draftWeights, setDraftWeights] = useState<LexiconParams>(committedParams ?? DEFAULT_LEXICON_PARAMS);
  const [debouncedWeights, setDebouncedWeights] = useState<LexiconParams>(draftWeights);

  const [hasLoadedCommitted, setHasLoadedCommitted] = useState(committedParams != null);
  if (committedParams && !hasLoadedCommitted) {
    setHasLoadedCommitted(true);
    setDraftWeights(committedParams);
  }

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedWeights(draftWeights), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [draftWeights]);

  const preview = useMemo<LexiconItemData[]>(() => {
    if (!phonology) return [];
    return samplePreviewRoots(phonology, debouncedWeights, seedBase, PREVIEW_COUNT);
  }, [phonology, debouncedWeights, seedBase]);

  const isDirty = committedParams != null && JSON.stringify(draftWeights) !== JSON.stringify(committedParams);

  return { draftWeights, setDraftWeights, preview, isDirty };
}
