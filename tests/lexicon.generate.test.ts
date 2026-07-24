import { describe, expect, it } from "vitest";
import { generatePhonology } from "../convex/phonology/generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "../convex/phonology/types";
import { COMPOUND_LIST, CORE_LIST, FLEXIBLE_LIST } from "../convex/lexicon/content";
import { generateLexicon, regenerateSingleItem } from "../convex/lexicon/generate";
import { DEFAULT_LEXICON_PARAMS, ROOT_TARGET } from "../convex/lexicon/types";
import type { PhonologyData } from "../convex/phonology/types";
import type { LexiconItemData } from "../convex/lexicon/types";

const FIXED_NOW = 1_700_000_000_000;

function testPhonology(seedBase: number): PhonologyData {
  return generatePhonology({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_PARAMS,
    previous: null,
    targets: ALL_TARGETS,
    mode: "initial",
    now: FIXED_NOW,
  });
}

function generateInitial(seedBase: number, phonology: PhonologyData) {
  return generateLexicon({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_LEXICON_PARAMS,
    phonology,
    previousItems: [],
    mode: "initial",
    now: FIXED_NOW,
  });
}

describe("generateLexicon determinism", () => {
  const phonology = testPhonology(42);

  it("produces identical output for identical inputs", () => {
    const a = generateInitial(7, phonology);
    const b = generateInitial(7, phonology);
    expect(a).toEqual(b);
  });

  it("produces different output for a different seed", () => {
    const a = generateInitial(7, phonology);
    const b = generateInitial(8, phonology);
    expect(a).not.toEqual(b);
  });

  it("always includes every core concept", () => {
    const { items } = generateInitial(7, phonology);
    const ids = new Set(items.map((i) => i.id));
    for (const c of CORE_LIST) expect(ids.has(c.id)).toBe(true);
  });

  it("always includes every compound", () => {
    const { items } = generateInitial(7, phonology);
    const ids = new Set(items.map((i) => i.id));
    for (const c of COMPOUND_LIST) expect(ids.has(c.id)).toBe(true);
  });

  it("hits the root target", () => {
    const { items, stage } = generateInitial(7, phonology);
    expect(items.length).toBe(ROOT_TARGET);
    expect(stage.itemCount).toBe(ROOT_TARGET);
  });

  it("fills the remaining budget from flexible domains, not exceeding the pool", () => {
    const { items } = generateInitial(7, phonology);
    const flexibleCount = items.filter((i) => i.kind === "flexible").length;
    const expectedBudget = ROOT_TARGET - CORE_LIST.length - COMPOUND_LIST.length;
    expect(flexibleCount).toBe(Math.min(expectedBudget, FLEXIBLE_LIST.length));
  });

  it("skews flexible selection toward domains with higher weight", () => {
    // Budget (46) exceeds the nautical pool (18), so once nautical is
    // exhausted, selection spills into other domains rather than leaving
    // the budget unfilled — weight is a bias, not a hard exclusion filter.
    const nauticalPoolSize = FLEXIBLE_LIST.filter((c) => c.domain === "nautical").length;
    const params = {
      domainWeights: { nautical: 1, agricultural: 0, martial: 0, mercantile: 0, pastoral: 0, craft: 0 },
    };
    const { items } = generateLexicon({
      seed: { base: 7, variation: 0 },
      params,
      phonology,
      previousItems: [],
      mode: "initial",
      now: FIXED_NOW,
    });
    const flexible = items.filter((i) => i.kind === "flexible");
    const nauticalCount = flexible.filter((i) => i.domain === "nautical").length;
    expect(nauticalCount).toBe(nauticalPoolSize);
  });

  it("produces every root as phonotactically valid syllables (non-empty phoneme lists)", () => {
    const { items } = generateInitial(7, phonology);
    for (const item of items) {
      expect(item.phonemeIds.length).toBeGreaterThan(0);
      expect(item.phonologicalForm.length).toBeGreaterThan(0);
    }
  });

  it("compounds combine their two components' forms", () => {
    const { items } = generateInitial(7, phonology);
    const byId = new Map(items.map((i) => [i.id, i]));
    const compound = items.find((i) => i.kind === "compound")!;
    expect(compound.componentIds).toBeDefined();
    const [aId, bId] = compound.componentIds!;
    const a = byId.get(aId)!;
    const b = byId.get(bId)!;
    expect(compound.phonemeIds).toEqual([...a.phonemeIds, ...b.phonemeIds]);
  });

  it("a locked item survives a reroll unchanged", () => {
    const initial = generateInitial(7, phonology);
    const lockedItem: LexiconItemData = { ...initial.items[0], locked: true };
    const previousItems = initial.items.map((i) => (i.id === lockedItem.id ? lockedItem : i));

    const rerolled = generateLexicon({
      seed: { base: 999, variation: 0 },
      params: DEFAULT_LEXICON_PARAMS,
      phonology,
      previousItems,
      mode: "reroll",
      now: FIXED_NOW,
    });

    const survived = rerolled.items.find((i) => i.id === lockedItem.id);
    expect(survived).toEqual(lockedItem);
  });

  it("regenerateSingleItem only changes the targeted item and its dependent compounds", () => {
    const initial = generateInitial(7, phonology);
    const target = initial.items.find((i) => i.kind === "core" && i.id === "hand")!;

    const updated = regenerateSingleItem({
      conceptId: "hand",
      phonology,
      previous: target,
      allItems: initial.items,
      mode: "reroll",
      freshSeedBase: 12345,
    });

    const updatedIds = new Set(updated.map((i) => i.id));
    expect(updatedIds.has("hand")).toBe(true);
    // "glove", "strength", and "generosity" all consume "hand" as a component.
    expect(updatedIds.has("glove")).toBe(true);
    expect(updatedIds.has("strength")).toBe(true);
    expect(updatedIds.has("generosity")).toBe(true);
  });
});
