// Zero Convex imports — this file (and content.ts, generate.ts, render.ts,
// diff.ts) must stay importable from the browser for live preview (design
// doc Section 13.5), same rule as convex/phonology/*, convex/lexicon/*,
// convex/morphology/*, convex/syntax/*. Only mutations.ts, queries.ts, and
// staleness.ts touch Convex runtime machinery.

export interface Seed {
  /** Rotates only on reroll (fresh entropy at commit time). */
  base: number;
  /** Advances on each nudge commit against the same base; resets to 0 on reroll. */
  variation: number;
}

export type ScriptCategory = "alphabetic" | "abjad" | "abugida" | "syllabic" | "logographic";

export const SCRIPT_CATEGORIES: ScriptCategory[] = ["alphabetic", "abjad", "abugida", "syllabic", "logographic"];

export type Aesthetic = "invented" | "realLike";

export const AESTHETICS: Aesthetic[] = ["invented", "realLike"];

/** Design doc Section 9.5 — the only two Orthography knobs the design doc ever mentions. No additional sliders (deliberate — see M6 plan). */
export interface OrthographyParams {
  scriptCategory: ScriptCategory;
  aesthetic: Aesthetic;
}

export const DEFAULT_ORTHOGRAPHY_PARAMS: OrthographyParams = {
  scriptCategory: "alphabetic",
  aesthetic: "invented",
};

export interface Point {
  x: number;
  y: number;
}

/**
 * The small shared stroke vocabulary every glyph in a script draws from —
 * this shared vocabulary, plus ScriptStyle's shared grid, is what makes a
 * generated glyph set read as one coherent script rather than N unrelated
 * shapes (design doc Section 14.2's flagged risk).
 */
export type Stroke =
  | { kind: "line"; from: Point; to: Point }
  | { kind: "curve"; from: Point; control: Point; to: Point }
  | { kind: "dot"; center: Point; radius: number }
  | { kind: "hook"; anchor: Point; angle: number; length: number; curvature: number };

/**
 * The shared visual grammar every glyph in a language's script must obey —
 * generated once per (seed, aesthetic), never per-glyph. A square canvas
 * grid with a shared baseline/x-height band, corner style, and stroke
 * width, so every glyph is visibly built from the same construction rules.
 */
export interface ScriptStyle {
  version: 1;
  viewBoxSize: number;
  baselineY: number;
  xHeightY: number;
  strokeWidth: number;
  cornerStyle: "sharp" | "rounded";
  /** A shared connecting bar every glyph sits under — evokes Devanagari's shirorekha without copying it. realLike aesthetic only; null for invented. */
  connectorBar: { y: number } | null;
  strokeCountRange: [number, number];
}

export type GlyphKind = "consonant" | "vowel" | "vowelDiacritic" | "syllable" | "concept";

/**
 * One rendered symbol. Unlike Phonology's Phoneme (a fixed catalog entry
 * that's selected, not composed), a Glyph's strokes ARE the composed,
 * random output — so it carries its own seed/locked like a
 * LexiconItemData/MorphologyAffixData item, even though (design doc Section
 * 10.1/10.2 — orthography is a "single coherent object" stage) it lives
 * inline on this single stage document rather than a separate items table.
 * `id` is the stable lock/diff key:
 * - alphabetic/abjad/abugida (consonant): the phoneme's own catalog id.
 * - abugida (vowel diacritic): `diacritic:${vowelId}`.
 * - syllabic: `${consonantId ?? "_"}+${vowelId}` (see syllableGlyphId in generate.ts).
 * - logographic: the lexicon concept id.
 */
export interface Glyph {
  id: string;
  kind: GlyphKind;
  strokes: Stroke[];
  seed: Seed;
  locked: boolean;
}

/**
 * Sound/morpheme→symbol mapping (design doc Section 8.3's "Engine Output").
 * Tagged by script category so consumers can narrow without a separate
 * runtime check against `params.scriptCategory`. v1's mapping is an
 * identity map over glyph ids by construction (a glyph's own id already IS
 * its mapping key) — kept as an explicit typed artifact anyway because it's
 * the literal Section 8.3 output the design doc asks for, gives future
 * consumers (M7 PDF export) a stable lookup without knowing per-category id
 * conventions, and leaves room for a later version where a glyph could be
 * shared across multiple sounds without a breaking change.
 */
export type SoundToSymbolMapping =
  | { kind: "alphabetic"; phonemeToGlyph: Record<string, string> }
  | { kind: "abjad"; consonantToGlyph: Record<string, string> } // vowels unwritten — explicit v1 scope cut
  | { kind: "abugida"; baseConsonantToGlyph: Record<string, string>; vowelToDiacritic: Record<string, string> }
  | { kind: "syllabic"; syllableToGlyph: Record<string, string> } // key: `${consonantId ?? "_"}+${vowelId}`
  | { kind: "logographic"; conceptToGlyph: Record<string, string> };

export type BoundaryTreatment = "adjacency" | "ligature" | "diacritic";

export interface OrthographyStageData {
  version: 1;
  seed: Seed;
  params: OrthographyParams;
  scriptStyle: ScriptStyle;
  glyphs: Glyph[];
  mapping: SoundToSymbolMapping;
  generatedAt: number;
}

export type OrthographyTarget = "unlocked";
