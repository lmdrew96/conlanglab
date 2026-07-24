import { diffAtomic, diffKeyedArray, type DiffOp } from "../lib/history";
import type { LexiconItemData, LexiconParams, Seed } from "./types";

/**
 * Flat shape history actually diffs/reconstructs — `applyDiff` writes ops
 * back onto top-level fields, so this stays flat rather than mirroring the
 * nested `{stage, items}` split used elsewhere. `itemCount`/`generatedAt`
 * aren't included: they're display metadata on the live stage doc, always
 * recomputable from `items.length` / the commit time, not worth diffing.
 */
export interface LexiconSnapshot {
  items: LexiconItemData[];
  params: LexiconParams;
  seed: Seed;
}

/**
 * Diffs the full collection (stage params/seed + every root/compound) as one
 * unit, same shape as diffPhonology — history for lexicon operates on the
 * collection level even though live reads/writes go through the per-item
 * `lexiconItems` table (Section 10.1's item table split is about targeted
 * writes, not about how history is diffed).
 */
export function diffLexicon(prev: LexiconSnapshot, next: LexiconSnapshot): DiffOp[] {
  return [
    ...diffKeyedArray(prev.items, next.items, "items"),
    ...diffAtomic(prev.params, next.params, "params"),
    ...diffAtomic(prev.seed, next.seed, "seed"),
  ];
}
