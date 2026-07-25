import { describe, expect, it } from "vitest";
import { generatePhonology } from "../convex/phonology/generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "../convex/phonology/types";
import { CATEGORY_MAP, TYPOLOGY_CATEGORY_COUNT } from "../convex/morphology/content";
import { generateMorphology, regenerateSingleItem } from "../convex/morphology/generate";
import { DEFAULT_MORPHOLOGY_PARAMS } from "../convex/morphology/types";
import type { PhonologyData } from "../convex/phonology/types";
import type { MorphologicalType, MorphologyAffixData } from "../convex/morphology/types";

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

function generateInitial(seedBase: number, phonology: PhonologyData, typology: MorphologicalType = DEFAULT_MORPHOLOGY_PARAMS.typology) {
  return generateMorphology({
    seed: { base: seedBase, variation: 0 },
    params: { typology },
    phonology,
    previousItems: [],
    mode: "initial",
    now: FIXED_NOW,
  });
}

describe("generateMorphology determinism", () => {
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
});

describe("typology drives category count (Section 5.3: plausible subset, not maximal)", () => {
  const phonology = testPhonology(42);

  it("isolating selects within its low category-count range across several seeds", () => {
    const [min, max] = TYPOLOGY_CATEGORY_COUNT.isolating;
    for (let seed = 1; seed <= 8; seed++) {
      const { stage } = generateInitial(seed, phonology, "isolating");
      expect(stage.selectedCategories.length).toBeGreaterThanOrEqual(min);
      expect(stage.selectedCategories.length).toBeLessThanOrEqual(max);
    }
  });

  it("polysynthetic selects within its high category-count range across several seeds", () => {
    const [min, max] = TYPOLOGY_CATEGORY_COUNT.polysynthetic;
    for (let seed = 1; seed <= 8; seed++) {
      const { stage } = generateInitial(seed, phonology, "polysynthetic");
      expect(stage.selectedCategories.length).toBeGreaterThanOrEqual(min);
      expect(stage.selectedCategories.length).toBeLessThanOrEqual(max);
    }
  });

  it("isolating never selects more categories than polysynthetic, seed for seed", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const isolating = generateInitial(seed, phonology, "isolating");
      const polysynthetic = generateInitial(seed, phonology, "polysynthetic");
      expect(isolating.stage.selectedCategories.length).toBeLessThanOrEqual(
        polysynthetic.stage.selectedCategories.length,
      );
    }
  });
});

describe("zero-marked values never produce an affix", () => {
  const phonology = testPhonology(42);

  it("no generated item realizes only a zero-marked value", () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const typology of ["isolating", "agglutinative", "fusional", "polysynthetic"] as MorphologicalType[]) {
        const { items } = generateInitial(seed, phonology, typology);
        for (const item of items) {
          const allZero = item.values.every((v) => {
            const catDef = CATEGORY_MAP.get(v.category);
            return catDef?.values.find((val) => val.id === v.value)?.zeroMarked ?? false;
          });
          expect(allZero).toBe(false);
        }
      }
    }
  });
});

describe("fusional bundling (Section 5.4's typology, applied to baseline affixation)", () => {
  const phonology = testPhonology(42);

  it("fusional typology produces at least one multi-category bundled affix across several seeds", () => {
    const foundBundle = Array.from({ length: 15 }, (_, i) => i + 1).some((seed) => {
      const { items } = generateInitial(seed, phonology, "fusional");
      return items.some((item) => item.categories.length > 1);
    });
    expect(foundBundle).toBe(true);
  });

  it("non-fusional typologies never bundle categories, seed for seed", () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const typology of ["isolating", "agglutinative", "polysynthetic"] as MorphologicalType[]) {
        const { items } = generateInitial(seed, phonology, typology);
        for (const item of items) expect(item.categories.length).toBe(1);
      }
    }
  });
});

describe("prefix/suffix strategy is consistent within a category (Section 5.2's baseline)", () => {
  const phonology = testPhonology(42);

  it("every standalone affix of the same category shares the same slot", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { items } = generateInitial(seed, phonology, "agglutinative");
      const byCategory = new Map<string, Set<string>>();
      for (const item of items) {
        if (item.categories.length !== 1) continue;
        const cat = item.categories[0];
        if (!byCategory.has(cat)) byCategory.set(cat, new Set());
        byCategory.get(cat)!.add(item.slot);
      }
      for (const slots of byCategory.values()) expect(slots.size).toBe(1);
    }
  });
});

describe("locking and item-level regeneration", () => {
  const phonology = testPhonology(42);

  it("a locked item survives a reroll unchanged", () => {
    const initial = generateInitial(7, phonology, "agglutinative");
    expect(initial.items.length).toBeGreaterThan(0);
    const lockedItem: MorphologyAffixData = { ...initial.items[0], locked: true };
    const previousItems = initial.items.map((i) => (i.id === lockedItem.id ? lockedItem : i));

    const rerolled = generateMorphology({
      seed: { base: 999, variation: 0 },
      params: { typology: "agglutinative" },
      phonology,
      previousItems,
      mode: "reroll",
      now: FIXED_NOW,
    });

    const survived = rerolled.items.find((i) => i.id === lockedItem.id);
    expect(survived).toEqual(lockedItem);
  });

  it("regenerateSingleItem changes only the form, keeping grammatical identity fixed", () => {
    const initial = generateInitial(7, phonology, "agglutinative");
    const target = initial.items[0];

    const updated = regenerateSingleItem({
      phonology,
      previous: target,
      allItems: initial.items,
      mode: "reroll",
      freshSeedBase: 12345,
    });

    expect(updated.id).toBe(target.id);
    expect(updated.slot).toBe(target.slot);
    expect(updated.domain).toBe(target.domain);
    expect(updated.categories).toEqual(target.categories);
    expect(updated.values).toEqual(target.values);
    expect(updated.gloss).toBe(target.gloss);
    expect(updated.phonemeIds.length).toBeGreaterThan(0);
  });
});
