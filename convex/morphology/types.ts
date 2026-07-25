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

/**
 * Section 5.2's full strategy set. `prefix`/`suffix` are the M3 baseline;
 * everything else is M4. Suppletion is deliberately NOT here — it's
 * lexeme-specific by definition (irregular "go/went"-style forms aren't a
 * productive rule any root can undergo), so it lives in its own
 * `SuppletionData` list instead of being forced into this per-root-general
 * shape.
 */
export type AffixStrategy =
  | "prefix"
  | "suffix"
  | "infix"
  | "circumfix"
  | "reduplicationFull"
  | "reduplicationPartial"
  | "ablaut"
  | "templatic";

/** Which piece of the root gets copied for partial reduplication, e.g. ["C","V"] = copy the root's first consonant+vowel. */
export type ReduplicationShape = ("C" | "V")[];

export interface MorphologyParams {
  typology: MorphologicalType;
}

export const DEFAULT_MORPHOLOGY_PARAMS: MorphologyParams = { typology: "agglutinative" };

/**
 * Section 5.4, expressed by importing Phonology's own vocabulary
 * (VowelFeatures.backness, ConsonantFeatures.place, ClusterRule) rather than
 * inventing a parallel rule format — generated once per morphology
 * generation pass, deterministic, no user-facing control (same "integrated
 * system, not two generators bolted together" framing as the rest of M4).
 */
export interface VowelHarmonyRule {
  enabled: boolean;
  /** v1 scope: front/back harmony only — the dominant cross-linguistic pattern (Turkish/Finnish/Hungarian). */
  axis: "backness";
}

export interface ConsonantAssimilationRule {
  enabled: boolean;
  /** v1 scope: place assimilation only. */
  target: "place";
}

export interface EpenthesisRule {
  enabled: boolean;
  /** A concrete phoneme id from this language's own vowel inventory (nearest to schwa: central, mid height) inserted to break up a cluster that violates PhonotacticsData's cluster rules — chosen once so repairs stay native to the language rather than injecting a foreign sound. */
  epentheticVowelId: string;
}

export interface AllomorphyData {
  version: 1;
  vowelHarmony: VowelHarmonyRule;
  consonantAssimilation: ConsonantAssimilationRule;
  epenthesis: EpenthesisRule;
}

/**
 * Section 5.2's suppletion: a specific (root, category, value) cell gets an
 * arbitrary override form instead of the normal affix — controlled,
 * low-frequency "spice" applied only to a language's highest-frequency
 * roots, mirroring how real suppletion is a frequency effect.
 */
export interface SuppletionData {
  version: 1;
  id: string;
  /** The lexicon concept id this irregular form belongs to. */
  rootConceptId: string;
  category: CategoryId;
  value: string;
  overrideForm: string;
  overridePhonemeIds: string[];
  seed: Seed;
  locked: boolean;
}

/** Section 5.5's word-formation rule catalog — see content.ts's DERIVATIONAL_RULE_CATALOG for the concrete set. */
export type DerivationalRuleId = "agentive" | "abstractQuality" | "diminutive" | "adjectival" | "resultative";

/**
 * One generated derivational affix realizing a rule from
 * DERIVATIONAL_RULE_CATALOG. Kept linear-only (prefix/suffix) in v1 — the
 * non-linear strategy set is scoped to inflection (Section 5.2); derivation
 * doesn't need that same complexity to satisfy Section 5.5's ask (word
 * families feeding back into Lexicon).
 */
export interface DerivationalAffixData {
  version: 1;
  id: string;
  ruleId: DerivationalRuleId;
  slot: "prefix" | "suffix";
  form: string;
  phonemeIds: string[];
  seed: Seed;
  locked: boolean;
}

export interface MorphologyStageData {
  version: 1;
  seed: Seed;
  params: MorphologyParams;
  selectedCategories: CategoryId[];
  affixCount: number;
  allomorphy: AllomorphyData;
  suppletion: SuppletionData[];
  derivationalAffixes: DerivationalAffixData[];
  generatedAt: number;
}

/** One value a fused or standalone affix realizes, tagged with its source category. */
export interface AffixValueRef {
  category: CategoryId;
  value: string;
}

/**
 * One generated inflectional affix. `id` is the stable key for
 * locking/diffing/history (same contract as LexiconItemData.id) — it
 * encodes exactly which category/value combination this affix realizes
 * (see `cellId` in generate.ts), so item-level regeneration can change its
 * phonological form without disturbing its grammatical identity.
 */
export interface MorphologyAffixData {
  version: 1;
  id: string;
  strategy: AffixStrategy;
  domain: GrammaticalDomain;
  /** 1 for a standalone affix; 2-3 for a fusional bundle cell (fusional typology only). */
  categories: CategoryId[];
  values: AffixValueRef[];
  gloss: string;
  /**
   * Meaning depends on `strategy`:
   * - prefix/suffix/infix: the affix's own raw IPA string (no hyphen — the display layer adds one).
   * - circumfix: the opening (prefix-side) piece; `circumfixClosing` holds the closing piece.
   * - reduplicationFull/reduplicationPartial: unused (empty string) — the surface form is root-dependent, computed at apply-time by copying the root itself.
   * - ablaut/templatic: unused (empty string) — see `ablautFrom`/`ablautTo`/`templaticMelody` instead.
   */
  form: string;
  /** Circumfix only: the closing (suffix-side) piece. `phonemeIds` holds the opening piece's phonemes; this field holds the closing piece's, kept separate so the two can be resolved back to real phonemes independently at apply-time. */
  circumfixClosing?: string;
  circumfixClosingPhonemeIds?: string[];
  /** reduplicationPartial only: which part of the root gets copied. */
  reduplicationShape?: ReduplicationShape;
  /** reduplicationFull/reduplicationPartial only: whether the copy attaches before or after the root — cross-linguistically prefixing reduplication is the majority pattern (WALS), so "before" is the default lean. */
  reduplicationPlacement?: "before" | "after";
  /** ablaut only: the phoneme id of the root vowel this pattern targets. */
  ablautFrom?: string;
  /** ablaut only: the phoneme id the targeted root vowel gets swapped to. */
  ablautTo?: string;
  /** templatic only: vowel phoneme ids interleaved with the root's extracted consonant skeleton, in order. */
  templaticMelody?: string[];
  /**
   * Flat list of phoneme catalog ids used to build this affix's OWN fixed
   * material — lets an upstream phonology edit that removes a phoneme flag
   * exactly the affixes that used it (Section 10.2a), same contract as
   * LexiconItemData.phonemeIds. Empty for reduplication, whose material is
   * copied from whatever root it attaches to rather than owned by the
   * affix itself.
   */
  phonemeIds: string[];
  seed: Seed;
  locked: boolean;
}

export type MorphologyTarget = "unlocked";
