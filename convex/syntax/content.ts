// Zero Convex imports — same rule as types.ts. The weight tables here are
// the concrete rule set Open Question 14.1 asked for: which Greenberg-style
// universals get implemented, expressed as data rather than buried in
// generate.ts's control flow.

import type { AdjectiveOrder, AdpositionOrder, GenitiveOrder, WordOrder } from "./types";
import type { MorphologicalType } from "../morphology/types";

/** WALS-informed baseline distribution across the six logical orders, before any typology lean is applied. */
export const WORD_ORDER_BASE_WEIGHTS: Record<WordOrder, number> = {
  SOV: 0.45,
  SVO: 0.42,
  VSO: 0.09,
  VOS: 0.03,
  OVS: 0.01,
  OSV: 0.01,
};

/**
 * Multiplicative lean applied to WORD_ORDER_BASE_WEIGHTS per Morphology's
 * typology (design doc Section 7.1's "consistent with Morphology's
 * typological choices where real cross-linguistic correlations exist"):
 * - isolating: analytic languages lean SVO — word order carries the
 *   grammatical load case marking would otherwise carry (Mandarin,
 *   Vietnamese, Yoruba).
 * - agglutinative: classic verb-final lean (Turkish, Japanese, Korean,
 *   Finnish, Quechua).
 * - fusional: mild SVO lean (Indo-European mix, both orders well attested).
 * - polysynthetic: verb-final lean, with more tolerance for the rarer
 *   orders than a strict SOV lean would give (many polysynthetic languages
 *   are pragmatically flexible).
 * Word orders not listed for a typology keep weight ×1 (no lean).
 */
export const TYPOLOGY_WORD_ORDER_LEAN: Record<MorphologicalType, Partial<Record<WordOrder, number>>> = {
  isolating: { SVO: 1.8, SOV: 0.5 },
  agglutinative: { SOV: 1.6, SVO: 0.7 },
  fusional: { SVO: 1.1 },
  polysynthetic: { SOV: 1.3, OVS: 1.2, OSV: 1.2 },
};

/** Additional SOV lean when Morphology's selectedCategories includes "case" — case-marked languages cross-linguistically skew verb-final/free-order, since case (not position) carries the grammatical-role signal. */
export const CASE_CATEGORY_SOV_LEAN = 1.2;

/**
 * Greenberg Universal 3 ("VSO languages are almost always prepositional")
 * and Universal 4 ("SOV languages are almost always postpositional"),
 * generalized to the full Object-before-Verb vs. Verb-before-Object split
 * (OVS groups with SOV/OSV here — Object still precedes Verb) and kept
 * statistical ("almost always"), not absolute.
 */
export const ADPOSITION_ORDER_WEIGHTS_OV: Record<AdpositionOrder, number> = {
  postpositional: 0.85,
  prepositional: 0.15,
};

export const ADPOSITION_ORDER_WEIGHTS_VO: Record<AdpositionOrder, number> = {
  prepositional: 0.8,
  postpositional: 0.2,
};

export const OV_WORD_ORDERS: WordOrder[] = ["SOV", "OSV", "OVS"];

/** Greenberg Universal 2: prepositional languages lean noun-genitive; postpositional languages lean genitive-noun. */
export const GENITIVE_ORDER_WEIGHTS_PREPOSITIONAL: Record<GenitiveOrder, number> = {
  nounGenitive: 0.65,
  genitiveNoun: 0.35,
};

export const GENITIVE_ORDER_WEIGHTS_POSTPOSITIONAL: Record<GenitiveOrder, number> = {
  genitiveNoun: 0.8,
  nounGenitive: 0.2,
};

/**
 * Weaker tendency than the genitive correlation above — same directional
 * (head-final vs. head-initial) lean, softer weighting to reflect that
 * Greenberg's adjective-order universals are conditional/weaker than the
 * adposition/genitive ones.
 */
export const ADJECTIVE_ORDER_WEIGHTS_HEAD_FINAL: Record<AdjectiveOrder, number> = {
  adjectiveNoun: 0.6,
  nounAdjective: 0.4,
};

export const ADJECTIVE_ORDER_WEIGHTS_HEAD_INITIAL: Record<AdjectiveOrder, number> = {
  nounAdjective: 0.6,
  adjectiveNoun: 0.4,
};

/** Preferred lexicon concept ids for example-sentence roles — all guaranteed present in CORE_LIST, picked over a random same-POS item so examples read naturally across languages. Falls back to a random item of the right part of speech when a language's lexicon doesn't have these (e.g. a heavily edited/pruned lexicon). */
export const PREFERRED_SUBJECT_IDS = ["i", "you_sg", "he_she_it"];
export const PREFERRED_VERB_IDS = ["see", "have", "go", "do"];
export const PREFERRED_ADJECTIVE_IDS = ["big", "small", "good", "bad"];

/** The 5 adposition concepts added to convex/lexicon/content.ts's CORE_LIST for M5. */
export const PREFERRED_ADPOSITION_IDS = ["in", "on", "to", "from", "with"];
