// Deterministic seeded PRNG shared by every generation engine. No Convex
// imports — safe to run client-side (live preview) or server-side (mutations).
//
// mulberry32: https://github.com/bryc/code/blob/master/jshash/PRNGs.md —
// a small, fast, well-documented 32-bit generator. Not cryptographic; not
// meant to be. The only property that matters here is: same seed in,
// same sequence out, forever.

export type SeedFn = () => number;

export function mulberry32(seed: number): SeedFn {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: SeedFn;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.float() * (max - min + 1)) + min;
  }

  /** True with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Pick one element uniformly. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[this.int(0, items.length - 1)];
  }

  /** Pick one element with per-item weights. Falls back to uniform if all weights are 0. */
  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    const weights = items.map(weight);
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return this.pick(items);
    let roll = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Shuffle a copy of the array (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

/**
 * Deterministically combine a base seed with a salt (e.g. a nudge counter)
 * into a new 32-bit seed. Same inputs always produce the same derived seed.
 */
export function deriveSeed(base: number, salt: number): number {
  let h = (base ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ salt, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Fresh, non-deterministic entropy for picking a brand-new base seed on
 * reroll. Only ever called from mutations.ts (never from pure generate.ts).
 */
export function freshSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
