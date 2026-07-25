// Pure, deterministic generation engine — zero Convex imports, same
// client/server-shared contract as convex/phonology/generate.ts,
// convex/lexicon/generate.ts, convex/morphology/generate.ts,
// convex/syntax/generate.ts. Reuses convex/morphology/generate.ts's
// `isVowel`/`resolvePhonemes` directly (one canonical predicate/resolver,
// not a parallel copy) but re-implements the small local `hashString`
// FNV-1a helper locally rather than importing it — same "not exported from
// there" convention convex/syntax/generate.ts already follows.

import { Rng, deriveSeed } from "../lib/rng";
import {
  AESTHETIC_STYLE_PRESETS,
  ALL_STROKE_KINDS,
  BOUNDARY_TREATMENT_TABLE,
  ORIENTATION_BY_PLACE,
  SECONDARY_MARK_ANGLE,
  STROKE_FAMILY_BY_MANNER,
  VOWEL_BACKNESS_X,
  VOWEL_HEIGHT_Y,
  VOWEL_STROKE_KINDS,
} from "./content";
import type {
  Aesthetic,
  BoundaryTreatment,
  Glyph,
  GlyphKind,
  OrthographyParams,
  OrthographyStageData,
  ScriptCategory,
  ScriptStyle,
  Seed,
  SoundToSymbolMapping,
  Stroke,
} from "./types";
import { isVowel, resolvePhonemes } from "../morphology/generate";
import type { AssembledWord } from "../morphology/generate";
import type { AffixStrategy, MorphologyAffixData } from "../morphology/types";
import type { ConsonantPhoneme, PhonologyData, VowelPhoneme } from "../phonology/types";
import type { LexiconItemData } from "../lexicon/types";

const DEFAULT_NUDGE_KEEP_PROBABILITY = 0.75;

/** FNV-1a — deterministic string→uint32, used to derive per-glyph seeds from the stage seed. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The stable id/lock key for a syllable/mora glyph — shared by generation, mapping, and live composition so all three always agree on the same key format. */
export function syllableGlyphId(consonantId: string | null, vowelId: string): string {
  return `${consonantId ?? "_"}+${vowelId}`;
}

export function buildScriptStyle(aesthetic: Aesthetic): ScriptStyle {
  return { version: 1, ...AESTHETIC_STYLE_PRESETS[aesthetic] };
}

// --- Stroke composition (Section 14.2's shared grid + shared stroke vocabulary) ---

function gridX(bias: number, style: ScriptStyle, jitter: number): number {
  const margin = style.viewBoxSize * 0.15;
  const usable = style.viewBoxSize - margin * 2;
  return margin + bias * usable + jitter;
}

function buildStrokeOfKind(kind: Stroke["kind"], xBias: number, style: ScriptStyle, rng: Rng): Stroke {
  const yTop = style.xHeightY;
  const yBottom = style.baselineY;
  switch (kind) {
    case "line": {
      const x = gridX(xBias, style, rng.int(-6, 6));
      return { kind: "line", from: { x, y: yTop }, to: { x: x + rng.int(-6, 6), y: yBottom } };
    }
    case "curve": {
      const x = gridX(xBias, style, rng.int(-6, 6));
      const curveAmount = style.cornerStyle === "rounded" ? rng.int(10, 20) : rng.int(2, 6);
      return {
        kind: "curve",
        from: { x, y: yTop },
        control: { x: x + curveAmount, y: (yTop + yBottom) / 2 },
        to: { x: x + rng.int(-6, 6), y: yBottom },
      };
    }
    case "dot": {
      const x = gridX(xBias, style, rng.int(-6, 6));
      return { kind: "dot", center: { x, y: rng.int(yTop, yBottom) }, radius: style.strokeWidth * 1.2 };
    }
    case "hook": {
      const x = gridX(xBias, style, rng.int(-6, 6));
      const curvature = style.cornerStyle === "rounded" ? rng.int(20, 40) : rng.int(5, 15);
      return {
        kind: "hook",
        anchor: { x, y: rng.int(yTop, yBottom) },
        angle: rng.int(0, 359),
        length: rng.int(15, 30),
        curvature,
      };
    }
  }
}

