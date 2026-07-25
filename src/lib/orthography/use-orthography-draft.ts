"use client";

import { useMemo, useState } from "react";
import { DEFAULT_ORTHOGRAPHY_PARAMS, sampleGlyphs } from "./engine";
import type { Glyph, OrthographyParams } from "./engine";
import type { PhonologyData } from "@/lib/phonology/engine";

/**
 * Draft (scriptCategory, aesthetic) state plus a live sample-glyph preview.
 * Both params are discrete/categorical (a 5-way and a 2-way pick) — like
 * Syntax's word order or Morphology's typology, not Phonology's continuous
 * sliders — so this follows the no-debounce, useMemo-computed-preview
 * pattern (see src/lib/syntax/use-syntax-draft.ts), not Phonology's
 * debounced one.
 */
export function useOrthographyDraft(committedParams: OrthographyParams | null | undefined, phonology: PhonologyData | null, seedBase: number) {
  const [draftParams, setDraftParams] = useState<OrthographyParams>(committedParams ?? DEFAULT_ORTHOGRAPHY_PARAMS);

  const [hasLoadedCommitted, setHasLoadedCommitted] = useState(committedParams != null);
  if (committedParams && !hasLoadedCommitted) {
    setHasLoadedCommitted(true);
    setDraftParams(committedParams);
  }

  const preview = useMemo<Glyph[]>(() => {
    if (!phonology) return [];
    return sampleGlyphs(draftParams, phonology, seedBase);
  }, [draftParams, phonology, seedBase]);

  const isDirty = committedParams != null && JSON.stringify(draftParams) !== JSON.stringify(committedParams);

  return { draftParams, setDraftParams, preview, isDirty };
}
