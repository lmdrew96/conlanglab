// Pure, deterministic generation engine — zero Convex imports, same
// client/server-shared contract as convex/phonology/generate.ts (see that
// file's header). Root phonological forms are built by reusing Phonology's
// `buildSyllable` directly (Section 5.4's "same phonotactic rule
// representation" principle, applied here to Lexicon rather than
// allomorphy) — never a parallel syllable-building implementation.

import { Rng, deriveSeed } from "../lib/rng";
import { buildSyllable } from "../phonology/generate";
import { COMPOUND_LIST, CORE_LIST, FLEXIBLE_LIST } from "./content";
import { ROOT_TARGET } from "./types";
import type {
  CompoundConcept,
  ConceptKind,
  FlexibleDomain,
  LexiconItemData,
  LexiconParams,
  LexiconStageData,
  PartOfSpeech,
  Seed,
} from "./types";
import type { ConsonantPhoneme, PhonologyData, StressPattern, VowelPhoneme } from "../phonology/types";

const DEFAULT_NUDGE_KEEP_PROBABILITY = 0.75;
const MAX_UNIQUE_ATTEMPTS = 25;

const CORE_MAP = new Map(CORE_LIST.map((c) => [c.id, c]));
const FLEXIBLE_MAP = new Map(FLEXIBLE_LIST.map((c) => [c.id, c]));
const COMPOUND_MAP = new Map(COMPOUND_LIST.map((c) => [c.id, c]));

interface ConceptMeta {
  pos: PartOfSpeech;
  domain: string;
  gloss: string;
  kind: ConceptKind;
}

function lookupConcept(id: string): ConceptMeta | null {
  const core = CORE_MAP.get(id);
  if (core) return { pos: core.pos, domain: core.category, gloss: core.gloss, kind: "core" };
  const flex = FLEXIBLE_MAP.get(id);
  if (flex) return { pos: flex.pos, domain: flex.domain, gloss: flex.gloss, kind: "flexible" };
  return null;
}

/** FNV-1a — deterministic string→uint32, used to derive a per-concept seed from the stage seed. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function isVowel(p: ConsonantPhoneme | VowelPhoneme): p is VowelPhoneme {
  return "height" in p.features;
}

function hasCoda(syllable: Array<ConsonantPhoneme | VowelPhoneme>): boolean {
  const vIndex = syllable.findIndex(isVowel);
  return vIndex >= 0 && vIndex < syllable.length - 1;
}

function pickStressIndex(syllables: Array<Array<ConsonantPhoneme | VowelPhoneme>>, pattern: StressPattern): number {
  const n = syllables.length;
  if (n <= 1 || pattern === "none") return pattern === "none" ? -1 : 0;
  switch (pattern) {
    case "initial":
      return 0;
    case "final":
      return n - 1;
    case "penultimate":
      return Math.max(0, n - 2);
    case "weightSensitive": {
      for (let i = n - 1; i >= 0; i--) {
        if (hasCoda(syllables[i])) return i;
      }
      return Math.max(0, n - 2);
    }
  }
}

function pickSyllableCount(rng: Rng): number {
  return rng.weightedPick([1, 2, 3], (n) => (n === 1 ? 5 : n === 2 ? 3 : 1));
}

/** Absolute index within `syllables.flat()` of the given syllable's own vowel — undefined if that syllable somehow has none (shouldn't happen for a well-formed syllable, but buildSyllable's contract isn't re-validated here). */
function absoluteVowelIndex(syllables: Array<Array<ConsonantPhoneme | VowelPhoneme>>, syllableIndex: number): number | undefined {
  let offset = 0;
  for (let i = 0; i < syllableIndex; i++) offset += syllables[i].length;
  const withinSyllable = syllables[syllableIndex].findIndex(isVowel);
  return withinSyllable === -1 ? undefined : offset + withinSyllable;
}

/** Build a root's phonemes + rendered IPA form (syllable-dotted, primary-stress-marked). */
function buildRoot(
  rng: Rng,
  phonology: PhonologyData,
  syllableCount: number,
): { phonemeIds: string[]; phonologicalForm: string; stressedPhonemeIndex?: number } {
  const syllables: Array<Array<ConsonantPhoneme | VowelPhoneme>> = [];
  for (let i = 0; i < syllableCount; i++) syllables.push(buildSyllable(rng, phonology));

  const stressIndex = pickStressIndex(syllables, phonology.stress.pattern);
  const rendered = syllables
    .map((s) => s.map((p) => p.ipa).join(""))
    .map((ipa, i) => (i === stressIndex ? `ˈ${ipa}` : ipa))
    .join(".");

  return {
    phonemeIds: syllables.flat().map((p) => p.id),
    phonologicalForm: rendered,
    stressedPhonemeIndex: stressIndex === -1 ? undefined : absoluteVowelIndex(syllables, stressIndex),
  };
}

