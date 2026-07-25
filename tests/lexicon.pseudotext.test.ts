import { describe, expect, it } from "vitest";
import { generatePseudotext } from "../src/lib/lexicon/pseudotext";
import type { LexiconItemData } from "../convex/lexicon/types";

function fakeItem(id: string, phonologicalForm: string): LexiconItemData {
  return {
    version: 1,
    id,
    kind: "flexible",
    domain: "nautical",
    partOfSpeech: "noun",
    meaning: id,
    phonologicalForm,
    phonemeIds: [],
    seed: { base: 0, variation: 0 },
    locked: false,
  };
}

const ITEMS: LexiconItemData[] = [
  fakeItem("a", "ˈta.mo"),
  fakeItem("b", "ku.ˈsen"),
  fakeItem("c", "ˈrin"),
  fakeItem("d", "va.ˈlu.ki"),
];

describe("generatePseudotext", () => {
  it("returns nothing for an empty pool", () => {
    expect(generatePseudotext([], 7)).toEqual([]);
  });

  it("is deterministic for the same items and seed", () => {
    expect(generatePseudotext(ITEMS, 7)).toEqual(generatePseudotext(ITEMS, 7));
  });

  it("changes with the seed", () => {
    expect(generatePseudotext(ITEMS, 7)).not.toEqual(generatePseudotext(ITEMS, 8));
  });

  it("produces 1-2 sentences, each ending in . or !, built only from the given forms", () => {
    const sentences = generatePseudotext(ITEMS, 7);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences.length).toBeLessThanOrEqual(2);
    const forms = new Set(ITEMS.map((i) => i.phonologicalForm));
    for (const sentence of sentences) {
      expect(/[.!]$/.test(sentence)).toBe(true);
      const words = sentence.slice(0, -1).split(" ");
      for (const word of words) expect(forms.has(word)).toBe(true);
    }
  });
});
