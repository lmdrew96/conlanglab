// Pure, deterministic generation engine — zero Convex imports, same
// client/server-shared contract as convex/phonology/generate.ts,
// convex/lexicon/generate.ts, convex/morphology/generate.ts.
//
// Deliberately does NOT store assembled example sentences — only which
// lexicon concept ids/word order were picked. buildExampleSentences
// resolves those against whatever lexicon/morphology data the caller
// passes in, so a live preview and the committed stage's display both run
// the exact same function (the committed case just passes committed data).

import { Rng, deriveSeed } from "../lib/rng";
import { applyAffixesToRoot } from "../morphology/generate";
import {
  ADJECTIVE_ORDER_WEIGHTS_HEAD_FINAL,
  ADJECTIVE_ORDER_WEIGHTS_HEAD_INITIAL,
  ADPOSITION_ORDER_WEIGHTS_OV,
  ADPOSITION_ORDER_WEIGHTS_VO,
  CASE_CATEGORY_SOV_LEAN,
  GENITIVE_ORDER_WEIGHTS_POSTPOSITIONAL,
  GENITIVE_ORDER_WEIGHTS_PREPOSITIONAL,
  OV_WORD_ORDERS,
  PREFERRED_ADJECTIVE_IDS,
  PREFERRED_ADPOSITION_IDS,
  PREFERRED_SUBJECT_IDS,
  PREFERRED_VERB_IDS,
  TYPOLOGY_WORD_ORDER_LEAN,
  WORD_ORDER_BASE_WEIGHTS,
} from "./content";
import { WORD_ORDERS } from "./types";
import type {
  AdjectiveOrder,
  AdpositionOrder,
  ExampleConceptRefs,
  ExamplePhrase,
  ExampleWord,
  GenitiveOrder,
  PhraseStructureData,
  Seed,
  SyntaxParams,
  SyntaxStageData,
  WordOrder,
} from "./types";
import type { AllomorphyData, MorphologicalType, MorphologyAffixData, MorphologyStageData } from "../morphology/types";
import type { LexiconItemData, PartOfSpeech } from "../lexicon/types";
import type { PhonologyData } from "../phonology/types";

const PREVIEW_SALT = 0xbeef;

/** FNV-1a — deterministic string→uint32, same idiom convex/morphology/generate.ts uses (not exported from there, so re-implemented locally rather than reaching into another engine's private helper). */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// --- Word order: typology-leaned weights (resolves Open Question 14.1) ---

export function computeWordOrderWeights(typology: MorphologicalType, hasCase: boolean): Record<WordOrder, number> {
  const lean = TYPOLOGY_WORD_ORDER_LEAN[typology];
  const weights = {} as Record<WordOrder, number>;
  for (const order of WORD_ORDERS) {
    let w = WORD_ORDER_BASE_WEIGHTS[order] * (lean[order] ?? 1);
    if (hasCase && order === "SOV") w *= CASE_CATEGORY_SOV_LEAN;
    weights[order] = w;
  }
  return weights;
}

/**
 * A lean, never a requirement (Section 9's "may suggest... but never
 * forces it" framing, same as suggestTypology). Argmax of the weight
 * table — deterministic, so the same morphology always suggests the same
 * order, unlike the actual weighted-random pick used inside
 * derivePhraseStructure for the correlated fields.
 */
export function suggestWordOrder(morphology: Pick<MorphologyStageData, "params" | "selectedCategories">): WordOrder {
  const weights = computeWordOrderWeights(morphology.params.typology, morphology.selectedCategories.includes("case"));
  let best: WordOrder = "SOV";
  let bestWeight = -Infinity;
  for (const order of WORD_ORDERS) {
    if (weights[order] > bestWeight) {
      best = order;
      bestWeight = weights[order];
    }
  }
  return best;
}

// --- Derived correlates: Greenberg Universals 2/3/4 ---

