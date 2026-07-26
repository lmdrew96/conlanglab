// English → conlang translation. Pure, deterministic, zero Convex imports
// (same client/server-shared contract as every engine's generate.ts) and
// nothing here is ever persisted — a translation is composed live from
// current stage data, the same "compose live, don't cache" idiom
// convex/syntax/generate.ts's buildExampleSentences and
// convex/orthography/generate.ts's composeWordGlyphSequence already use.
//
// This is NOT a sixth generation stage. It generates no language material
// of its own: every root comes from Lexicon, every affix from Morphology,
// every constituent order from Syntax, every glyph from Orthography. Its
// entire job is reading English well enough to hand those four engines the
// right inputs — which is why it lives in its own directory with no table,
// no mutations, and no staleness of its own.
//
// Scope, stated plainly because the UI states it to the user too: this
// handles a word, a phrase, or a simple declarative clause. It is a
// deliberately small rule set over lexicon-supplied parts of speech, not a
// parser. Anything it can't read confidently falls back to source order,
// which is always a defensible answer rather than a wrong one.

import { CATEGORY_MAP } from "../morphology/content";
import { applyAffixesToRoot } from "../morphology/generate";
import type { AffixValueRef, AllomorphyData, CategoryId, MorphologyAffixData } from "../morphology/types";
import type { LexiconItemData, PartOfSpeech } from "../lexicon/types";
import type { PhonologyData } from "../phonology/types";
import type { PhraseStructureData } from "../syntax/types";
import { composeWordGlyphSequence } from "../orthography/generate";
import type { GlyphSequenceStep } from "../orthography/generate";
import type { Aesthetic, BoundaryTreatment, SoundToSymbolMapping } from "../orthography/types";
import {
  ADPOSITION_CONCEPT_IDS,
  AFFIX_APPLICATION_ORDER,
  ARTICLES,
  AUXILIARIES,
  CLAUSE_CONNECTIVES,
  CONTRACTIONS,
  DERIVED_GLOSS_PATTERNS,
  IRREGULAR_PAST,
  IRREGULAR_PLURALS,
  NEGATORS,
  POSSESSIVE_DETERMINERS,
  PRONOUN_AGREEMENT,
  PRONOUN_LEMMA,
} from "./content";
import type { DetectedFeature } from "./content";

export type { DetectedFeature } from "./content";

// --- Gloss index (English → this language's roots) ---

/**
 * English alias → the lexicon items that claim it. A list rather than a
 * single item because glosses genuinely collide: "light (illumination)" and
 * "light (not heavy)" both normalize to "light", as do "fear (noun)" and
 * "fear (verb)". Lookup disambiguates by an expected part of speech when
 * the caller has one.
 */
export interface GlossIndex {
  byAlias: Map<string, LexiconItemData[]>;
}

function normalizeAlias(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every English string a lexicon item should answer to. Glosses carry three
 * conventions this has to unpick — disambiguating parentheticals ("back
 * (body)", "you (sg.)", "glove (lit. hand-shoe)"), comma-separated synonyms
 * ("earth, soil"), and slash-separated alternatives ("he/she/it") — plus
 * the concept id itself, which covers multiword ids like `old_age` and
 * `lie_down` that a user is more likely to type than the gloss's exact
 * punctuation.
 */
function aliasesForItem(item: LexiconItemData): string[] {
  const aliases = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeAlias(value);
    if (normalized) aliases.add(normalized);
  };

  const meaning = item.meaning.toLowerCase();
  add(meaning);
  const withoutParentheticals = meaning.replace(/\([^)]*\)/g, " ");
  for (const commaPart of withoutParentheticals.split(",")) {
    for (const slashPart of commaPart.split("/")) add(slashPart);
  }
  // Derived/compound ids are namespaced (`derived:agentive:run`) and would
  // only ever produce noise here — their meaning is already indexed above.
  if (!item.id.includes(":")) add(item.id.replace(/_/g, " "));

  return Array.from(aliases);
}

export function buildGlossIndex(lexiconItems: LexiconItemData[]): GlossIndex {
  const byAlias = new Map<string, LexiconItemData[]>();
  for (const item of lexiconItems) {
    for (const alias of aliasesForItem(item)) {
      const existing = byAlias.get(alias);
      if (existing) existing.push(item);
      else byAlias.set(alias, [item]);
    }
  }
  return { byAlias };
}

/** Cheap POS preference when an alias is claimed by more than one item — no scoring model, just "the caller expected a verb, one of these is a verb." */
function lookupAlias(index: GlossIndex, alias: string, posHint?: PartOfSpeech): LexiconItemData | null {
  const matches = index.byAlias.get(alias);
  if (!matches || matches.length === 0) return null;
  if (posHint) {
    const preferred = matches.find((m) => m.partOfSpeech === posHint);
    if (preferred) return preferred;
  }
  return matches[0];
}

