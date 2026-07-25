// Pure, deterministic generation engine — zero Convex imports, same
// client/server-shared contract as convex/phonology/generate.ts and
// convex/lexicon/generate.ts. Affix phonological forms are built from the
// language's current consonant/vowel pools directly (buildAffixForm) rather
// than through Phonology's buildSyllable — affixes are shorter than a full
// syllable and don't need onset/coda cluster machinery. Word-level
// preview assembly (generateTypologyPreview) does reuse buildSyllable for
// the sample root, same "one canonical syllable builder" principle Lexicon
// already follows for its roots.

import { Rng, deriveSeed } from "../lib/rng";
import {
  AFFIX_SHAPE_WEIGHTS,
  CATEGORY_CATALOG,
  CATEGORY_MAP,
  DEFAULT_SUFFIX_LEAN,
  FUSION_BUNDLE_CAP,
  SUFFIX_LEAN,
  TYPOLOGY_CATEGORY_COUNT,
  TYPOLOGY_WEIGHT_MULTIPLIERS,
} from "./content";
import { buildSyllable } from "../phonology/generate";
import type {
  AffixSlot,
  AffixValueRef,
  CategoryDef,
  CategoryId,
  GrammaticalDomain,
  MorphologicalType,
  MorphologyAffixData,
  MorphologyParams,
  MorphologyStageData,
  Seed,
} from "./types";
import type { ConsonantPhoneme, PhonologyData, VowelPhoneme } from "../phonology/types";

const DEFAULT_NUDGE_KEEP_PROBABILITY = 0.75;
const MAX_UNIQUE_ATTEMPTS = 25;
const SLOT_SALT = 0x51071;
const PREVIEW_SALT = 0xdead;

/** FNV-1a — deterministic string→uint32, used to derive per-cell/per-group seeds from the stage seed. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Fusional bundle cells sharing a `categories` set are paradigm alternatives
 * (e.g. Sg.Subj.Def vs. Sg.Obj.Indef from the same {number,case,definiteness}
 * bundle) — exactly one applies to a word at a time, never both. Keeps only
 * the first affix seen per distinct category signature so sampling call
 * sites never stack mutually-exclusive cells onto one word.
 */
export function dedupeAffixesByCategorySignature(affixes: MorphologyAffixData[]): MorphologyAffixData[] {
  const seen = new Set<string>();
  const deduped: MorphologyAffixData[] = [];
  for (const affix of affixes) {
    const signature = affix.categories.slice().sort().join(",");
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(affix);
  }
  return deduped;
}

function weightedSampleWithoutReplacement<T>(
  rng: Rng,
  pool: readonly T[],
  count: number,
  weight: (item: T) => number,
): T[] {
  const remaining = [...pool];
  const picked: T[] = [];
  while (picked.length < count && remaining.length > 0) {
    const choice = rng.weightedPick(remaining, weight);
    const idx = remaining.indexOf(choice);
    remaining.splice(idx, 1);
    picked.push(choice);
  }
  return picked;
}

// --- Category selection (Section 5.3) ---

function selectCategories(
  rng: Rng,
  typology: MorphologicalType,
  lockedCategoryIds: Set<CategoryId>,
): CategoryDef[] {
  const [minCount, maxCount] = TYPOLOGY_CATEGORY_COUNT[typology];
  const targetCount = rng.int(minCount, maxCount);
  const multipliers = TYPOLOGY_WEIGHT_MULTIPLIERS[typology] ?? {};
  const weight = (c: CategoryDef) => c.baseInclusionWeight * (multipliers[c.id] ?? 1);

  const lockedDefs = CATEGORY_CATALOG.filter((c) => lockedCategoryIds.has(c.id));
  const remainingPool = CATEGORY_CATALOG.filter((c) => !lockedCategoryIds.has(c.id));
  const remainingBudget = Math.max(0, targetCount - lockedDefs.length);
  const sampled = weightedSampleWithoutReplacement(rng, remainingPool, remainingBudget, weight);

  const selectedIds = new Set<CategoryId>([...lockedDefs, ...sampled].map((c) => c.id));
  return CATEGORY_CATALOG.filter((c) => selectedIds.has(c.id));
}