function buildConsonantStrokes(phoneme: ConsonantPhoneme, style: ScriptStyle, rng: Rng): Stroke[] {
  const family = STROKE_FAMILY_BY_MANNER[phoneme.features.manner];
  const xBias = ORIENTATION_BY_PLACE[phoneme.features.place];
  const [minStrokes, maxStrokes] = style.strokeCountRange;
  const strokes: Stroke[] = [];
  for (let i = 0; i < rng.int(minStrokes, maxStrokes); i++) {
    strokes.push(buildStrokeOfKind(rng.pick(family), xBias, style, rng));
  }
  if (phoneme.features.voiced) {
    strokes.push({ kind: "dot", center: { x: gridX(xBias, style, 8), y: style.xHeightY - 6 }, radius: style.strokeWidth });
  }
  if (phoneme.features.secondary) {
    const angle = SECONDARY_MARK_ANGLE[phoneme.features.secondary];
    strokes.push({ kind: "hook", anchor: { x: gridX(xBias, style, 10), y: style.xHeightY - 4 }, angle, length: 8, curvature: 10 });
  }
  return strokes;
}

function buildVowelStrokes(phoneme: VowelPhoneme, style: ScriptStyle, rng: Rng): Stroke[] {
  const xBias = VOWEL_BACKNESS_X[phoneme.features.backness];
  const count = Math.max(1, style.strokeCountRange[0] - 1);
  const strokes: Stroke[] = [];
  for (let i = 0; i < count; i++) {
    strokes.push(buildStrokeOfKind(rng.pick(VOWEL_STROKE_KINDS), xBias, style, rng));
  }
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: { x: gridX(xBias, style, -8), y: style.baselineY - 4 }, radius: style.strokeWidth });
  }
  return strokes;
}

/** A smaller mark in the ascender band above x-height, composed onto a base consonant glyph at word-composition time rather than stored as part of it (abugida vowel diacritics). */
function buildVowelDiacriticStrokes(phoneme: VowelPhoneme, style: ScriptStyle, rng: Rng): Stroke[] {
  const xBias = VOWEL_BACKNESS_X[phoneme.features.backness];
  const y = style.xHeightY * (1 - VOWEL_HEIGHT_Y[phoneme.features.height] * 0.4);
  const strokes: Stroke[] = [buildStrokeOfKind(rng.pick(VOWEL_STROKE_KINDS), xBias, style, rng)];
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: { x: gridX(xBias, style, 4), y }, radius: style.strokeWidth * 0.8 });
  }
  return strokes;
}

function buildSyllableStrokes(
  consonantId: string | null,
  vowelId: string,
  phonology: PhonologyData,
  style: ScriptStyle,
  rng: Rng,
): Stroke[] {
  const vowel = phonology.vowels.find((v) => v.id === vowelId);
  if (!vowel) return [];
  const vowelStrokes = buildVowelStrokes(vowel, style, rng);
  const consonant = consonantId ? phonology.consonants.find((c) => c.id === consonantId) : undefined;
  if (!consonant) return vowelStrokes;
  return [...buildConsonantStrokes(consonant, style, rng), ...vowelStrokes];
}

/** Logographic glyphs have no phoneme features to key off — composed from the full stroke vocabulary across the whole grid instead of a manner/place-constrained family. */
function buildConceptStrokes(style: ScriptStyle, rng: Rng): Stroke[] {
  const strokes: Stroke[] = [];
  for (let i = 0; i < rng.int(style.strokeCountRange[0], style.strokeCountRange[1] + 1); i++) {
    strokes.push(buildStrokeOfKind(rng.pick(ALL_STROKE_KINDS), rng.float(), style, rng));
  }
  return strokes;
}

const PREVIEW_SAMPLE_COUNT = 4;
const PREVIEW_SALT = 0xfeed;

/**
 * A handful of representative sample glyphs for a (scriptCategory,
 * aesthetic) combination — used by the pre-generation script-picker
 * (Section 9.5) to show what a script would look like without generating
 * (or persisting) the full glyph set. Only needs Phonology, which is
 * already a hard requirement by the time this stage's UI is reachable at
 * all; syllabic/logographic samples use placeholder ids rather than real
 * attested syllables/concepts, since the full lexicon-derived set isn't
 * being computed here — this is a style preview, not a mapping preview.
 */
