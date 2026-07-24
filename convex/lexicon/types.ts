// Zero Convex imports — this file (and content.ts, generate.ts, diff.ts) must
// stay importable from the browser for live preview (design doc Section
// 13.5), same rule as convex/phonology/*. Only mutations.ts, queries.ts, and
// staleness.ts touch Convex runtime machinery.

export interface Seed {
  /** Rotates only on reroll (fresh entropy at commit time). */
  base: number;
  /** Advances on each nudge commit against the same base; resets to 0 on reroll. */
  variation: number;
}

export type PartOfSpeech = "noun" | "verb" | "adjective" | "adverb" | "pronoun" | "numeral" | "function";

/**
 * Culture-flavor domains a user can weight to bias the ~50 non-core root
 * slots (Section 6.2) — nautical vocabulary for a seafaring people,
 * agricultural for farmers, etc. Distinct from the always-included core
 * list (Swadesh-extended + emotions/abstract/social/tech/objects), which
 * needs no weighting to produce a complete baseline lexicon.
 */
export type FlexibleDomain = "nautical" | "agricultural" | "martial" | "mercantile" | "pastoral" | "craft";

export const FLEXIBLE_DOMAINS: FlexibleDomain[] = [
  "nautical",
  "agricultural",
  "martial",
  "mercantile",
  "pastoral",
  "craft",
];

export type ConceptKind = "core" | "flexible" | "compound";

export interface CoreConcept {
  id: string;
  gloss: string;
  pos: PartOfSpeech;
  category: string;
}

export interface FlexibleConcept {
  id: string;
  gloss: string;
  pos: PartOfSpeech;
  domain: FlexibleDomain;
}

/** A non-literal/idiomatic formation (Section 6.3) — components reference other concept ids by their generated roots. */
export interface CompoundConcept {
  id: string;
  gloss: string;
  pos: PartOfSpeech;
  components: [string, string];
}

export interface LexiconParams {
  /** 0..1 per flexible domain — biases which domains the ~50 non-core slots are drawn from. Default: uniform (no flavor yet). */
  domainWeights: Record<FlexibleDomain, number>;
}

export const DEFAULT_LEXICON_PARAMS: LexiconParams = {
  domainWeights: {
    nautical: 0.5,
    agricultural: 0.5,
    martial: 0.5,
    mercantile: 0.5,
    pastoral: 0.5,
    craft: 0.5,
  },
};

/** Total root budget for a "complete" v1 lexicon (design doc Section 6.1). Not user-adjustable — a fixed engine target. */
export const ROOT_TARGET = 500;

export interface LexiconStageData {
  version: 1;
  seed: Seed;
  params: LexiconParams;
  itemCount: number;
  generatedAt: number;
}

/**
 * One generated root or compound. `id` mirrors the source concept's id and
 * is the stable key for locking/diffing/history (same contract as
 * Phoneme.id in phonology/types.ts).
 */
export interface LexiconItemData {
  version: 1;
  id: string;
  kind: ConceptKind;
  domain: string;
  partOfSpeech: PartOfSpeech;
  meaning: string;
  /** Syllable-boundary-joined IPA with a primary-stress mark, e.g. "ˈta.mo". */
  phonologicalForm: string;
  /** Flat list of phoneme catalog ids used to build this root — lets an upstream phonology edit that removes a phoneme flag exactly the roots that used it (Section 10.2a). */
  phonemeIds: string[];
  /** For compounds only: the two component concept ids whose roots were combined. */
  componentIds?: [string, string];
  seed: Seed;
  locked: boolean;
}

export type LexiconTarget = "unlocked";