const MAX_SUGGESTIONS = 3;

/**
 * Shortest alias allowed to match by containment. Two-letter roots ("i",
 * "to", "on") are inside a large share of English words — "spaceship"
 * containing "i" is not a hint, it's noise — so both sides of the
 * comparison have to clear this.
 */
const MIN_SUGGESTION_LENGTH = 3;

/**
 * "Did you mean" candidates for a word with no root. Substring containment
 * over the index's aliases — a 500-root lexicon is small enough that this is
 * instant and a real edit-distance implementation would be unjustified
 * machinery for a hint chip.
 */
function suggestionsFor(index: GlossIndex, word: string): string[] {
  if (word.length < MIN_SUGGESTION_LENGTH) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [alias, items] of index.byAlias) {
    if (alias.length < MIN_SUGGESTION_LENGTH) continue;
    if (alias === word || (!alias.includes(word) && !word.includes(alias))) continue;
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item.meaning);
      if (out.length >= MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}

// --- English reading ---

/** One lookup attempt: an alias to try, plus the feature that attempt implies. `blockedFor` drops the feature when the match's part of speech makes it nonsense — "-s" means plural on a noun but subject agreement on a verb, and the two are only distinguishable after the root resolves. */
interface LookupCandidate {
  alias: string;
  feature: DetectedFeature | null;
  blockedFor?: PartOfSpeech[];
  posHint?: PartOfSpeech;
}

function stripSuffix(word: string, suffix: string): string | null {
  if (!word.endsWith(suffix) || word.length <= suffix.length + 1) return null;
  return word.slice(0, word.length - suffix.length);
}

/**
 * Every way an English surface form might map onto a root, in priority
 * order. The first candidate that resolves against the index wins — so an
 * exact gloss match always beats a speculative de-inflection, and "runner"
 * only falls through to "run" after the derived item "one who runs" has
 * been tried.
 */
function lookupCandidates(word: string): LookupCandidate[] {
  const candidates: LookupCandidate[] = [{ alias: word, feature: null }];

  const lemma = PRONOUN_LEMMA[word];
  if (lemma) candidates.push({ alias: lemma, feature: null });

  const irregularPlural = IRREGULAR_PLURALS[word];
  if (irregularPlural) {
    candidates.push({ alias: irregularPlural, feature: { category: "number", value: "plural" }, posHint: "noun" });
  }

  const irregularPast = IRREGULAR_PAST[word];
  if (irregularPast) {
    candidates.push({ alias: irregularPast, feature: { category: "tense", value: "past" }, posHint: "verb" });
  }

  for (const pattern of DERIVED_GLOSS_PATTERNS) {
    const stem = stripSuffix(word, pattern.suffix);
    if (stem) candidates.push({ alias: pattern.toGloss(stem), feature: null });
  }

  // Regular plural / 3sg agreement. "-ies" and "-es" first so "berries" and
  // "boxes" don't lose a letter to the bare "-s" rule.
  const ies = stripSuffix(word, "ies");
  if (ies) candidates.push({ alias: `${ies}y`, feature: { category: "number", value: "plural" }, blockedFor: ["verb"] });
  const es = stripSuffix(word, "es");
  if (es) candidates.push({ alias: es, feature: { category: "number", value: "plural" }, blockedFor: ["verb"] });
  const s = stripSuffix(word, "s");
  if (s) candidates.push({ alias: s, feature: { category: "number", value: "plural" }, blockedFor: ["verb"] });

  const ed = stripSuffix(word, "ed");
  if (ed) {
    candidates.push({ alias: ed, feature: { category: "tense", value: "past" }, blockedFor: ["noun", "adjective"] });
    // "carried" → "carry", "hoped" → "hope"
    candidates.push({ alias: `${ed}e`, feature: { category: "tense", value: "past" }, blockedFor: ["noun", "adjective"] });
    if (ed.endsWith("i")) {
      candidates.push({
        alias: `${ed.slice(0, -1)}y`,
        feature: { category: "tense", value: "past" },
        blockedFor: ["noun", "adjective"],
      });
    }
  }

  const ing = stripSuffix(word, "ing");
  if (ing) {
    candidates.push({ alias: ing, feature: { category: "aspect", value: "imperfective" }, blockedFor: ["noun"] });
    candidates.push({ alias: `${ing}e`, feature: { category: "aspect", value: "imperfective" }, blockedFor: ["noun"] });
  }

  // Comparatives/superlatives: this app models no comparison category, so
  // these strip to the bare adjective and mark nothing.
  const er = stripSuffix(word, "er");
  if (er) candidates.push({ alias: er, feature: null, posHint: "adjective" });
  const est = stripSuffix(word, "est");
  if (est) candidates.push({ alias: est, feature: null, posHint: "adjective" });

  return candidates;
}