export function sampleGlyphs(params: OrthographyParams, phonology: PhonologyData, seedBase: number): Glyph[] {
  const style = buildScriptStyle(params.aesthetic);
  const previewSeedBase = deriveSeed(seedBase, hashString(`${params.scriptCategory}:${params.aesthetic}`) ^ PREVIEW_SALT);
  const rng = new Rng(previewSeedBase);
  const placeholderSeed: Seed = { base: previewSeedBase, variation: 0 };

  switch (params.scriptCategory) {
    case "alphabetic":
    case "abjad": {
      return phonology.consonants.slice(0, PREVIEW_SAMPLE_COUNT).map((c) => ({
        id: c.id,
        kind: "consonant" as const,
        strokes: buildConsonantStrokes(c, style, rng),
        seed: placeholderSeed,
        locked: false,
      }));
    }
    case "abugida": {
      const consonant = phonology.consonants[0];
      const vowel = phonology.vowels[0];
      if (!consonant || !vowel) return [];
      return [
        { id: consonant.id, kind: "consonant", strokes: buildConsonantStrokes(consonant, style, rng), seed: placeholderSeed, locked: false },
        {
          id: `diacritic:${vowel.id}`,
          kind: "vowelDiacritic",
          strokes: buildVowelDiacriticStrokes(vowel, style, rng),
          seed: placeholderSeed,
          locked: false,
        },
      ];
    }
    case "syllabic": {
      const consonantId = phonology.consonants[0]?.id ?? null;
      return phonology.vowels
        .slice(0, PREVIEW_SAMPLE_COUNT)
        .map((v) => buildGlyphForSyllable(consonantId, v.id, phonology, style, previewSeedBase));
    }
    case "logographic": {
      return Array.from({ length: PREVIEW_SAMPLE_COUNT }, (_, i) => ({
        id: `preview:${i}`,
        kind: "concept" as const,
        strokes: buildConceptStrokes(style, rng),
        seed: placeholderSeed,
        locked: false,
      }));
    }
  }
}

// --- Attested syllable extraction (Section 8.1's syllabic-category scope) ---

export interface AttestedSyllable {
  consonantId: string | null;
  vowelId: string;
}

/**
 * Bounds the syllabary to the CV/V moras actually attested in generated
 * Lexicon roots, not the full theoretical consonant×vowel cross product —
 * a syllable not yet materialized here can still be built on demand via
 * `buildGlyphForSyllable` (this app's "compose live, don't cache" idiom).
 * Complex onset clusters collapse to their nucleus-adjacent consonant and
 * codas are dropped (open-syllable moras only, matching how real
 * syllabaries like hiragana work) — a deliberate v1 simplification.
 * "derived" items are skipped: their assembled `phonologicalForm` has no
 * dot delimiters to parse syllable boundaries from (core/flexible/compound
 * items do — see convex/lexicon/generate.ts's buildRoot/buildCompoundItem).
 */
export function extractAttestedSyllables(lexiconItems: LexiconItemData[], phonology: PhonologyData): AttestedSyllable[] {
  const seen = new Map<string, AttestedSyllable>();
  for (const item of lexiconItems) {
    if (item.kind === "derived") continue;
    const resolved = resolvePhonemes(item.phonemeIds, phonology);
    if (!resolved) continue;

    const syllableStrings = item.phonologicalForm.split(".").map((s) => s.replace(/ˈ/g, ""));
    let cursor = 0;
    for (const syll of syllableStrings) {
      const group: Array<ConsonantPhoneme | VowelPhoneme> = [];
      let acc = "";
      while (acc.length < syll.length && cursor < resolved.length) {
        const p = resolved[cursor];
        acc += p.ipa;
        group.push(p);
        cursor++;
      }
      if (acc !== syll) continue; // malformed/mismatched — skip rather than guess

      const vowelIdx = group.findIndex(isVowel);
      if (vowelIdx === -1) continue;
      const onset = vowelIdx > 0 ? group[vowelIdx - 1] : undefined;
      const consonantId = onset && !isVowel(onset) ? onset.id : null;
      const vowelId = (group[vowelIdx] as VowelPhoneme).id;
      const key = syllableGlyphId(consonantId, vowelId);
      if (!seen.has(key)) seen.set(key, { consonantId, vowelId });
    }
  }
  return Array.from(seen.values());
}