function buildRootItem(
  conceptId: string,
  meta: ConceptMeta,
  itemRng: Rng,
  phonology: PhonologyData,
  usedForms: Set<string>,
  seed: Seed,
): LexiconItemData {
  let built = buildRoot(itemRng, phonology, pickSyllableCount(itemRng));
  let attempts = 0;
  while (usedForms.has(built.phonologicalForm) && attempts < MAX_UNIQUE_ATTEMPTS) {
    built = buildRoot(itemRng, phonology, pickSyllableCount(itemRng));
    attempts++;
  }
  usedForms.add(built.phonologicalForm);

  return {
    version: 1,
    id: conceptId,
    kind: meta.kind,
    domain: meta.domain,
    partOfSpeech: meta.pos,
    meaning: meta.gloss,
    phonologicalForm: built.phonologicalForm,
    phonemeIds: built.phonemeIds,
    stressedPhonemeIndex: built.stressedPhonemeIndex,
    seed,
    locked: false,
  };
}

/** Compounds carry no independent randomness — their form is a pure function of their components' current forms (Section 6.3). Primary stress lands on the first component, a common cross-linguistic compound-stress default — `a`'s stressed-phoneme index needs no offset since `a`'s phonemes come first in the concatenation. */
function buildCompoundItem(compound: CompoundConcept, a: LexiconItemData, b: LexiconItemData, seed: Seed): LexiconItemData {
  const strip = (s: string) => s.replace(/ˈ/g, "");
  const form = `ˈ${strip(a.phonologicalForm)}.${strip(b.phonologicalForm)}`;
  return {
    version: 1,
    id: compound.id,
    kind: "compound",
    domain: "compound",
    partOfSpeech: compound.pos,
    meaning: compound.gloss,
    phonologicalForm: form,
    phonemeIds: [...a.phonemeIds, ...b.phonemeIds],
    stressedPhonemeIndex: a.stressedPhonemeIndex,
    componentIds: compound.components,
    seed,
    locked: false,
  };
}

/** Weighted sample without replacement — used to spend the ~50 non-core slots across flexible domains by their weight (Section 6.2). */
function weightedSampleWithoutReplacement<T extends { domain: FlexibleDomain }>(
  rng: Rng,
  pool: readonly T[],
  count: number,
  weights: Record<FlexibleDomain, number>,
): T[] {
  const remaining = [...pool];
  const picked: T[] = [];
  while (picked.length < count && remaining.length > 0) {
    const choice = rng.weightedPick(remaining, (item) => weights[item.domain] ?? 0);
    const idx = remaining.indexOf(choice);
    remaining.splice(idx, 1);
    picked.push(choice);
  }
  return picked;
}

function resolveItemSeed(stageSeed: Seed, conceptId: string, previous: LexiconItemData | undefined, mode: "initial" | "reroll" | "nudge"): Seed {
  const base = deriveSeed(stageSeed.base, hashString(conceptId));
  if (mode === "nudge" && previous) return { base, variation: previous.seed.variation + 1 };
  return { base, variation: 0 };
}

export interface GenerateLexiconArgs {
  seed: Seed;
  params: LexiconParams;
  phonology: PhonologyData;
  /** Full current collection — empty on initial generation. */
  previousItems: LexiconItemData[];
  mode: "initial" | "reroll" | "nudge";
  now: number;
  nudgeKeepProbability?: number;
}

export interface GenerateLexiconResult {
  stage: LexiconStageData;
  items: LexiconItemData[];
}

