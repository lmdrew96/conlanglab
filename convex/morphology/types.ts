// Zero Convex imports — this file (and content.ts, generate.ts, diff.ts) must
// stay importable from the browser for live preview (design doc Section
// 13.5), same rule as convex/phonology/* and convex/lexicon/*. Only
// mutations.ts, queries.ts, and staleness.ts touch Convex runtime machinery.

export interface Seed {
  /** Rotates only on reroll (fresh entropy at commit time). */
  base: number;
  /** Advances on each nudge commit against the same base; resets to 0 on reroll. */
  variation: number;
}

export type MorphologicalType = "isolating" | "agglutinative" | "fusional" | "polysynthetic";

export const MORPHOLOGICAL_TYPES: MorphologicalType[] = [
  "isolating",
  "agglutinative",
  "fusional",
  "polysynthetic",
];

export type GrammaticalDomain = "nominal" | "verbal";

/** Section 5.3's category coverage — nominal + verbal, plus agreement. */
export type CategoryId =
  | "case"
  | "number"
  | "genderClass"
  | "definiteness"
  | "possession"
  | "tense"
  | "aspect"
  | "mood"
  | "evidentiality"
  | "polarity"
  | "voice"
  | "agreement";

export interface CategoryValue {
  id: string;
  /** Standard Leipzig-glossing abbreviation (e.g. "PL", "PST", "3SG.POSS") — technical, terse, meant for the affix table's secondary tag and future academic export (Section 11), not as primary UI text. */
  gloss: string;
  /** Plain-English label (e.g. "Plural", "Past", "Their") — this is what the UI shows by default. */
  label: string;
  /** The typologically-unmarked baseline (e.g. singular, present, active) — never gets a generated affix. */
  zeroMarked?: boolean;
}

export interface CategoryDef {
  id: CategoryId;
  domain: GrammaticalDomain;
  label: string;
  values: CategoryValue[];
  /** Cross-linguistic commonness — base weight for inclusion sampling (Section 5.3's "plausible subset"). */
  baseInclusionWeight: number;
}

export type AffixSlot = "prefix" | "suffix";

export interface MorphologyParams {
  typology: MorphologicalType;
}

export const DEFAULT_MORPHOLOGY_PARAMS: MorphologyParams = { typology: "agglutinative" };

export interface MorphologyStageData {
  version: 1;
  seed: Seed;
  params: MorphologyParams;
  selectedCategories: CategoryId[];
  affixCount: number;
  generatedAt: number;
}

/** One value a fused or standalone affix realizes, tagged with its source category. */
export interface AffixValueRef {
  category: CategoryId;
  value: string;
}

/**
 * One generated affix. `id` is the stable key for locking/diffing/history
 * (same contract as LexiconItemData.id) — it encodes exactly which
 * category/value combination this affix realizes (see `cellId` in
 * generate.ts), so item-level regeneration can change its phonological
 * form without disturbing its grammatical identity.
 */
export interface MorphologyAffixData {
  version: 1;
  id: string;
  slot: AffixSlot;
  domain: GrammaticalDomain;
  /** 1 for a standalone affix; 2-3 for a fusional bundle cell (fusional typology only). */
  categories: CategoryId[];
  values: AffixValueRef[];
  gloss: string;
  /** Raw IPA — no hyphen; the display layer adds it based on `slot`. */
  form: string;
  /** Flat list of phoneme catalog ids used to build this affix — lets an upstream phonology edit that removes a phoneme flag exactly the affixes that used it (Section 10.2a), same contract as LexiconItemData.phonemeIds. */
  phonemeIds: string[];
  seed: Seed;
  locked: boolean;
}

export type MorphologyTarget = "unlocked";
