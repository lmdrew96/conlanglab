import type { AdjectiveOrder, AdpositionOrder, GenitiveOrder, PhraseStructureData, WordOrder } from "./engine";

const SLOT_LABELS: Record<"S" | "O" | "V", string> = { S: "Subject", O: "Object", V: "Verb" };

export function formatWordOrder(order: WordOrder): string {
  return order
    .split("")
    .map((slot) => SLOT_LABELS[slot as "S" | "O" | "V"])
    .join("–");
}

const WORD_ORDER_INFO: Record<WordOrder, string> = {
  SOV: "Verb-final — the most common word order cross-linguistically (Japanese, Turkish, Korean, Latin).",
  SVO: "Verb-medial — the second most common order (English, Mandarin, Swahili).",
  VSO: "Verb-initial (Classical Arabic, Irish, Welsh).",
  VOS: "Verb-initial, object before subject — rare (Malagasy, some Mayan languages).",
  OVS: "Object-initial — very rare (Hixkaryana).",
  OSV: "Object-initial, subject last — the rarest attested order (a few Amazonian languages).",
};

export function wordOrderInfo(order: WordOrder): string {
  return WORD_ORDER_INFO[order] ?? "";
}

export function formatAdpositionOrder(order: AdpositionOrder): string {
  return order === "prepositional" ? "Prepositional" : "Postpositional";
}

export function formatGenitiveOrder(order: GenitiveOrder): string {
  return order === "genitiveNoun" ? "Possessor before noun" : "Possessor after noun";
}

export function formatAdjectiveOrder(order: AdjectiveOrder): string {
  return order === "adjectiveNoun" ? "Adjective before noun" : "Adjective after noun";
}

/** Section 7.2's "basic phrase-structure rules" as human-readable lines, derived from the Greenberg-correlated fields in PhraseStructureData. */
export function formatPhraseRules(data: PhraseStructureData): string[] {
  return [
    `Sentence: ${formatWordOrder(data.wordOrder)}`,
    data.adjectiveOrder === "adjectiveNoun" ? "Noun Phrase: Adjective + Noun" : "Noun Phrase: Noun + Adjective",
    data.genitiveOrder === "genitiveNoun"
      ? "Possessive Phrase: Possessor + Noun"
      : "Possessive Phrase: Noun + Possessor",
    data.adpositionOrder === "prepositional"
      ? "Adpositional Phrase: Preposition + Noun"
      : "Adpositional Phrase: Noun + Postposition",
  ];
}
