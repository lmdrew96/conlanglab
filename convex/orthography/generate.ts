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
import type { ConsonantPhoneme, PhonologyData, VowelHeight, VowelPhoneme } from "../phonology/types";
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

const STYLE_SALT = 0xc0ffee;

/**
 * `strokeWidth`/`strokeCountRange`/`connectorBar` used to come straight off
 * the 2-entry AESTHETIC_STYLE_PRESETS table, so every script sharing an
 * aesthetic had byte-identical "visual weight" (line thickness, glyph
 * density) — part of why regenerated scripts all looked like the same font.
 * Now derived per (aesthetic, seed.base) within an aesthetic-appropriate
 * envelope: invented stays the thinner/sparser archetype and realLike the
 * heavier/denser one on average, but two scripts of the same aesthetic can
 * still land anywhere in that envelope — one bold and minimal, another thin
 * and elaborate.
 */
export function buildScriptStyle(aesthetic: Aesthetic, seedBase: number): ScriptStyle {
  const preset = AESTHETIC_STYLE_PRESETS[aesthetic];
  const rng = new Rng(deriveSeed(seedBase, STYLE_SALT));
  const strokeWidth = aesthetic === "invented" ? rng.int(3, 6) : rng.int(2, 5);
  const strokeCountRange: [number, number] =
    aesthetic === "invented" ? [rng.int(1, 2), rng.int(3, 5)] : [rng.int(2, 3), rng.int(4, 6)];
  const connectorBar = preset.connectorBar ? { y: rng.int(15, 26) } : null;
  return { version: 1, ...preset, strokeWidth, strokeCountRange, connectorBar };
}

// --- Stroke composition (Section 14.2's shared grid + shared stroke vocabulary) ---

function gridX(bias: number, style: ScriptStyle, jitter: number): number {
  const margin = style.viewBoxSize * 0.15;
  const usable = style.viewBoxSize - margin * 2;
  return margin + bias * usable + jitter;
}

const GEOMETRY_SALT = 0xbeef;

/**
 * A script's own "handwriting" — jitter spread, a consistent lean direction,
 * and hook/curve size ranges — derived once per (cornerStyle, seed.base) so
 * every reroll produces a structurally distinct-looking script instead of
 * reshuffling phonemes onto an identical fixed skeleton (the "orthography
 * variety" bug: every invented/realLike script looked the same because
 * AESTHETIC_STYLE_PRESETS is a static 2-entry table and the old hardcoded
 * jitter/hook/curve constants left almost no room for seeds to differ).
 * Bounds stay envelope-appropriate per cornerStyle so "invented" always
 * reads sharper/tighter and "realLike" always reads rounder/looser — only
 * the specific numbers within that envelope vary by seed.
 */
interface GeometryProfile {
  jitterSpread: number;
  /** -1..1, a consistent per-script lean applied to every line/curve endpoint so strokes share a "handwriting angle" instead of jittering independently. */
  slant: number;
  curveBulgeRange: [number, number];
  hookLengthRange: [number, number];
  dotScale: number;
  /**
   * 0 = this script strongly favors geometric/discrete strokes (line, dot)
   * wherever a manner's STROKE_FAMILY_BY_MANNER pool offers a choice; 1 =
   * strongly favors flowing/cursive strokes (curve, hook). Every manner pool
   * now includes at least one of each (see content.ts), so this one number
   * sweeps the whole consonant inventory — the mechanism that makes two
   * scripts of the same aesthetic read like distinct typefaces (one blocky,
   * one cursive) rather than just reshuffled letterforms.
   */
  shapeBias: number;
}

function buildGeometryProfile(cornerStyle: ScriptStyle["cornerStyle"], seedBase: number): GeometryProfile {
  const rng = new Rng(deriveSeed(seedBase, GEOMETRY_SALT));
  const rounded = cornerStyle === "rounded";
  return {
    jitterSpread: rng.int(rounded ? 5 : 6, rounded ? 12 : 16),
    slant: rng.float() * 2 - 1,
    curveBulgeRange: rounded ? [rng.int(8, 14), rng.int(16, 28)] : [rng.int(2, 6), rng.int(7, 14)],
    hookLengthRange: rounded ? [rng.int(12, 20), rng.int(24, 42)] : [rng.int(8, 16), rng.int(18, 34)],
    dotScale: rng.float() * 0.6 + 0.8,
    shapeBias: rng.float(),
  };
}

