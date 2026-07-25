// Zero Convex imports — this file (and content.ts, generate.ts, diff.ts) must
// stay importable from the browser for live preview (design doc Section
// 13.5), same rule as convex/phonology/*, convex/lexicon/*, convex/morphology/*.
// Only mutations.ts and queries.ts touch Convex runtime machinery.

export interface Seed {
  /** Rotates only on reroll (fresh entropy at commit time). */
  base: number;
  /** Advances on each nudge commit against the same base; resets to 0 on reroll. */
  variation: number;
}

/**
 * The six logical constituent orders (Section 7.1). Picked via weighted
 * random from content.ts's WORD_ORDER_BASE_WEIGHTS, leaned by Morphology's
 * typology — see generate.ts's computeWordOrderWeights, which resolves
 * Open Question 14.1 with a concrete rule set instead of an abstract
 * "informed by correlations" gesture.
 */
export type WordOrder = "SOV" | "SVO" | "VSO" | "VOS" | "OVS" | "OSV";

export const WORD_ORDERS: WordOrder[] = ["SOV", "SVO", "VSO", "VOS", "OVS", "OSV"];

export type AdpositionOrder = "prepositional" | "postpositional";

/** "genitiveNoun" = possessor precedes the noun ("the person's water"); "nounGenitive" = possessor follows ("the water of the person"). */
export type GenitiveOrder = "genitiveNoun" | "nounGenitive";

export type AdjectiveOrder = "adjectiveNoun" | "nounAdjective";

/** User-selectable, mirrors MorphologyParams.typology's role in the M3/M4 wizard. */
export interface SyntaxParams {
  wordOrder: WordOrder;
}

export const DEFAULT_SYNTAX_PARAMS: SyntaxParams = { wordOrder: "SOV" };

/**
 * adpositionOrder/genitiveOrder/adjectiveOrder are NOT independently
 * user-set — they're derived deterministically from (wordOrder, seed) via
 * the Greenberg-universal-informed weights in content.ts (Universals 2/3/4).
 * Changing word order (reroll/nudge/setWordOrder) always recomputes all
 * three together — no separate lock/regeneration surface for them,
 * matching Section 7's "lightest engine" scope.
 */
export interface PhraseStructureData {
  wordOrder: WordOrder;
  adpositionOrder: AdpositionOrder;
  genitiveOrder: GenitiveOrder;
  adjectiveOrder: AdjectiveOrder;
}

/**
 * Which lexicon concept ids flavor the example sentences (Section 7.2) —
 * re-rolled on nudge/reroll. Deliberately NOT the assembled example
 * sentences themselves: those are resolved against LIVE lexicon/morphology
 * data at render time (see src/lib/syntax's buildExampleSentences,
 * re-exporting generate.ts), the same "compose live, don't cache" pattern
 * convex/components/morphology/example-words-panel.tsx already uses. Since
 * lexicon root ids never change (only their phonological form does on
 * reroll), this can never dangle — so unlike lexiconItems/morphologyItems,
 * Syntax needs no cross-stage staleness flagging at all.
 */
export interface ExampleConceptRefs {
  subjectId: string;
  objectId: string;
  possessorId: string;
  verbId: string;
  adjectiveId: string;
  /** Null if the language's lexicon has no "function"-POS item at all (shouldn't happen post-M5, but a pre-M5 lexicon that hasn't been rerolled could lack even the fallback). */
  adpositionId: string | null;
}

export interface SyntaxStageData {
  version: 1;
  seed: Seed;
  params: SyntaxParams;
  phraseStructure: PhraseStructureData;
  exampleConcepts: ExampleConceptRefs;
  generatedAt: number;
}

/**
 * One word's surface form plus its English gloss, for interlinear-style
 * display. `phonemeIds`/`stressedPhonemeIndex` mirror AssembledWord (from
 * convex/morphology/generate.ts's applyAffixesToRoot) — carried through so
 * a phrase's words can be resolved back to real phonemes and played as
 * audio (src/lib/syntax/audio.ts), not just displayed as IPA text.
 */
export interface ExampleWord {
  form: string;
  gloss: string;
  phonemeIds: string[];
  stressedPhonemeIndex: number | undefined;
}

/** One rendered example (the transitive clause, a noun phrase, a possessive phrase, or an adpositional phrase) — built live from current lexicon/morphology data, never persisted (see ExampleConceptRefs's comment). */
export interface ExamplePhrase {
  label: string;
  words: ExampleWord[];
  translation: string;
}
