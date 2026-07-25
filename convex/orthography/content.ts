// Static curated tables — zero Convex imports (same rule as content.ts in
// every other engine). This is where Section 14.2's glyph-coherence
// mechanism becomes concrete numbers: which stroke shapes a manner/place
// combination is allowed to draw from, so the same feature always produces
// the same visual choice everywhere it occurs.

import type { ConsonantManner, ConsonantPlace, VowelBackness, VowelHeight } from "../phonology/types";
import type { ConsonantFeatures } from "../phonology/types";
import type { AffixStrategy } from "../morphology/types";
import type { AncestorScriptFamily, Aesthetic, ScriptStyle, Stroke } from "./types";

/**
 * Invented = sharp corners — a deliberately alien, blocky construction.
 * realLike = rounded corners, aiming for a more "familiar script family"
 * visual logic per design doc Section 8.2.
 */
export const AESTHETIC_STYLE_PRESETS: Record<Aesthetic, Omit<ScriptStyle, "version">> = {
  invented: {
    viewBoxSize: 100,
    baselineY: 88,
    xHeightY: 20,
    strokeWidth: 4,
    cornerStyle: "sharp",
    strokeCountRange: [2, 4],
  },
  realLike: {
    viewBoxSize: 100,
    baselineY: 82,
    xHeightY: 28,
    strokeWidth: 3,
    cornerStyle: "rounded",
    strokeCountRange: [2, 5],
  },
};

/**
 * Manner → allowed stroke-kind pool (Section 14.2's feature-driven
 * determinism: same manner always draws from the same shape family,
 * everywhere it occurs in the script). Every manner now includes at least
 * one geometric kind (line/dot) and one flowing kind (curve/hook), so a
 * script's per-seed `shapeBias` (generate.ts's GeometryProfile) can
 * consistently favor blocky/discrete or cursive/flowing shapes across the
 * *whole* inventory — giving two scripts of the same aesthetic a distinct
 * "typeface" identity — while the allowed pool itself never changes, so
 * "same manner → same family" coherence is untouched; only which member of
 * that family gets favored shifts per script.
 */
export const STROKE_FAMILY_BY_MANNER: Record<ConsonantManner, Stroke["kind"][]> = {
  stop: ["line", "hook"],
  nasal: ["hook", "dot"],
  fricative: ["curve", "line"],
  affricate: ["line", "curve"],
  approximant: ["curve", "hook", "line"],
  lateralApproximant: ["line", "hook"],
  trill: ["hook", "line"],
  tap: ["hook", "line"],
  lateralFricative: ["curve", "hook", "dot"],
  click: ["dot", "line", "hook"],
  ejective: ["line", "dot", "curve"],
  implosive: ["curve", "dot"],
};

/**
 * Manner → a fixed small tick angle, appended to every consonant glyph as a
 * deterministic (non-random) "manner radical" — Hangul-style featural
 * composition: same manner always produces the exact same tiny mark,
 * regardless of which stroke kind shapeBias happened to pick for that
 * glyph's main strokes. STROKE_FAMILY_BY_MANNER's shared pool already makes
 * same-manner glyphs *likely* similar; this radical makes them *guaranteed*
 * visibly related, satisfying the "phonemes sharing a feature are visibly
 * related" contract unambiguously rather than statistically. 12 manners
 * spaced 30° apart around the circle so no two are visually adjacent.
 */
export const MANNER_RADICAL_ANGLE: Record<ConsonantManner, number> = {
  stop: 0,
  nasal: 30,
  fricative: 60,
  affricate: 90,
  approximant: 120,
  lateralApproximant: 150,
  trill: 180,
  tap: 210,
  lateralFricative: 240,
  click: 270,
  ejective: 300,
  implosive: 330,
};

