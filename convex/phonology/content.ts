// Curated implicational-hierarchy catalog (Section 4.1) — informed by
// cross-linguistic frequency patterns (UPSID/PHOIBLE-style universals), not
// exhaustive IPA coverage. `tier` + `prerequisites` drive core-outward
// selection in generate.ts. Depth belongs in the selection algorithm, not
// table size — this catalog is a plain, cheaply-extensible data array.
//
// `locked` here is always `false` — this is the catalog, not a generated
// inventory. generate.ts copies entries out of this table into a language's
// actual PhonologyData, where `locked` becomes meaningful.

import type { ConsonantPhoneme, PhonologyParams, VowelPhoneme } from "./types";

function c(
  id: string,
  ipa: string,
  place: ConsonantPhoneme["features"]["place"],
  manner: ConsonantPhoneme["features"]["manner"],
  voiced: boolean,
  tier: ConsonantPhoneme["tier"],
  prerequisites: string[] = [],
): ConsonantPhoneme {
  return { id, ipa, features: { place, manner, voiced }, tier, prerequisites, locked: false };
}

function v(
  id: string,
  ipa: string,
  height: VowelPhoneme["features"]["height"],
  backness: VowelPhoneme["features"]["backness"],
  rounded: boolean,
  tier: VowelPhoneme["tier"],
  prerequisites: string[] = [],
): VowelPhoneme {
  return { id, ipa, features: { height, backness, rounded }, tier, prerequisites, locked: false };
}

export const CONSONANT_CATALOG: ConsonantPhoneme[] = [
  // Core: near-universal across the world's languages.
  c("p", "p", "bilabial", "stop", false, "core"),
  c("t", "t", "alveolar", "stop", false, "core"),
  c("k", "k", "velar", "stop", false, "core"),
  c("m", "m", "bilabial", "nasal", true, "core"),
  c("n", "n", "alveolar", "nasal", true, "core"),
  c("s", "s", "alveolar", "fricative", false, "core"),
  c("j_glide", "j", "palatal", "approximant", true, "core"),
  c("w", "w", "bilabial", "approximant", true, "core"),
  c("l", "l", "alveolar", "lateralApproximant", true, "core"),

  // Common: frequent, gated by their voiceless/plain counterpart being present.
  c("b", "b", "bilabial", "stop", true, "common", ["p"]),
  c("d", "d", "alveolar", "stop", true, "common", ["t"]),
  c("g", "g", "velar", "stop", true, "common", ["k"]),
  c("f", "f", "labiodental", "fricative", false, "common"),
  c("v", "v", "labiodental", "fricative", true, "common", ["f"]),
  c("z", "z", "alveolar", "fricative", true, "common", ["s"]),
  c("sh", "ʃ", "postalveolar", "fricative", false, "common"),
  c("zh", "ʒ", "postalveolar", "fricative", true, "common", ["sh"]),
  c("ch", "tʃ", "postalveolar", "affricate", false, "common"),
  c("j_affricate", "dʒ", "postalveolar", "affricate", true, "common", ["ch"]),
  c("h", "h", "glottal", "fricative", false, "common"),
  c("ng", "ŋ", "velar", "nasal", true, "common", ["n", "k"]),
  c("r_trill", "r", "alveolar", "trill", true, "common"),
  c("r_tap", "ɾ", "alveolar", "tap", true, "common"),
  c("x", "x", "velar", "fricative", false, "common", ["k"]),
  c("q", "q", "uvular", "stop", false, "common", ["k"]),
  c("gh", "ɣ", "velar", "fricative", true, "common", ["x"]),
  c("th_voiceless", "θ", "dental", "fricative", false, "common"),
  c("th_voiced", "ð", "dental", "fricative", true, "common", ["th_voiceless"]),

  // Marked: gated behind explicit user toggles (markedFeatures), never
  // added just because the inventory-size slider wants more phonemes.
  c("p_ejective", "pʼ", "bilabial", "ejective", false, "marked", ["p"]),
  c("t_ejective", "tʼ", "alveolar", "ejective", false, "marked", ["t"]),
  c("k_ejective", "kʼ", "velar", "ejective", false, "marked", ["k"]),
  c("click_dental", "ǀ", "dental", "click", false, "marked"),
  c("click_alveolar", "ǃ", "alveolar", "click", false, "marked"),
  c("b_implosive", "ɓ", "bilabial", "implosive", true, "marked", ["b"]),
  c("d_implosive", "ɗ", "alveolar", "implosive", true, "marked", ["d"]),
];

export const VOWEL_CATALOG: VowelPhoneme[] = [
  // Core: the cross-linguistically minimal three-vowel system.
  v("i", "i", "high", "front", false, "core"),
  v("a", "a", "low", "central", false, "core"),
  v("u", "u", "high", "back", true, "core"),

  // Common: fills out typical 5-7 vowel systems, gated by the corresponding
  // closer vowel being present (a language with /e/ almost always has /i/).
  v("e", "e", "mid", "front", false, "common", ["i"]),
  v("o", "o", "mid", "back", true, "common", ["u"]),
  v("open_e", "ɛ", "nearLow", "front", false, "common", ["e"]),
  v("open_o", "ɔ", "nearLow", "back", true, "common", ["o"]),
  v("schwa", "ə", "mid", "central", false, "common"),
  v("small_i", "ɪ", "nearHigh", "front", false, "common", ["i"]),
  v("small_u", "ʊ", "nearHigh", "back", true, "common", ["u"]),
  v("back_a", "ɑ", "low", "back", false, "common", ["a"]),

  // Marked: front rounded vowels, gated behind markedFeatures.frontRoundedVowels
  // — implies their front unrounded counterpart is present (Section 4.1).
  v("y", "y", "high", "front", true, "marked", ["i"]),
  v("oe", "ø", "mid", "front", true, "marked", ["e"]),
];

type MarkedFeatureKey = keyof PhonologyParams["markedFeatures"];

/** Which marked-feature toggle gates each marked-tier catalog entry. */
export const CONSONANT_MARKED_GATE: Record<string, MarkedFeatureKey> = {
  p_ejective: "ejectives",
  t_ejective: "ejectives",
  k_ejective: "ejectives",
  click_dental: "clicks",
  click_alveolar: "clicks",
  b_implosive: "implosives",
  d_implosive: "implosives",
};

export const VOWEL_MARKED_GATE: Record<string, MarkedFeatureKey> = {
  y: "frontRoundedVowels",
  oe: "frontRoundedVowels",
};

export const CONSONANT_INVENTORY_TARGET: Record<PhonologyParams["consonantInventorySize"], number> = {
  small: 14,
  medium: 20,
  large: 27,
};

export const VOWEL_INVENTORY_TARGET: Record<PhonologyParams["vowelInventorySize"], number> = {
  small: 5,
  medium: 7,
  large: 10,
};
