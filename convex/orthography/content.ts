// Static curated tables — zero Convex imports (same rule as content.ts in
// every other engine). This is where Section 14.2's glyph-coherence
// mechanism becomes concrete numbers: which stroke shapes a manner/place
// combination is allowed to draw from, so the same feature always produces
// the same visual choice everywhere it occurs.

import type { ConsonantManner, ConsonantPlace, VowelBackness, VowelHeight } from "../phonology/types";
import type { ConsonantFeatures } from "../phonology/types";
import type { AffixStrategy } from "../morphology/types";
import type { AncestorScriptFamily, Aesthetic, ArmatureKind, AttachmentKind, ScriptStyle } from "./types";

/** The parts of ScriptStyle that come straight off the aesthetic; everything else is seed-derived per script (see buildScriptStyle). */
export type AestheticStylePreset = Omit<ScriptStyle, "version" | "strokeWidth" | "armature" | "sideBearing" | "slant">;

/**
 * Invented = sharp corners — a deliberately alien, blocky construction.
 * realLike = rounded corners, aiming for a more "familiar script family"
 * visual logic per design doc Section 8.2.
 *
 * `attachmentCountRange` replaced v1's `strokeCountRange`: a glyph is no
 * longer "N chained strokes" but "an armature plus N attachments," and the
 * reference fonts are emphatic that N is small — 1.1-2.2 contours per glyph
 * across every font in fonts/scripts/ except the one double-outlined display
 * face. Two attachments plus an optional feature mark already sits at the
 * busy end of that range.
 */
export const AESTHETIC_STYLE_PRESETS: Record<Aesthetic, AestheticStylePreset> = {
  invented: {
    viewBoxSize: 100,
    baselineY: 88,
    xHeightY: 20,
    cornerStyle: "sharp",
    attachmentCountRange: [1, 2],
  },
  realLike: {
    viewBoxSize: 100,
    baselineY: 82,
    xHeightY: 28,
    cornerStyle: "rounded",
    attachmentCountRange: [1, 2],
  },
};

/**
 * Which armatures and attachment shapes each aesthetic draws from. Invented
 * favors the rigid, geometric skeletons (box frames, centered spines, hard
 * stems) and angular attachments; realLike favors the skeletons real script
 * families actually use (stems, headlines, unsupported cursive sweeps) and
 * rounder attachments. Both pools are deliberately wider than any single
 * script uses — buildScriptArmature narrows each script to 2-3 attachment
 * kinds, because a script that draws on the whole vocabulary reads as no
 * script at all.
 */
export const AESTHETIC_ARMATURE_POOL: Record<Aesthetic, { kinds: ArmatureKind[]; attachments: AttachmentKind[] }> = {
  invented: {
    kinds: ["stemLeft", "stemRight", "frame", "spine", "headline"],
    attachments: ["arm", "crossbar", "flag", "pip", "bowl"],
  },
  realLike: {
    kinds: ["stemLeft", "stemRight", "headline", "baseRule", "none"],
    attachments: ["bowl", "curl", "arm", "crossbar", "flag"],
  },
};

/**
 * How many quantized anchor stops sit along a script's armature. Fewer stops
 * = a tighter, more repetitive script; more = a looser one with more
 * distinguishable letters.
 *
 * This and SCRIPT_ATTACHMENT_VOCABULARY_RANGE together set a hard ceiling on
 * how many distinct letterforms a script can produce, and a phoneme
 * inventory routinely runs to 27+ consonants. At 4 stops and 2 kinds that
 * ceiling sits below the inventory and a measured ~20% of an alphabet came
 * out as byte-identical duplicates — legible as a style, useless as a
 * writing system. Raised until the duplicate rate fell into the low single
 * digits while the sets still read as one script.
 */
export const ANCHOR_STOP_RANGE: [number, number] = [5, 7];

/** How many attachment kinds one script's vocabulary holds. Three reads as rigidly systematic, four as slightly richer; past that a script stops reading as a single system. */
export const SCRIPT_ATTACHMENT_VOCABULARY_RANGE: [number, number] = [3, 4];

/** Aspect ratio (ink width / rail height) envelope, taken from the reference fonts' measured 0.53-1.01 with the extremes trimmed. Drives `sideBearing`, so a script's glyphs all share one width by construction instead of drifting per phoneme. */
export const ASPECT_RANGE: [number, number] = [0.62, 0.88];

/**
 * Manner → preferred attachment kinds, in preference order (Section 14.2's
 * feature-driven determinism: the same manner always reaches for the same
 * shape everywhere it occurs). A script only owns 2-3 attachment kinds
 * (ScriptArmature.attachments), so generate.ts takes the first entry here
 * that the script actually owns and falls back to a manner-hashed pool index
 * when a manner's whole preference list is outside the script's vocabulary.
 * Both paths are deterministic per (manner, script), which is the property
 * that matters: within one script, one manner always draws one shape.
 *
 * Every manner's preference pair is a distinct unordered set from all eleven
 * others, so two consonants sharing a place of articulation can never
 * collapse onto the same attachment — the failure mode the v1 stroke-family
 * table kept re-introducing (stop/trill/tap/lateralApproximant all shared
 * {line,hook}; fricative/affricate shared {curve,line}).
 */
export const ATTACHMENT_BY_MANNER: Record<ConsonantManner, AttachmentKind[]> = {
  stop: ["arm", "crossbar"],
  nasal: ["bowl", "pip"],
  fricative: ["curl", "arm"],
  affricate: ["crossbar", "curl"],
  approximant: ["curl", "bowl"],
  lateralApproximant: ["crossbar", "flag"],
  trill: ["flag", "curl"],
  tap: ["pip", "flag"],
  lateralFricative: ["bowl", "crossbar"],
  click: ["pip", "crossbar"],
  ejective: ["arm", "flag"],
  implosive: ["bowl", "flag"],
};

