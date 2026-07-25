import { diffAtomic, diffKeyedArray, type DiffOp } from "../lib/history";
import type { CategoryId, DerivationalAffixData, MorphologyAffixData, MorphologyParams, Seed, SuppletionData } from "./types";

/**
 * Flat shape history actually diffs/reconstructs — same rationale as
 * LexiconSnapshot (convex/lexicon/diff.ts). `affixCount`/`generatedAt`
 * aren't included: display metadata on the live stage doc, always
 * recomputable from `items.length` / the commit time. `allomorphy` is
 * likewise excluded — it's a pure, deterministic function of phonology
 * (buildAllomorphy), not an independently-generated/lockable artifact, so
 * it's always recomputable rather than needing history tracking.
 * `suppletion`/`derivationalAffixes` ARE tracked here (unlike allomorphy)
 * since both carry their own seeds and lock state, same as `items`.
 */
export interface MorphologySnapshot {
  items: MorphologyAffixData[];
  params: MorphologyParams;
  seed: Seed;
  selectedCategories: CategoryId[];
  suppletion: SuppletionData[];
  derivationalAffixes: DerivationalAffixData[];
}

/** Diffs the full collection as one unit — same shape as diffLexicon. */
export function diffMorphology(prev: MorphologySnapshot, next: MorphologySnapshot): DiffOp[] {
  return [
    ...diffKeyedArray(prev.items, next.items, "items"),
    ...diffAtomic(prev.params, next.params, "params"),
    ...diffAtomic(prev.seed, next.seed, "seed"),
    ...diffAtomic(prev.selectedCategories, next.selectedCategories, "selectedCategories"),
    ...diffKeyedArray(prev.suppletion, next.suppletion, "suppletion"),
    ...diffKeyedArray(prev.derivationalAffixes, next.derivationalAffixes, "derivationalAffixes"),
  ];
}