function pickAdpositionOrder(wordOrder: WordOrder, rng: Rng): AdpositionOrder {
  const weights = OV_WORD_ORDERS.includes(wordOrder) ? ADPOSITION_ORDER_WEIGHTS_OV : ADPOSITION_ORDER_WEIGHTS_VO;
  return rng.weightedPick(["prepositional", "postpositional"], (o) => weights[o]);
}

function pickGenitiveOrder(adpositionOrder: AdpositionOrder, rng: Rng): GenitiveOrder {
  const weights =
    adpositionOrder === "prepositional" ? GENITIVE_ORDER_WEIGHTS_PREPOSITIONAL : GENITIVE_ORDER_WEIGHTS_POSTPOSITIONAL;
  return rng.weightedPick(["nounGenitive", "genitiveNoun"], (o) => weights[o]);
}

function pickAdjectiveOrder(genitiveOrder: GenitiveOrder, rng: Rng): AdjectiveOrder {
  const weights = genitiveOrder === "genitiveNoun" ? ADJECTIVE_ORDER_WEIGHTS_HEAD_FINAL : ADJECTIVE_ORDER_WEIGHTS_HEAD_INITIAL;
  return rng.weightedPick(["adjectiveNoun", "nounAdjective"], (o) => weights[o]);
}

export function derivePhraseStructure(wordOrder: WordOrder, rng: Rng): PhraseStructureData {
  const adpositionOrder = pickAdpositionOrder(wordOrder, rng);
  const genitiveOrder = pickGenitiveOrder(adpositionOrder, rng);
  const adjectiveOrder = pickAdjectiveOrder(genitiveOrder, rng);
  return { wordOrder, adpositionOrder, genitiveOrder, adjectiveOrder };
}

// --- Example-sentence concept picking ---

function byPos(items: LexiconItemData[], pos: PartOfSpeech): LexiconItemData[] {
  return items.filter((i) => i.partOfSpeech === pos);
}

function pickPreferred(candidates: LexiconItemData[], preferredIds: string[], rng: Rng): LexiconItemData | null {
  if (candidates.length === 0) return null;
  for (const id of preferredIds) {
    const match = candidates.find((c) => c.id === id);
    if (match) return match;
  }
  return rng.pick(candidates);
}

export function pickExampleConcepts(lexiconItems: LexiconItemData[], rng: Rng): ExampleConceptRefs {
  const pronouns = byPos(lexiconItems, "pronoun");
  const nouns = rng.shuffle(byPos(lexiconItems, "noun"));
  const verbs = byPos(lexiconItems, "verb");
  const adjectives = byPos(lexiconItems, "adjective");
  const functionWords = byPos(lexiconItems, "function");

  const subject = pickPreferred(pronouns, PREFERRED_SUBJECT_IDS, rng) ?? nouns[0] ?? null;
  const objectNoun = nouns[0] ?? subject;
  const possessorNoun = nouns[1] ?? nouns[0] ?? subject;
  const verb = pickPreferred(verbs, PREFERRED_VERB_IDS, rng);
  const adjective = pickPreferred(adjectives, PREFERRED_ADJECTIVE_IDS, rng);
  const adposition = pickPreferred(functionWords, PREFERRED_ADPOSITION_IDS, rng);

  if (!subject || !objectNoun || !possessorNoun || !verb || !adjective) {
    throw new Error("Lexicon needs at least one pronoun, noun, verb, and adjective before Syntax examples can be built");
  }

  return {
    subjectId: subject.id,
    objectId: objectNoun.id,
    possessorId: possessorNoun.id,
    verbId: verb.id,
    adjectiveId: adjective.id,
    adpositionId: adposition?.id ?? null,
  };
}

// --- Committed-stage generation ---

export interface GenerateSyntaxArgs {
  seed: Seed;
  params: SyntaxParams;
  morphology: Pick<MorphologyStageData, "params" | "selectedCategories">;
  lexiconItems: LexiconItemData[];
  mode: "initial" | "reroll" | "nudge";
  now: number;
}

