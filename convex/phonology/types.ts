// Zero Convex imports — this file (and content.ts, sonority.ts, generate.ts,
// nudge.ts, diff.ts) must stay importable from the browser for live preview
// (design doc Section 13.5). Only mutations.ts and queries.ts touch Convex
// runtime machinery.

export interface Seed {
  /** Rotates only on reroll (fresh entropy at commit time). */
  base: number;
  /** Advances on each nudge commit against the same base; resets to 0 on reroll. */
  variation: number;
}

export type PhonemeTier = "core" | "common" | "marked";

export type ConsonantPlace =
  | "bilabial"
  | "labiodental"
  | "dental"
  | "alveolar"
  | "postalveolar"
  | "retroflex"
  | "palatal"
  | "velar"
  | "uvular"
  | "pharyngeal"
  | "glottal";

export type ConsonantManner =
  | "stop"
  | "nasal"
  | "fricative"
  | "affricate"
  | "approximant"
  | "lateralApproximant"
  | "trill"
  | "tap"
  | "lateralFricative"
  | "click"
  | "ejective"
  | "implosive";

export interface ConsonantFeatures {
  place: ConsonantPlace;
  manner: ConsonantManner;
  voiced: boolean;
  secondary?: "labialized" | "palatalized" | "velarized" | "aspirated" | "glottalized";
}

export type VowelHeight = "high" | "nearHigh" | "mid" | "nearLow" | "low";
export type VowelBackness = "front" | "central" | "back";

export interface VowelFeatures {
  height: VowelHeight;
  backness: VowelBackness;
  rounded: boolean;
}

/**
 * Stable catalog slug (e.g. "p", "th_voiced") — never regenerated per-run.
 * Locking/diffing key on `id`, so a phoneme must keep the same id every time
 * it's selected or a reroll of the rest of the inventory would silently
 * orphan its lock.
 */
export interface Phoneme<F> {
  id: string;
  ipa: string;
  features: F;
  tier: PhonemeTier;
  /** Catalog ids that must already be selected for this phoneme to be eligible. */
  prerequisites: string[];
  locked: boolean;
}

export type ConsonantPhoneme = Phoneme<ConsonantFeatures>;
export type VowelPhoneme = Phoneme<VowelFeatures>;

export type WordPosition = "initial" | "medial" | "final";

export interface ClusterRule {
  maxSize: number;
  allowedManners: ConsonantManner[];
}

export interface SyllableTemplate {
  shape: ("C" | "V")[];
}

export interface PhonotacticsData {
  templates: SyllableTemplate[];
  onsetClusters: ClusterRule;
  codaClusters: ClusterRule;
  positionRules: {
    wordInitial: { codaAllowed: boolean; onsetClusterMax: number };
    wordMedial: { codaAllowed: boolean; onsetClusterMax: number; codaClusterMax: number };
    wordFinal: { codaAllowed: boolean; codaClusterMax: number };
  };
  locked: boolean;
}

/** Canonical Sonority Sequencing Principle scale — higher rank = more sonorous. */
export type SonorityScale = Record<ConsonantManner, number>;

export interface SonorityGradingData {
  scaleRank: SonorityScale;
  allowViolations: boolean;
  violationRate: number; // 0..1, meaningful only if allowViolations
  locked: boolean;
}

export type StressPattern = "initial" | "final" | "penultimate" | "weightSensitive" | "none";

export interface StressData {
  pattern: StressPattern;
  locked: boolean;
}

export interface ToneData {
  enabled: boolean;
  levels: number; // 2-5 contrastive levels, meaningful only if enabled
  contours: boolean;
  locked: boolean;
}

export type InventorySize = "small" | "medium" | "large";

export interface PhonologyParams {
  consonantInventorySize: InventorySize;
  vowelInventorySize: InventorySize;
  markedFeatures: {
    ejectives: boolean;
    clicks: boolean;
    frontRoundedVowels: boolean;
    implosives: boolean;
  };
  typologicalStrictness: number; // 0..1 — higher = stricter adherence to implicational order
  clusterComplexity: number; // 0..1 — feeds onset/coda max cluster size
  sonorityViolationRate: number; // 0..1 — mirrors SonorityGradingData.violationRate
}

export interface PhonologyData {
  version: 1;
  seed: Seed;
  params: PhonologyParams;
  consonants: ConsonantPhoneme[];
  vowels: VowelPhoneme[];
  phonotactics: PhonotacticsData;
  sonorityGrading: SonorityGradingData;
  stress: StressData;
  tone: ToneData;
  generatedAt: number;
}

export type PhonologyTarget = "inventory" | "phonotactics" | "sonorityGrading" | "stress" | "tone";

export const ALL_TARGETS: PhonologyTarget[] = [
  "inventory",
  "phonotactics",
  "sonorityGrading",
  "stress",
  "tone",
];

export const DEFAULT_PARAMS: PhonologyParams = {
  consonantInventorySize: "medium",
  vowelInventorySize: "medium",
  markedFeatures: {
    ejectives: false,
    clicks: false,
    frontRoundedVowels: false,
    implosives: false,
  },
  typologicalStrictness: 0.7,
  clusterComplexity: 0.3,
  sonorityViolationRate: 0,
};
