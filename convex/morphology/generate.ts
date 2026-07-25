// Pure, deterministic generation engine — zero Convex imports, same
// client/server-shared contract as convex/phonology/generate.ts and
// convex/lexicon/generate.ts. Affix phonological forms are built from the
// language's current consonant/vowel pools directly (buildAffixForm) rather
// than through Phonology's buildSyllable — affixes are shorter than a full
// syllable and don't need onset/coda cluster machinery. Word-level
// assembly (applyAffixesToRoot, generateTypologyPreview) does reuse
// buildSyllable for the sample root, same "one canonical syllable builder"
// principle Lexicon already follows for its roots.

import { Rng, deriveSeed } from "../lib/rng";
import {
  AFFIX_SHAPE_WEIGHTS,
  CATEGORY_CATALOG,
  CATEGORY_MAP,
  DERIVATIONAL_RULE_CATALOG,
  DEFAULT_SUFFIX_LEAN,
  FUSION_BUNDLE_CAP,
  NASAL_ASSIMILATION_TARGET,
  REDUPLICATION_BEFORE_LEAN,
  REDUPLICATION_SHAPE_WEIGHTS,
  STRATEGY_MIX,
  SUFFIX_LEAN,
  TYPOLOGY_CATEGORY_COUNT,
  TYPOLOGY_WEIGHT_MULTIPLIERS,
} from "./content";
import { buildSyllable } from "../phonology/generate";
import type {
  AffixStrategy,
  AffixValueRef,
  AllomorphyData,
  CategoryDef,
  CategoryId,
  DerivationalAffixData,
  GrammaticalDomain,
  MorphologicalType,
  MorphologyAffixData,
  MorphologyParams,
  MorphologyStageData,
  ReduplicationShape,
  Seed,
  SuppletionData,
} from "./types";
import type { ConsonantPhoneme, ConsonantPlace, PhonologyData, VowelPhoneme } from "../phonology/types";
import { CORE_LIST } from "../lexicon/content";
import type { LexiconItemData } from "../lexicon/types";

const DEFAULT_NUDGE_KEEP_PROBABILITY = 0.75;
const MAX_UNIQUE_ATTEMPTS = 25;
const SLOT_SALT = 0x51071;
const STRATEGY_SALT = 0x5a1e91;
const PREVIEW_SALT = 0xdead;
const DERIVATION_BUDGET = 30;
const SUPPLETION_BUDGET = 3;

/** FNV-1a — deterministic string→uint32, used to derive per-cell/per-group seeds from the stage seed. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Resolve a flat phoneme-id sequence against the current inventory — null if any id can't be found (mirrors src/lib/lexicon/audio.ts's resolveRootPhonemes, duplicated here rather than imported since that module pulls in browser audio machinery this pure engine must stay free of). Exported for reuse by lexicon/generate.ts's derivation pass. */
export function resolvePhonemes(
  phonemeIds: string[],
  phonology: PhonologyData,
): Array<ConsonantPhoneme | VowelPhoneme> | null {
  const byId = new Map<string, ConsonantPhoneme | VowelPhoneme>();
  for (const c of phonology.consonants) byId.set(c.id, c);
  for (const v of phonology.vowels) byId.set(v.id, v);
  const resolved: Array<ConsonantPhoneme | VowelPhoneme> = [];
  for (const id of phonemeIds) {
    const phoneme = byId.get(id);
    if (!phoneme) return null;
    resolved.push(phoneme);
  }
  return resolved;
}