/** A content word after English analysis: which root it resolved to (if any) and every feature read off it or absorbed from neighbouring grammar words. */
interface AnalyzedWord {
  /** English as typed, including any absorbed grammar words — "the dogs", "did not see". */
  source: string;
  /** The bare surface form, used for pronoun-driven agreement and for suggestions. */
  surface: string;
  item: LexiconItemData | null;
  features: DetectedFeature[];
  suggestions: string[];
  /** Set by a following possessive "'s". */
  possessive: boolean;
}

function addFeature(features: DetectedFeature[], feature: DetectedFeature) {
  if (features.some((f) => f.category === feature.category)) return;
  features.push(feature);
}

/** Expands contractions and splits possessive "'s" into its own token, so the classifier below only ever sees single words. */
function tokenizeSentence(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    if (!cleaned) continue;

    const expanded = CONTRACTIONS[cleaned];
    if (expanded) {
      tokens.push(...expanded);
      continue;
    }
    if (cleaned.endsWith("'s")) {
      tokens.push(cleaned.slice(0, -2), "'s");
      continue;
    }
    if (cleaned.endsWith("s'")) {
      tokens.push(cleaned.slice(0, -1), "'s");
      continue;
    }
    if (cleaned.endsWith("n't")) {
      tokens.push(cleaned.slice(0, -3), "not");
      continue;
    }
    tokens.push(cleaned);
  }
  return tokens;
}

/**
 * Surfaces that are auxiliaries in one sentence and full verbs in another
 * ("I have a dog" vs "I have seen it"). Disambiguated once per sentence by
 * whether any OTHER token resolves to a verb — if nothing else can be the
 * verb, these are the verb.
 */
const AMBIGUOUS_AUXILIARIES = new Set(["have", "has", "had", "do", "does", "did", "is", "am", "are", "was", "were"]);

/** Longest multiword gloss worth attempting — covers "lie down", "old age" and derivational glosses like "one who runs". */
const MAX_MULTIWORD_LOOKUP = 3;

/**
 * Plenty of glosses are phrases ("lie down", "old age", "one who runs"), and
 * a per-token lookup can never see them. Tries the longest join first so
 * "lie down" wins over the noun "lie (falsehood)" sitting at "lie". Only
 * exact index hits count — no de-inflection across a join, which would make
 * false positives far too easy.
 */
function tryMultiwordLookup(
  tokens: string[],
  start: number,
  index: GlossIndex,
): { item: LexiconItemData; phrase: string; length: number } | null {
  for (let length = Math.min(MAX_MULTIWORD_LOOKUP, tokens.length - start); length >= 2; length--) {
    const phrase = tokens.slice(start, start + length).join(" ");
    const item = lookupAlias(index, phrase);
    if (item) return { item, phrase, length };
  }
  return null;
}

/** The root these resolve to when used as a full verb rather than an auxiliary. */
const AUXILIARY_LEMMA: Record<string, string> = {
  have: "have",
  has: "have",
  had: "have",
  do: "do",
  does: "do",
  did: "do",
  is: "be",
  am: "be",
  are: "be",
  was: "be",
  were: "be",
  be: "be",
  been: "be",
};

function resolveWord(index: GlossIndex, word: string): { item: LexiconItemData | null; feature: DetectedFeature | null } {
  for (const candidate of lookupCandidates(word)) {
    const match = lookupAlias(index, candidate.alias, candidate.posHint);
    if (!match) continue;
    if (candidate.blockedFor?.includes(match.partOfSpeech)) {
      // The root is right but the feature this candidate implies isn't —
      // "sees" is the verb "see", not a plural. Take the match, drop the feature.
      return { item: match, feature: null };
    }
    return { item: match, feature: candidate.feature };
  }
  return { item: null, feature: null };
}

/**
 * Reads one sentence's worth of English into content words carrying
 * features. Grammar-only tokens (articles, auxiliaries, negators,
 * possessive determiners) never become words of their own — they're
 * absorbed into the content word they modify, which is precisely what
 * translating into a language that marks those categories affixally means.
 */
