// Static English-side lookup tables — zero Convex imports (same rule as
// content.ts in every engine). Nothing here describes the generated
// language; it all describes ENGLISH, the input side. The generated
// language's own vocabulary comes from lexiconItems and its own grammar
// from morphologyItems/phraseStructure, resolved at translate time.
//
// Deliberately small and curated rather than a real morphological analyzer:
// the goal is that a user typing "the dogs saw the big mountain" gets a
// correct, fully-marked result, not that every English string parses.
// Anything these tables miss degrades to "treated as an uninflected content
// word," which is the same path an unknown word already takes.

import type { CategoryId } from "../morphology/types";

/** One grammatical feature read off the English input, named in the same (category, value) vocabulary CATEGORY_CATALOG uses — so it can be matched straight against a generated affix's `values`. */
export interface DetectedFeature {
  category: CategoryId;
  value: string;
}

/**
 * Which absorbed grammar words map to which feature. `null` means "this
 * word carries no feature this app models" — it still gets absorbed (so it
 * doesn't become a spurious untranslatable word) and reported in the
 * word's `absorbed` list.
 */
export const ARTICLES: Record<string, DetectedFeature | null> = {
  the: { category: "definiteness", value: "definite" },
  a: { category: "definiteness", value: "indefinite" },
  an: { category: "definiteness", value: "indefinite" },
};

/** Possessive determiners → a `possession` feature on the noun they modify. English marks the possessor on the determiner; most languages with this category mark it on the possessed noun, which is exactly what absorbing them does. */
export const POSSESSIVE_DETERMINERS: Record<string, DetectedFeature> = {
  my: { category: "possession", value: "poss1sg" },
  your: { category: "possession", value: "poss2sg" },
  his: { category: "possession", value: "poss3sg" },
  her: { category: "possession", value: "poss3sg" },
  its: { category: "possession", value: "poss3sg" },
  our: { category: "possession", value: "poss1pl" },
  their: { category: "possession", value: "poss3pl" },
};

/**
 * Subject pronoun → the `agreement` value a verb agrees with. Keyed by the
 * pronoun's English surface rather than its lexicon concept id, because
 * object forms ("me", "them") and subject forms ("I", "they") share a
 * concept but only the subject position drives agreement.
 */
export const PRONOUN_AGREEMENT: Record<string, string> = {
  i: "1sg",
  me: "1sg",
  you: "2sg",
  he: "3sg",
  him: "3sg",
  she: "3sg",
  her: "3sg",
  it: "3sg",
  we: "1pl",
  us: "1pl",
  they: "3pl",
  them: "3pl",
};

/** Object-form pronouns → the lexicon alias their subject form is indexed under, so "I see them" resolves "them" to the `they` root. */
export const PRONOUN_LEMMA: Record<string, string> = {
  me: "i",
  him: "he",
  her: "she",
  us: "we",
  them: "they",
  mine: "i",
  yours: "you",
  hers: "she",
  ours: "we",
  theirs: "they",
};

export const NEGATORS = new Set(["not", "n't", "never", "no"]);

/** Auxiliaries that contribute tense/aspect/mood to the following verb and have no root of their own. */
export const AUXILIARIES: Record<string, DetectedFeature | null> = {
  will: { category: "tense", value: "future" },
  shall: { category: "tense", value: "future" },
  did: { category: "tense", value: "past" },
  had: { category: "tense", value: "past" },
  has: { category: "aspect", value: "perfective" },
  have: { category: "aspect", value: "perfective" },
  does: null,
  do: null,
  am: null,
  is: null,
  are: null,
  was: { category: "tense", value: "past" },
  were: { category: "tense", value: "past" },
  would: { category: "mood", value: "subjunctive" },
  could: { category: "mood", value: "subjunctive" },
  should: { category: "mood", value: "subjunctive" },
  might: { category: "mood", value: "subjunctive" },
  may: { category: "mood", value: "subjunctive" },
  can: null,
  must: null,
};

/**
 * Contractions expanded before classification. Keeps the tokenizer from
 * having to know about apostrophes beyond splitting possessive "'s" — which
 * it still must do, since "the dog's tail" and "the dog is big" are
 * genuinely different structures.
 */
export const CONTRACTIONS: Record<string, string[]> = {
  "don't": ["do", "not"],
  "doesn't": ["does", "not"],
  "didn't": ["did", "not"],
  "won't": ["will", "not"],
  "can't": ["can", "not"],
  "isn't": ["is", "not"],
  "aren't": ["are", "not"],
  "wasn't": ["was", "not"],
  "weren't": ["were", "not"],
  "i'm": ["i", "am"],
  "we're": ["we", "are"],
  "they're": ["they", "are"],
  "you're": ["you", "are"],
  "i'll": ["i", "will"],
  "we'll": ["we", "will"],
  "they'll": ["they", "will"],
  "you'll": ["you", "will"],
  "he'll": ["he", "will"],
  "she'll": ["she", "will"],
};

/** Irregular plurals whose singular can't be recovered by suffix stripping. */
export const IRREGULAR_PLURALS: Record<string, string> = {
  men: "man",
  women: "woman",
  children: "child",
  people: "person",
  feet: "foot",
  teeth: "tooth",
  geese: "goose",
  mice: "mouse",
  oxen: "ox",
  knives: "knife",
  leaves: "leaf",
  lives: "life",
  wives: "wife",
  wolves: "wolf",
  thieves: "thief",
  loaves: "loaf",
  selves: "self",
  fish: "fish",
  sheep: "sheep",
  deer: "deer",
};