function isVowel(p: ConsonantPhoneme | VowelPhoneme): p is VowelPhoneme {
  return "height" in p.features;
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
  /** Groups cells that must share one strategy/slot roll — one per standalone category, one per fused bundle. */
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
function resolveLinearSlot(seedBase: number, cell: AffixCellPlan): "prefix" | "suffix" {
  const singleCategory = cell.categories.length === 1 ? cell.categories[0] : undefined;
  const lean = (singleCategory && SUFFIX_LEAN[singleCategory]) ?? DEFAULT_SUFFIX_LEAN;
  const groupRng = new Rng(deriveSeed(seedBase, hashString(cell.groupKey) ^ SLOT_SALT));
  return groupRng.chance(lean) ? "suffix" : "prefix";
}

/**
 * Section 5.2's strategy assignment — one roll per group, independent of the
 * linear-slot roll above. Non-linear strategies are the deliberate minority
 * (STRATEGY_MIX.nonLinearRate), weighted-picked per typology when they do
 * occur; otherwise falls back to the existing prefix/suffix resolution.
 */
function resolveStrategy(seedBase: number, cell: AffixCellPlan, typology: MorphologicalType): AffixStrategy {
  const mix = STRATEGY_MIX[typology];
  const entries = Object.entries(mix.weights) as [AffixStrategy, number][];
  if (mix.nonLinearRate > 0 && entries.length > 0) {
    const groupRng = new Rng(deriveSeed(seedBase, hashString(cell.groupKey) ^ STRATEGY_SALT));
    if (groupRng.chance(mix.nonLinearRate)) {
      return groupRng.weightedPick(entries, ([, w]) => w)[0];
    }
  }
  return resolveLinearSlot(seedBase, cell);
}

// --- Affix phonological form ---

/** Exported for reuse by the typology live-preview and tests. Builds one linear (prefix/suffix/infix/circumfix-piece) affix form. */
export function buildAffixForm(rng: Rng, phonology: PhonologyData): { form: string; phonemeIds: string[] } {
  const shape = rng.weightedPick(AFFIX_SHAPE_WEIGHTS, (s) => s.weight).shape;
  const phonemes: Array<ConsonantPhoneme | VowelPhoneme> = shape.map((slot) =>
    slot === "C" ? rng.pick(phonology.consonants) : rng.pick(phonology.vowels),
  );
  return { form: phonemes.map((p) => p.ipa).join(""), phonemeIds: phonemes.map((p) => p.id) };
}

/** Section 5.2's ablaut: picks two distinct vowel phonemes from the language's own inventory — the root vowel matching `from` gets swapped to `to` at apply-time. Returns null if the inventory can't support a meaningful contrast (fewer than 2 vowels). */
function buildAblautPattern(rng: Rng, phonology: PhonologyData): { ablautFrom: string; ablautTo: string } | null {
  if (phonology.vowels.length < 2) return null;
  const shuffled = rng.shuffle(phonology.vowels);
  return { ablautFrom: shuffled[0].id, ablautTo: shuffled[1].id };
}

/** Section 5.2's templatic/apophonic pattern, v1 simplified scope (see plan): a short vowel melody interleaved with the root's own consonant skeleton at apply-time, rather than a full abstract root-and-pattern redesign. */
function buildTemplaticMelody(rng: Rng, phonology: PhonologyData): string[] | null {
  if (phonology.vowels.length === 0) return null;
  const length = rng.int(1, 2);
  return Array.from({ length }, () => rng.pick(phonology.vowels).id);
}

interface BuiltAffixPayload {
  form: string;
  phonemeIds: string[];
  circumfixClosing?: string;
  circumfixClosingPhonemeIds?: string[];
  reduplicationShape?: ReduplicationShape;
  reduplicationPlacement?: "before" | "after";
  ablautFrom?: string;
  ablautTo?: string;
  templaticMelody?: string[];
}

/** Dispatches to the right strategy-specific builder, falling back to a plain suffix when a language's inventory can't support the requested non-linear strategy (e.g. too few vowels for ablaut). */
function buildAffixPayload(
  strategy: AffixStrategy,
  rng: Rng,
  phonology: PhonologyData,
  usedForms: Set<string>,
): { strategy: AffixStrategy; payload: BuiltAffixPayload } {
  const buildUniqueLinear = (): { form: string; phonemeIds: string[] } => {
    let built = buildAffixForm(rng, phonology);
    let attempts = 0;
    while (usedForms.has(built.form) && attempts < MAX_UNIQUE_ATTEMPTS) {
      built = buildAffixForm(rng, phonology);
      attempts++;
    }
    usedForms.add(built.form);
    return built;
  };

  switch (strategy) {
    case "prefix":
    case "suffix":
    case "infix":
      return { strategy, payload: buildUniqueLinear() };

    case "circumfix": {
      const opening = buildUniqueLinear();
      const closing = buildAffixForm(rng, phonology);
      return {
        strategy,
        payload: {
          form: opening.form,
          phonemeIds: opening.phonemeIds,
          circumfixClosing: closing.form,
          circumfixClosingPhonemeIds: closing.phonemeIds,
        },
      };
    }

    case "reduplicationFull": {
      return {
        strategy,
        payload: { form: "", phonemeIds: [], reduplicationPlacement: rng.chance(REDUPLICATION_BEFORE_LEAN) ? "before" : "after" },
      };
    }

    case "reduplicationPartial": {
      const shape = rng.weightedPick(REDUPLICATION_SHAPE_WEIGHTS, (s) => s.weight).shape;
      return {
        strategy,
        payload: {
          form: "",
          phonemeIds: [],
          reduplicationShape: shape,
          reduplicationPlacement: rng.chance(REDUPLICATION_BEFORE_LEAN) ? "before" : "after",
        },
      };
    }

    case "ablaut": {
      const pattern = buildAblautPattern(rng, phonology);
      if (!pattern) return buildAffixPayload("suffix", rng, phonology, usedForms);
      return { strategy, payload: { form: "", phonemeIds: [pattern.ablautFrom, pattern.ablautTo], ...pattern } };
    }

    case "templatic": {
      const melody = buildTemplaticMelody(rng, phonology);
      if (!melody) return buildAffixPayload("suffix", rng, phonology, usedForms);
      return { strategy, payload: { form: "", phonemeIds: melody, templaticMelody: melody } };
    }
  }
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
  strategy: AffixStrategy,
  rng: Rng,
  phonology: PhonologyData,
  usedForms: Set<string>,
  seed: Seed,
): MorphologyAffixData {
  const { strategy: resolvedStrategy, payload } = buildAffixPayload(strategy, rng, phonology, usedForms);
  return {
    version: 1,
    id,
    strategy: resolvedStrategy,
    domain: cell.domain,
    categories: cell.categories,
    values: cell.values,
    gloss: cellGloss(cell),
    ...payload,
    seed,
    locked: false,
  };
}

// --- Allomorphy (Section 5.4) ---

/** Built once per generation pass, deterministic from the language's own phonology — no independent randomness, matching Section 5.4's "integrated system" framing (an allomorphy configuration isn't a separate generated artifact, it's a direct function of the sound system already in place). */
export function buildAllomorphy(phonology: PhonologyData): AllomorphyData {
  const hasBacknessContrast = new Set(phonology.vowels.map((v) => v.features.backness)).size > 1;
  const hasNasal = phonology.consonants.some((c) => c.features.manner === "nasal");
  const epenthetic =
    phonology.vowels.find((v) => v.features.height === "mid" && v.features.backness === "central") ??
    phonology.vowels[0];

  return {
    version: 1,
    vowelHarmony: { enabled: hasBacknessContrast, axis: "backness" },
    consonantAssimilation: { enabled: hasNasal, target: "place" },
    epenthesis: { enabled: epenthetic != null, epentheticVowelId: epenthetic?.id ?? "" },
  };
}

/**
 * Section 5.4's boundary repair, run generically at every attachment point
 * regardless of which strategy produced the pieces being joined — this is
 * what resolves Section 14.3's reduplication+allomorphy interaction risk:
 * a reduplicant boundary gets exactly the same treatment as a prefix
 * boundary, with no separate code path to diverge.
 *
 * `leftPhonemes`/`rightPhonemes` are the two sequences meeting at the
 * boundary (in attachment order); returns the repaired sequence.
 */
function resolveBoundary(
  leftPhonemes: Array<ConsonantPhoneme | VowelPhoneme>,
  rightPhonemes: Array<ConsonantPhoneme | VowelPhoneme>,
  allomorphy: AllomorphyData,
  phonology: PhonologyData,
): Array<ConsonantPhoneme | VowelPhoneme> {
  let left = [...leftPhonemes];
  let right = [...rightPhonemes];

  // Vowel harmony: if the boundary-adjacent segments are both vowels and the
  // right one doesn't share the left one's backness, swap the right vowel
  // for the closest inventory match at the left's backness.
  if (allomorphy.vowelHarmony.enabled && left.length > 0 && right.length > 0) {
    const leftLast = left[left.length - 1];
    const rightFirst = right[0];
    if (isVowel(leftLast) && isVowel(rightFirst) && leftLast.features.backness !== rightFirst.features.backness) {
      const match = phonology.vowels.find(
        (v) => v.features.backness === leftLast.features.backness && v.features.height === rightFirst.features.height,
      );
      if (match) right = [match, ...right.slice(1)];
    }
  }

  // Consonant assimilation: nasal place assimilation at the boundary.
  if (allomorphy.consonantAssimilation.enabled && left.length > 0 && right.length > 0) {
    const leftLast = left[left.length - 1];
    const rightFirst = right[0];
    if (!isVowel(leftLast) && !isVowel(rightFirst) && leftLast.features.manner === "nasal") {
      const targetPlace = NASAL_ASSIMILATION_TARGET[rightFirst.features.place as ConsonantPlace];
      if (targetPlace && targetPlace !== leftLast.features.place) {
        const match = phonology.consonants.find((c) => c.features.manner === "nasal" && c.features.place === targetPlace);
        if (match) left = [...left.slice(0, -1), match];
      }
    }
  }

  // Epenthesis: break up an onset/coda cluster that violates the language's
  // own phonotactic cluster-size limits by inserting the epenthetic vowel.
  if (allomorphy.epenthesis.enabled && left.length > 0 && right.length > 0) {
    const leftLast = left[left.length - 1];
    const rightFirst = right[0];
    if (!isVowel(leftLast) && !isVowel(rightFirst)) {
      const maxCluster = Math.max(phonology.phonotactics.onsetClusters.maxSize, phonology.phonotactics.codaClusters.maxSize);
      if (maxCluster < 2) {
        const epenthetic = phonology.vowels.find((v) => v.id === allomorphy.epenthesis.epentheticVowelId);
        if (epenthetic) right = [epenthetic, ...right];
      }
    }
  }

  return [...left, ...right];
}

// --- Canonical word assembly (replaces ad hoc concatenation in the UI) ---

export interface RootLike {
  phonologicalForm: string;
  phonemeIds: string[];
  stressedPhonemeIndex?: number;
}

export interface AssembledWord {
  form: string;
  phonemeIds: string[];
  stressedPhonemeIndex: number | undefined;
}

/**
 * The single canonical word-assembler (Section 5.6's output artifact made
 * real) — replaces the naive `attach()`/`attachPhonemeIds()` concatenation
 * previously duplicated in example-words-panel.tsx and inline in
 * generateTypologyPreview. Applies each affix's strategy in turn, always
 * finishing every attachment with the generic `resolveBoundary` repair
 * pass — see that function's comment for how this resolves Section 14.3.
 */
export function applyAffixesToRoot(
  root: RootLike,
  affixes: MorphologyAffixData[],
  phonology: PhonologyData,
  allomorphy: AllomorphyData,
): AssembledWord {
  let phonemes = resolvePhonemes(root.phonemeIds, phonology) ?? [];
  let stressIndex = root.stressedPhonemeIndex;

  const applyOne = (affix: MorphologyAffixData) => {
    switch (affix.strategy) {
      case "prefix": {
        const affixPhonemes = resolvePhonemes(affix.phonemeIds, phonology) ?? [];
        const rootLength = phonemes.length;
        const repaired = resolveBoundary(affixPhonemes, phonemes, allomorphy, phonology);
        // All growth from prefixing (and any epenthesis it triggers) lands
        // before the root's original content, so the stressed phoneme's
        // index shifts by exactly the net length added on this side.
        if (stressIndex !== undefined) stressIndex += repaired.length - rootLength;
        phonemes = repaired;
        break;
      }
      case "suffix": {
        const affixPhonemes = resolvePhonemes(affix.phonemeIds, phonology) ?? [];
        phonemes = resolveBoundary(phonemes, affixPhonemes, allomorphy, phonology);
        break;
      }
      case "infix": {
        const affixPhonemes = resolvePhonemes(affix.phonemeIds, phonology) ?? [];
        const insertAt = Math.min(1, phonemes.length);
        phonemes = [...phonemes.slice(0, insertAt), ...affixPhonemes, ...phonemes.slice(insertAt)];
        if (stressIndex !== undefined && stressIndex >= insertAt) stressIndex += affixPhonemes.length;
        break;
      }
      case "circumfix": {
        const openingPhonemes = resolvePhonemes(affix.phonemeIds, phonology) ?? [];
        const closingPhonemes = resolvePhonemes(affix.circumfixClosingPhonemeIds ?? [], phonology) ?? [];
        const rootLength = phonemes.length;
        const withOpening = resolveBoundary(openingPhonemes, phonemes, allomorphy, phonology);
        const withBoth = resolveBoundary(withOpening, closingPhonemes, allomorphy, phonology);
        if (stressIndex !== undefined) stressIndex += withOpening.length - rootLength;
        phonemes = withBoth;
        break;
      }
      case "reduplicationFull": {
        const copy = [...phonemes];
        const rootLength = phonemes.length;
        if (affix.reduplicationPlacement === "after") {
          phonemes = resolveBoundary(phonemes, copy, allomorphy, phonology);
        } else {
          const repaired = resolveBoundary(copy, phonemes, allomorphy, phonology);
          if (stressIndex !== undefined) stressIndex += repaired.length - rootLength;
          phonemes = repaired;
        }
        break;
      }
      case "reduplicationPartial": {
        const shape = affix.reduplicationShape ?? ["C", "V"];
        const copy: Array<ConsonantPhoneme | VowelPhoneme> = [];
        let cursor = 0;
        for (const slot of shape) {
          const match = phonemes.slice(cursor).find((p) => (slot === "C" ? !isVowel(p) : isVowel(p)));
          if (match) copy.push(match);
          cursor++;
        }
        const rootLength = phonemes.length;
        if (affix.reduplicationPlacement === "after") {
          phonemes = resolveBoundary(phonemes, copy, allomorphy, phonology);
        } else {
          const repaired = resolveBoundary(copy, phonemes, allomorphy, phonology);
          if (stressIndex !== undefined) stressIndex += repaired.length - rootLength;
          phonemes = repaired;
        }
        break;
      }
      case "ablaut": {
        if (affix.ablautFrom && affix.ablautTo) {
          const idx = phonemes.findIndex((p) => p.id === affix.ablautFrom);
          if (idx >= 0) {
            const target = resolvePhonemes([affix.ablautTo], phonology)?.[0];
            if (target) phonemes = [...phonemes.slice(0, idx), target, ...phonemes.slice(idx + 1)];
          }
        }
        break;
      }
      case "templatic": {
        if (affix.templaticMelody && affix.templaticMelody.length > 0) {
          const melody = resolvePhonemes(affix.templaticMelody, phonology) ?? [];
          const consonantSkeleton = phonemes.filter((p) => !isVowel(p));
          const rebuilt: Array<ConsonantPhoneme | VowelPhoneme> = [];
          for (let i = 0; i < consonantSkeleton.length; i++) {
            rebuilt.push(consonantSkeleton[i]);
            if (melody[i]) rebuilt.push(melody[i]);
          }
          if (rebuilt.length > 0) phonemes = rebuilt;
        }
        break;
      }
    }
  };

  for (const affix of affixes) applyOne(affix);

  return {
    form: phonemes.map((p) => p.ipa).join(""),
    phonemeIds: phonemes.map((p) => p.id),
    stressedPhonemeIndex: stressIndex,
  };
}

export interface GenerateMorphologyArgs {
  seed: Seed;
  params: MorphologyParams;
  phonology: PhonologyData;
  /** Full current collection — empty on initial generation. */
  previousItems: MorphologyAffixData[];
  previousSuppletion?: SuppletionData[];
  previousDerivational?: DerivationalAffixData[];
  /** Current lexicon roots (Lexicon/M2 generates before Morphology in the pipeline — design doc roadmap §15), used to pick real Tier-A roots for suppletion (Section 5.2). Omitted/empty is fine — suppletion just stays empty until Lexicon exists. */
  lexiconItems?: LexiconItemData[];
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

  const groupStrategies = new Map<string, AffixStrategy>();
  for (const cell of cells) {
    if (!groupStrategies.has(cell.groupKey)) groupStrategies.set(cell.groupKey, resolveStrategy(seed.base, cell, params.typology));
  }

  const usedForms = new Set<string>();
  for (const item of previousItems) if (item.locked && item.form) usedForms.add(item.form);

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
      if (previous.form) usedForms.add(previous.form);
      continue;
    }

    const itemSeed = resolveItemSeed(seed, id, previous, mode);
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    items.push(buildAffixItem(id, cell, groupStrategies.get(cell.groupKey)!, itemRng, phonology, usedForms, itemSeed));
  }

  const allomorphy = buildAllomorphy(phonology);
  const tierAIds = new Set(CORE_LIST.filter((c) => c.frequencyTier === "A").map((c) => c.id));
  const tierARoots = (args.lexiconItems ?? []).filter((item) => tierAIds.has(item.id));
  const suppletion = generateSuppletion(rng, seed, phonology, selectedCategories, tierARoots, args.previousSuppletion ?? []);
  const derivationalAffixes = generateDerivationalAffixes(seed, phonology, args.previousDerivational ?? []);

  const stage: MorphologyStageData = {
    version: 1,
    seed,
    params,
    selectedCategories: selectedCategories.map((c) => c.id),
    affixCount: items.length,
    allomorphy,
    suppletion,
    derivationalAffixes,
    generatedAt: now,
  };
  return { stage, items };
}

