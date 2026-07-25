// Zero Convex imports — same rule as types.ts.

import type { AffixStrategy, CategoryDef, CategoryId, DerivationalRuleId, MorphologicalType } from "./types";
import type { ConsonantPlace } from "../phonology/types";
import type { PartOfSpeech } from "../lexicon/types";

export const CATEGORY_CATALOG: CategoryDef[] = [
  // --- Nominal (Section 5.3) ---
  {
    id: "case",
    domain: "nominal",
    label: "Case",
    baseInclusionWeight: 0.6,
    values: [
      { id: "nominative", gloss: "NOM", label: "Subject", zeroMarked: true },
      { id: "accusative", gloss: "ACC", label: "Object" },
      { id: "genitive", gloss: "GEN", label: "Possessive" },
      { id: "dative", gloss: "DAT", label: "To / For" },
    ],
  },
  {
    id: "number",
    domain: "nominal",
    label: "Number",
    baseInclusionWeight: 0.9,
    values: [
      { id: "singular", gloss: "SG", label: "Singular", zeroMarked: true },
      { id: "plural", gloss: "PL", label: "Plural" },
    ],
  },
  {
    id: "genderClass",
    domain: "nominal",
    label: "Gender / Noun Class",
    baseInclusionWeight: 0.35,
    // No zero value — presence of the category means every noun carries a class marker (Bantu-style class prefixes).
    values: [
      { id: "classI", gloss: "I", label: "Class I" },
      { id: "classII", gloss: "II", label: "Class II" },
      { id: "classIII", gloss: "III", label: "Class III" },
    ],
  },
  {
    id: "definiteness",
    domain: "nominal",
    label: "Definiteness",
    baseInclusionWeight: 0.35,
    values: [
      { id: "indefinite", gloss: "INDEF", label: "Indefinite ('a')", zeroMarked: true },
      { id: "definite", gloss: "DEF", label: "Definite ('the')" },
    ],
  },
  {
    id: "possession",
    domain: "nominal",
    label: "Possession",
    baseInclusionWeight: 0.25,
    // No zero value — possessor person/number marking only exists when this category is present at all.
    values: [
      { id: "poss1sg", gloss: "1SG.POSS", label: "My" },
      { id: "poss2sg", gloss: "2SG.POSS", label: "Your" },
      { id: "poss3sg", gloss: "3SG.POSS", label: "His / Her / Its" },
      { id: "poss1pl", gloss: "1PL.POSS", label: "Our" },
      { id: "poss2pl", gloss: "2PL.POSS", label: "Your (plural)" },
      { id: "poss3pl", gloss: "3PL.POSS", label: "Their" },
    ],
  },
  // --- Verbal (Section 5.3) ---
  {
    id: "tense",
    domain: "verbal",
    label: "Tense",
    baseInclusionWeight: 0.85,
    values: [
      { id: "present", gloss: "PRS", label: "Present", zeroMarked: true },
      { id: "past", gloss: "PST", label: "Past" },
      { id: "future", gloss: "FUT", label: "Future" },
    ],
  },
  {
    id: "aspect",
    domain: "verbal",
    label: "Aspect",
    baseInclusionWeight: 0.55,
    values: [
      { id: "imperfective", gloss: "IPFV", label: "Ongoing / Habitual", zeroMarked: true },
      { id: "perfective", gloss: "PFV", label: "Completed" },
    ],
  },
  {
    id: "mood",
    domain: "verbal",
    label: "Mood",
    baseInclusionWeight: 0.45,
    values: [
      { id: "indicative", gloss: "IND", label: "Statement", zeroMarked: true },
      { id: "imperative", gloss: "IMP", label: "Command" },
      { id: "subjunctive", gloss: "SBJV", label: "Hypothetical / Wish" },
    ],
  },
  {
    id: "evidentiality",
    domain: "verbal",
    label: "Evidentiality",
    baseInclusionWeight: 0.12,
    values: [
      { id: "direct", gloss: "DIR", label: "Witnessed firsthand", zeroMarked: true },
      { id: "inferred", gloss: "INFR", label: "Inferred / Guessed" },
      { id: "reported", gloss: "REP", label: "Reported (hearsay)" },
    ],
  },
  {
    id: "polarity",
    domain: "verbal",
    label: "Polarity",
    baseInclusionWeight: 0.7,
    values: [
      { id: "affirmative", gloss: "AFF", label: "Affirmative", zeroMarked: true },
      { id: "negative", gloss: "NEG", label: "Negative ('not')" },
    ],
  },
  {
    id: "voice",
    domain: "verbal",
    label: "Voice",
    baseInclusionWeight: 0.35,
    values: [
      { id: "active", gloss: "ACT", label: "Active", zeroMarked: true },
      { id: "passive", gloss: "PASS", label: "Passive" },
    ],
  },
  {
    id: "agreement",
    domain: "verbal",
    label: "Subject Agreement",
    baseInclusionWeight: 0.6,
    // No zero value — agreement is inherently always marked when the category is present.
    values: [
      { id: "1sg", gloss: "1SG", label: "I" },
      { id: "2sg", gloss: "2SG", label: "You" },
      { id: "3sg", gloss: "3SG", label: "He / She / It" },
      { id: "1pl", gloss: "1PL", label: "We" },
      { id: "2pl", gloss: "2PL", label: "You all" },
      { id: "3pl", gloss: "3PL", label: "They" },
    ],
  },
];