/**
 * Irregular past-tense AND past-participle forms → present stem. The two
 * share a table because they resolve to the same root and imply the same
 * feature here: this app models tense and aspect but no participle, so
 * "saw" and "seen" both come out as `see` marked past. Restricted to verbs
 * the core lexicon actually carries, plus a handful users reach for
 * constantly.
 */
export const IRREGULAR_PAST: Record<string, string> = {
  was: "be",
  were: "be",
  been: "be",
  had: "have",
  did: "do",
  went: "go",
  came: "come",
  ran: "run",
  flew: "fly",
  swam: "swim",
  sat: "sit",
  stood: "stand",
  lay: "lie down",
  slept: "sleep",
  woke: "wake",
  ate: "eat",
  drank: "drink",
  bit: "bite",
  saw: "see",
  heard: "hear",
  smelled: "smell",
  felt: "feel",
  spoke: "speak",
  said: "say",
  told: "tell",
  knew: "know",
  thought: "think",
  forgot: "forget",
  learned: "learn",
  taught: "teach",
  understood: "understand",
  wanted: "want",
  gave: "give",
  took: "take",
  held: "hold",
  threw: "throw",
  caught: "catch",
  brought: "bring",
  bought: "buy",
  sold: "sell",
  made: "make",
  built: "build",
  broke: "break",
  cut: "cut",
  grew: "grow",
  won: "win",
  lost: "lose",
  found: "find",
  fought: "fight",
  sang: "sing",
  slew: "kill",
  wrote: "write",
  read: "read",
  sent: "send",
  met: "meet",
  paid: "pay",
  sought: "seek",
  fell: "fall",
  drove: "drive",
  rode: "ride",
  wore: "wear",
  chose: "choose",
  spent: "spend",
  hid: "hide",
  struck: "hit",
  // Past participles — same target stem, same feature (see the note above).
  seen: "see",
  done: "do",
  gone: "go",
  eaten: "eat",
  drunk: "drink",
  taken: "take",
  given: "give",
  known: "know",
  spoken: "speak",
  written: "write",
  driven: "drive",
  ridden: "ride",
  chosen: "choose",
  broken: "break",
  forgotten: "forget",
  worn: "wear",
  sung: "sing",
  begun: "begin",
  woken: "wake",
  thrown: "throw",
  grown: "grow",
  fallen: "fall",
  hidden: "hide",
  bitten: "bite",
  flown: "fly",
  swum: "swim",
};

/**
 * Derived-word patterns (Section 5.5's DERIVATIONAL_RULE_CATALOG, read
 * backwards). Lexicon stores a derived item's meaning as the rule's
 * generated gloss — "one who runs", "little house" — so an English input of
 * "runner" is looked up by reconstructing that gloss rather than by
 * teaching the index about English suffixes.
 */
export const DERIVED_GLOSS_PATTERNS: Array<{ suffix: string; toGloss: (stem: string) => string }> = [
  { suffix: "er", toGloss: (stem) => `one who ${stem}s` },
  { suffix: "or", toGloss: (stem) => `one who ${stem}s` },
  { suffix: "ness", toGloss: (stem) => `the quality of being ${stem}` },
  { suffix: "ity", toGloss: (stem) => `the quality of being ${stem}` },
  { suffix: "like", toGloss: (stem) => `${stem}-like` },
  { suffix: "ish", toGloss: (stem) => `${stem}-like` },
];

/** Lexicon concept ids that behave as adpositions for phrase-order purposes. Kept as ids (not glosses) because these are exactly the "function"-POS entries Syntax's adpositional-phrase example already relies on. */
export const ADPOSITION_CONCEPT_IDS = new Set(["in", "on", "to", "from", "with"]);

/** Coordinators and subordinators — left in source position, and their presence is what makes a sentence too complex for clause reordering (see reorderClause). */
export const CLAUSE_CONNECTIVES = new Set(["and", "or", "but", "if", "because", "then", "so", "that", "while", "when"]);

/**
 * The order affixes are applied to a root in. Inner (closest to the stem)
 * first, matching the cross-linguistic tendency this app's own affix
 * generation already assumes: number/agreement sit inside case/tense, and
 * discourse-level marking (polarity, definiteness) sits outermost.
 * `applyAffixesToRoot` applies its array in order, so this IS the surface
 * order for a prefixing language too — the affix's own strategy decides
 * which side it lands on.
 */
export const AFFIX_APPLICATION_ORDER: CategoryId[] = [
  "genderClass",
  "number",
  "possession",
  "case",
  "definiteness",
  "voice",
  "aspect",
  "tense",
  "agreement",
  "mood",
  "evidentiality",
  "polarity",
];

/** One-click starter phrases, so the page opens with something to look at rather than an empty box. Chosen to exercise different parts of the pipeline: bare noun, adjective order, full clause, possessive, adposition. */
export const STARTER_PHRASES = [
  "the sun",
  "big mountain",
  "I see the water",
  "the child's mother",
  "the bird flies to the forest",
  "we did not hear the thunder",
];