/** Place of articulation → horizontal grid position (0..1), ordered front-to-back along the IPA chart's own continuum so adjacent places produce visually adjacent glyphs. */
export const ORIENTATION_BY_PLACE: Record<ConsonantPlace, number> = {
  bilabial: 0,
  labiodental: 0.1,
  dental: 0.2,
  alveolar: 0.3,
  postalveolar: 0.4,
  retroflex: 0.5,
  palatal: 0.6,
  velar: 0.7,
  uvular: 0.8,
  pharyngeal: 0.9,
  glottal: 1,
};

/** Secondary articulation → a fixed mark angle, so the same secondary feature always produces the same distinguishing mark regardless of which base consonant it modifies. */
export const SECONDARY_MARK_ANGLE: Record<NonNullable<ConsonantFeatures["secondary"]>, number> = {
  labialized: 200,
  palatalized: 45,
  velarized: 315,
  aspirated: 90,
  glottalized: 270,
};

export const VOWEL_HEIGHT_Y: Record<VowelHeight, number> = {
  high: 0,
  nearHigh: 0.25,
  mid: 0.5,
  nearLow: 0.75,
  low: 1,
};

export const VOWEL_BACKNESS_X: Record<VowelBackness, number> = {
  front: 0,
  central: 0.5,
  back: 1,
};

export const VOWEL_STROKE_KINDS: Stroke["kind"][] = ["curve", "dot"];
export const ALL_STROKE_KINDS: Stroke["kind"][] = ["line", "curve", "dot", "hook"];

/**
 * Ancestor-script structural seeding (OrthographyParams.ancestorScript):
 * narrows/skews the seed-derived GeometryProfile's random envelope toward a
 * real script family's overall character — shapeBias range (discrete vs
 * flowing strokes) and a jitter multiplier — rather than reproducing any
 * actual letterform. Still fully procedural: two languages picking the same
 * ancestorScript land at different points within the same narrowed range,
 * not at identical values.
 */
export const ANCESTOR_SCRIPT_BIAS: Record<AncestorScriptFamily, { shapeBiasRange: [number, number]; jitterMultiplier: number }> = {
  latin: { shapeBiasRange: [0.35, 0.65], jitterMultiplier: 1 },
  cyrillic: { shapeBiasRange: [0.3, 0.6], jitterMultiplier: 1.1 },
  arabic: { shapeBiasRange: [0.7, 1], jitterMultiplier: 1.2 },
  devanagari: { shapeBiasRange: [0.55, 0.85], jitterMultiplier: 1 },
  hangul: { shapeBiasRange: [0, 0.25], jitterMultiplier: 0.6 },
};

/**
 * Which junction treatment an affix's strategy gets at render time (design
 * doc Section 8.3), resolved live from (strategy, aesthetic) rather than
 * stored per-language — a pure function of two already-known values needs
 * no staleness tracking of its own. Invented aesthetic keeps affixed glyphs
 * as discrete adjacent symbols (matching its blockier, alien construction);
 * realLike connects them with a ligature stroke (a more cursive-like,
 * familiar-script feel). Non-linear strategies (infix, ablaut, templatic)
 * always get "diacritic" regardless of aesthetic — infix interrupts the
 * root rather than sitting at an edge, and ablaut/templatic modify root
 * phonemes in place with no literal segment boundary to connect at all.
 */
export const BOUNDARY_TREATMENT_TABLE: Record<Aesthetic, Record<AffixStrategy, "adjacency" | "ligature" | "diacritic">> = {
  invented: {
    prefix: "adjacency",
    suffix: "adjacency",
    infix: "diacritic",
    circumfix: "adjacency",
    reduplicationFull: "adjacency",
    reduplicationPartial: "adjacency",
    ablaut: "diacritic",
    templatic: "diacritic",
  },
  realLike: {
    prefix: "ligature",
    suffix: "ligature",
    infix: "diacritic",
    circumfix: "ligature",
    reduplicationFull: "ligature",
    reduplicationPartial: "ligature",
    ablaut: "diacritic",
    templatic: "diacritic",
  },
};