// --- Affix cell planning: which (category, value) combinations get an affix ---

interface AffixCellPlan {
  domain: GrammaticalDomain;
  categories: CategoryId[];
  values: AffixValueRef[];
  /** Groups cells that must share one prefix/suffix roll — one per standalone category, one per fused bundle. */
  groupKey: string;
}

function planStandaloneCells(cat: CategoryDef): AffixCellPlan[] {
  const groupKey = `cat:${cat.id}`;
  return cat.values
    .filter((v) => !v.zeroMarked)
    .map((v) => ({
      domain: cat.domain,
      categories: [cat.id],
      values: [{ category: cat.id, value: v.id }],
      groupKey,
    }));
}

function cartesianValues(categories: CategoryDef[]): AffixValueRef[][] {
  let combos: AffixValueRef[][] = [[]];
  for (const cat of categories) {
    const next: AffixValueRef[][] = [];
    for (const combo of combos) {
      for (const v of cat.values) next.push([...combo, { category: cat.id, value: v.id }]);
    }
    combos = next;
  }
  return combos;
}

function isZeroMarked(categories: CategoryDef[], ref: AffixValueRef): boolean {
  const val = categories.find((c) => c.id === ref.category)?.values.find((v) => v.id === ref.value);
  return val?.zeroMarked ?? false;
}

/** Fuses up to FUSION_BUNDLE_CAP categories (highest-weight first) into one affix slot per value-combination; any remainder stays standalone. */
function planDomainCellsFusional(categories: CategoryDef[], domain: GrammaticalDomain): AffixCellPlan[] {
  if (categories.length === 0) return [];
  if (categories.length === 1) return planStandaloneCells(categories[0]);

  const sorted = [...categories].sort((a, b) => b.baseInclusionWeight - a.baseInclusionWeight);
  const bundled = sorted.slice(0, FUSION_BUNDLE_CAP);
  const standalone = sorted.slice(FUSION_BUNDLE_CAP);

  const cells: AffixCellPlan[] = standalone.flatMap(planStandaloneCells);

  const groupKey = `bundle:${domain}:${bundled
    .map((c) => c.id)
    .sort()
    .join("_")}`;
  for (const combo of cartesianValues(bundled)) {
    if (combo.every((v) => isZeroMarked(bundled, v))) continue; // fully-unmarked cell — no affix
    cells.push({ domain, categories: bundled.map((c) => c.id), values: combo, groupKey });
  }
  return cells;
}

function planAffixCells(selected: CategoryDef[], typology: MorphologicalType): AffixCellPlan[] {
  if (typology !== "fusional") return selected.flatMap(planStandaloneCells);
  const nominal = selected.filter((c) => c.domain === "nominal");
  const verbal = selected.filter((c) => c.domain === "verbal");
  return [...planDomainCellsFusional(nominal, "nominal"), ...planDomainCellsFusional(verbal, "verbal")];
}

function cellId(cell: AffixCellPlan): string {
  return cell.values
    .map((v) => `${v.category}.${v.value}`)
    .sort()
    .join("+");
}

function cellGloss(cell: AffixCellPlan): string {
  return cell.values
    .map((v) => CATEGORY_MAP.get(v.category)?.values.find((val) => val.id === v.value)?.gloss ?? v.value)
    .join(".");
}

/** One roll per group (standalone category or fused bundle), seeded from the stage base only — stable across nudges of the same base, fresh on reroll. Mirrors nudge=small-variation / reroll=fresh-entropy (Section 9.2) at the structural level. */
function resolveSlot(seedBase: number, cell: AffixCellPlan): AffixSlot {
  const singleCategory = cell.categories.length === 1 ? cell.categories[0] : undefined;
  const lean = (singleCategory && SUFFIX_LEAN[singleCategory]) ?? DEFAULT_SUFFIX_LEAN;
  const groupRng = new Rng(deriveSeed(seedBase, hashString(cell.groupKey) ^ SLOT_SALT));
  return groupRng.chance(lean) ? "suffix" : "prefix";
}

// --- Affix phonological form ---

