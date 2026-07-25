"use client";

import { useMemo, useState } from "react";
import { DEFAULT_SYNTAX_PARAMS, WORD_ORDERS, generateWordOrderPreview } from "./engine";
import type { SyntaxParams, WordOrder, WordOrderPreviewExample } from "./engine";
import type { LexiconItemData } from "@/lib/lexicon/engine";
import type { AllomorphyData, MorphologyAffixData } from "@/lib/morphology/engine";
import type { PhonologyData } from "@/lib/phonology/engine";

/**
 * Draft word-order state plus a live 6-way preview (Section 7.1/9.5) — a
 * discrete picker, no debounce needed, mirrors useMorphologyDraft's
 * "sync draft from committed during render" pattern. Unlike Morphology's
 * typology preview (which has to synthesize throwaway data because
 * Morphology doesn't exist yet at that point), Syntax's precondition is
 * that Lexicon + Morphology already exist — so every preview here runs
 * against real committed data.
 */
export function useSyntaxDraft(
  committedParams: SyntaxParams | null | undefined,
  lexiconItems: LexiconItemData[],
  morphologyItems: MorphologyAffixData[],
  phonology: PhonologyData | null,
  allomorphy: AllomorphyData | null,
  seedBase: number,
) {
  const [draftWordOrder, setDraftWordOrder] = useState<WordOrder>(
    committedParams?.wordOrder ?? DEFAULT_SYNTAX_PARAMS.wordOrder,
  );

  const [hasLoadedCommitted, setHasLoadedCommitted] = useState(committedParams != null);
  if (committedParams && !hasLoadedCommitted) {
    setHasLoadedCommitted(true);
    setDraftWordOrder(committedParams.wordOrder);
  }

  const previews = useMemo<WordOrderPreviewExample[]>(() => {
    if (!phonology || !allomorphy) return [];
    return WORD_ORDERS.map((order) =>
      generateWordOrderPreview(order, seedBase, lexiconItems, morphologyItems, phonology, allomorphy),
    );
  }, [phonology, allomorphy, lexiconItems, morphologyItems, seedBase]);

  const isDirty = committedParams != null && draftWordOrder !== committedParams.wordOrder;

  return { draftWordOrder, setDraftWordOrder, previews, isDirty };
}
