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

/**
 * Optional structural starting point for procedural generation — biases the
 * seed-derived GeometryProfile (generate.ts) toward a real script family's
 * overall character (stroke curviness, shape vocabulary) without
 * reproducing its actual letterforms; still fully procedural, just a
 * narrower/skewed random envelope. `null` = fully free generation.
 */
export type AncestorScriptFamily = "latin" | "cyrillic" | "arabic" | "devanagari" | "hangul";

export const ANCESTOR_SCRIPT_FAMILIES: AncestorScriptFamily[] = ["latin", "cyrillic", "arabic", "devanagari", "hangul"];

/** How the generator handles a phoneme inventory that exceeds a script's base glyph budget (generate.ts's BASE_GLYPH_BUDGET). Only meaningful for alphabetic/abjad/abugida — syllabic/logographic mappings have no comparable "budget" concept. */
export type OverflowStrategy = "digraph" | "diacriticStacking" | "extendedInventory";

export const OVERFLOW_STRATEGIES: OverflowStrategy[] = ["digraph", "diacriticStacking", "extendedInventory"];

/**
 * Design doc Section 9.5 named scriptCategory/aesthetic as the only two
 * Orthography knobs for M6 (deliberately no more sliders at v1). These
 * three are v2 follow-ups filed as their own ChaosPatch items after M6
 * shipped, each defaulting to a no-op value so a language generated before
 * v2 (or one that never touches these knobs) behaves identically to v1:
 * orthographicDepth 0 = pure 1:1 mapping, ancestorScript null = fully free
 * generation, overflowStrategy "extendedInventory" = today's unlimited-
 * budget behavior.
 */
export interface OrthographyParams {
  scriptCategory: ScriptCategory;
  aesthetic: Aesthetic;
  /** 0 = shallow/transparent (near-1:1 phoneme→grapheme, like Spanish); 1 = deep/opaque (irregular, context-dependent spellings, like English). */
  orthographicDepth: number;
  ancestorScript: AncestorScriptFamily | null;
  overflowStrategy: OverflowStrategy;
}