/** Exported for reuse by the typology live-preview and tests. */
export function buildAffixForm(rng: Rng, phonology: PhonologyData): { form: string; phonemeIds: string[] } {
  const shape = rng.weightedPick(AFFIX_SHAPE_WEIGHTS, (s) => s.weight).shape;
  const phonemes: Array<ConsonantPhoneme | VowelPhoneme> = shape.map((slot) =>
    slot === "C" ? rng.pick(phonology.consonants) : rng.pick(phonology.vowels),
  );
  return { form: phonemes.map((p) => p.ipa).join(""), phonemeIds: phonemes.map((p) => p.id) };
}

function resolveItemSeed(
  stageSeed: Seed,
  id: string,
  previous: MorphologyAffixData | undefined,
  mode: "initial" | "reroll" | "nudge",
): Seed {
  const base = deriveSeed(stageSeed.base, hashString(id));
  if (mode === "nudge" && previous) return { base, variation: previous.seed.variation + 1 };
  return { base, variation: 0 };
}

function buildAffixItem(
  id: string,
  cell: AffixCellPlan,
  slot: AffixSlot,
  rng: Rng,
  phonology: PhonologyData,
  usedForms: Set<string>,
  seed: Seed,
): MorphologyAffixData {
  let built = buildAffixForm(rng, phonology);
  let attempts = 0;
  while (usedForms.has(built.form) && attempts < MAX_UNIQUE_ATTEMPTS) {
    built = buildAffixForm(rng, phonology);
    attempts++;
  }
  usedForms.add(built.form);

  return {
    version: 1,
    id,
    slot,
    domain: cell.domain,
    categories: cell.categories,
    values: cell.values,
    gloss: cellGloss(cell),
    form: built.form,
    phonemeIds: built.phonemeIds,
    seed,
    locked: false,
  };
}

export interface GenerateMorphologyArgs {
  seed: Seed;
  params: MorphologyParams;
  phonology: PhonologyData;
  /** Full current collection — empty on initial generation. */
  previousItems: MorphologyAffixData[];
  mode: "initial" | "reroll" | "nudge";
  now: number;
  nudgeKeepProbability?: number;
}

export interface GenerateMorphologyResult {
  stage: MorphologyStageData;
  items: MorphologyAffixData[];
}

export function generateMorphology(args: GenerateMorphologyArgs): GenerateMorphologyResult {
  const { seed, params, phonology, previousItems, mode, now } = args;
  const keepProbability = args.nudgeKeepProbability ?? DEFAULT_NUDGE_KEEP_PROBABILITY;
  const rng = new Rng(mode === "nudge" ? deriveSeed(seed.base, seed.variation) : seed.base);

  const previousById = new Map(previousItems.map((i) => [i.id, i]));
  const lockedCategoryIds = new Set(previousItems.filter((i) => i.locked).flatMap((i) => i.categories));

  const selectedCategories = selectCategories(rng, params.typology, lockedCategoryIds);
  const cells = planAffixCells(selectedCategories, params.typology);

  const groupSlots = new Map<string, AffixSlot>();
  for (const cell of cells) {
    if (!groupSlots.has(cell.groupKey)) groupSlots.set(cell.groupKey, resolveSlot(seed.base, cell));
  }

  const usedForms = new Set<string>();
  for (const item of previousItems) if (item.locked) usedForms.add(item.form);

  const items: MorphologyAffixData[] = [];
  for (const cell of cells) {
    const id = cellId(cell);
    const previous = previousById.get(id);

    if (previous?.locked) {
      items.push(previous);
      continue;
    }
    if (mode === "nudge" && previous && rng.chance(keepProbability)) {
      items.push(previous);
      usedForms.add(previous.form);
      continue;
    }

    const itemSeed = resolveItemSeed(seed, id, previous, mode);
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    items.push(buildAffixItem(id, cell, groupSlots.get(cell.groupKey)!, itemRng, phonology, usedForms, itemSeed));
  }

  const stage: MorphologyStageData = {
    version: 1,
    seed,
    params,
    selectedCategories: selectedCategories.map((c) => c.id),
    affixCount: items.length,
    generatedAt: now,
  };
  return { stage, items };
}

/**
 * Item-level nudge/reroll (Section 9.1/9.2) — regenerates exactly one
 * affix's phonological form, leaving its grammatical identity (category,
 * value, gloss, slot) untouched. No cascade to other items: unlike
 * Lexicon's compounds, no affix is derived from another affix.
 */