function analyzeSentence(tokens: string[], index: GlossIndex): AnalyzedWord[] {
  // "have"/"is"/"did" are auxiliaries only when something else in the
  // sentence can carry the verb slot.
  const hasOtherVerb = tokens.some(
    (t) => !AMBIGUOUS_AUXILIARIES.has(t) && !NEGATORS.has(t) && resolveWord(index, t).item?.partOfSpeech === "verb",
  );

  const words: AnalyzedWord[] = [];
  let pendingFeatures: DetectedFeature[] = [];
  let pendingSource: string[] = [];

  const flushInto = (word: AnalyzedWord) => {
    for (const feature of pendingFeatures) addFeature(word.features, feature);
    word.source = [...pendingSource, word.source].join(" ");
    pendingFeatures = [];
    pendingSource = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "'s") {
      const previous = words[words.length - 1];
      if (previous) previous.possessive = true;
      continue;
    }

    // "of" has no root in this app's core list; it exists purely to mark the
    // FOLLOWING noun as the possessor of the preceding one.
    if (token === "of") {
      pendingSource.push(token);
      pendingFeatures.push({ category: "case", value: "genitive" });
      continue;
    }

    if (token in ARTICLES) {
      pendingSource.push(token);
      const article = ARTICLES[token];
      if (article) pendingFeatures.push(article);
      continue;
    }

    // "her"/"his" are determiners before a modified word and pronouns
    // otherwise ("her dog" vs "I see her"), decided by whether anything
    // followable comes next.
    const possessive = POSSESSIVE_DETERMINERS[token];
    if (possessive && (token !== "her" || i < tokens.length - 1)) {
      pendingSource.push(token);
      pendingFeatures.push(possessive);
      continue;
    }

    if (NEGATORS.has(token)) {
      pendingSource.push(token);
      pendingFeatures.push({ category: "polarity", value: "negative" });
      continue;
    }

    if (token in AUXILIARIES && (!AMBIGUOUS_AUXILIARIES.has(token) || hasOtherVerb)) {
      pendingSource.push(token);
      const auxiliary = AUXILIARIES[token];
      if (auxiliary) pendingFeatures.push(auxiliary);
      continue;
    }

    const multiword = tryMultiwordLookup(tokens, i, index);
    if (multiword) {
      const word: AnalyzedWord = {
        source: multiword.phrase,
        surface: multiword.phrase,
        item: multiword.item,
        features: [],
        suggestions: [],
        possessive: false,
      };
      flushInto(word);
      words.push(word);
      i += multiword.length - 1;
      continue;
    }

    // A full-verb use of an ambiguous auxiliary resolves through its lemma
    // and keeps whatever tense the surface form carried.
    const lemma: string | undefined = AUXILIARY_LEMMA[token];
    const resolved = lemma ? resolveWord(index, lemma) : resolveWord(index, token);
    const surfaceFeature = lemma ? ((token in AUXILIARIES ? AUXILIARIES[token] : null) ?? null) : resolved.feature;

    const word: AnalyzedWord = {
      source: token,
      surface: token,
      item: resolved.item,
      features: [],
      suggestions: resolved.item ? [] : suggestionsFor(index, token),
      possessive: false,
    };
    if (surfaceFeature) addFeature(word.features, surfaceFeature);
    flushInto(word);
    words.push(word);
  }

  // Trailing grammar with nothing to attach to ("we did not") folds onto the
  // last content word rather than vanishing.
  if (pendingFeatures.length > 0 || pendingSource.length > 0) {
    const last = words[words.length - 1];
    if (last) {
      for (const feature of pendingFeatures) addFeature(last.features, feature);
      last.source = `${last.source} ${pendingSource.join(" ")}`.trim();
    }
  }

  return words;
}

// --- Constituent structure ---

export type WordRole = "subject" | "object" | "verb" | "possessor" | "modifier" | "adposition" | "other";

/** A head noun plus the adjectives modifying it — the unit that has to stay together when a possessor moves to the other side of what it possesses. */
interface NominalGroup {
  head: AnalyzedWord;
  modifiers: AnalyzedWord[];
}

/** A nominal group (with its possessor and adposition) or a verb. Chunks, not words, are what clause reordering moves — an adjective has to travel with the noun it modifies. */
interface Chunk {
  kind: "nominal" | "verbal" | "other";
  head: AnalyzedWord;
  modifiers: AnalyzedWord[];
  possessor: NominalGroup | null;
  adposition: AnalyzedWord | null;
  role: WordRole;
}

function isAdposition(word: AnalyzedWord): boolean {
  return word.item != null && ADPOSITION_CONCEPT_IDS.has(word.item.id);
}

function isConnective(word: AnalyzedWord): boolean {
  return CLAUSE_CONNECTIVES.has(word.surface);
}