export function generateSyntax(args: GenerateSyntaxArgs): SyntaxStageData {
  const rng = new Rng(args.mode === "nudge" ? deriveSeed(args.seed.base, args.seed.variation) : args.seed.base);
  const phraseStructure = derivePhraseStructure(args.params.wordOrder, rng);
  const exampleConcepts = pickExampleConcepts(args.lexiconItems, rng);
  return {
    version: 1,
    seed: args.seed,
    params: args.params,
    phraseStructure,
    exampleConcepts,
    generatedAt: args.now,
  };
}

// --- Live example-sentence assembly (reused by both the committed display and the pre-generation preview) ---

function resolveItem(lexiconItems: LexiconItemData[], id: string): LexiconItemData | null {
  return lexiconItems.find((i) => i.id === id) ?? null;
}

function findCaseAffix(morphologyItems: MorphologyAffixData[], value: string): MorphologyAffixData | null {
  return (
    morphologyItems.find((a) => a.domain === "nominal" && a.values.some((v) => v.category === "case" && v.value === value)) ??
    null
  );
}

function bareWord(item: LexiconItemData, phonology: PhonologyData, allomorphy: AllomorphyData): ExampleWord {
  const assembled = applyAffixesToRoot(item, [], phonology, allomorphy);
  return {
    form: assembled.form,
    gloss: item.meaning,
    phonemeIds: assembled.phonemeIds,
    stressedPhonemeIndex: assembled.stressedPhonemeIndex,
  };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Applies the case affix realizing `caseValue` if Morphology generated one (case may not be a selected category at all, or the value may be the typologically-unmarked zero-marked baseline — e.g. nominative usually has no overt affix, see CategoryValue.zeroMarked) — falls back to the bare root either way, which is the linguistically correct result for zero-marking. */
function applyCase(
  item: LexiconItemData,
  caseValue: string,
  morphologyItems: MorphologyAffixData[],
  phonology: PhonologyData,
  allomorphy: AllomorphyData,
): ExampleWord {
  const affix = findCaseAffix(morphologyItems, caseValue);
  const affixes = affix ? [affix] : [];
  const assembled = applyAffixesToRoot(item, affixes, phonology, allomorphy);
  return {
    form: assembled.form,
    gloss: item.meaning,
    phonemeIds: assembled.phonemeIds,
    stressedPhonemeIndex: assembled.stressedPhonemeIndex,
  };
}

export interface BuildExampleSentencesArgs {
  phraseStructure: PhraseStructureData;
  exampleConcepts: ExampleConceptRefs;
  lexiconItems: LexiconItemData[];
  morphologyItems: MorphologyAffixData[];
  phonology: PhonologyData;
  allomorphy: AllomorphyData;
}

/**
 * Builds up to 4 example phrases demonstrating Section 7.1's basic
 * constituent structure — a simple transitive clause, a noun phrase, a
 * possessive phrase, and an adpositional phrase — from LIVE lexicon and
 * morphology data (never from cached/persisted forms; see ExampleConceptRefs's
 * comment on why Syntax needs no staleness tracking). Only the transitive
 * clause and possessive phrase apply morphology (case affixes); adjective/noun
 * order alone isn't marked by inflection in this v1 scope.
 */
export function buildExampleSentences(args: BuildExampleSentencesArgs): ExamplePhrase[] {
  const { phraseStructure, exampleConcepts, lexiconItems, morphologyItems, phonology, allomorphy } = args;
  const subject = resolveItem(lexiconItems, exampleConcepts.subjectId);
  const object = resolveItem(lexiconItems, exampleConcepts.objectId);
  const possessor = resolveItem(lexiconItems, exampleConcepts.possessorId);
  const verb = resolveItem(lexiconItems, exampleConcepts.verbId);
  const adjective = resolveItem(lexiconItems, exampleConcepts.adjectiveId);
  const adposition = exampleConcepts.adpositionId ? resolveItem(lexiconItems, exampleConcepts.adpositionId) : null;

  const phrases: ExamplePhrase[] = [];

  if (subject && object && verb) {
    const slots = {
      S: applyCase(subject, "nominative", morphologyItems, phonology, allomorphy),
      O: applyCase(object, "accusative", morphologyItems, phonology, allomorphy),
      V: bareWord(verb, phonology, allomorphy),
    };
    // English glosses arranged in the SAME slot order as the conlang's
    // actual word order — deliberately not natural/grammatical English
    // (e.g. SOV renders "I the thunder see") so the translation itself
    // demonstrates the constituent order rather than hiding it behind a
    // fixed SVO gloss.
    const glosses: Record<"S" | "O" | "V", string> = {
      S: subject.meaning,
      O: `the ${object.meaning}`,
      V: verb.meaning,
    };
    const order = phraseStructure.wordOrder.split("") as Array<"S" | "O" | "V">;
    phrases.push({
      label: "Simple sentence",
      words: order.map((slot) => slots[slot]),
      translation: capitalize(order.map((slot) => glosses[slot]).join(" ")),
    });
  }

  if (adjective && object) {
    const adjWord = bareWord(adjective, phonology, allomorphy);
    const objWord = bareWord(object, phonology, allomorphy);
    const words = phraseStructure.adjectiveOrder === "adjectiveNoun" ? [adjWord, objWord] : [objWord, adjWord];
    phrases.push({
      label: "Noun phrase",
      words,
      translation: `the ${adjective.meaning} ${object.meaning}`,
    });
  }

  if (possessor && object) {
    const possWord = applyCase(possessor, "genitive", morphologyItems, phonology, allomorphy);
    const objWord = bareWord(object, phonology, allomorphy);
    const words = phraseStructure.genitiveOrder === "genitiveNoun" ? [possWord, objWord] : [objWord, possWord];
    phrases.push({
      label: "Possessive phrase",
      words,
      translation: `the ${possessor.meaning}'s ${object.meaning}`,
    });
  }

  if (adposition && object) {
    const adpWord = bareWord(adposition, phonology, allomorphy);
    const objWord = bareWord(object, phonology, allomorphy);
    const words = phraseStructure.adpositionOrder === "prepositional" ? [adpWord, objWord] : [objWord, adpWord];
    phrases.push({
      label: "Adpositional phrase",
      words,
      translation: `${adposition.meaning} the ${object.meaning}`,
    });
  }

  return phrases;
}

// --- Pre-generation word-order preview panel ---

export interface WordOrderPreviewExample {
  wordOrder: WordOrder;
  phraseStructure: PhraseStructureData;
  clause: ExamplePhrase | null;
}

/**
 * Runs the real derivation + assembly pipeline (throwaway, never persisted)
 * for one word-order option, so the picker shows real Greenberg-derived
 * correlates and a real example sentence rather than a blind dropdown —
 * same "generates live preview examples... before the user commits" ask as
 * Section 5.1/9.5, and reuses buildExampleSentences rather than a
 * parallel preview-only formatter. Unlike Morphology's typology preview,
 * this doesn't need to synthesize a throwaway root/affixes — Syntax
 * requires Lexicon + Morphology to already exist (the page gates on both),
 * so the preview draws on real committed data.
 */
export function generateWordOrderPreview(
  wordOrder: WordOrder,
  seedBase: number,
  lexiconItems: LexiconItemData[],
  morphologyItems: MorphologyAffixData[],
  phonology: PhonologyData,
  allomorphy: AllomorphyData,
): WordOrderPreviewExample {
  const previewSeed = deriveSeed(seedBase, hashString(wordOrder) ^ PREVIEW_SALT);
  const rng = new Rng(previewSeed);
  const phraseStructure = derivePhraseStructure(wordOrder, rng);
  let clause: ExamplePhrase | null = null;
  if (lexiconItems.length > 0) {
    const exampleConcepts = pickExampleConcepts(lexiconItems, rng);
    const phrases = buildExampleSentences({ phraseStructure, exampleConcepts, lexiconItems, morphologyItems, phonology, allomorphy });
    clause = phrases[0] ?? null;
  }
  return { wordOrder, phraseStructure, clause };
}