/** Pure, callable at any time — a syllable not yet in the stored `glyphs[]` array (e.g. one a fresh affix attachment creates) is "not yet materialized," not "unmapped." */
export function buildGlyphForSyllable(
  consonantId: string | null,
  vowelId: string,
  phonology: PhonologyData,
  style: ScriptStyle,
  seedBase: number,
): Glyph {
  const id = syllableGlyphId(consonantId, vowelId);
  const seed: Seed = { base: deriveSeed(seedBase, hashString(id)), variation: 0 };
  const rng = new Rng(deriveSeed(seed.base, seed.variation));
  return { id, kind: "syllable", strokes: buildSyllableStrokes(consonantId, vowelId, phonology, style, rng), seed, locked: false };
}

// --- Glyph-set resolution (per script category, with locked-carryover/nudge-keep) ---

interface GlyphPlan {
  id: string;
  kind: GlyphKind;
  build: (rng: Rng) => Stroke[];
}

function alphabeticPlan(phonology: PhonologyData, style: ScriptStyle): GlyphPlan[] {
  return [
    ...phonology.consonants.map((c) => ({ id: c.id, kind: "consonant" as const, build: (rng: Rng) => buildConsonantStrokes(c, style, rng) })),
    ...phonology.vowels.map((v) => ({ id: v.id, kind: "vowel" as const, build: (rng: Rng) => buildVowelStrokes(v, style, rng) })),
  ];
}

function abjadPlan(phonology: PhonologyData, style: ScriptStyle): GlyphPlan[] {
  return phonology.consonants.map((c) => ({ id: c.id, kind: "consonant" as const, build: (rng: Rng) => buildConsonantStrokes(c, style, rng) }));
}

function abugidaPlan(phonology: PhonologyData, style: ScriptStyle): GlyphPlan[] {
  return [
    ...phonology.consonants.map((c) => ({ id: c.id, kind: "consonant" as const, build: (rng: Rng) => buildConsonantStrokes(c, style, rng) })),
    ...phonology.vowels.map((v) => ({
      id: `diacritic:${v.id}`,
      kind: "vowelDiacritic" as const,
      build: (rng: Rng) => buildVowelDiacriticStrokes(v, style, rng),
    })),
  ];
}

function syllabicPlan(phonology: PhonologyData, lexiconItems: LexiconItemData[], style: ScriptStyle): GlyphPlan[] {
  return extractAttestedSyllables(lexiconItems, phonology).map(({ consonantId, vowelId }) => ({
    id: syllableGlyphId(consonantId, vowelId),
    kind: "syllable" as const,
    build: (rng: Rng) => buildSyllableStrokes(consonantId, vowelId, phonology, style, rng),
  }));
}

function logographicPlan(lexiconItems: LexiconItemData[], style: ScriptStyle): GlyphPlan[] {
  return lexiconItems.map((item) => ({ id: item.id, kind: "concept" as const, build: (rng: Rng) => buildConceptStrokes(style, rng) }));
}

function resolveGlyphs(
  plan: GlyphPlan[],
  seed: Seed,
  previousById: Map<string, Glyph>,
  mode: "initial" | "reroll" | "nudge",
  rng: Rng,
  keepProbability: number,
): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const planned of plan) {
    const prev = previousById.get(planned.id);
    if (prev?.locked) {
      glyphs.push(prev);
      continue;
    }
    if (mode === "nudge" && prev && rng.chance(keepProbability)) {
      glyphs.push(prev);
      continue;
    }

    const itemSeed: Seed =
      mode === "nudge" && prev
        ? { base: prev.seed.base, variation: prev.seed.variation + 1 }
        : { base: deriveSeed(seed.base, hashString(planned.id)), variation: 0 };
    const itemRng = new Rng(deriveSeed(itemSeed.base, itemSeed.variation));
    glyphs.push({ id: planned.id, kind: planned.kind, strokes: planned.build(itemRng), seed: itemSeed, locked: false });
  }
  return glyphs;
}

