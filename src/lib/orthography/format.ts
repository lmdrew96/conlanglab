import type { AncestorScriptFamily, Aesthetic, BoundaryTreatment, OverflowStrategy, ScriptCategory } from "./engine";

/** The mark drawn between two glyphs at a morpheme junction (design doc Section 8.3). Shared by every surface that renders a composed word so the same junction never reads two different ways. */
const BOUNDARY_TREATMENT_MARKS: Record<BoundaryTreatment, string> = {
  adjacency: "·",
  ligature: "‿",
  diacritic: "⁺",
};

export function boundaryTreatmentMark(treatment: BoundaryTreatment): string {
  return BOUNDARY_TREATMENT_MARKS[treatment];
}

const BOUNDARY_TREATMENT_LABELS: Record<BoundaryTreatment, string> = {
  adjacency: "Adjacent — the affix's glyphs simply sit next to the root's",
  ligature: "Ligature — a connecting stroke joins the affix to the root",
  diacritic: "Diacritic — the affix is marked on the root's own glyph rather than beside it",
};

export function boundaryTreatmentInfo(treatment: BoundaryTreatment): string {
  return BOUNDARY_TREATMENT_LABELS[treatment];
}

const SCRIPT_CATEGORY_LABELS: Record<ScriptCategory, string> = {
  alphabetic: "Alphabetic",
  abjad: "Abjad",
  abugida: "Abugida",
  syllabic: "Syllabic",
  logographic: "Logographic",
};

export function formatScriptCategory(category: ScriptCategory): string {
  return SCRIPT_CATEGORY_LABELS[category];
}

const SCRIPT_CATEGORY_INFO: Record<ScriptCategory, string> = {
  alphabetic: "One symbol per consonant and vowel — the most flexible mapping (English, Korean Hangul, Greek).",
  abjad: "Consonants only get symbols; vowels go unwritten (Arabic, Hebrew).",
  abugida: "A base symbol per consonant, with vowels marked as diacritics attached to it (Devanagari, Ge'ez).",
  syllabic: "One symbol per attested consonant+vowel syllable, not per individual sound (Japanese hiragana/katakana).",
  logographic: "One symbol per word/concept rather than per sound (Chinese characters).",
};

export function scriptCategoryInfo(category: ScriptCategory): string {
  return SCRIPT_CATEGORY_INFO[category] ?? "";
}

export function formatAesthetic(aesthetic: Aesthetic): string {
  return aesthetic === "invented" ? "Invented" : "Real-like";
}

const AESTHETIC_INFO: Record<Aesthetic, string> = {
  invented: "Alien, wholly novel glyph shapes with no visual reference to any existing script.",
  realLike:
    "Glyph shapes evoke the visual logic of real script families (Latin/Cyrillic/Arabic/Devanagari-style strokes) without reproducing actual letterforms.",
};

export function aestheticInfo(aesthetic: Aesthetic): string {
  return AESTHETIC_INFO[aesthetic] ?? "";
}

const ANCESTOR_SCRIPT_LABELS: Record<AncestorScriptFamily, string> = {
  latin: "Latin",
  cyrillic: "Cyrillic",
  arabic: "Arabic",
  devanagari: "Devanagari",
  hangul: "Hangul",
};

export function formatAncestorScript(ancestorScript: AncestorScriptFamily | null): string {
  return ancestorScript ? ANCESTOR_SCRIPT_LABELS[ancestorScript] : "None";
}

const ANCESTOR_SCRIPT_INFO: Record<AncestorScriptFamily, string> = {
  latin: "Biases toward a balanced mix of blocky and flowing strokes with moderate jitter — evokes Latin's plain, upright letterforms without copying them.",
  cyrillic: "Similar to Latin's balance, slightly looser jitter — evokes Cyrillic's related-but-distinct letterforms.",
  arabic: "Biases heavily toward flowing, curved strokes — evokes Arabic's cursive, joined quality without copying its letterforms.",
  devanagari: "Biases toward flowing strokes with a moderate lean toward geometric marks — evokes Devanagari's rounded, connected quality.",
  hangul: "Biases heavily toward blocky, geometric strokes with tight, regular jitter — evokes Hangul's featural, block-composed letterforms.",
};

export function ancestorScriptInfo(ancestorScript: AncestorScriptFamily): string {
  return ANCESTOR_SCRIPT_INFO[ancestorScript] ?? "";
}

const OVERFLOW_STRATEGY_LABELS: Record<OverflowStrategy, string> = {
  digraph: "Digraphs",
  diacriticStacking: "Diacritic stacking",
  extendedInventory: "Extended inventory",
};

export function formatOverflowStrategy(strategy: OverflowStrategy): string {
  return OVERFLOW_STRATEGY_LABELS[strategy];
}

const OVERFLOW_STRATEGY_INFO: Record<OverflowStrategy, string> = {
  digraph: "Sounds beyond the base letter set are spelled with a pair of existing letters, like English \"th\" or \"sh\".",
  diacriticStacking: "Sounds beyond the base letter set reuse a letter's shape with an added mark, like Vietnamese's diacritic vowels.",
  extendedInventory: "Every sound gets its own dedicated letter, however large the inventory gets — the Cyrillic route.",
};

export function overflowStrategyInfo(strategy: OverflowStrategy): string {
  return OVERFLOW_STRATEGY_INFO[strategy];
}
