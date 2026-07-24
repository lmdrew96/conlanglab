// Pure, deterministic generation engine — zero Convex imports. The exact
// same code runs server-side (mutations.ts, source of truth) and
// client-side (live preview, Section 13.5) because it's a plain function
// of its inputs. It must stay that way: no Date.now(), no Math.random(),
// no object-key iteration order dependence — `now` is threaded in as an
// explicit argument specifically so `generatePhonology(sameArgs)` called
// twice is always deepEqual (see phonology.test.ts).

import { Rng, deriveSeed } from "../lib/rng";
import {
  CONSONANT_CATALOG,
  CONSONANT_INVENTORY_TARGET,
  CONSONANT_MARKED_GATE,
  VOWEL_CATALOG,
  VOWEL_INVENTORY_TARGET,
  VOWEL_MARKED_GATE,
} from "./content";
import { DEFAULT_SONORITY_SCALE } from "./sonority";
import type {
  ConsonantManner,
  ConsonantPhoneme,
  Phoneme,
  PhonologyData,
  PhonologyParams,
  PhonologyTarget,
  Seed,
  SonorityGradingData,
  SonorityScale,
  StressData,
  StressPattern,
  SyllableTemplate,
  ToneData,
  VowelPhoneme,
} from "./types";

export interface GenerateArgs {
  seed: Seed;
  params: PhonologyParams;
  /** null only for the very first generation of a language's phonology. */
  previous: PhonologyData | null;
  /** Which of the 5 addressable units to (re)build; others copy verbatim from `previous`. */
  targets: PhonologyTarget[];
  mode: "initial" | "reroll" | "nudge";
  /** Injected explicitly so the function stays pure — see file header. */
  now: number;
  /** Nudge-only: probability an unlocked phoneme survives a nudge unchanged. */
  nudgeKeepProbability?: number;
}

const DEFAULT_NUDGE_KEEP_PROBABILITY = 0.75;

export function generatePhonology(args: GenerateArgs): PhonologyData {
  const { seed, params, previous, targets, mode, now } = args;
  const keepProbability = args.nudgeKeepProbability ?? DEFAULT_NUDGE_KEEP_PROBABILITY;
  const rng = new Rng(mode === "nudge" ? deriveSeed(seed.base, seed.variation) : seed.base);

  const wants = (t: PhonologyTarget) => targets.includes(t);

  let consonants: ConsonantPhoneme[];
  let vowels: VowelPhoneme[];

  if (!wants("inventory") && previous) {
    consonants = previous.consonants;
    vowels = previous.vowels;
  } else {
    const consonantGates = buildGates(CONSONANT_MARKED_GATE, params);
    const vowelGates = buildGates(VOWEL_MARKED_GATE, params);
    const consonantTarget = CONSONANT_INVENTORY_TARGET[params.consonantInventorySize];
    const vowelTarget = VOWEL_INVENTORY_TARGET[params.vowelInventorySize];

    const consonantSeed =
      mode === "nudge" && previous
        ? seedSetForNudge(rng, CONSONANT_CATALOG, previous.consonants, keepProbability)
        : seedSetForReroll(CONSONANT_CATALOG, previous?.consonants.filter((p) => p.locked) ?? []);
    const vowelSeed =
      mode === "nudge" && previous
        ? seedSetForNudge(rng, VOWEL_CATALOG, previous.vowels, keepProbability)
        : seedSetForReroll(VOWEL_CATALOG, previous?.vowels.filter((p) => p.locked) ?? []);

    consonants = resolveInventory(rng, CONSONANT_CATALOG, consonantTarget, consonantGates, params.typologicalStrictness, consonantSeed);
    vowels = resolveInventory(rng, VOWEL_CATALOG, vowelTarget, vowelGates, params.typologicalStrictness, vowelSeed);
  }

  const phonotactics = !wants("phonotactics") && previous ? previous.phonotactics : buildPhonotactics(rng, params);
  const sonorityGrading =
    !wants("sonorityGrading") && previous ? previous.sonorityGrading : buildSonorityGrading(params);
  const stress = !wants("stress") && previous ? previous.stress : buildStress(rng);
  const tone = !wants("tone") && previous ? previous.tone : buildTone(rng);

  return {
    version: 1,
    seed,
    params,
    consonants,
    vowels,
    phonotactics,
    sonorityGrading,
    stress,
    tone,
    generatedAt: now,
  };
}

function buildGates(
  gateMap: Record<string, keyof PhonologyParams["markedFeatures"]>,
  params: PhonologyParams,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [id, key] of Object.entries(gateMap)) {
    result[id] = params.markedFeatures[key];
  }
  return result;
}