const FLOWING_STROKE_KINDS = new Set<Stroke["kind"]>(["curve", "hook"]);

/** Picks a stroke kind from an allowed pool, weighted by the script's shapeBias — a no-op when the pool has only one option (most manners still constrain to a fixed family; this only decides which member of a mixed family gets favored). */
function pickStrokeKind(kinds: readonly Stroke["kind"][], geometry: GeometryProfile, rng: Rng): Stroke["kind"] {
  if (kinds.length === 1) return kinds[0];
  return rng.weightedPick(kinds, (kind) => (FLOWING_STROKE_KINDS.has(kind) ? geometry.shapeBias : 1 - geometry.shapeBias));
}

/**
 * Vowel height was previously computed (VOWEL_HEIGHT_Y) but never actually
 * consulted when placing a vowel's stroke — every vowel glyph drew across
 * the full x-height→baseline span regardless of height, so vowels sharing a
 * backness (most of them) rendered near-identically. This maps height onto
 * a real sub-band of the available vertical range; `height: null` (used by
 * consonants/concepts, which have no height feature) keeps the full band.
 */
function heightBand(height: VowelHeight | null, top: number, bottom: number): [number, number] {
  if (height === null) return [top, bottom];
  const span = bottom - top;
  const center = top + VOWEL_HEIGHT_Y[height] * span;
  const half = span * 0.22;
  return [Math.max(top, center - half), Math.min(bottom, center + half)];
}

function buildStrokeOfKind(
  kind: Stroke["kind"],
  xBias: number,
  yBand: [number, number],
  style: ScriptStyle,
  geometry: GeometryProfile,
  rng: Rng,
): Stroke {
  const [yTop, yBottom] = yBand;
  const jitter = geometry.jitterSpread;
  const lean = geometry.slant * jitter;
  switch (kind) {
    case "line": {
      const x = gridX(xBias, style, rng.int(-jitter, jitter));
      return { kind: "line", from: { x, y: yTop }, to: { x: x + lean + rng.int(-jitter, jitter), y: yBottom } };
    }
    case "curve": {
      const x = gridX(xBias, style, rng.int(-jitter, jitter));
      const [bulgeMin, bulgeMax] = geometry.curveBulgeRange;
      const curveAmount = rng.int(bulgeMin, bulgeMax);
      return {
        kind: "curve",
        from: { x, y: yTop },
        control: { x: x + curveAmount + lean, y: (yTop + yBottom) / 2 },
        to: { x: x + lean + rng.int(-jitter, jitter), y: yBottom },
      };
    }
    case "dot": {
      const x = gridX(xBias, style, rng.int(-jitter, jitter));
      return { kind: "dot", center: { x, y: rng.int(yTop, yBottom) }, radius: style.strokeWidth * geometry.dotScale };
    }
    case "hook": {
      const x = gridX(xBias, style, rng.int(-jitter, jitter));
      const [lenMin, lenMax] = geometry.hookLengthRange;
      const [curvMin, curvMax] = geometry.curveBulgeRange;
      return {
        kind: "hook",
        anchor: { x, y: rng.int(yTop, yBottom) },
        angle: rng.int(0, 359),
        length: rng.int(lenMin, lenMax),
        curvature: rng.int(curvMin, curvMax),
      };
    }
  }
}

function buildConsonantStrokes(phoneme: ConsonantPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const family = STROKE_FAMILY_BY_MANNER[phoneme.features.manner];
  const xBias = ORIENTATION_BY_PLACE[phoneme.features.place];
  const yBand: [number, number] = [style.xHeightY, style.baselineY];
  const [minStrokes, maxStrokes] = style.strokeCountRange;
  const strokes: Stroke[] = [];
  for (let i = 0; i < rng.int(minStrokes, maxStrokes); i++) {
    strokes.push(buildStrokeOfKind(pickStrokeKind(family, geometry, rng), xBias, yBand, style, geometry, rng));
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

function buildVowelStrokes(phoneme: VowelPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const xBias = VOWEL_BACKNESS_X[phoneme.features.backness];
  const yBand = heightBand(phoneme.features.height, style.xHeightY, style.baselineY);
  const count = Math.max(1, style.strokeCountRange[0] - 1);
  const strokes: Stroke[] = [];
  for (let i = 0; i < count; i++) {
    strokes.push(buildStrokeOfKind(pickStrokeKind(VOWEL_STROKE_KINDS, geometry, rng), xBias, yBand, style, geometry, rng));
  }
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: { x: gridX(xBias, style, -8), y: style.baselineY - 4 }, radius: style.strokeWidth });
  }
  return strokes;
}