export const DEFAULT_ORTHOGRAPHY_PARAMS: OrthographyParams = {
  scriptCategory: "alphabetic",
  aesthetic: "invented",
  orthographicDepth: 0,
  ancestorScript: null,
  overflowStrategy: "extendedInventory",
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
 * The load-bearing skeleton every glyph in a script is built on, drawn
 * identically in every one of them. This is the mechanism Section 14.2 was
 * reaching for and the pre-v2 "shared stroke vocabulary" never actually
 * delivered: sharing a *pool of stroke kinds* across glyphs produces N
 * unrelated shapes that happen to be made of similar marks, which is why
 * generated sets read as scribbles. Every real constructed script instead
 * shares a literal structural motif — Britannian hangs every letter off a
 * vertical stem, Devanagari off a headline, Tau builds each one inside a
 * closed box — and the per-letter variation is only ever *what attaches
 * where*. Measured against the reference fonts in fonts/scripts/, the
 * disciplined ones hold every letter's ink to within 0.002-0.016 em of the
 * same two horizontal rails; the pre-v2 random walk drifted 0.10-0.19.
 *
 * - stemLeft/stemRight: a vertical stroke at one side; attachments reach across.
 * - headline/baseRule: a horizontal rail; attachments hang below / rise above.
 * - frame: a closed box; attachments cross its interior.
 * - spine: a centered vertical; attachments reach out both ways.
 * - none: no armature stroke drawn at all — coherence comes from the shared
 *   rails and attachment vocabulary alone, and the primary attachment is
 *   required to span rail-to-rail on its own (the sweeping single-stroke look
 *   of a cursive script).
 */
export type ArmatureKind = "stemLeft" | "stemRight" | "headline" | "baseRule" | "frame" | "spine" | "none";

export const ARMATURE_KINDS: ArmatureKind[] = ["stemLeft", "stemRight", "headline", "baseRule", "frame", "spine", "none"];

/**
 * What a single glyph hangs off its script's armature. Every one of these
 * starts at an anchor stop on the armature and terminates on either another
 * stop or the opposite rail, so a glyph is always a connected figure on a
 * shared lattice rather than a free walk.
 */
export type AttachmentKind = "arm" | "bowl" | "crossbar" | "flag" | "curl" | "pip";

export const ATTACHMENT_KINDS: AttachmentKind[] = ["arm", "bowl", "crossbar", "flag", "curl", "pip"];

/** The per-script armature choice — derived once per (seed.base, aesthetic, ancestorScript) and then held constant across every glyph, nudges included. */
export interface ScriptArmature {
  kind: ArmatureKind;
  /** The 2-3 attachment kinds this script's glyphs may draw from. Narrower than the full vocabulary on purpose: a script that uses every shape reads as no script at all. */
  attachments: AttachmentKind[];
  /** How many quantized anchor stops sit along the armature's principal axis (4-6). The lattice every attachment endpoint snaps to. */
  anchorStops: number;
}

/**
 * The shared visual grammar every glyph in a language's script must obey —
 * generated once per (seed, aesthetic), never per-glyph. A square canvas
 * with a shared baseline/x-height rail pair, corner style, stroke width,
 * and (v2) the structural armature every glyph is built on, so every glyph
 * is visibly built from the same construction rules.
 *
 * `version` is 2 as of the armature patch. Pre-v2 stored styles have no
 * `armature`/`sideBearing` and their glyphs' coordinates were produced by a
 * different algorithm entirely, so generation never reuses one (see
 * generateOrthography's nudge branch) and queries.ts reports them stale so
 * the UI can prompt a regenerate.
 */
export interface ScriptStyle {
  version: 2;
  viewBoxSize: number;
  baselineY: number;
  xHeightY: number;
  strokeWidth: number;
  cornerStyle: "sharp" | "rounded";
  /** How many attachments a single glyph gets, before its optional feature mark. */
  attachmentCountRange: [number, number];
  armature: ScriptArmature;
  /** Horizontal inset from the viewBox edge to the armature's own extent — the script's consistent side bearing. Reference fonts hold this near-constant across a whole alphabet; the pre-v2 generator drifted it per phoneme via place of articulation. */
  sideBearing: number;
  /** The script's lean, as a horizontal shear anchored at the baseline (positive = top leans right). Part of the shared grid rather than a per-glyph rendering detail, because `sideBearing` is computed to pay for the extra horizontal extent this adds — the two have to travel together or a leaning script overflows its viewBox. */
  slant: number;
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

/** Environment a GraphemeRule applies in — "always" for overflow-strategy rules (the phoneme just never got a dedicated glyph); the three positional ones for orthographicDepth's context-dependent irregularity. */
export type GraphemeRuleEnvironment = "wordInitial" | "wordMedial" | "wordFinal" | "always";

/**
 * An irregular or overflow spelling: instead of `phonemeId`'s canonical
 * single mapped glyph, render it as `glyphIds` (borrowed from glyphs that
 * already exist in this script — a single borrowed id is a "homograph"
 * substitution, 2+ ids is a digraph/trigraph) whenever `environment`
 * matches the phoneme's position in the current word. Consulted by
 * groupIntoGraphemes/composeWordGlyphSequence ahead of the plain mapping
 * lookup. Only ever populated for alphabetic/abjad/abugida — see
 * OverflowStrategy and OrthographyParams.orthographicDepth.
 */
export interface GraphemeRule {
  phonemeId: string;
  environment: GraphemeRuleEnvironment;
  glyphIds: string[];
}

/**
 * Sound/morpheme→symbol mapping (design doc Section 8.3's "Engine Output").
 * Tagged by script category so consumers can narrow without a separate
 * runtime check against `params.scriptCategory`. The base map is an
 * identity map over glyph ids by construction (a glyph's own id already IS
 * its mapping key) — kept as an explicit typed artifact anyway because it's
 * the literal Section 8.3 output the design doc asks for, gives future
 * consumers (M7 PDF export) a stable lookup without knowing per-category id
 * conventions, and leaves room for a later version where a glyph could be
 * shared across multiple sounds without a breaking change (now realized by
 * `rules`, v2's depth/overflow irregularity).
 */
export type SoundToSymbolMapping =
  | { kind: "alphabetic"; phonemeToGlyph: Record<string, string>; rules: GraphemeRule[] }
  | { kind: "abjad"; consonantToGlyph: Record<string, string>; rules: GraphemeRule[] } // vowels unwritten — explicit v1 scope cut
  | { kind: "abugida"; baseConsonantToGlyph: Record<string, string>; vowelToDiacritic: Record<string, string>; rules: GraphemeRule[] }
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