function seedSetForReroll<F>(catalog: Phoneme<F>[], previousLocked: Phoneme<F>[]): Map<string, Phoneme<F>> {
  const set = new Map<string, Phoneme<F>>();
  for (const p of previousLocked) set.set(p.id, { ...p, locked: true });
  for (const p of catalog) {
    if (p.tier === "core" && !set.has(p.id)) set.set(p.id, { ...p, locked: false });
  }
  return set;
}

function seedSetForNudge<F>(
  rng: Rng,
  catalog: Phoneme<F>[],
  previous: Phoneme<F>[],
  keepProbability: number,
): Map<string, Phoneme<F>> {
  const set = new Map<string, Phoneme<F>>();
  for (const p of previous) {
    if (p.locked || rng.chance(keepProbability)) set.set(p.id, p);
  }
  // A nudge should never accidentally erode the phonological foundation.
  for (const p of catalog) {
    if (p.tier === "core" && !set.has(p.id)) set.set(p.id, { ...p, locked: false });
  }
  return set;
}

/** Core-outward fill: start from `seedSet`, add eligible catalog entries until `targetCount`. */
function resolveInventory<F>(
  rng: Rng,
  catalog: Phoneme<F>[],
  targetCount: number,
  gates: Record<string, boolean>,
  strictness: number,
  seedSet: Map<string, Phoneme<F>>,
): Phoneme<F>[] {
  const selected = new Map(seedSet);

  function prereqsMet(p: Phoneme<F>): boolean {
    return p.prerequisites.every((id) => selected.has(id));
  }
  function isEligible(p: Phoneme<F>): boolean {
    if (selected.has(p.id)) return false;
    if (p.tier === "marked" && !gates[p.id]) return false;
    return prereqsMet(p);
  }

  let guard = 0;
  const guardLimit = catalog.length * 4;
  while (selected.size < targetCount && guard < guardLimit) {
    guard++;
    const eligible = catalog.filter(isEligible);
    if (eligible.length === 0) break;
    const pick = pickNextPhoneme(rng, eligible, strictness);
    selected.set(pick.id, { ...pick, locked: false });
  }

  return Array.from(selected.values());
}

/**
 * Higher strictness biases toward common-tier phonemes over marked ones —
 * but never drives a toggled-on marked feature's weight to zero. A user who
 * turns ejectives on should actually see ejectives, not have them crowded
 * out every time common-tier alone happens to be enough to hit the target.
 * Low strictness ("allow rarer/more speculative combinations", Section 4.1)
 * lets marked-tier phonemes compete on roughly even footing with common ones.
 */
function pickNextPhoneme<F>(rng: Rng, eligible: Phoneme<F>[], strictness: number): Phoneme<F> {
  return rng.weightedPick(eligible, (p) => (p.tier === "marked" ? Math.max(0.15, 1 - strictness) : 1));
}

const CLUSTERABLE_MANNERS: ConsonantManner[] = [
  "stop",
  "fricative",
  "nasal",
  "approximant",
  "lateralApproximant",
  "trill",
  "tap",
  "affricate",
];

/**
 * clusterComplexity feeds every cluster-related probability continuously
 * (not just the 1..3 size ceiling) so the slider has a felt effect at every
 * position, not just at the two points where the ceiling steps up.
 */
function buildPhonotactics(rng: Rng, params: PhonologyParams): PhonologyData["phonotactics"] {
  const cc = params.clusterComplexity;
  const onsetMax = cc < 1 / 3 ? 1 : cc < 2 / 3 ? 2 : 3;
  const codaMax = onsetMax;

  const templates: SyllableTemplate[] = [{ shape: ["C", "V"] }];
  if (rng.chance(0.8)) templates.push({ shape: ["C", "V", "C"] });
  if (onsetMax >= 2 && rng.chance(0.3 + 0.5 * cc)) templates.push({ shape: ["C", "C", "V"] });
  if (codaMax >= 2 && rng.chance(0.15 + 0.4 * cc)) templates.push({ shape: ["C", "V", "C", "C"] });
  if (onsetMax >= 3 && rng.chance(0.15 * cc)) templates.push({ shape: ["C", "C", "C", "V"] });
  if (codaMax >= 3 && rng.chance(0.15 * cc)) templates.push({ shape: ["C", "V", "C", "C", "C"] });
  if (onsetMax >= 2 && codaMax >= 2 && rng.chance(0.1 + 0.3 * cc)) templates.push({ shape: ["C", "C", "V", "C", "C"] });

  const allowedManners = rng.shuffle(CLUSTERABLE_MANNERS).slice(0, rng.int(3, CLUSTERABLE_MANNERS.length));

  return {
    templates,
    onsetClusters: { maxSize: onsetMax, allowedManners },
    codaClusters: { maxSize: codaMax, allowedManners },
    positionRules: {
      wordInitial: { codaAllowed: false, onsetClusterMax: onsetMax },
      wordMedial: { codaAllowed: true, onsetClusterMax: onsetMax, codaClusterMax: codaMax },
      wordFinal: { codaAllowed: rng.chance(0.7), codaClusterMax: codaMax },
    },
    locked: false,
  };
}