/** A smaller mark in the ascender band above x-height, composed onto a base consonant glyph at word-composition time rather than stored as part of it (abugida vowel diacritics). Previously drew its primary stroke across the same full x-height→baseline band as a consonant (the ascender-band placement only ever applied to the optional rounding dot) — now the primary stroke itself lives in the ascender band, keyed by height, so diacritics actually read as a small mark riding above the base glyph. */
function buildVowelDiacriticStrokes(phoneme: VowelPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const xBias = VOWEL_BACKNESS_X[phoneme.features.backness];
  const ascenderTop = style.xHeightY * 0.15;
  const ascenderBottom = style.xHeightY * 0.9;
  const yBand = heightBand(phoneme.features.height, ascenderTop, ascenderBottom);
  const strokes: Stroke[] = [buildStrokeOfKind(pickStrokeKind(VOWEL_STROKE_KINDS, geometry, rng), xBias, yBand, style, geometry, rng)];
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: { x: gridX(xBias, style, 4), y: ascenderBottom }, radius: style.strokeWidth * 0.8 });
  }
  return strokes;
}

function buildSyllableStrokes(
  consonantId: string | null,
  vowelId: string,
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  rng: Rng,
): Stroke[] {
  const vowel = phonology.vowels.find((v) => v.id === vowelId);
  if (!vowel) return [];
  const vowelStrokes = buildVowelStrokes(vowel, style, geometry, rng);
  const consonant = consonantId ? phonology.consonants.find((c) => c.id === consonantId) : undefined;
  if (!consonant) return vowelStrokes;
  return [...buildConsonantStrokes(consonant, style, geometry, rng), ...vowelStrokes];
}

/** Logographic glyphs have no phoneme features to key off — composed from the full stroke vocabulary across the whole grid instead of a manner/place-constrained family. */
function buildConceptStrokes(style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const yBand: [number, number] = [style.xHeightY, style.baselineY];
  const strokes: Stroke[] = [];
  for (let i = 0; i < rng.int(style.strokeCountRange[0], style.strokeCountRange[1] + 1); i++) {
    strokes.push(buildStrokeOfKind(pickStrokeKind(ALL_STROKE_KINDS, geometry, rng), rng.float(), yBand, style, geometry, rng));
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
 * Returns `style` alongside `glyphs` (rather than a bare Glyph[]) because
 * ScriptStyle is now seed-derived (stroke width, count range, connector bar
 * position) — a caller that rebuilt its own style from just `aesthetic`
 * would render these glyphs' baked-in coordinates against a mismatched
 * viewBox/stroke-width, so the exact style used at generation time has to
 * travel with them.
 */
export function sampleGlyphs(
  params: OrthographyParams,
  phonology: PhonologyData,
  seedBase: number,
): { style: ScriptStyle; glyphs: Glyph[] } {
  const previewSeedBase = deriveSeed(seedBase, hashString(`${params.scriptCategory}:${params.aesthetic}`) ^ PREVIEW_SALT);
  const style = buildScriptStyle(params.aesthetic, previewSeedBase);
  const geometry = buildGeometryProfile(style.cornerStyle, previewSeedBase);
  const rng = new Rng(previewSeedBase);
  const placeholderSeed: Seed = { base: previewSeedBase, variation: 0 };

  const glyphs: Glyph[] = (() => {
    switch (params.scriptCategory) {
      case "alphabetic":
      case "abjad": {
        return phonology.consonants.slice(0, PREVIEW_SAMPLE_COUNT).map((c) => ({
          id: c.id,
          kind: "consonant" as const,
          strokes: buildConsonantStrokes(c, style, geometry, rng),
          seed: placeholderSeed,
          locked: false,
        }));
      }
      case "abugida": {
        const consonant = phonology.consonants[0];
        const vowel = phonology.vowels[0];
        if (!consonant || !vowel) return [];
        return [
          {
            id: consonant.id,
            kind: "consonant" as const,
            strokes: buildConsonantStrokes(consonant, style, geometry, rng),
            seed: placeholderSeed,
            locked: false,
          },
          {
            id: `diacritic:${vowel.id}`,
            kind: "vowelDiacritic" as const,
            strokes: buildVowelDiacriticStrokes(vowel, style, geometry, rng),
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
          strokes: buildConceptStrokes(style, geometry, rng),
          seed: placeholderSeed,
          locked: false,
        }));
      }
    }
  })();

  return { style, glyphs };
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
  const geometry = buildGeometryProfile(style.cornerStyle, seedBase);
  return {
    id,
    kind: "syllable",
    strokes: buildSyllableStrokes(consonantId, vowelId, phonology, style, geometry, rng),
    seed,
    locked: false,
  };
}

// --- Glyph-set resolution (per script category, with locked-carryover/nudge-keep) ---

interface GlyphPlan {
  id: string;
  kind: GlyphKind;
  build: (rng: Rng) => Stroke[];
}

function alphabeticPlan(phonology: PhonologyData, style: ScriptStyle, geometry: GeometryProfile): GlyphPlan[] {
  return [
    ...phonology.consonants.map((c) => ({
      id: c.id,
      kind: "consonant" as const,
      build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng),
    })),
    ...phonology.vowels.map((v) => ({
      id: v.id,
      kind: "vowel" as const,
      build: (rng: Rng) => buildVowelStrokes(v, style, geometry, rng),
    })),
  ];
}