// --- Suppletion (Section 5.2's controlled, low-frequency spice) ---

/**
 * Suppletion pairs a specific (Tier-A lexicon root, category, value) cell
 * with an irregular override form (Section 5.2's "controlled, low-frequency
 * spice") — real suppletion is a frequency effect, so eligibility is gated
 * to a language's highest-frequency roots. `overrideForm` is a whole
 * irregular word, so it's built with buildSyllable (Lexicon's own root
 * shape) rather than buildAffixForm's shorter affix shapes.
 */
function generateSuppletion(
  rng: Rng,
  seed: Seed,
  phonology: PhonologyData,
  selectedCategories: CategoryDef[],
  tierARoots: LexiconItemData[],
  previous: SuppletionData[],
): SuppletionData[] {
  const lockedPrevious = previous.filter((s) => s.locked);
  const eligibleCategories = selectedCategories.filter((c) => c.values.some((v) => !v.zeroMarked));
  if (eligibleCategories.length === 0 || tierARoots.length === 0) return lockedPrevious;

  const usedRootIds = new Set(lockedPrevious.map((s) => s.rootConceptId));
  const eligibleRoots = tierARoots.filter((r) => !usedRootIds.has(r.id));
  const count = Math.min(SUPPLETION_BUDGET, eligibleRoots.length, rng.int(0, SUPPLETION_BUDGET));

  const built: SuppletionData[] = [...lockedPrevious];
  const chosenRoots = rng.shuffle(eligibleRoots).slice(0, count);
  for (const root of chosenRoots) {
    const cat = rng.pick(eligibleCategories);
    const value = rng.pick(cat.values.filter((v) => !v.zeroMarked));
    const id = `suppletion:${root.id}:${cat.id}.${value.id}`;
    const itemSeed: Seed = { base: deriveSeed(seed.base, hashString(id)), variation: 0 };
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    const overrideSyllable = buildSyllable(itemRng, phonology);
    built.push({
      version: 1,
      id,
      rootConceptId: root.id,
      category: cat.id,
      value: value.id,
      overrideForm: overrideSyllable.map((p) => p.ipa).join(""),
      overridePhonemeIds: overrideSyllable.map((p) => p.id),
      seed: itemSeed,
      locked: false,
    });
  }
  return built;
}