/** Unknown words are chunked as nominals so a sentence with one unrecognized noun still reorders correctly — the alternative (bailing to source order) fails on exactly the sentences a 500-root lexicon makes most likely. */
function chunkKindFor(word: AnalyzedWord): "nominal" | "verbal" | "other" {
  if (isConnective(word)) return "other";
  if (!word.item) return "nominal";
  switch (word.item.partOfSpeech) {
    case "verb":
      return "verbal";
    case "noun":
    case "pronoun":
    case "numeral":
      return "nominal";
    case "adjective":
    case "adverb":
    case "function":
      return "other";
  }
}

function isGenitive(word: AnalyzedWord): boolean {
  return word.features.some((f) => f.category === "case" && f.value === "genitive");
}

function nominalChunk(group: NominalGroup, possessor: NominalGroup | null, adposition: AnalyzedWord | null): Chunk {
  return { kind: "nominal", head: group.head, modifiers: group.modifiers, possessor, adposition, role: "other" };
}

/**
 * Groups a sentence's words into constituents. Two English possessive
 * constructions feed the same `possessor` slot from opposite directions:
 * "the child's mother" marks the possessor with "'s" BEFORE the possessed
 * noun, and "the mother of the child" marks it with "of" AFTER — analysis
 * has already turned both into a genitive feature, so this only has to
 * decide which nominal each one hangs on.
 */
function buildChunks(words: AnalyzedWord[]): Chunk[] {
  const chunks: Chunk[] = [];
  let pendingModifiers: AnalyzedWord[] = [];
  let pendingAdposition: AnalyzedWord | null = null;
  let pendingPossessor: NominalGroup | null = null;

  const orphanChunk = (word: AnalyzedWord, role: WordRole): Chunk => ({
    kind: "other",
    head: word,
    modifiers: [],
    possessor: null,
    adposition: null,
    role,
  });

  const flushOrphans = () => {
    // Modifiers or an adposition that never found a head still have to be
    // rendered; each becomes its own chunk in place.
    for (const modifier of pendingModifiers) chunks.push(orphanChunk(modifier, "modifier"));
    if (pendingAdposition) chunks.push(orphanChunk(pendingAdposition, "adposition"));
    pendingModifiers = [];
    pendingAdposition = null;
  };

  for (const word of words) {
    if (isAdposition(word)) {
      pendingAdposition = word;
      continue;
    }
    if (word.item?.partOfSpeech === "adjective") {
      pendingModifiers.push(word);
      continue;
    }

    const kind = chunkKindFor(word);
    if (kind !== "nominal") {
      flushOrphans();
      chunks.push({
        kind,
        head: word,
        modifiers: [],
        possessor: null,
        adposition: null,
        role: kind === "verbal" ? "verb" : "other",
      });
      continue;
    }

    const group: NominalGroup = { head: word, modifiers: pendingModifiers };
    const adposition = pendingAdposition;
    pendingModifiers = [];
    pendingAdposition = null;

    // "the mother of the child" — an "of"-marked nominal is the possessor of
    // the nearest preceding nominal that doesn't already have one.
    if (isGenitive(word) && !word.possessive) {
      const target = [...chunks].reverse().find((c) => c.kind === "nominal" && c.possessor === null);
      if (target) {
        target.possessor = group;
        continue;
      }
    }

    // "the child's mother" — this noun possesses whatever nominal comes
    // next, so it waits rather than becoming a chunk of its own.
    if (word.possessive) {
      if (pendingPossessor) chunks.push(nominalChunk(pendingPossessor, null, null));
      pendingPossessor = group;
      continue;
    }

    chunks.push(nominalChunk(group, pendingPossessor, adposition));
    pendingPossessor = null;
  }

  flushOrphans();
  // A dangling possessor (nothing followed "the child's") still has to render.
  if (pendingPossessor) chunks.push(nominalChunk(pendingPossessor, null, null));
  return chunks;
}

/**
 * Assigns S/V/O and reorders to the language's own constituent order —
 * but only for a clean single clause: exactly one verb, at most one nominal
 * on each side of it, and no coordinator or subordinator anywhere. Anything
 * looser keeps source order, because guessing at the structure of "I see
 * the sun and the moon rises" would produce a confidently wrong sentence
 * rather than an honest one. Intra-chunk orders (adjective, genitive,
 * adposition) apply either way — those are local and never ambiguous.
 *
 * Returns whether the clause was actually reordered so the UI can say so.
 */