/**
 * Place of articulation → position along the armature (0..1), ordered
 * front-to-back along the IPA chart's own continuum so adjacent places
 * produce visually adjacent glyphs.
 *
 * v1 spent this value on the glyph's horizontal position *within the em
 * box*, which is why bilabials sat against one edge and glottals against the
 * other — measured side-bearing drift no reference font has. It now selects
 * which anchor STOP along the shared armature a glyph's primary attachment
 * hangs from, so the front-to-back ordering survives while every glyph keeps
 * the same footprint.
 */
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

/**
 * Secondary articulation → where along the armature its distinguishing mark
 * sits (0 = the cap-rail end, 1 = the base-rail end), so the same secondary
 * feature always lands in the same place regardless of which base consonant
 * it modifies. v1 stored these as absolute degree angles for a free-floating
 * `hook`; marks now snap to the shared anchor lattice like everything else.
 */
export const SECONDARY_MARK_POSITION: Record<NonNullable<ConsonantFeatures["secondary"]>, number> = {
  labialized: 0,
  palatalized: 0.25,
  velarized: 0.5,
  aspirated: 0.75,
  glottalized: 1,
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

/** Vowels draw from the rounder end of the vocabulary — the visual contrast with consonants that alphabetic scripts generally maintain. Intersected with the script's own `attachments` vocabulary, same as the consonant path. */
export const VOWEL_ATTACHMENT_PREFERENCE: AttachmentKind[] = ["bowl", "curl", "arm", "crossbar"];

export type DiacriticShape = "tick" | "longTick" | "arc" | "hook" | "chevron";

/**
 * Abugida vowel diacritics keyed by height, alongside VOWEL_HEIGHT_Y/
 * VOWEL_BACKNESS_X's mark placement — v1 varied only a mark's POSITION,
 * built from a single primitive (a line, or a shallow arc — picked once for
 * the whole script by cornerStyle), so vowels sharing backness rendered
 * near-identical, sliding a few pixels apart. Height now also picks which of
 * five distinct primitives draws the mark, the same "deterministic feature
 * -> deterministic mark" idiom SECONDARY_MARK_POSITION already uses for
 * consonants. All five are skeleton (line/curve) shapes, never a bare dot —
 * a dot-only mark fails the same "no dot-only glyph" legibility rule the
 * main letterform path already enforces.
 */
export const DIACRITIC_SHAPE_BY_HEIGHT: Record<VowelHeight, DiacriticShape> = {
  high: "tick",
  nearHigh: "chevron",
  mid: "arc",
  nearLow: "hook",
  low: "longTick",
};

/** Logographic concepts have no phonological features to key off, so they draw from the script's whole vocabulary in seeded order. */
export const CONCEPT_ATTACHMENT_PREFERENCE: AttachmentKind[] = ["arm", "bowl", "crossbar", "curl", "flag", "pip"];

/**
 * Attachment budgets for the two categories whose glyph sets are an order of
 * magnitude larger than an alphabet's. A phoneme inventory needs ~20-30
 * distinct forms and 1-2 attachments on a 5-7 stop lattice supplies that
 * with room to spare; a lexicon-derived syllabary needs ~140 and a logography
 * ~500, and at the alphabet's budget a measured 25-33% of those sets collided
 * onto shapes already taken. More components per sign is also what real
 * syllabaries and logographies actually do — a Han character compounds
 * radicals rather than inventing 500 unrelated primitives.
 */
export const SYLLABLE_ATTACHMENT_BUDGET: [number, number] = [2, 3];
export const CONCEPT_ATTACHMENT_BUDGET: [number, number] = [3, 5];

/**
 * Ancestor-script structural seeding (OrthographyParams.ancestorScript):
 * narrows the seed-derived envelope toward a real script family's overall
 * character, rather than reproducing any actual letterform. Still fully
 * procedural — two languages picking the same ancestorScript land at
 * different points within the same narrowed range, not at identical values.
 *
 * v1 expressed this as two floats (`shapeBiasRange`, `jitterMultiplier`)
 * feeding a random walk, which made the knob visually inert: the thing that
 * actually distinguishes these families is their *skeleton* (Devanagari
 * hangs off a headline, Hangul assembles inside a block, Arabic runs a
 * connected baseline sweep with no stem at all), not the curviness of
 * individual marks. The bias is now over armatures and attachment shapes,
 * which is where the family resemblance actually lives.
 */
export const ANCESTOR_SCRIPT_BIAS: Record<AncestorScriptFamily, { kinds: ArmatureKind[]; attachments: AttachmentKind[]; aspectBias: number }> = {
  latin: { kinds: ["stemLeft", "stemRight"], attachments: ["bowl", "arm", "crossbar"], aspectBias: 0.75 },
  cyrillic: { kinds: ["stemLeft", "frame", "spine"], attachments: ["arm", "crossbar", "flag"], aspectBias: 0.8 },
  arabic: { kinds: ["none", "baseRule"], attachments: ["curl", "bowl", "pip"], aspectBias: 0.85 },
  devanagari: { kinds: ["headline"], attachments: ["bowl", "arm", "curl"], aspectBias: 0.7 },
  hangul: { kinds: ["frame", "spine"], attachments: ["crossbar", "arm", "flag"], aspectBias: 0.9 },
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
