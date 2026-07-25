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

export type ConceptKind = "core" | "flexible" | "compound" | "derived";

/**
 * Zipf's Law of Abbreviation tier (design doc: Frequency-weighted root
 * complexity) — biases syllable count and cluster likelihood so high-use
 * words (pronouns, core verbs) skew short/simple relative to rare/domain
 * vocabulary. A = ultra-core (1 syllable, no clusters) through D = domain/rare
 * (current unrestricted range). Only `CoreConcept` carries this — flexible
 * and compound concepts are always treated as Tier D (see generate.ts).
 */
export type FrequencyTier = "A" | "B" | "C" | "D";

export interface CoreConcept {
  id: string;
  gloss: string;
  pos: PartOfSpeech;
  category: string;
  frequencyTier: FrequencyTier;
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
  /** Index into `phonemeIds` of the primary-stressed vowel (matches the ˈ mark in `phonologicalForm`) — undefined when the phonology's stress pattern is "none", or for roots generated before this field existed (audio playback falls back to uniform, unstressed timing in that case). */
  stressedPhonemeIndex?: number;
  /** For compounds only: the two component concept ids whose roots were combined. */
  componentIds?: [string, string];
  /**
   * For derived items only (Section 5.5) — the source root + derivational
   * rule this word family member came from. `sourceSeed`/`affixSeed` are
   * the source root's and derivational affix's seeds AT THE TIME this item
   * was built — a staleness check (see lexicon/staleness.ts) compares them
   * against the source's current seed to detect "the root regenerated to a
   * new form but this derived item didn't rebuild," the same
   * seed-changed-means-content-changed idiom used everywhere else in this
   * codebase, rather than a new dependency-tracking mechanism.
   */
  derivedFrom?: { conceptId: string; ruleId: string; sourceSeed: Seed; affixSeed: Seed };
  seed: Seed;
  locked: boolean;
}

export type LexiconTarget = "unlocked";
