import { diffAtomic, diffKeyedArray, type DiffOp } from "../lib/history";
import type { CategoryId, MorphologyAffixData, MorphologyParams, Seed } from "./types";

/**
 * Flat shape history actually diffs/reconstructs — same rationale as
 * LexiconSnapshot (convex/lexicon/diff.ts). `affixCount`/`generatedAt`
 * aren't included: display metadata on the live stage doc, always
 * recomputable from `items.length` / the commit time.
 */
export interface MorphologySnapshot {
  items: MorphologyAffixData[];
  params: MorphologyParams;
  seed: Seed;
  selectedCategories: CategoryId[];
}

/** Diffs the full collection as one unit — same shape as diffLexicon. */
export function diffMorphology(prev: MorphologySnapshot, next: MorphologySnapshot): DiffOp[] {
  return [
    ...diffKeyedArray(prev.items, next.items, "items"),
    ...diffAtomic(prev.params, next.params, "params"),
    ...diffAtomic(prev.seed, next.seed, "seed"),
    ...diffAtomic(prev.selectedCategories, next.selectedCategories, "selectedCategories"),
  ];
}
