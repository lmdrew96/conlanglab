"use client";

import { useMemo, useState } from "react";
import { DEFAULT_MORPHOLOGY_PARAMS, MORPHOLOGICAL_TYPES, generateTypologyPreview } from "./engine";
import type { MorphologicalType, MorphologyParams, TypologyPreviewExample } from "./engine";
import type { PhonologyData } from "@/lib/phonology/engine";

/**
 * Draft typology state plus a live 4-way preview (Section 5.1/9.5). Unlike
 * useLexiconDraft's continuous domain-weight sliders, the typology picker
 * is a discrete 4-option choice — no debounce needed, all 4 previews are
 * cheap pure computations shown side-by-side up front. Mirrors
 * useLexiconDraft's "sync draft from committed during render" pattern.
 */
export function useMorphologyDraft(
  committedParams: MorphologyParams | null | undefined,
  phonology: PhonologyData | null,
  seedBase: number,
) {
  const [draftTypology, setDraftTypology] = useState<MorphologicalType>(
    committedParams?.typology ?? DEFAULT_MORPHOLOGY_PARAMS.typology,
  );

  const [hasLoadedCommitted, setHasLoadedCommitted] = useState(committedParams != null);
  if (committedParams && !hasLoadedCommitted) {
    setHasLoadedCommitted(true);
    setDraftTypology(committedParams.typology);
  }

  const previews = useMemo<TypologyPreviewExample[]>(() => {
    if (!phonology) return [];
    return MORPHOLOGICAL_TYPES.map((typology) => generateTypologyPreview(phonology, typology, seedBase));
  }, [phonology, seedBase]);

  const isDirty = committedParams != null && draftTypology !== committedParams.typology;

  return { draftTypology, setDraftTypology, previews, isDirty };
}
