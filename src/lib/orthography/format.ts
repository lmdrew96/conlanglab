import type { Aesthetic, ScriptCategory } from "./engine";

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