function abjadPlan(phonology: PhonologyData, style: ScriptStyle, geometry: GeometryProfile): GlyphPlan[] {
  return phonology.consonants.map((c) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng),
  }));
}

function abugidaPlan(phonology: PhonologyData, style: ScriptStyle, geometry: GeometryProfile): GlyphPlan[] {
  return [
    ...phonology.consonants.map((c) => ({
      id: c.id,
      kind: "consonant" as const,
      build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng),
    })),
    ...phonology.vowels.map((v) => ({
      id: `diacritic:${v.id}`,
      kind: "vowelDiacritic" as const,
      build: (rng: Rng) => buildVowelDiacriticStrokes(v, style, geometry, rng),
    })),
  ];
}

function syllabicPlan(
  phonology: PhonologyData,
  lexiconItems: LexiconItemData[],
  style: ScriptStyle,
  geometry: GeometryProfile,
): GlyphPlan[] {
  return extractAttestedSyllables(lexiconItems, phonology).map(({ consonantId, vowelId }) => ({
    id: syllableGlyphId(consonantId, vowelId),
    kind: "syllable" as const,
    build: (rng: Rng) => buildSyllableStrokes(consonantId, vowelId, phonology, style, geometry, rng),
  }));
}

function logographicPlan(lexiconItems: LexiconItemData[], style: ScriptStyle, geometry: GeometryProfile): GlyphPlan[] {
  return lexiconItems.map((item) => ({
    id: item.id,
    kind: "concept" as const,
    build: (rng: Rng) => buildConceptStrokes(style, geometry, rng),
  }));
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
  const scriptStyle = mode === "nudge" && previous ? previous.scriptStyle : buildScriptStyle(params.aesthetic, seed.base);
  // Geometry is a pure function of (cornerStyle, seed.base), and nudge keeps
  // seed.base fixed (only variation advances) — so this stays stable across
  // nudges for the same reason scriptStyle does, without needing its own
  // nudge/reroll branch.
  const geometry = buildGeometryProfile(scriptStyle.cornerStyle, seed.base);

  const previousGlyphsById = new Map((previous?.glyphs ?? []).map((g) => [g.id, g] as const));

  const plan: GlyphPlan[] =
    params.scriptCategory === "alphabetic"
      ? alphabeticPlan(phonology, scriptStyle, geometry)
      : params.scriptCategory === "abjad"
        ? abjadPlan(phonology, scriptStyle, geometry)
        : params.scriptCategory === "abugida"
          ? abugidaPlan(phonology, scriptStyle, geometry)
          : params.scriptCategory === "syllabic"
            ? syllabicPlan(phonology, lexiconItems, scriptStyle, geometry)
            : logographicPlan(lexiconItems, scriptStyle, geometry);

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