export const CATEGORY_MAP = new Map(CATEGORY_CATALOG.map((c) => [c.id, c]));

/**
 * [min, max] selected-category count per typology (Section 5.3: "plausible
 * subset... not maximal marking on every language"). Polysynthetic is
 * modeled here as "agglutinative with a much larger category budget" — the
 * non-linear strategies and noun incorporation that make polysynthetic
 * languages distinctive are explicitly M4 scope (Section 5.2/5.4 phasing).
 */
export const TYPOLOGY_CATEGORY_COUNT: Record<MorphologicalType, [number, number]> = {
  isolating: [0, 2],
  agglutinative: [5, 8],
  fusional: [4, 6],
  polysynthetic: [7, 10],
};

/**
 * Small, legible tilt on top of each category's baseInclusionWeight — this
 * is what "informed by typological co-occurrence patterns" (Section 5.3)
 * means concretely: agglutinative/polysynthetic languages lean richer in
 * case and agreement; fusional languages lean into case (classic
 * case+number fusion, e.g. Latin/Russian declension). Isolating gets no
 * special-casing — its low category-count cap alone does the work.
 */
export const TYPOLOGY_WEIGHT_MULTIPLIERS: Partial<Record<MorphologicalType, Partial<Record<CategoryId, number>>>> = {
  agglutinative: { case: 1.4, agreement: 1.2 },
  fusional: { case: 1.2 },
  polysynthetic: { agreement: 1.6, possession: 1.3, mood: 1.2 },
};

/**
 * Per-category prefix/suffix lean (probability of *suffix*). Cross-
 * linguistic default is suffix-preferring (WALS); agreement leans prefix,
 * reflecting the Bantu/Algonquian-style subject-marking pattern.
 */
export const SUFFIX_LEAN: Partial<Record<CategoryId, number>> = {
  agreement: 0.4,
};
export const DEFAULT_SUFFIX_LEAN = 0.65;

/**
 * Affix shape weights. Affixes are shorter than a full syllable, so this is
 * a dedicated, simpler distribution rather than reusing buildSyllable's
 * onset/coda cluster machinery (that's phonotactics for whole syllables).
 */
export const AFFIX_SHAPE_WEIGHTS: Array<{ shape: ("C" | "V")[]; weight: number }> = [
  { shape: ["V"], weight: 0.25 },
  { shape: ["C", "V"], weight: 0.4 },
  { shape: ["V", "C"], weight: 0.15 },
  { shape: ["C", "V", "C"], weight: 0.2 },
];

/**
 * Cap on how many selected categories fuse into one affix bundle for a
 * fusional typology (Section 5.4's typology, applied to Section 5.2's
 * baseline strategies). Categories beyond the cap stay standalone even in a
 * fusional language — real fusional languages mix fused and agglutinated
 * categories too (e.g. Russian's aspect marking sits apart from its
 * case/number fusion).
 */
export const FUSION_BUNDLE_CAP = 3;

/**
 * Section 5.2's non-linear strategy mix, per typology. `nonLinearRate` is
 * the chance a given affix cell uses a non-linear strategy at all (drawn
 * from `weights` when it does) instead of the prefix/suffix baseline —
 * prefix/suffix stays the cross-linguistic default for every typology,
 * non-linear strategies are the deliberate minority per Section 5.3's
 * "plausible subset, not maximal marking" framing. Isolating gets 0: its
 * existing [0,2] category cap (TYPOLOGY_CATEGORY_COUNT) already does the
 * "near-bare" work; layering non-linear strategies on top would fight that.
 * Each typology's `weights` sum to 1 for legibility.
 */