export function generateLexicon(args: GenerateLexiconArgs): GenerateLexiconResult {
  const { seed, params, phonology, previousItems, mode, now } = args;
  const keepProbability = args.nudgeKeepProbability ?? DEFAULT_NUDGE_KEEP_PROBABILITY;
  const rng = new Rng(mode === "nudge" ? deriveSeed(seed.base, seed.variation) : seed.base);

  const previousById = new Map(previousItems.map((i) => [i.id, i]));

  const coreIds = CORE_LIST.map((c) => c.id);
  const lockedFlexibleIds = previousItems.filter((i) => i.locked && i.kind === "flexible").map((i) => i.id);

  const flexibleBudget = Math.max(0, ROOT_TARGET - CORE_LIST.length - COMPOUND_LIST.length);
  const selectedFlexibleIds = weightedSampleWithoutReplacement(rng, FLEXIBLE_LIST, flexibleBudget, params.domainWeights).map(
    (c) => c.id,
  );
  const finalFlexibleIds = Array.from(new Set([...selectedFlexibleIds, ...lockedFlexibleIds]));

  const usedForms = new Set<string>();
  for (const item of previousItems) {
    if (item.locked) usedForms.add(item.phonologicalForm);
  }

  const rootsByConceptId = new Map<string, LexiconItemData>();

  for (const id of [...coreIds, ...finalFlexibleIds]) {
    const meta = lookupConcept(id);
    if (!meta) continue;
    const previous = previousById.get(id);

    if (previous?.locked) {
      rootsByConceptId.set(id, previous);
      continue;
    }
    if (mode === "nudge" && previous && rng.chance(keepProbability)) {
      rootsByConceptId.set(id, previous);
      usedForms.add(previous.phonologicalForm);
      continue;
    }

    const itemSeed = resolveItemSeed(seed, id, previous, mode);
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    rootsByConceptId.set(id, buildRootItem(id, meta, itemRng, phonology, usedForms, itemSeed));
  }

  const items: LexiconItemData[] = Array.from(rootsByConceptId.values());

  for (const compound of COMPOUND_LIST) {
    const previous = previousById.get(compound.id);
    if (previous?.locked) {
      items.push(previous);
      continue;
    }
    const a = rootsByConceptId.get(compound.components[0]);
    const b = rootsByConceptId.get(compound.components[1]);
    if (!a || !b) continue;
    const itemSeed = resolveItemSeed(seed, compound.id, previous, mode);
    items.push(buildCompoundItem(compound, a, b, itemSeed));
  }

  const stage: LexiconStageData = { version: 1, seed, params, itemCount: items.length, generatedAt: now };
  return { stage, items };
}

/**
 * Item-level nudge/reroll (Section 9.1/9.2) — regenerates exactly one
 * concept's root, leaving everything else untouched. Returns every item
 * that needs to be written: the target item, plus any compound that
 * consumes it as a component (a compound has no independent randomness —
 * regenerating its component and leaving the compound stale would silently
 * desync it, so it's rebuilt from the new root unless the compound itself
 * is locked).
 */
export function regenerateSingleItem(args: {
  conceptId: string;
  phonology: PhonologyData;
  previous: LexiconItemData;
  allItems: LexiconItemData[];
  mode: "nudge" | "reroll";
  /** Fresh entropy for "reroll" — the impure boundary (mutations.ts) draws this, mirroring phonology's reroll mutation. Unused for "nudge". */
  freshSeedBase?: number;
}): LexiconItemData[] {
  const compoundMeta = COMPOUND_MAP.get(args.conceptId);
  const seed: Seed =
    args.mode === "nudge"
      ? { base: args.previous.seed.base, variation: args.previous.seed.variation + 1 }
      : { base: args.freshSeedBase!, variation: 0 };

  if (compoundMeta) {
    const a = args.allItems.find((i) => i.id === compoundMeta.components[0]);
    const b = args.allItems.find((i) => i.id === compoundMeta.components[1]);
    if (!a || !b) return [];
    return [buildCompoundItem(compoundMeta, a, b, seed)];
  }

  const meta = lookupConcept(args.conceptId);
  if (!meta) return [];

  const usedForms = new Set(args.allItems.filter((i) => i.id !== args.conceptId).map((i) => i.phonologicalForm));
  const itemRng = new Rng(deriveSeed(seed.base, seed.variation));
  const item = buildRootItem(args.conceptId, meta, itemRng, args.phonology, usedForms, seed);

  const updated = [item];
  for (const compound of COMPOUND_LIST) {
    if (!compound.components.includes(args.conceptId)) continue;
    const prevCompound = args.allItems.find((i) => i.id === compound.id);
    if (prevCompound?.locked) continue;
    const otherId = compound.components.find((c) => c !== args.conceptId)!;
    const otherItem = args.allItems.find((i) => i.id === otherId);
    if (!otherItem) continue;
    const [a, b] = compound.components[0] === args.conceptId ? [item, otherItem] : [otherItem, item];
    updated.push(buildCompoundItem(compound, a, b, prevCompound?.seed ?? seed));
  }
  return updated;
}

// --- Live preview sampling (Section 9.5, 13.5) ---

const PREVIEW_SALT = 0xdead;

/** Sample example flexible-domain roots reflecting current domain weights, for the live preview panel. Read-only — never persisted. */
export function samplePreviewRoots(phonology: PhonologyData, params: LexiconParams, seedBase: number, count: number): LexiconItemData[] {
  const rng = new Rng(deriveSeed(seedBase, PREVIEW_SALT));
  const picks = weightedSampleWithoutReplacement(rng, FLEXIBLE_LIST, count, params.domainWeights);
  const usedForms = new Set<string>();
  return picks.map((c) => {
    const itemSeed = { base: deriveSeed(seedBase, hashString(c.id) ^ PREVIEW_SALT), variation: 0 };
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    return buildRootItem(c.id, { pos: c.pos, domain: c.domain, gloss: c.gloss, kind: "flexible" }, itemRng, phonology, usedForms, itemSeed);
  });
}