function assignRolesAndReorder(chunks: Chunk[], phraseStructure: PhraseStructureData): { chunks: Chunk[]; reordered: boolean } {
  const verbs = chunks.filter((c) => c.kind === "verbal");
  // Every chunk has to be a nominal or the verb. A connective means more than
  // one clause; anything else left over ("where", a stray adverb, an orphan
  // adjective) is material with no S/V/O slot to travel in, and reordering
  // around it would silently relocate it somewhere the English never put it.
  const hasUnplaceable = chunks.some((c) => c.kind === "other");
  if (verbs.length !== 1 || hasUnplaceable) return { chunks, reordered: false };

  const verbIndex = chunks.indexOf(verbs[0]);
  const before = chunks.slice(0, verbIndex).filter((c) => c.kind === "nominal");
  const after = chunks.slice(verbIndex + 1).filter((c) => c.kind === "nominal");
  if (before.length > 1 || after.length > 1) return { chunks, reordered: false };

  const subject = before[0] ?? null;
  const object = after[0] ?? null;
  if (subject) subject.role = "subject";
  if (object) object.role = "object";

  // Grammatical role marking, applied here rather than during analysis
  // because it's a fact about the clause, not about the English word. A
  // chunk with an adposition is skipped: "to the forest" gets its case from
  // the adposition governing it, not from the verb, so marking it accusative
  // would be double-marking a role it doesn't have.
  if (object && !object.adposition) addFeature(object.head.features, { category: "case", value: "accusative" });
  if (subject) {
    const agreement = PRONOUN_AGREEMENT[subject.head.surface] ?? agreementForNoun(subject);
    addFeature(verbs[0].head.features, { category: "agreement", value: agreement });
  }

  const slots: Record<"S" | "V" | "O", Chunk | null> = { S: subject, V: verbs[0], O: object };
  const ordered = phraseStructure.wordOrder
    .split("")
    .map((slot) => slots[slot as "S" | "V" | "O"])
    .filter((c): c is Chunk => c != null);

  return { chunks: ordered, reordered: ordered.length > 1 };
}

function agreementForNoun(subject: Chunk): string {
  return subject.head.features.some((f) => f.category === "number" && f.value === "plural") ? "3pl" : "3sg";
}

type PlacedWord = { word: AnalyzedWord; role: WordRole };

/** A head plus its adjectives, ordered per Greenberg Universal 4 (adjectiveOrder). */
function flattenNominalGroup(group: NominalGroup, headRole: WordRole, phraseStructure: PhraseStructureData): PlacedWord[] {
  const head: PlacedWord[] = [{ word: group.head, role: headRole }];
  if (group.modifiers.length === 0) return head;
  const modifiers: PlacedWord[] = group.modifiers.map((word) => ({ word, role: "modifier" }));
  return phraseStructure.adjectiveOrder === "adjectiveNoun" ? [...modifiers, ...head] : [...head, ...modifiers];
}

/** Flattens a chunk into surface order, applying the three Greenberg-derived orders Syntax generated (Universals 2/3/4) — adposition wraps the whole nominal group, possessor and adjectives sit on whichever side the language puts them. */
function flattenChunk(chunk: Chunk, phraseStructure: PhraseStructureData): PlacedWord[] {
  if (chunk.kind !== "nominal") return [{ word: chunk.head, role: chunk.role }];

  let group = flattenNominalGroup({ head: chunk.head, modifiers: chunk.modifiers }, chunk.role, phraseStructure);

  if (chunk.possessor) {
    addFeature(chunk.possessor.head.features, { category: "case", value: "genitive" });
    const possessor = flattenNominalGroup(chunk.possessor, "possessor", phraseStructure);
    group = phraseStructure.genitiveOrder === "genitiveNoun" ? [...possessor, ...group] : [...group, ...possessor];
  }

  if (chunk.adposition) {
    const adposition: PlacedWord = { word: chunk.adposition, role: "adposition" };
    group = phraseStructure.adpositionOrder === "prepositional" ? [adposition, ...group] : [...group, adposition];
  }

  return group;
}

// --- Affix selection ---

function isZeroMarked(value: AffixValueRef): boolean {
  return CATEGORY_MAP.get(value.category)?.values.find((v) => v.id === value.value)?.zeroMarked ?? false;
}

/**
 * How badly an affix over-marks a word, given everything the English
 * actually asked for. Only matters for a fusional language, where a single
 * affix realizes a whole bundle of categories at once and several bundles
 * can realize the requested value — picking the first one found silently
 * pluralizes singular nouns and the like. Lower is better:
 * - a value the input DID ask for is free;
 * - a category the input said nothing about is nearly free if the bundle
 *   uses that category's unmarked baseline (a singular noun should ride in
 *   on the singular cell), and costly otherwise;
 * - contradicting a value the input explicitly asked for is disqualifying
 *   in all but name.
 */