// --- Derivational morphology (Section 5.5) ---

function generateDerivationalAffixes(
  seed: Seed,
  phonology: PhonologyData,
  previous: DerivationalAffixData[],
): DerivationalAffixData[] {
  const previousById = new Map(previous.map((d) => [d.id, d]));
  const usedForms = new Set(previous.filter((d) => d.locked).map((d) => d.form));

  return DERIVATIONAL_RULE_CATALOG.map((rule) => {
    const id = `deriv:${rule.id}`;
    const existing = previousById.get(id);
    if (existing?.locked) return existing;

    const itemSeed: Seed = { base: deriveSeed(seed.base, hashString(id)), variation: 0 };
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    let built = buildAffixForm(itemRng, phonology);
    let attempts = 0;
    while (usedForms.has(built.form) && attempts < MAX_UNIQUE_ATTEMPTS) {
      built = buildAffixForm(itemRng, phonology);
      attempts++;
    }
    usedForms.add(built.form);

    return {
      version: 1,
      id,
      ruleId: rule.id,
      slot: itemRng.chance(rule.suffixLean) ? "suffix" : "prefix",
      form: built.form,
      phonemeIds: built.phonemeIds,
      seed: itemSeed,
      locked: false,
    };
  });
}

/**
 * Item-level nudge/reroll (Section 9.1/9.2) — regenerates exactly one
 * affix's phonological form, leaving its grammatical identity (category,
 * value, gloss) untouched. `strategy` normally stays the same too, except
 * in the edge case where the language's inventory can no longer support it
 * (e.g. ablaut on a language regenerated down to one vowel) — buildAffixPayload
 * falls back to a plain suffix there, so all previous strategy-specific
 * fields (circumfixClosing, ablautFrom/To, etc.) must be cleared, not just
 * overwritten, or a stale field could linger from the old strategy. No
 * cascade to other items: unlike Lexicon's compounds, no affix is derived
 * from another affix.
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

  const usedForms = new Set(args.allItems.filter((i) => i.id !== args.previous.id && i.form).map((i) => i.form));
  const itemRng = new Rng(deriveSeed(seed.base, seed.variation));
  const { strategy, payload } = buildAffixPayload(args.previous.strategy, itemRng, args.phonology, usedForms);

  return {
    version: 1,
    id: args.previous.id,
    strategy,
    domain: args.previous.domain,
    categories: args.previous.categories,
    values: args.previous.values,
    gloss: args.previous.gloss,
    ...payload,
    seed,
    locked: args.previous.locked,
  };
}

// --- Live preview (Section 5.1, 9.5, 13.5) ---

export interface TypologyPreviewExample {
  typology: MorphologicalType;
  /** The sample word with its verbal affixes attached, run through the same applyAffixesToRoot pipeline (strategies + allomorphy) real generation uses. */
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

  const rootPhonemes = buildSyllable(rng, phonology);
  const root: RootLike = {
    phonologicalForm: rootPhonemes.map((p) => p.ipa).join(""),
    phonemeIds: rootPhonemes.map((p) => p.id),
    stressedPhonemeIndex: 0,
  };

  // Up to 3 verbal affixes — enough to show isolating's near-bare output and
  // polysynthetic's stacking without listing every generated category.
  const verbalItems = dedupeAffixesByCategorySignature(items.filter((i) => i.domain === "verbal")).slice(0, 3);

  const assembled = applyAffixesToRoot(root, verbalItems, phonology, stage.allomorphy);
  const markedValues = verbalItems.flatMap((a) => a.values);

  return { typology, word: assembled.form, markedValues, affixCount: stage.affixCount };
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