function buildMapping(category: ScriptCategory, glyphs: Glyph[]): SoundToSymbolMapping {
  switch (category) {
    case "alphabetic": {
      const phonemeToGlyph: Record<string, string> = {};
      for (const g of glyphs) phonemeToGlyph[g.id] = g.id;
      return { kind: "alphabetic", phonemeToGlyph };
    }
    case "abjad": {
      const consonantToGlyph: Record<string, string> = {};
      for (const g of glyphs) consonantToGlyph[g.id] = g.id;
      return { kind: "abjad", consonantToGlyph };
    }
    case "abugida": {
      const baseConsonantToGlyph: Record<string, string> = {};
      const vowelToDiacritic: Record<string, string> = {};
      for (const g of glyphs) {
        if (g.kind === "vowelDiacritic") vowelToDiacritic[g.id.replace(/^diacritic:/, "")] = g.id;
        else baseConsonantToGlyph[g.id] = g.id;
      }
      return { kind: "abugida", baseConsonantToGlyph, vowelToDiacritic };
    }
    case "syllabic": {
      const syllableToGlyph: Record<string, string> = {};
      for (const g of glyphs) syllableToGlyph[g.id] = g.id;
      return { kind: "syllabic", syllableToGlyph };
    }
    case "logographic": {
      const conceptToGlyph: Record<string, string> = {};
      for (const g of glyphs) conceptToGlyph[g.id] = g.id;
      return { kind: "logographic", conceptToGlyph };
    }
  }
}

export interface GenerateOrthographyArgs {
  seed: Seed;
  params: OrthographyParams;
  phonology: PhonologyData;
  /** Only consulted for the syllabic/logographic categories — safe to pass [] otherwise. */
  lexiconItems: LexiconItemData[];
  previous: OrthographyStageData | null;
  mode: "initial" | "reroll" | "nudge";
  now: number;
  nudgeKeepProbability?: number;
}

export function generateOrthography(args: GenerateOrthographyArgs): OrthographyStageData {
  const { seed, params, phonology, lexiconItems, previous, mode, now } = args;
  const keepProbability = args.nudgeKeepProbability ?? DEFAULT_NUDGE_KEEP_PROBABILITY;
  const rng = new Rng(mode === "nudge" ? deriveSeed(seed.base, seed.variation) : seed.base);

  // A nudge never touches the shared grid — only reroll/param-change does,
  // so mid-script "flavor" tweaks never fight the script's own coherence.
  const scriptStyle = mode === "nudge" && previous ? previous.scriptStyle : buildScriptStyle(params.aesthetic);

  const previousGlyphsById = new Map((previous?.glyphs ?? []).map((g) => [g.id, g] as const));

  const plan: GlyphPlan[] =
    params.scriptCategory === "alphabetic"
      ? alphabeticPlan(phonology, scriptStyle)
      : params.scriptCategory === "abjad"
        ? abjadPlan(phonology, scriptStyle)
        : params.scriptCategory === "abugida"
          ? abugidaPlan(phonology, scriptStyle)
          : params.scriptCategory === "syllabic"
            ? syllabicPlan(phonology, lexiconItems, scriptStyle)
            : logographicPlan(lexiconItems, scriptStyle);

  const glyphs = resolveGlyphs(plan, seed, previousGlyphsById, mode, rng, keepProbability);
  const mapping = buildMapping(params.scriptCategory, glyphs);

  return { version: 1, seed, params, scriptStyle, glyphs, mapping, generatedAt: now };
}

// --- Boundary rendering (Section 8.3) — resolved live, never persisted ---

export function resolveBoundaryTreatment(strategy: AffixStrategy, aesthetic: Aesthetic): BoundaryTreatment {
  return BOUNDARY_TREATMENT_TABLE[aesthetic][strategy];
}

interface GraphemeGroup {
  start: number;
  end: number;
  glyphId: string;
  diacriticGlyphId?: string;
}