function overMarkingPenalty(affix: MorphologyAffixData, features: DetectedFeature[]): number {
  let penalty = 0;
  for (const value of affix.values) {
    const requested = features.find((f) => f.category === value.category);
    if (requested) {
      if (requested.value !== value.value) penalty += 100;
      continue;
    }
    penalty += isZeroMarked(value) ? 1 : 10;
  }
  return penalty;
}

/**
 * Which of a word's detected features this language actually marks, and
 * with which generated affixes.
 *
 * Three things can stop a feature becoming an affix, and only the last is
 * worth telling the user about:
 * - the value is the typologically-unmarked baseline (CategoryValue.zeroMarked)
 *   — a bare root IS the correct output, so this is silent;
 * - an already-chosen fusional affix bundles that category too;
 * - the language never generated an affix for it, because Morphology didn't
 *   select that category at all. That one is reported as `unmarked`.
 *
 * A fusional affix can also drag in a value the English never asked for and
 * that has no unmarked baseline to fall back on — a language that fuses case
 * with possession genuinely cannot write "the forest" without saying whose.
 * Those come back as `incidental` so the UI can explain the extra gloss
 * rather than leaving it looking like a bug.
 */
function selectAffixes(
  features: DetectedFeature[],
  affixes: MorphologyAffixData[],
): { applied: MorphologyAffixData[]; unmarked: DetectedFeature[]; incidental: AffixValueRef[] } {
  const ordered = [...features].sort((a, b) => {
    const ai = AFFIX_APPLICATION_ORDER.indexOf(a.category);
    const bi = AFFIX_APPLICATION_ORDER.indexOf(b.category);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });

  const applied: MorphologyAffixData[] = [];
  const unmarked: DetectedFeature[] = [];
  const incidental: AffixValueRef[] = [];
  const covered = new Set<CategoryId>();

  for (const feature of ordered) {
    if (covered.has(feature.category)) continue;
    if (isZeroMarked(feature)) {
      covered.add(feature.category);
      continue;
    }

    const candidates = affixes.filter((a) =>
      a.values.some((v) => v.category === feature.category && v.value === feature.value),
    );
    if (candidates.length === 0) {
      unmarked.push(feature);
      continue;
    }

    // Stable: ties keep generation order, so the same word always inflects
    // the same way.
    let best = candidates[0];
    let bestPenalty = overMarkingPenalty(best, features);
    for (const candidate of candidates.slice(1)) {
      const penalty = overMarkingPenalty(candidate, features);
      if (penalty < bestPenalty) {
        best = candidate;
        bestPenalty = penalty;
      }
    }

    applied.push(best);
    for (const value of best.values) {
      if (!features.some((f) => f.category === value.category) && !isZeroMarked(value)) incidental.push(value);
      covered.add(value.category);
    }
  }

  return { applied, unmarked, incidental };
}

// --- Output ---

export interface TranslatedWord {
  /** English as typed, including absorbed grammar words. */
  source: string;
  /** Just this word's own surface form, without absorbed grammar — what a "did you mean" replacement has to swap out of the user's input. */
  surface: string;
  item: LexiconItemData | null;
  role: WordRole;
  /** IPA surface form of the assembled word; empty when no root resolved. */
  form: string;
  phonemeIds: string[];
  stressedPhonemeIndex: number | undefined;
  appliedAffixes: MorphologyAffixData[];
  /** Features this language has no affix for — surfaced as "your language doesn't mark this", not as an error. */
  unmarkedFeatures: DetectedFeature[];
  /** Values a fusional affix forced onto the word that the English never asked for (see selectAffixes). */
  incidentalValues: AffixValueRef[];
  glyphSteps: GlyphSequenceStep[];
  /** Set when an ablaut/templatic affix modified the root in place — rendered as a whole-word marker, same contract as ComposedWord.nonSegmentalTreatment. */
  nonSegmentalTreatment: BoundaryTreatment | null;
  /** Lexicon glosses to offer when `item` is null. */
  suggestions: string[];
}

export interface TranslatedSentence {
  words: TranslatedWord[];
  /** Whether clause-level constituent reordering applied (see assignRolesAndReorder). */
  reordered: boolean;
  terminator: string;
}

export interface TranslationResult {
  sentences: TranslatedSentence[];
  resolvedCount: number;
  totalCount: number;
}

