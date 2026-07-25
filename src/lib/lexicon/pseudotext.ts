// Fake "pseudotext" sentences built from already-sampled preview roots —
// pure flavor for the live preview panel (ConGen-inspired, see the
// OSS-generator research patch), not a syntax engine. No grammar, no word
// order rules — that's M5 (Syntax Engine). Deterministic: same items +
// seedBase always produce the same sentences, matching the "pure function
// of inputs" convention the rest of Lexicon follows.

import { Rng, deriveSeed } from "../../../convex/lib/rng";
import type { LexiconItemData } from "./engine";

const PSEUDOTEXT_SALT = 0xf00d;
const SENTENCE_COUNT = 2;
const MIN_WORDS_PER_SENTENCE = 3;
const MAX_WORDS_PER_SENTENCE = 6;
const EXCLAMATION_CHANCE = 0.2;

/**
 * Sample `count` words with replacement from `items` — a fake sentence
 * reusing a word twice is expected and fine here, this is flavor text over
 * a small preview pool, not a lexicon-integrity concern the way exact
 * phonological-form duplication in the generated lexicon itself is.
 */
function sampleSentence(rng: Rng, items: LexiconItemData[]): string {
  const wordCount = rng.int(MIN_WORDS_PER_SENTENCE, MAX_WORDS_PER_SENTENCE);
  const words = Array.from({ length: wordCount }, () => rng.pick(items).phonologicalForm);
  const punctuation = rng.chance(EXCLAMATION_CHANCE) ? "!" : ".";
  return words.join(" ") + punctuation;
}

/**
 * Builds 1-2 fake sentences from the currently-sampled preview roots.
 * Read-only, never persisted — same contract as `samplePreviewRoots`.
 * Forms are left as generated IPA (no capitalization): these are phonemic
 * transcriptions, not romanized letters, and most IPA symbols have no
 * conventional capital form — so imposing sentence-casing here would just
 * look broken rather than lending the fake text any real orthographic feel.
 */
export function generatePseudotext(items: LexiconItemData[], seedBase: number): string[] {
  if (items.length === 0) return [];
  const rng = new Rng(deriveSeed(seedBase, PSEUDOTEXT_SALT));
  return Array.from({ length: SENTENCE_COUNT }, () => sampleSentence(rng, items));
}