function buildSonorityGrading(params: PhonologyParams): SonorityGradingData {
  return {
    scaleRank: DEFAULT_SONORITY_SCALE,
    allowViolations: params.sonorityViolationRate > 0,
    violationRate: params.sonorityViolationRate,
    locked: false,
  };
}

const STRESS_WEIGHTS: Array<{ pattern: StressPattern; weight: number }> = [
  { pattern: "initial", weight: 3 },
  { pattern: "penultimate", weight: 3 },
  { pattern: "final", weight: 2 },
  { pattern: "weightSensitive", weight: 2 },
  { pattern: "none", weight: 1 },
];

function buildStress(rng: Rng): StressData {
  const pattern = rng.weightedPick(STRESS_WEIGHTS, (o) => o.weight).pattern;
  return { pattern, locked: false };
}

function buildTone(rng: Rng): ToneData {
  const enabled = rng.chance(0.3);
  if (!enabled) return { enabled: false, levels: 2, contours: false, locked: false };
  return { enabled: true, levels: rng.int(2, 5), contours: rng.chance(0.5), locked: false };
}

// --- Live preview sampling (Section 9.5, 13.5) ---

const PREVIEW_SALT_SYLLABLES = 0xa11ce;
const PREVIEW_SALT_ONSET = 0xc1055;
const PREVIEW_SALT_CODA = 0xc1056;

/** A sampled syllable or cluster, paired with its phonemes for audio playback. */
export interface SampledUnit {
  ipa: string;
  phonemes: Array<ConsonantPhoneme | VowelPhoneme>;
}

function toUnit(phonemes: Array<ConsonantPhoneme | VowelPhoneme>): SampledUnit {
  return { ipa: phonemes.map((p) => p.ipa).join(""), phonemes };
}

/** Group a language's consonants by sonority rank, restricted to `allowedManners`. */
function tiersByRank(
  consonants: ConsonantPhoneme[],
  allowedManners: ConsonantManner[],
  scale: SonorityScale,
): Map<number, ConsonantPhoneme[]> {
  const tiers = new Map<number, ConsonantPhoneme[]>();
  for (const p of consonants) {
    if (!allowedManners.includes(p.features.manner)) continue;
    const rank = scale[p.features.manner];
    const bucket = tiers.get(rank);
    if (bucket) bucket.push(p);
    else tiers.set(rank, [p]);
  }
  return tiers;
}

/** A random `k`-length ascending subsequence of `sortedValues` (which stays sorted). */
function randomAscendingSubset<T>(rng: Rng, sortedValues: T[], k: number): T[] {
  const indices = rng.shuffle(sortedValues.map((_, i) => i)).slice(0, k).sort((a, b) => a - b);
  return indices.map((i) => sortedValues[i]);
}

/**
 * Manners that are sonorants (nasals, liquids, glides) rather than obstruents.
 * SSP violations (Section 4.3) are meant to simulate genuinely harsh but
 * attested languages — obstruent pileups like Georgian/Polish consonant
 * clusters — not sequences that don't occur in any language's phonotactics
 * at all. Two sonorants of the *same* manner adjacent (e.g. two glides, two
 * nasals, two liquids) is that latter case: they glide into each other with
 * no real consonantal closure between them, so it reads as broken rather
 * than harsh. That specific pattern is excluded even from the "deliberate
 * override" path; everything else (obstruent-obstruent, obstruent-sonorant,
 * differing sonorant manners) is fair game.
 */
const SONORANT_MANNERS = new Set<ConsonantManner>(["nasal", "trill", "tap", "lateralApproximant", "approximant"]);

function hasSameMannerSonorantAdjacency(picks: ConsonantPhoneme[]): boolean {
  for (let i = 1; i < picks.length; i++) {
    const prev = picks[i - 1].features.manner;
    const curr = picks[i].features.manner;
    if (prev === curr && SONORANT_MANNERS.has(prev)) return true;
  }
  return false;
}

/** Deliberate-override draw for Section 4.3 — see SONORANT_MANNERS above for the one excluded pattern. */
function pickHarshCluster(rng: Rng, consonants: ConsonantPhoneme[], size: number): ConsonantPhoneme[] {
  const guardLimit = 20;
  let picks: ConsonantPhoneme[] = [];
  for (let attempt = 0; attempt < guardLimit; attempt++) {
    picks = Array.from({ length: size }, () => rng.pick(consonants));
    if (!hasSameMannerSonorantAdjacency(picks)) return picks;
  }
  return picks;
}

