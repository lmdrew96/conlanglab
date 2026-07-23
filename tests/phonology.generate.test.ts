import { describe, expect, it } from "vitest";
import { generatePhonology } from "../convex/phonology/generate";
import { ALL_TARGETS, DEFAULT_PARAMS } from "../convex/phonology/types";
import type { PhonologyData } from "../convex/phonology/types";

const FIXED_NOW = 1_700_000_000_000;

function generateInitial(seedBase: number): PhonologyData {
  return generatePhonology({
    seed: { base: seedBase, variation: 0 },
    params: DEFAULT_PARAMS,
    previous: null,
    targets: ALL_TARGETS,
    mode: "initial",
    now: FIXED_NOW,
  });
}

describe("generatePhonology determinism", () => {
  it("produces identical output for identical inputs", () => {
    const a = generateInitial(42);
    const b = generateInitial(42);
    expect(a).toEqual(b);
  });

  it("produces different output for a different seed", () => {
    const a = generateInitial(42);
    const b = generateInitial(43);
    expect(a).not.toEqual(b);
  });

  it("always includes every core-tier phoneme", () => {
    const data = generateInitial(7);
    const coreConsonantIds = ["p", "t", "k", "m", "n", "s", "j_glide", "w", "l"];
    const coreVowelIds = ["i", "a", "u"];
    for (const id of coreConsonantIds) {
      expect(data.consonants.some((c) => c.id === id)).toBe(true);
    }
    for (const id of coreVowelIds) {
      expect(data.vowels.some((v) => v.id === id)).toBe(true);
    }
  });

  it("never includes a marked phoneme whose toggle is off", () => {
    const data = generateInitial(7);
    expect(data.consonants.some((c) => c.tier === "marked")).toBe(false);
    expect(data.vowels.some((v) => v.tier === "marked")).toBe(false);
  });

  it("includes ejectives when the toggle is on and their prerequisites are met", () => {
    const data = generatePhonology({
      seed: { base: 7, variation: 0 },
      params: { ...DEFAULT_PARAMS, markedFeatures: { ...DEFAULT_PARAMS.markedFeatures, ejectives: true } },
      previous: null,
      targets: ALL_TARGETS,
      mode: "initial",
      now: FIXED_NOW,
    });
    const ejectives = data.consonants.filter((c) => c.features.manner === "ejective");
    expect(ejectives.length).toBeGreaterThan(0);
    for (const ej of ejectives) {
      for (const prereq of ej.prerequisites) {
        expect(data.consonants.some((c) => c.id === prereq)).toBe(true);
      }
    }
  });
});

describe("reroll respects locks", () => {
  it("keeps a locked phoneme through a full reroll of the inventory", () => {
    const initial = generateInitial(7);
    const lockedId = initial.consonants.find((c) => c.tier === "common")?.id ?? initial.consonants[0].id;
    const locked: PhonologyData = {
      ...initial,
      consonants: initial.consonants.map((c) => (c.id === lockedId ? { ...c, locked: true } : c)),
    };

    const rerolled = generatePhonology({
      seed: { base: 999, variation: 0 },
      params: locked.params,
      previous: locked,
      targets: ["inventory"],
      mode: "reroll",
      now: FIXED_NOW,
    });

    const survivor = rerolled.consonants.find((c) => c.id === lockedId);
    expect(survivor).toBeDefined();
    expect(survivor?.locked).toBe(true);
  });

  it("leaves non-targeted fields untouched", () => {
    const initial = generateInitial(7);
    const rerolled = generatePhonology({
      seed: { base: 999, variation: 0 },
      params: initial.params,
      previous: initial,
      targets: ["stress"],
      mode: "reroll",
      now: FIXED_NOW,
    });
    expect(rerolled.consonants).toEqual(initial.consonants);
    expect(rerolled.vowels).toEqual(initial.vowels);
    expect(rerolled.phonotactics).toEqual(initial.phonotactics);
  });
});

describe("nudge respects locks and stays close to the original", () => {
  it("keeps a locked phoneme through a nudge of the inventory", () => {
    const initial = generateInitial(7);
    const lockedId = initial.consonants.find((c) => c.tier === "common")?.id ?? initial.consonants[0].id;
    const locked: PhonologyData = {
      ...initial,
      consonants: initial.consonants.map((c) => (c.id === lockedId ? { ...c, locked: true } : c)),
    };

    const nudged = generatePhonology({
      seed: { base: locked.seed.base, variation: locked.seed.variation + 1 },
      params: locked.params,
      previous: locked,
      targets: ["inventory"],
      mode: "nudge",
      now: FIXED_NOW,
    });

    const survivor = nudged.consonants.find((c) => c.id === lockedId);
    expect(survivor).toBeDefined();
    expect(survivor?.locked).toBe(true);
  });

  it("keeps most of the inventory the same (small perturbation, not a fresh draw)", () => {
    const initial = generateInitial(7);
    const nudged = generatePhonology({
      seed: { base: initial.seed.base, variation: initial.seed.variation + 1 },
      params: initial.params,
      previous: initial,
      targets: ["inventory"],
      mode: "nudge",
      now: FIXED_NOW,
    });

    const initialIds = new Set(initial.consonants.map((c) => c.id));
    const keptCount = nudged.consonants.filter((c) => initialIds.has(c.id)).length;
    expect(keptCount / initial.consonants.length).toBeGreaterThan(0.5);
  });
});