function groupIntoGraphemes(resolved: Array<ConsonantPhoneme | VowelPhoneme>, mapping: SoundToSymbolMapping): GraphemeGroup[] {
  const groups: GraphemeGroup[] = [];
  // Logographic scripts render a whole word as one concept glyph — there's
  // no per-phoneme grapheme story to walk, so boundary composition simply
  // doesn't apply (see boundary-preview-panel's scope note).
  if (mapping.kind === "logographic") return groups;

  if (mapping.kind === "alphabetic") {
    resolved.forEach((p, i) => groups.push({ start: i, end: i + 1, glyphId: mapping.phonemeToGlyph[p.id] ?? p.id }));
    return groups;
  }

  if (mapping.kind === "abjad") {
    resolved.forEach((p, i) => {
      if (isVowel(p)) return;
      groups.push({ start: i, end: i + 1, glyphId: mapping.consonantToGlyph[p.id] ?? p.id });
    });
    return groups;
  }

  if (mapping.kind === "abugida") {
    let i = 0;
    while (i < resolved.length) {
      const p = resolved[i];
      if (!isVowel(p)) {
        const next = resolved[i + 1];
        if (next && isVowel(next)) {
          groups.push({
            start: i,
            end: i + 2,
            glyphId: mapping.baseConsonantToGlyph[p.id] ?? p.id,
            diacriticGlyphId: mapping.vowelToDiacritic[next.id],
          });
          i += 2;
          continue;
        }
        groups.push({ start: i, end: i + 1, glyphId: mapping.baseConsonantToGlyph[p.id] ?? p.id });
        i += 1;
        continue;
      }
      // A bare vowel with no preceding consonant carrier — render its diacritic standalone.
      groups.push({ start: i, end: i + 1, glyphId: mapping.vowelToDiacritic[p.id] ?? p.id });
      i += 1;
    }
    return groups;
  }

  // syllabic
  let i = 0;
  while (i < resolved.length) {
    const p = resolved[i];
    if (isVowel(p)) {
      const id = syllableGlyphId(null, p.id);
      groups.push({ start: i, end: i + 1, glyphId: mapping.syllableToGlyph[id] ?? id });
      i += 1;
      continue;
    }
    const next = resolved[i + 1];
    if (next && isVowel(next)) {
      const id = syllableGlyphId(p.id, next.id);
      groups.push({ start: i, end: i + 2, glyphId: mapping.syllableToGlyph[id] ?? id });
      i += 2;
      continue;
    }
    // A leftover coda consonant with no following vowel — this app's
    // syllabaries cover open CV/V moras only (see extractAttestedSyllables),
    // so it has no glyph; skip it (v1 scope cut).
    i += 1;
  }
  return groups;
}

export interface GlyphSequenceStep {
  glyphId: string;
  /** abugida only: a vowel diacritic composed onto glyphId. */
  diacriticGlyphId?: string;
  junctionBefore: BoundaryTreatment | null;
}

export interface ComposedWord {
  steps: GlyphSequenceStep[];
  /**
   * Set when an ablaut/templatic affix modified the word in place. Those
   * strategies leave no clean per-phoneme junction to anchor a per-step
   * marker at (see convex/morphology/types.ts's WordSegment comment), so the
   * UI renders this as a whole-word annotation instead of attaching it to
   * one glyph.
   */
  nonSegmentalTreatment: BoundaryTreatment | null;
}

/**
 * The live, boundary-aware word→glyph-sequence composer — never persisted,
 * same "compose live, don't cache" idiom as convex/syntax/generate.ts's
 * buildExampleSentences. `affixesUsed` must be the same list (in the same
 * order) passed to convex/morphology/generate.ts's applyAffixesToRoot to
 * produce `assembled`, so segment sources can be resolved back to their
 * originating affix.
 */
export function composeWordGlyphSequence(
  assembled: AssembledWord,
  affixesUsed: MorphologyAffixData[],
  phonology: PhonologyData,
  mapping: SoundToSymbolMapping,
  aesthetic: Aesthetic,
): ComposedWord {
  const resolved = resolvePhonemes(assembled.phonemeIds, phonology);
  if (!resolved) return { steps: [], nonSegmentalTreatment: null };

  const groups = groupIntoGraphemes(resolved, mapping);
  const affixesById = new Map(affixesUsed.map((a) => [a.id, a] as const));

  const steps: GlyphSequenceStep[] = groups.map((group, i) => {
    let junctionBefore: BoundaryTreatment | null = null;
    if (i > 0) {
      const segmentAtStart = assembled.segments.find((s) => s.start === group.start && s.source !== "root");
      const affix = segmentAtStart ? affixesById.get(segmentAtStart.source) : undefined;
      junctionBefore = affix ? resolveBoundaryTreatment(affix.strategy, aesthetic) : "adjacency";
    }
    return { glyphId: group.glyphId, diacriticGlyphId: group.diacriticGlyphId, junctionBefore };
  });

  const nonSegmental = affixesUsed.find((a) => a.strategy === "ablaut" || a.strategy === "templatic");
  const nonSegmentalTreatment = nonSegmental ? resolveBoundaryTreatment(nonSegmental.strategy, aesthetic) : null;

  return { steps, nonSegmentalTreatment };
}
