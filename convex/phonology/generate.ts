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
import { DEFAULT_SONORITY_SCALE, gradeCluster } from "./sonority";
import type {
  ConsonantManner,
  ConsonantPhoneme,
  Phoneme,
  PhonologyData,
  PhonologyParams,
  PhonologyTarget,
  Seed,
  SonorityGradingData,
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

function buildPhonotactics(rng: Rng, params: PhonologyParams): PhonologyData["phonotactics"] {
  const onsetMax = 1 + Math.round(params.clusterComplexity * 2); // 1..3
  const codaMax = 1 + Math.round(params.clusterComplexity * 2); // 1..3

  const templates: SyllableTemplate[] = [{ shape: ["C", "V"] }];
  if (rng.chance(0.8)) templates.push({ shape: ["C", "V", "C"] });
  if (onsetMax >= 2 && rng.chance(0.6)) templates.push({ shape: ["C", "C", "V"] });
  if (codaMax >= 2 && rng.chance(0.4)) templates.push({ shape: ["C", "V", "C", "C"] });
  if (onsetMax >= 2 && codaMax >= 2 && rng.chance(0.25)) templates.push({ shape: ["C", "C", "V", "C", "C"] });

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
const MAX_CLUSTER_ATTEMPTS = 20;

function pickCluster(
  rng: Rng,
  data: PhonologyData,
  size: number,
  position: "onset" | "coda",
): ConsonantPhoneme[] {
  if (size <= 0) return [];
  if (size === 1) return [rng.pick(data.consonants)];

  for (let attempt = 0; attempt < MAX_CLUSTER_ATTEMPTS; attempt++) {
    const cluster = Array.from({ length: size }, () => rng.pick(data.consonants));
    const grade = gradeCluster(cluster, position, data.sonorityGrading.scaleRank);
    if (grade === "elegant") return cluster;
    if (data.sonorityGrading.allowViolations && rng.chance(data.sonorityGrading.violationRate)) return cluster;
  }
  // Sampling failed to find an elegant (or deliberately-allowed) cluster in
  // the attempt budget — fall back to a single consonant rather than a
  // sonority-violating one nobody asked for.
  return [rng.pick(data.consonants)];
}

function buildSyllable(rng: Rng, data: PhonologyData): string {
  const template = rng.pick(data.phonotactics.templates);
  const vIndex = template.shape.indexOf("V");
  const onsetSize = vIndex;
  const codaSize = template.shape.length - vIndex - 1;

  const onset = pickCluster(rng, data, onsetSize, "onset");
  const nucleus = rng.pick(data.vowels).ipa;
  const coda = pickCluster(rng, data, codaSize, "coda");

  return onset.map((p) => p.ipa).join("") + nucleus + coda.map((p) => p.ipa).join("");
}

/** Sample example syllables for the live preview panel. Read-only — never persisted. */
export function sampleSyllables(data: PhonologyData, count: number): string[] {
  const rng = new Rng(deriveSeed(data.seed.base, PREVIEW_SALT_SYLLABLES));
  return Array.from({ length: count }, () => buildSyllable(rng, data));
}

/** Sample example clusters at a given position for the live preview panel. */
export function sampleClusters(data: PhonologyData, count: number, position: "onset" | "coda"): string[] {
  const rng = new Rng(deriveSeed(data.seed.base, position === "onset" ? PREVIEW_SALT_ONSET : PREVIEW_SALT_CODA));
  const size = Math.max(
    2,
    position === "onset" ? data.phonotactics.onsetClusters.maxSize : data.phonotactics.codaClusters.maxSize,
  );
  return Array.from({ length: count }, () => pickCluster(rng, data, size, position).map((p) => p.ipa).join(""));
}