export function regenerateSingleItem(args: {
  phonology: PhonologyData;
  previous: MorphologyAffixData;
  allItems: MorphologyAffixData[];
  mode: "nudge" | "reroll";
  /** Fresh entropy for "reroll" — the impure boundary (mutations.ts) draws this. Unused for "nudge". */
  freshSeedBase?: number;
}): MorphologyAffixData {
  const seed: Seed =
    args.mode === "nudge"
      ? { base: args.previous.seed.base, variation: args.previous.seed.variation + 1 }
      : { base: args.freshSeedBase!, variation: 0 };

  const usedForms = new Set(args.allItems.filter((i) => i.id !== args.previous.id).map((i) => i.form));
  const itemRng = new Rng(deriveSeed(seed.base, seed.variation));
  let built = buildAffixForm(itemRng, args.phonology);
  let attempts = 0;
  while (usedForms.has(built.form) && attempts < MAX_UNIQUE_ATTEMPTS) {
    built = buildAffixForm(itemRng, args.phonology);
    attempts++;
  }

  return { ...args.previous, form: built.form, phonemeIds: built.phonemeIds, seed };
}

// --- Live preview (Section 5.1, 9.5, 13.5) ---

export interface TypologyPreviewExample {
  typology: MorphologicalType;
  /** The sample word with its verbal affixes attached — naive concatenation, no allomorphy (Section 5.4 is M4 scope). */
  word: string;
  /** The (category, value) pairs realized by the attached affixes, in attachment order — raw data so the UI can format them (plain-English label vs. Leipzig gloss) rather than the engine baking one representation in. */
  markedValues: AffixValueRef[];
  affixCount: number;
}

/**
 * Runs the real generation algorithm (throwaway, never persisted) for one
 * typology and renders a sample inflected word — this is Section 5.1's
 * actual ask: "generates live preview examples of what a word would look
 * like under each typological option" before the user commits. The UI
 * calls this once per typology to build the 4-way comparison.
 */
export function generateTypologyPreview(
  phonology: PhonologyData,
  typology: MorphologicalType,
  seedBase: number,
): TypologyPreviewExample {
  const previewSeedBase = deriveSeed(seedBase, hashString(typology) ^ PREVIEW_SALT);
  const rng = new Rng(previewSeedBase);

  const { stage, items } = generateMorphology({
    seed: { base: previewSeedBase, variation: 0 },
    params: { typology },
    phonology,
    previousItems: [],
    mode: "initial",
    now: 0,
  });

  const rootForm = buildSyllable(rng, phonology)
    .map((p) => p.ipa)
    .join("");

  // Up to 3 verbal affixes — enough to show isolating's near-bare output and
  // polysynthetic's stacking without listing every generated category.
  const verbalItems = dedupeAffixesByCategorySignature(items.filter((i) => i.domain === "verbal")).slice(0, 3);
  const prefixes = verbalItems.filter((i) => i.slot === "prefix");
  const suffixes = verbalItems.filter((i) => i.slot === "suffix");

  const word = [...prefixes.map((a) => a.form), rootForm, ...suffixes.map((a) => a.form)].join("");
  const markedValues = [...prefixes, ...suffixes].flatMap((a) => a.values);

  return { typology, word, markedValues, affixCount: stage.affixCount };
}

/**
 * A lean, never a requirement (Section 5.1: "may suggest a lean... but
 * never forces it"). Tied to one real phonology parameter — cluster
 * complexity — rather than a black-box heuristic: simple syllable canons
 * correlate loosely with analytic/isolating typology cross-linguistically
 * (e.g. Mandarin, Vietnamese), heavy clustering with morphologically dense
 * typologies. Deliberately coarse; the UI presents it as a suggestion
 * alongside all 4 real previews, never as a gate.
 */
export function suggestTypology(phonology: PhonologyData): MorphologicalType {
  const cc = phonology.params.clusterComplexity;
  if (cc < 0.15) return "isolating";
  if (cc < 0.4) return "fusional";
  if (cc < 0.7) return "agglutinative";
  return "polysynthetic";
}