export interface TranslateArgs {
  text: string;
  lexiconItems: LexiconItemData[];
  /** Pass [] when Morphology hasn't been generated — every word comes out as a bare root, which is what an isolating language looks like anyway. */
  morphologyItems: MorphologyAffixData[];
  phonology: PhonologyData;
  allomorphy: AllomorphyData;
  mapping: SoundToSymbolMapping;
  aesthetic: Aesthetic;
  /** Pass null when Syntax hasn't been generated — source order is kept and nothing is reordered. */
  phraseStructure: PhraseStructureData | null;
  /** Prebuilt index, so a component can memoize it across keystrokes instead of rebuilding 500 roots per render. */
  glossIndex?: GlossIndex;
}

/** Source order, used when Syntax hasn't been generated yet — every order is "keep what the user typed". */
const SOURCE_ORDER_STRUCTURE: PhraseStructureData = {
  wordOrder: "SVO",
  adpositionOrder: "prepositional",
  genitiveOrder: "genitiveNoun",
  adjectiveOrder: "adjectiveNoun",
};

/**
 * Logographic scripts write a whole word as one concept sign, so there's no
 * per-phoneme grapheme walk to do — composeWordGlyphSequence deliberately
 * returns nothing for them (see groupIntoGraphemes). The sign is looked up
 * by concept id directly, and inflection simply isn't visible in the
 * script, which is true of real logographies too.
 */
function logographicSteps(item: LexiconItemData, mapping: SoundToSymbolMapping): GlyphSequenceStep[] {
  if (mapping.kind !== "logographic") return [];
  const glyphId = mapping.conceptToGlyph[item.id];
  return glyphId ? [{ glyphId, junctionBefore: null }] : [];
}

export function translate(args: TranslateArgs): TranslationResult {
  const { text, lexiconItems, morphologyItems, phonology, allomorphy, mapping, aesthetic } = args;
  const index = args.glossIndex ?? buildGlossIndex(lexiconItems);
  const phraseStructure = args.phraseStructure ?? SOURCE_ORDER_STRUCTURE;
  const canReorder = args.phraseStructure != null;

  const sentences: TranslatedSentence[] = [];
  let resolvedCount = 0;
  let totalCount = 0;

  for (const { body, terminator } of splitSentences(text)) {
    const analyzed = analyzeSentence(tokenizeSentence(body), index);
    if (analyzed.length === 0) continue;

    const chunks = buildChunks(analyzed);
    const { chunks: orderedChunks, reordered } = canReorder
      ? assignRolesAndReorder(chunks, phraseStructure)
      : { chunks, reordered: false };

    const flattened = orderedChunks.flatMap((chunk) => flattenChunk(chunk, phraseStructure));

    const words = flattened.map(({ word, role }) => {
      totalCount += 1;
      if (!word.item) {
        return {
          source: word.source,
          surface: word.surface,
          item: null,
          role,
          form: "",
          phonemeIds: [],
          stressedPhonemeIndex: undefined,
          appliedAffixes: [],
          unmarkedFeatures: [],
          incidentalValues: [],
          glyphSteps: [],
          nonSegmentalTreatment: null,
          suggestions: word.suggestions,
        } satisfies TranslatedWord;
      }
      resolvedCount += 1;

      const domain = word.item.partOfSpeech === "verb" ? "verbal" : "nominal";
      const { applied, unmarked, incidental } = selectAffixes(
        word.features,
        morphologyItems.filter((a) => a.domain === domain),
      );
      const assembled = applyAffixesToRoot(word.item, applied, phonology, allomorphy);
      const composed =
        mapping.kind === "logographic"
          ? { steps: logographicSteps(word.item, mapping), nonSegmentalTreatment: null }
          : composeWordGlyphSequence(assembled, applied, phonology, mapping, aesthetic, word.item.toneValues);

      return {
        source: word.source,
        surface: word.surface,
        item: word.item,
        role,
        form: assembled.form,
        phonemeIds: assembled.phonemeIds,
        stressedPhonemeIndex: assembled.stressedPhonemeIndex,
        appliedAffixes: applied,
        unmarkedFeatures: unmarked,
        incidentalValues: incidental,
        glyphSteps: composed.steps,
        nonSegmentalTreatment: composed.nonSegmentalTreatment,
        suggestions: [],
      } satisfies TranslatedWord;
    });

    sentences.push({ words, reordered, terminator });
  }

  return { sentences, resolvedCount, totalCount };
}

function splitSentences(text: string): Array<{ body: string; terminator: string }> {
  const out: Array<{ body: string; terminator: string }> = [];
  const pattern = /([^.!?;]+)([.!?;]*)/g;
  let match = pattern.exec(text);
  while (match) {
    if (match[1].trim()) out.push({ body: match[1], terminator: match[2].replace(/;/g, "") });
    match = pattern.exec(text);
  }
  return out;
}