export const STRATEGY_MIX: Record<
  MorphologicalType,
  { nonLinearRate: number; weights: Partial<Record<AffixStrategy, number>> }
> = {
  isolating: { nonLinearRate: 0, weights: {} },
  agglutinative: {
    nonLinearRate: 0.12,
    weights: { reduplicationFull: 0.45, reduplicationPartial: 0.35, infix: 0.2 },
  },
  fusional: {
    nonLinearRate: 0.2,
    weights: { ablaut: 0.4, circumfix: 0.3, reduplicationFull: 0.2, templatic: 0.1 },
  },
  polysynthetic: {
    nonLinearRate: 0.3,
    weights: {
      circumfix: 0.25,
      infix: 0.2,
      reduplicationFull: 0.2,
      reduplicationPartial: 0.15,
      ablaut: 0.15,
      templatic: 0.05,
    },
  },
};

/**
 * Weighted shapes for partial reduplication's copied piece (Section 5.2) —
 * CV (copy the root's first onset+nucleus) is the cross-linguistic default
 * partial-reduplication template; bare-C and bare-V copies are rarer but
 * attested.
 */
export const REDUPLICATION_SHAPE_WEIGHTS: Array<{ shape: ("C" | "V")[]; weight: number }> = [
  { shape: ["C", "V"], weight: 0.6 },
  { shape: ["V"], weight: 0.15 },
  { shape: ["C"], weight: 0.15 },
  { shape: ["C", "V", "C"], weight: 0.1 },
];

/** Reduplication attaches before the root (prefixing) far more often cross-linguistically (WALS) than after — this is the lean, not an absolute. */
export const REDUPLICATION_BEFORE_LEAN = 0.8;

/**
 * Section 5.4's consonant assimilation, v1 scope: nasal place assimilation
 * only — the single most cross-linguistically common and legible
 * assimilation pattern (e.g. English im-possible vs in-tolerant). Keyed by
 * the following consonant's place; value is the place a nasal assimilates
 * to when adjacent to it. Deliberately partial — not every place has a
 * common assimilation target, and a language may not have a nasal at that
 * place anyway (checked at apply-time against the language's own
 * inventory, not assumed here).
 */
export const NASAL_ASSIMILATION_TARGET: Partial<Record<ConsonantPlace, ConsonantPlace>> = {
  bilabial: "bilabial",
  labiodental: "labiodental",
  velar: "velar",
  uvular: "uvular",
};

export interface DerivationalRuleDef {
  id: DerivationalRuleId;
  sourcePos: PartOfSpeech;
  resultPos: PartOfSpeech;
  /** Probability the generated affix is a suffix rather than a prefix — same convention as SUFFIX_LEAN. */
  suffixLean: number;
  /** Builds the derived word's gloss from its source root's gloss, e.g. "run" -> "one who runs". */
  glossTemplate: (sourceGloss: string) => string;
}

/**
 * Section 5.5's derivational rule set — a small, curated set of common
 * cross-linguistic word-formation patterns, applied productively (any
 * eligible root can undergo one) rather than hand-paired per word-family
 * the way Lexicon's idiomatic COMPOUND_LIST is. See lexicon/generate.ts's
 * derivation pass for eligibility + budget rules.
 */
export const DERIVATIONAL_RULE_CATALOG: DerivationalRuleDef[] = [
  { id: "agentive", sourcePos: "verb", resultPos: "noun", suffixLean: 0.8, glossTemplate: (g) => `one who ${g}s` },
  {
    id: "abstractQuality",
    sourcePos: "adjective",
    resultPos: "noun",
    suffixLean: 0.75,
    glossTemplate: (g) => `the quality of being ${g}`,
  },
  { id: "diminutive", sourcePos: "noun", resultPos: "noun", suffixLean: 0.7, glossTemplate: (g) => `little ${g}` },
  { id: "adjectival", sourcePos: "noun", resultPos: "adjective", suffixLean: 0.65, glossTemplate: (g) => `${g}-like` },
  {
    id: "resultative",
    sourcePos: "verb",
    resultPos: "noun",
    suffixLean: 0.8,
    glossTemplate: (g) => `the result of ${g}ing`,
  },
];