/**
 * Build a cluster by construction rather than rejection-sampling: pick `size`
 * distinct sonority tiers (ascending toward the nucleus for onsets, descending
 * for codas) and draw one consonant from each. This guarantees an SSP-elegant
 * result — never a random draw that happens to fail the grader — and finally
 * makes `allowedManners` (Section 4.2) do something. When the language's
 * inventory can't support the requested size, the cluster shrinks to what's
 * actually available rather than forcing an invalid one.
 */
function pickCluster(
  rng: Rng,
  data: PhonologyData,
  size: number,
  position: "onset" | "coda",
): ConsonantPhoneme[] {
  if (size <= 0) return [];
  if (size === 1) return [rng.pick(data.consonants)];

  if (data.sonorityGrading.allowViolations && rng.chance(data.sonorityGrading.violationRate)) {
    // Deliberate override (Section 4.3) — a user who explicitly wants harsh
    // clusters gets a genuinely unconstrained draw, not a softened one.
    return pickHarshCluster(rng, data.consonants, size);
  }

  const allowedManners =
    position === "onset" ? data.phonotactics.onsetClusters.allowedManners : data.phonotactics.codaClusters.allowedManners;
  const tiers = tiersByRank(data.consonants, allowedManners, data.sonorityGrading.scaleRank);
  const ranks = Array.from(tiers.keys()).sort((a, b) => a - b);
  if (ranks.length === 0) return [rng.pick(data.consonants)];

  const clusterSize = Math.min(size, ranks.length);
  const chosenRanks = randomAscendingSubset(rng, ranks, clusterSize);
  if (position === "coda") chosenRanks.reverse();

  return chosenRanks.map((rank) => rng.pick(tiers.get(rank)!));
}

/** Exported for reuse by the Lexicon Engine (Section 6.1) — roots are built from the same syllable/phonotactic logic, not a parallel implementation. */
export function buildSyllable(rng: Rng, data: PhonologyData): Array<ConsonantPhoneme | VowelPhoneme> {
  const template = rng.pick(data.phonotactics.templates);
  const vIndex = template.shape.indexOf("V");
  const onsetSize = vIndex;
  const codaSize = template.shape.length - vIndex - 1;

  const onset = pickCluster(rng, data, onsetSize, "onset");
  const nucleus = rng.pick(data.vowels);
  const coda = pickCluster(rng, data, codaSize, "coda");

  return [...onset, nucleus, ...coda];
}

/**
 * Draw up to `count` distinct-by-ipa units from `next()`. A small inventory
 * or a narrow allowed-manner set can legitimately have fewer than `count`
 * possible outputs — in that case this returns however many unique ones
 * exist rather than padding with repeats, which would misrepresent the
 * language as more varied than it is.
 */
function sampleUnique(count: number, maxAttempts: number, next: () => SampledUnit): SampledUnit[] {
  const seen = new Set<string>();
  const results: SampledUnit[] = [];
  for (let attempt = 0; results.length < count && attempt < maxAttempts; attempt++) {
    const unit = next();
    if (seen.has(unit.ipa)) continue;
    seen.add(unit.ipa);
    results.push(unit);
  }
  return results;
}

/** Sample example syllables for the live preview panel. Read-only — never persisted. */
export function sampleSyllables(data: PhonologyData, count: number): SampledUnit[] {
  const rng = new Rng(deriveSeed(data.seed.base, PREVIEW_SALT_SYLLABLES));
  return sampleUnique(count, count * 15, () => toUnit(buildSyllable(rng, data)));
}

/**
 * Sample example clusters at a given position for the live preview panel.
 * Sizes are drawn from the full 2..maxSize range (weighted toward smaller,
 * matching how often syllable templates actually produce each size) rather
 * than always forcing the ceiling — so the preview reflects what the
 * language actually sounds like, not just its most extreme case. Below a
 * maxSize of 2, the position has no clusters at all.
 */
export function sampleClusters(data: PhonologyData, count: number, position: "onset" | "coda"): SampledUnit[] {
  const rng = new Rng(deriveSeed(data.seed.base, position === "onset" ? PREVIEW_SALT_ONSET : PREVIEW_SALT_CODA));
  const maxSize = position === "onset" ? data.phonotactics.onsetClusters.maxSize : data.phonotactics.codaClusters.maxSize;
  if (maxSize < 2) return [];

  const sizes = Array.from({ length: maxSize - 1 }, (_, i) => i + 2);
  return sampleUnique(count, count * 15, () => {
    const size = rng.weightedPick(sizes, (s) => 1 / s);
    return toUnit(pickCluster(rng, data, size, position));
  });
}
