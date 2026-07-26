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
  AESTHETIC_ARMATURE_POOL,
  AESTHETIC_STYLE_PRESETS,
  ANCESTOR_SCRIPT_BIAS,
  ANCHOR_STOP_RANGE,
  ASPECT_RANGE,
  ATTACHMENT_BY_MANNER,
  BOUNDARY_TREATMENT_TABLE,
  CONCEPT_ATTACHMENT_BUDGET,
  CONCEPT_ATTACHMENT_PREFERENCE,
  DIACRITIC_SHAPE_BY_HEIGHT,
  ORIENTATION_BY_PLACE,
  SCRIPT_ATTACHMENT_VOCABULARY_RANGE,
  SECONDARY_MARK_POSITION,
  SYLLABLE_ATTACHMENT_BUDGET,
  VOWEL_ATTACHMENT_PREFERENCE,
  VOWEL_BACKNESS_X,
  VOWEL_HEIGHT_Y,
} from "./content";
import type {
  AncestorScriptFamily,
  Aesthetic,
  ArmatureKind,
  AttachmentKind,
  BoundaryTreatment,
  Glyph,
  GlyphKind,
  GraphemeRule,
  GraphemeRuleEnvironment,
  OrthographyParams,
  OrthographyStageData,
  OverflowStrategy,
  Point,
  ScriptArmature,
  ScriptCategory,
  ScriptStyle,
  Seed,
  SoundToSymbolMapping,
  Stroke,
} from "./types";
import { isVowel, resolvePhonemes } from "../morphology/generate";
import type { AssembledWord } from "../morphology/generate";
import type { AffixStrategy, MorphologyAffixData } from "../morphology/types";
import type { ConsonantPhoneme, PhonemeTier, PhonologyData, VowelPhoneme } from "../phonology/types";
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

/** Hard cap on a script's lean. Past this the shear eats enough horizontal room that the glyph either overflows the viewBox or has to be squashed narrower than the reference aspect band allows. */
const MAX_SLANT = 0.2;

/**
 * A script's structural identity: the one armature every glyph in it is
 * built on, and the narrow attachment vocabulary those glyphs may draw from.
 * Derived once per (aesthetic, seed.base, ancestorScript) and then held
 * fixed — this is what makes a generated set read as a single script rather
 * than N unrelated shapes, and it is the thing v1 never had (see
 * ScriptStyle's doc comment in types.ts).
 */
function buildScriptArmature(aesthetic: Aesthetic, ancestorScript: AncestorScriptFamily | null, rng: Rng): ScriptArmature {
  const aestheticPool = AESTHETIC_ARMATURE_POOL[aesthetic];
  const ancestor = ancestorScript ? ANCESTOR_SCRIPT_BIAS[ancestorScript] : null;

  // An ancestor family narrows the armature choice to the skeletons that
  // family actually uses; where that intersects nothing the aesthetic
  // allows, the ancestor wins — picking "devanagari" should get a headline
  // even under the invented aesthetic, since the skeleton IS the family
  // resemblance being asked for.
  const kindPool = ancestor ? (ancestor.kinds.filter((k) => aestheticPool.kinds.includes(k)).length > 0 ? ancestor.kinds.filter((k) => aestheticPool.kinds.includes(k)) : ancestor.kinds) : aestheticPool.kinds;
  const kind = rng.pick(kindPool);

  const attachmentPool = ancestor ? [...ancestor.attachments, ...aestheticPool.attachments.filter((a) => !ancestor.attachments.includes(a))] : aestheticPool.attachments;
  const [vocabMin, vocabMax] = SCRIPT_ATTACHMENT_VOCABULARY_RANGE;
  const attachments = rng.shuffle(attachmentPool).slice(0, rng.int(vocabMin, vocabMax));

  // Every glyph needs one shape that can carry the structure its armature
  // doesn't. A vocabulary of, say, {crossbar, flag} on a `none` armature has
  // nothing that spans rail to rail, and every letter in that script would
  // collapse to a single mark at one anchor stop. Prepending rather than
  // replacing keeps the seeded vocabulary intact and just guarantees it can
  // build a letter.
  const loadBearing = loadBearingKinds(kind);
  if (!attachments.some((a) => loadBearing.includes(a))) {
    attachments.unshift(rng.pick(loadBearing.filter((k) => attachmentPool.includes(k)).length > 0 ? loadBearing.filter((k) => attachmentPool.includes(k)) : loadBearing));
  }

  const [stopMin, stopMax] = ANCHOR_STOP_RANGE;
  return { kind, attachments, anchorStops: rng.int(stopMin, stopMax) };
}

/**
 * `strokeWidth` used to come straight off the 2-entry AESTHETIC_STYLE_PRESETS
 * table, so every script sharing an aesthetic had byte-identical "visual
 * weight" — part of why regenerated scripts all looked like the same font.
 * Derived per (aesthetic, seed.base) within an aesthetic-appropriate
 * envelope instead: invented stays the heavier/blockier archetype and
 * realLike the finer one on average, but two scripts of the same aesthetic
 * can still land anywhere in that envelope.
 *
 * `sideBearing` is derived from a per-script target aspect ratio rather than
 * being a constant, and it is the mechanism that gives a script consistent
 * side bearings: since every glyph is built on the same armature inset by
 * the same amount, glyph footprints no longer drift per phoneme the way v1's
 * place-of-articulation `gridX` made them.
 */
export function buildScriptStyle(aesthetic: Aesthetic, seedBase: number, ancestorScript: AncestorScriptFamily | null = null): ScriptStyle {
  const preset = AESTHETIC_STYLE_PRESETS[aesthetic];
  const rng = new Rng(deriveSeed(seedBase, STYLE_SALT));
  const strokeWidth = aesthetic === "invented" ? rng.int(3, 6) : rng.int(2, 5);
  const armature = buildScriptArmature(aesthetic, ancestorScript, rng);

  const railHeight = preset.baselineY - preset.xHeightY;
  const [aspectMin, aspectMax] = ASPECT_RANGE;
  const ancestorAspect = ancestorScript ? ANCESTOR_SCRIPT_BIAS[ancestorScript].aspectBias : null;
  // An ancestor family pins the aspect near its own characteristic
  // proportion (Devanagari runs narrow, Hangul near-square) with a little
  // seeded play around it; without one, the full reference-derived band.
  const aspect = ancestorAspect !== null ? clamp(ancestorAspect + (rng.float() - 0.5) * 0.12, aspectMin, aspectMax) : aspectMin + rng.float() * (aspectMax - aspectMin);

  const slant = (rng.float() * 2 - 1) * MAX_SLANT;
  // `aspect` is the ratio of the glyph's TOTAL horizontal extent to its rail
  // height — the same thing measured off the reference fonts' bounding boxes
  // — so the shear has to come out of that budget, not be added on top of
  // it. Charging it on top instead would inflate every leaning script's real
  // aspect by |slant| (0.7 target rendering as 0.9) and push it clean out of
  // the reference band. Floored at `strokeWidth` so the outermost stroke's
  // own half-width still lands inside the box.
  const totalExtent = aspect * railHeight;
  const sideBearing = Math.max(strokeWidth, (preset.viewBoxSize - totalExtent) / 2);

  return { version: 2, ...preset, strokeWidth, armature, sideBearing, slant };
}

// --- Armature geometry (the shared skeleton every glyph is built on) ---

const GEOMETRY_SALT = 0xbeef;

/**
 * The small remainder of v1's GeometryProfile that still means something.
 * `shapeBias` and `curveBulgeRange` are gone: which shapes a script uses is
 * now ScriptArmature.attachments, and curve control points land on the
 * shared anchor lattice rather than being offset by a free-floating bulge.
 * `jitterSpread` is gone outright — per-endpoint jitter is the opposite of
 * what the reference fonts do. `slant` moved onto ScriptStyle, since
 * `sideBearing` is computed to pay for the horizontal extent it adds and the
 * two must be derived from the same draw.
 */
interface GeometryProfile {
  dotScale: number;
  /** How far a secondary anchor stop tends to sit from the primary one. Low = tight, repetitive letters; high = sprawling ones. */
  stopSpread: number;
}

function buildGeometryProfile(seedBase: number): GeometryProfile {
  const rng = new Rng(deriveSeed(seedBase, GEOMETRY_SALT));
  return {
    dotScale: rng.float() * 0.4 + 0.6,
    stopSpread: rng.float() * 0.5 + 0.35,
  };
}

/**
 * A glyph's coordinate frame, expressed in the two numbers that actually
 * matter: `stop` (which quantized anchor along the armature, 0..stops-1) and
 * `across` (0 = on the armature line, 1 = the opposite rail or edge). Every
 * stroke endpoint in a glyph is one of these, which is what holds a whole
 * alphabet to the same rails.
 */
interface ArmatureFrame {
  /** Drawn identically in every glyph of the script. */
  strokes: Stroke[];
  stops: number;
  point: (stop: number, across: number) => Point;
  /** Whether `strokes` already spans cap→base rail on its own. */
  spansRails: boolean;
  /** Whether `strokes` already spans the glyph's full width on its own. */
  spansWidth: boolean;
  /** True when attachments may take a negative `across` to reach the other side (spine armatures only). */
  twoSided: boolean;
}

function buildArmatureFrame(style: ScriptStyle): ArmatureFrame {
  const { viewBoxSize, xHeightY: top, baselineY: bottom, sideBearing, armature, slant } = style;
  const railHeight = bottom - top;
  const shearAtTop = railHeight * slant;
  // Anchor the shear at the baseline (shift 0 there) and let it grow toward
  // the cap rail, then push the whole frame right by whichever end the lean
  // moved leftward, so the ink lands inside [sideBearing, viewBoxSize - …]
  // regardless of lean direction.
  const left = sideBearing - Math.min(0, shearAtTop);
  const right = viewBoxSize - sideBearing - Math.max(0, shearAtTop);
  const centerX = (left + right) / 2;
  const shear = (y: number) => (bottom - y) * slant;

  const stops = armature.anchorStops;
  const line = (from: Point, to: Point): Stroke => ({ kind: "line", from, to });
  const at = (x: number, y: number): Point => ({ x: x + shear(y), y });
  /**
   * A straight armature run emitted as one segment per anchor stop rather
   * than a single long line. The segments are collinear and share endpoints,
   * so they still merge into one subpath and render identically — but it
   * leaves the pen able to stop at any anchor, which is what lets
   * chainStrokes splice an attachment in mid-run instead of starting a new
   * contour for it. Reference fonts hold 1.1-2.2 contours per glyph; an
   * unsegmented armature costs a whole extra contour per attachment.
   */
  const run = (from: Point, to: Point): Stroke[] =>
    Array.from({ length: stops - 1 }, (_, i) =>
      line(
        { x: from.x + ((to.x - from.x) * i) / (stops - 1), y: from.y + ((to.y - from.y) * i) / (stops - 1) },
        { x: from.x + ((to.x - from.x) * (i + 1)) / (stops - 1), y: from.y + ((to.y - from.y) * (i + 1)) / (stops - 1) },
      ),
    );

  const vertical = (axisX: number, oppositeX: number) => (stop: number, across: number): Point => {
    const y = top + (railHeight * stop) / (stops - 1);
    return at(axisX + across * (oppositeX - axisX), y);
  };
  const horizontal = (axisY: number, oppositeY: number) => (stop: number, across: number): Point => {
    const x = left + ((right - left) * stop) / (stops - 1);
    const y = axisY + across * (oppositeY - axisY);
    return at(x, y);
  };

  switch (armature.kind) {
    case "stemLeft": {
      const point = vertical(left, right);
      return { strokes: run(at(left, top), at(left, bottom)), stops, point, spansRails: true, spansWidth: false, twoSided: false };
    }
    case "stemRight": {
      const point = vertical(right, left);
      return { strokes: run(at(right, top), at(right, bottom)), stops, point, spansRails: true, spansWidth: false, twoSided: false };
    }
    case "spine": {
      const point = vertical(centerX, right);
      return { strokes: run(at(centerX, top), at(centerX, bottom)), stops, point, spansRails: true, spansWidth: false, twoSided: true };
    }
    case "frame": {
      const point = vertical(left, right);
      // Perimeter walked so it ends on the anchor-bearing left edge, which is
      // segmented per stop like any other run — the other three sides carry
      // no anchors, so they stay whole.
      return {
        strokes: [
          line(at(left, top), at(right, top)),
          line(at(right, top), at(right, bottom)),
          line(at(right, bottom), at(left, bottom)),
          ...run(at(left, bottom), at(left, top)),
        ],
        stops,
        point,
        spansRails: true,
        spansWidth: true,
        twoSided: false,
      };
    }
    case "headline": {
      const point = horizontal(top, bottom);
      return { strokes: run(at(left, top), at(right, top)), stops, point, spansRails: false, spansWidth: true, twoSided: false };
    }
    case "baseRule": {
      const point = horizontal(bottom, top);
      return { strokes: run(at(left, bottom), at(right, bottom)), stops, point, spansRails: false, spansWidth: true, twoSided: false };
    }
    case "none": {
      const point = vertical(left, right);
      return { strokes: [], stops, point, spansRails: false, spansWidth: false, twoSided: false };
    }
  }
}

// --- Attachments (what one glyph hangs off the shared armature) ---

/** Whether an attachment reaches all the way to the far rail/edge. At least one per glyph must, or the glyph collapses to a bare armature plus a nub and falls out of the reference aspect band. */
function reachesFarSide(kind: AttachmentKind): boolean {
  return kind === "arm" || kind === "crossbar" || kind === "curl" || kind === "bowl";
}

/**
 * Whether an attachment actually travels between its two anchor stops.
 * `crossbar` and `pip` read only `stopA` — which is fine hanging off an
 * armature that already spans the rails, but on a `none` armature (no
 * armature stroke at all) it makes the whole glyph a single mark at one
 * stop: zero height, and an aspect ratio that runs off to infinity.
 */
function spansStops(kind: AttachmentKind): boolean {
  return kind === "arm" || kind === "curl" || kind === "bowl" || kind === "flag";
}

/** The kinds that can carry a glyph's structural guarantee, in preference order, given what its armature leaves unestablished. */
function loadBearingKinds(armatureKind: ArmatureKind): AttachmentKind[] {
  const spanning: AttachmentKind[] = ["arm", "curl", "bowl"];
  return armatureKind === "none" ? spanning : ["crossbar", ...spanning];
}

function buildAttachment(kind: AttachmentKind, frame: ArmatureFrame, stopA: number, stopB: number, side: number, style: ScriptStyle, geometry: GeometryProfile): Stroke[] {
  const p = (stop: number, across: number) => frame.point(stop, across * side);
  switch (kind) {
    case "arm":
      return [{ kind: "line", from: p(stopA, 0), to: p(stopB, 1) }];
    case "crossbar":
      return [{ kind: "line", from: p(stopA, 0), to: p(stopA, 1) }];
    case "flag":
      return [{ kind: "line", from: p(stopA, 0), to: p(stopB, 0.5) }];
    case "curl":
      return [{ kind: "curve", from: p(stopA, 0), control: p(stopA, 1), to: p(stopB, 1) }];
    case "bowl": {
      // Two connected quadratics rather than one — a single quadratic only
      // reaches halfway to its control point, so a one-segment "bowl" would
      // top out at across≈0.5 and leave the glyph too narrow. Split at the
      // midpoint so the curve genuinely touches the far side, and because
      // seg1.to === seg2.from, render.ts merges them into one subpath.
      const mid = (stopA + stopB) / 2;
      return [
        { kind: "curve", from: p(stopA, 0), control: p(stopA, 1), to: p(mid, 1) },
        { kind: "curve", from: p(mid, 1), control: p(stopB, 1), to: p(stopB, 0) },
      ];
    }
    case "pip":
      // Halfway across rather than on the armature line: a dot sitting
      // directly on the stem just reads as a lump on it, not as a mark.
      return [{ kind: "dot", center: p(stopA, 0.5), radius: style.strokeWidth * geometry.dotScale }];
  }
}

/**
 * Picks the attachment a feature maps to, honoring both invariants that
 * matter: within one script the same feature always draws the same shape,
 * and a script only ever uses shapes from its own narrow vocabulary. Takes
 * the first preference the script actually owns; when a feature's whole
 * preference list falls outside the vocabulary, falls back to a
 * deterministic hash into the vocabulary rather than an arbitrary default,
 * so distinct features still land on distinct shapes where the pool allows.
 */
function resolveAttachment(preference: readonly AttachmentKind[], vocabulary: AttachmentKind[], featureKey: string): AttachmentKind {
  const owned = preference.find((kind) => vocabulary.includes(kind));
  return owned ?? vocabulary[hashString(featureKey) % vocabulary.length];
}

/**
 * Reorders a glyph's strokes so consecutive ones share endpoints wherever
 * the geometry allows, which is what lets render.ts's glyphToSvgPath merge
 * them into a single SVG subpath. Purely an ordering concern — every stroke
 * is painted with the same stroke, so drawing order and direction are
 * visually irrelevant, but contour count is not: the reference fonts sit at
 * 1.1-2.2 contours per glyph, and emitting an armature and its attachments
 * in construction order lands closer to 3 even when every one of them
 * physically touches its neighbour.
 *
 * Dots are pulled to the end and never chained: render.ts always gives a dot
 * its own "M" (it's a closed loop, not something a line can continue into),
 * so leaving one mid-sequence would break the chain on both sides of it.
 */
function chainStrokes(strokes: Stroke[]): Stroke[] {
  const endpointsOf = (s: Stroke): [Point, Point] | null =>
    s.kind === "line" || s.kind === "curve" ? [s.from, s.to] : null;
  const reverse = (s: Stroke): Stroke =>
    s.kind === "line" ? { ...s, from: s.to, to: s.from } : s.kind === "curve" ? { ...s, from: s.to, to: s.from } : s;
  const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.001;

  const dots = strokes.filter((s) => s.kind === "dot");
  const pending = strokes.filter((s) => s.kind !== "dot");
  if (pending.length === 0) return dots;

  const ordered: Stroke[] = [pending.shift() as Stroke];
  let pen = (endpointsOf(ordered[0]) as [Point, Point])[1];
  while (pending.length > 0) {
    let index = pending.findIndex((s) => same((endpointsOf(s) as [Point, Point])[0], pen));
    let flip = false;
    if (index === -1) {
      index = pending.findIndex((s) => same((endpointsOf(s) as [Point, Point])[1], pen));
      flip = index !== -1;
    }
    if (index === -1) index = 0;
    const next = flip ? reverse(pending[index]) : pending[index];
    pending.splice(index, 1);
    ordered.push(next);
    pen = (endpointsOf(next) as [Point, Point])[1];
  }
  return [...ordered, ...dots];
}

/** One feature's contribution to a glyph: where along the armature it sits and what shape it reaches for. */
interface AttachmentSpec {
  /** 0..1 along the armature — which anchor stop this attachment hangs from. */
  position: number;
  preference: readonly AttachmentKind[];
  /** Distinguishes features whose preference list misses the script vocabulary entirely. */
  featureKey: string;
}

interface GlyphSpec extends AttachmentSpec {
  /**
   * A second feature-determined attachment rather than a seeded one — used
   * by syllabic glyphs, where the vowel is as much a part of the sign as the
   * consonant and can't be left to the rng the way a decorative second
   * attachment can.
   */
  secondary?: AttachmentSpec;
  /** A small interior mark for a salient binary feature (voicing, rounding, secondary articulation, overflow tier). */
  mark: { position: number } | null;
  /**
   * Overrides ScriptStyle.attachmentCountRange for glyph kinds that need a
   * bigger shape space than an alphabet does. A phoneme inventory asks for
   * ~20-30 distinct forms, which 1-2 attachments on a 5-7 stop lattice
   * supplies comfortably; a syllabary asks for ~140 and a logography for
   * ~500, which it does not — measured 25-33% of those sets colliding onto
   * shapes already taken. Real logographies answer this the same way, by
   * compounding several components into one sign.
   */
  attachmentBudget?: [number, number];
}

/**
 * The one place a glyph gets built. Every glyph in a script shares
 * `frame.strokes` verbatim and differs only in which attachments hang off
 * which anchor stops — the inversion of v1, where each glyph was an
 * independent random walk and the only thing shared was a stroke-kind pool.
 */
function buildGlyphStrokes(spec: GlyphSpec, style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const frame = buildArmatureFrame(style);
  const vocabulary = style.armature.attachments;
  const lastStop = frame.stops - 1;

  const stopFor = (position: number) => Math.round(clamp(position, 0, 1) * lastStop);
  const primaryStop = stopFor(spec.position);
  // The partner stop is what gives a glyph a second degree of freedom
  // beyond its place-derived primary stop, so the range it can span sets a
  // hard ceiling on how many distinct letters a script can have. A ±1 step
  // offers two partners; against a 27-consonant inventory mapped onto 4-6
  // stops that collapses most of the alphabet onto identical forms. Floored
  // at 2 so even the tightest script keeps four distinct partners, and
  // `stopSpread` still sets a script's character (compact vs sprawling)
  // above that floor. `rng` is seeded from the glyph's own id (see
  // resolveGlyphs), so this is stable per phoneme — distinctness, not noise.
  const maxSpread = clamp(Math.round(geometry.stopSpread * lastStop) + 1, 2, Math.max(2, lastStop));
  const spread = rng.int(1, maxSpread) * (rng.chance(0.5) ? 1 : -1);
  /**
   * Every two-point attachment needs its endpoints on genuinely different
   * stops. Clamping a ±spread offset into range collapses it back onto the
   * primary whenever the primary is already at a rail — and a `bowl` or
   * `curl` whose endpoints coincide degenerates into a fold-back squiggle,
   * which is exactly the scribble artifact this whole patch exists to
   * remove. Prefer whichever direction has room; only fall back to a
   * single-step nudge if neither does.
   */
  const separated = (from: number, offset: number): number => {
    const preferred = from + offset <= lastStop && from + offset >= 0 ? offset : -offset;
    const candidate = clamp(from + preferred, 0, lastStop);
    if (candidate !== from) return candidate;
    return from < lastStop ? from + 1 : from - 1;
  };
  const partnerStop = separated(primaryStop, spread);

  // A syllabic glyph's second attachment is the vowel — feature-determined,
  // not a seeded flourish — so it is placed before the optional decorative
  // one is even considered, and the decorative one is skipped entirely.
  const placed: Array<{ kind: AttachmentKind; a: number; b: number }> = [];
  // A glyph carrying a feature mark can't also have a bare `pip` as its
  // primary: the letter would be two loose dots and an armature, with
  // nothing to say which dot is the meaningful one.
  const primaryPool = spec.mark && vocabulary.length > 1 ? vocabulary.filter((k) => k !== "pip") : vocabulary;
  const primaryKind = resolveAttachment(spec.preference, primaryPool, spec.featureKey);
  placed.push({ kind: primaryKind, a: primaryStop, b: partnerStop });

  if (spec.secondary) {
    const stop = stopFor(spec.secondary.position);
    placed.push({
      kind: resolveAttachment(spec.secondary.preference, vocabulary, spec.secondary.featureKey),
      a: stop,
      b: stop === primaryStop ? separated(stop, spread) : primaryStop,
    });
  }

  {
    const [countMin, countMax] = spec.attachmentBudget ?? style.attachmentCountRange;
    // A glyph that already carries a feature mark excludes `pip` here: two
    // unconnected dots in one letter read as an accident rather than as two
    // deliberate marks, and the feature mark is the one carrying meaning.
    const available = vocabulary.filter((k) => k !== primaryKind && !(spec.mark && k === "pip"));
    // A `spine` sits at the glyph's centre, so `across` only ever reaches
    // half the footprint from it — a spine glyph with a single one-sided
    // attachment covers half the width the side bearing was budgeted for and
    // renders far too narrow. The opposite-side attachment is structural
    // there, not decorative, so it isn't left to the count roll.
    // A primary that ignores its partner stop (`crossbar`, `pip`) leaves the
    // glyph with a single degree of freedom — its one anchor position — so
    // an alphabet of 27 consonants collapses onto the 4-6 available stops
    // and most letters come out identical but for their feature mark. A
    // second attachment restores the (stopA, stopB) pair and with it enough
    // distinct forms to actually spell with.
    // `none` pins its structural attachment to the full stop range in every
    // glyph of the script (it is standing in for the missing armature), so
    // the second attachment is the only thing that can tell its letters
    // apart at all.
    const wantsMore = frame.twoSided || style.armature.kind === "none" || !spansStops(primaryKind) || rng.int(countMin, countMax) > placed.length;
    // On a spine that second attachment is load-bearing for the glyph's
    // width, so it has to be one of the kinds that actually reaches the
    // edge — a `flag` stops halfway and leaves the glyph a quarter narrower
    // than the side bearing budgeted for.
    const eligible = frame.twoSided ? available.filter((k) => reachesFarSide(k)) : available;
    // Falling back to the primary's own kind — at a different anchor stop —
    // rather than to nothing. The vocabulary can legitimately run dry here
    // (two kinds, one taken by the primary, `pip` filtered out by a feature
    // mark), and a repeated shape at a second position is an ordinary
    // letterform, whereas skipping the attachment leaves the glyph with a
    // single degree of freedom and duplicates elsewhere in the alphabet. On
    // a two-sided armature it additionally keeps both flanks full width.
    const pool = eligible.length > 0 ? eligible : [primaryKind];
    // Each extra attachment draws its own stop pair rather than reusing the
    // primary's reversed: (partner, primary) makes it fully determined by the
    // first attachment, so it adds no distinguishing power at all — two
    // phonemes that collided on the primary still collide on the whole glyph.
    // A budget above 2 compounds further components onto the same armature,
    // which is how the syllabic and logographic sets reach the hundreds of
    // distinct signs they need. Counted against what is already placed, so a
    // syllable's feature-driven vowel attachment fills part of the budget
    // rather than being additional to it.
    const extras = wantsMore ? Math.max(1, countMax - placed.length) : 0;
    for (let i = 0; i < extras && pool.length > 0; i++) {
      const anchor = i === 0 ? partnerStop : rng.int(0, lastStop);
      placed.push({ kind: rng.pick(pool), a: anchor, b: separated(anchor, rng.int(1, maxSpread) * (rng.chance(0.5) ? 1 : -1)) });
    }
  }

  // Whatever the armature doesn't establish on its own, an attachment has
  // to. A `frame` already covers both rails and full width, so it can carry
  // nothing but a `pip` and still be a legitimate letter; a bare stem plus a
  // pip is a line with a dot beside it, well outside the reference aspect
  // band. The promoted kind is drawn from the script's own vocabulary where
  // possible, so the guarantee doesn't smuggle in a shape the rest of the
  // alphabet never uses.
  const armatureKind = style.armature.kind;
  const loadBearing = loadBearingKinds(armatureKind);
  const carriesStructure = (kind: AttachmentKind) => reachesFarSide(kind) && (armatureKind !== "none" || spansStops(kind));
  // On a two-sided armature each side is only half the footprint, so it is
  // not enough for *some* attachment to reach the edge — the primary has to
  // as well, or the glyph comes out three-quarters width with one stunted
  // flank.
  const primaryMustCarry = frame.twoSided ? !carriesStructure(placed[0].kind) : !placed.some((p) => carriesStructure(p.kind));
  if (!(frame.spansRails && frame.spansWidth) && primaryMustCarry) {
    placed[0].kind = loadBearing.find((k) => vocabulary.includes(k)) ?? loadBearing[0];
  }
  // `none` draws no armature at all, so whichever attachment carries the
  // structure is the only thing reaching either rail — it has to run the
  // full stop range, and is in effect that script's armature: identical in
  // every glyph, which is exactly what holds the set together. All of the
  // distinguishing work therefore falls on the second attachment, which is
  // why `wantsSecond` forces one here.
  if (armatureKind === "none") {
    const structural = placed.find((p) => carriesStructure(p.kind)) ?? placed[0];
    structural.a = 0;
    structural.b = lastStop;
  }

  const strokes: Stroke[] = [...frame.strokes];
  placed.forEach(({ kind, a, b }, i) => {
    const side = frame.twoSided && i > 0 ? -1 : 1;
    strokes.push(...buildAttachment(kind, frame, a, b, side, style, geometry));
  });

  if (spec.mark) {
    // Half a stop off the lattice and halfway across, so the mark floats in
    // the glyph's counter instead of being swallowed by the armature line it
    // would otherwise sit on. Inside both rails by construction, so it never
    // disturbs the script's rail alignment.
    const markStop = clamp(spec.mark.position * lastStop + 0.5, 0, lastStop);
    strokes.push({ kind: "dot", center: frame.point(markStop, 0.5), radius: style.strokeWidth * geometry.dotScale * 0.8 });
  }

  return clampStrokes(chainStrokes(strokes), style.viewBoxSize);
}

// --- Shared numeric helpers ---

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPoint(point: Point, size: number): Point {
  return { x: clamp(point.x, 0, size), y: clamp(point.y, 0, size) };
}

/**
 * Defensive net against a stroke straying off-canvas. buildScriptStyle's
 * `sideBearing` already budgets for the ink width plus the shear, so nothing
 * an armature or attachment draws should reach the edge on its own — but a
 * `dot`'s radius and a curve's control point are the two coordinates not
 * covered by that budget, and a clamp here is cheaper than a proof. Clamps
 * every coordinate field a Stroke actually stores; a `hook`'s far end isn't
 * a stored field (only its anchor is), so there's nothing further to clamp
 * there. `hook` is no longer generated at all as of v2 — the case stays for
 * pre-v2 stored glyphs read back through clampStrokes.
 */
function clampStroke(stroke: Stroke, size: number): Stroke {
  switch (stroke.kind) {
    case "line":
      return { ...stroke, from: clampPoint(stroke.from, size), to: clampPoint(stroke.to, size) };
    case "curve":
      return { ...stroke, from: clampPoint(stroke.from, size), control: clampPoint(stroke.control, size), to: clampPoint(stroke.to, size) };
    case "dot":
      return { ...stroke, center: clampPoint(stroke.center, size) };
    case "hook":
      return { ...stroke, anchor: clampPoint(stroke.anchor, size) };
  }
}

function clampStrokes(strokes: Stroke[], size: number): Stroke[] {
  return strokes.map((stroke) => clampStroke(stroke, size));
}

// --- Per-category glyph builders ---

/**
 * At most one mark per glyph, by priority: secondary articulation and
 * voicing are the phonologically salient contrasts so they win, and
 * overflow — the "added-on tier" signal — is next. The reference fonts'
 * dominant pattern is a bare skeleton with NO mark at all in the common
 * case, so a plain voiceless consonant gets nothing.
 */
function consonantMark(phoneme: ConsonantPhoneme, markOverflow: boolean): GlyphSpec["mark"] {
  if (phoneme.features.secondary) return { position: SECONDARY_MARK_POSITION[phoneme.features.secondary] };
  if (phoneme.features.voiced) return { position: 0.5 };
  return markOverflow ? { position: 1 } : null;
}

function buildConsonantStrokes(phoneme: ConsonantPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng, markOverflow = false): Stroke[] {
  return buildGlyphStrokes(
    {
      position: ORIENTATION_BY_PLACE[phoneme.features.place],
      preference: ATTACHMENT_BY_MANNER[phoneme.features.manner],
      featureKey: `manner:${phoneme.features.manner}`,
      mark: consonantMark(phoneme, markOverflow),
    },
    style,
    geometry,
    rng,
  );
}

/**
 * Vowel height picks the anchor stop and backness the attachment shape, so
 * the two features that distinguish vowels from each other are the two that
 * vary the glyph — v1 computed VOWEL_HEIGHT_Y and then placed every vowel
 * across the same band anyway, so vowels sharing a backness rendered
 * near-identically.
 */
function buildVowelStrokes(phoneme: VowelPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng, markOverflow = false): Stroke[] {
  const backness = VOWEL_BACKNESS_X[phoneme.features.backness];
  const preference = backness < 0.5 ? VOWEL_ATTACHMENT_PREFERENCE : [...VOWEL_ATTACHMENT_PREFERENCE].reverse();
  return buildGlyphStrokes(
    {
      position: VOWEL_HEIGHT_Y[phoneme.features.height],
      preference,
      featureKey: `backness:${phoneme.features.backness}`,
      mark: phoneme.features.rounded ? { position: 0.5 } : markOverflow ? { position: 1 } : null,
    },
    style,
    geometry,
    rng,
  );
}

/**
 * A small mark riding in the ascender band above the cap rail, composed onto
 * a base consonant glyph at word-composition time rather than stored as part
 * of it (abugida vowel diacritics). Deliberately built on its own miniature
 * frame rather than the script's armature: a diacritic that inherited the
 * full skeleton would be a second letter stacked on the first, not a mark.
 * It's the one glyph kind exempt from the rail rule, because sitting outside
 * the rails is exactly what makes it read as a diacritic.
 */
function buildVowelDiacriticStrokes(phoneme: VowelPhoneme, style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  const bandTop = style.xHeightY * 0.15;
  const bandBottom = style.xHeightY * 0.8;
  const width = (style.viewBoxSize - style.sideBearing * 2) * 0.4;
  const left = (style.viewBoxSize - width) / 2;
  const x = left + VOWEL_BACKNESS_X[phoneme.features.backness] * width;
  const bandHeight = bandBottom - bandTop;
  const centerY = bandTop + bandHeight * 0.5;
  // Height slides a fixed-length mark down the band rather than stretching
  // it between the band edges: a mark whose length varied with height would
  // collapse to zero at `low` (its top and bottom coinciding), the same
  // degenerate-stroke failure mode the main glyph path guards against.
  const markLength = bandHeight * 0.5;
  const top = bandTop + VOWEL_HEIGHT_Y[phoneme.features.height] * (bandHeight - markLength);
  const bottom = top + markLength;
  // A small deterministic wobble on top of the height/backness-driven
  // placement, so two vowels landing on the same shape+position (e.g. two
  // scripts both drawing a "tick" at the same backness) still don't render
  // pixel-identical marks.
  const jitter = (rng.float() - 0.5) * style.strokeWidth;

  const shape = DIACRITIC_SHAPE_BY_HEIGHT[phoneme.features.height];
  const strokes: Stroke[] = [];
  // Every branch also records `anchor`, one of its own stroke's real
  // endpoints — not an independently computed point: with no armature to
  // fall back on, a diacritic's rounding dot is the one stroke that would
  // otherwise float free of the glyph entirely.
  let anchor: Point;
  switch (shape) {
    case "tick": {
      const from = { x: x + jitter, y: top };
      strokes.push({ kind: "line", from, to: { x: x + jitter, y: bottom } });
      anchor = from;
      break;
    }
    case "longTick": {
      const from = { x: x + jitter, y: bandTop };
      strokes.push({ kind: "line", from, to: { x: x + jitter, y: bandBottom } });
      anchor = from;
      break;
    }
    case "arc": {
      const from = { x: left, y: bottom };
      strokes.push({ kind: "curve", from, control: { x, y: top + jitter }, to: { x: left + width, y: bottom } });
      anchor = from;
      break;
    }
    case "hook": {
      const from = { x: x - markLength * 0.4, y: top };
      strokes.push({ kind: "curve", from, control: { x, y: centerY + jitter }, to: { x: x + markLength * 0.4, y: bottom } });
      anchor = from;
      break;
    }
    case "chevron": {
      const apex = { x, y: bottom };
      const to = { x: x + markLength * 0.35 + jitter, y: top };
      strokes.push(
        { kind: "line", from: { x: x - markLength * 0.35, y: top }, to: apex },
        { kind: "line", from: apex, to },
      );
      anchor = to;
      break;
    }
  }
  if (phoneme.features.rounded) {
    strokes.push({ kind: "dot", center: anchor, radius: style.strokeWidth * geometry.dotScale * 0.8 });
  }
  return clampStrokes(strokes, style.viewBoxSize);
}

/**
 * A tone mark composed onto a vowel-bearing glyph at word-composition time
 * (see composeWordGlyphSequence), never stored as part of the base glyph —
 * tone is a per-word Lexicon value (LexiconItemData.toneValues), not a
 * phoneme-catalog feature, so unlike every other mark in this file it has no
 * fixed per-phoneme home to live in. `levels` is language-specific
 * (phonology.tone.levels, 2-5), so position is a continuous t = level /
 * (levels-1) rather than a fixed Record table — the same "position encodes a
 * feature" idiom VOWEL_HEIGHT_Y uses, just computed instead of looked up
 * since the number of contrastive levels varies per language. Sits in a
 * thin strip above the vowel-diacritic band (buildVowelDiacriticStrokes) so
 * an abugida vowel can carry both marks without them colliding.
 */
export function buildToneMarkStrokes(level: number, levels: number, style: ScriptStyle): Stroke[] {
  const bandTop = 0;
  const bandBottom = style.xHeightY * 0.12;
  const t = levels <= 1 ? 0.5 : level / (levels - 1);
  const y = bandTop + t * (bandBottom - bandTop);
  const width = (style.viewBoxSize - style.sideBearing * 2) * 0.3;
  const left = (style.viewBoxSize - width) / 2;
  return clampStrokes([{ kind: "line", from: { x: left, y }, to: { x: left + width, y } }], style.viewBoxSize);
}

/**
 * One syllable = one glyph on ONE armature: the consonant picks the primary
 * attachment and the vowel a second one on the same skeleton. v1 built the
 * consonant and vowel as two independent chains in different regions and
 * joined them with a bridge line, which read as two adjacent letterforms
 * sharing an id rather than a single syllabic sign.
 */
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
  const consonant = consonantId ? phonology.consonants.find((c) => c.id === consonantId) : undefined;
  if (!consonant) return buildVowelStrokes(vowel, style, geometry, rng);

  return buildGlyphStrokes(
    {
      position: ORIENTATION_BY_PLACE[consonant.features.place],
      preference: ATTACHMENT_BY_MANNER[consonant.features.manner],
      featureKey: `manner:${consonant.features.manner}`,
      mark: null,
      attachmentBudget: SYLLABLE_ATTACHMENT_BUDGET,
      secondary: {
        position: VOWEL_HEIGHT_Y[vowel.features.height],
        preference: VOWEL_ATTACHMENT_PREFERENCE,
        featureKey: `backness:${vowel.features.backness}`,
      },
    },
    style,
    geometry,
    rng,
  );
}

/** Logographic glyphs have no phonological features to key off, so their anchor stops and attachment shapes come straight from the item's own seeded rng — but they are still built on the script's shared armature, which is what keeps a logography reading as one writing system. */
function buildConceptStrokes(style: ScriptStyle, geometry: GeometryProfile, rng: Rng): Stroke[] {
  return buildGlyphStrokes(
    {
      position: rng.float(),
      preference: rng.shuffle(CONCEPT_ATTACHMENT_PREFERENCE),
      featureKey: "concept",
      mark: null,
      attachmentBudget: CONCEPT_ATTACHMENT_BUDGET,
    },
    style,
    geometry,
    rng,
  );
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
  // ancestorScript is part of the key because it now picks the armature —
  // the single most visible thing about a script. Leaving it out would show
  // an identical preview for "free generation" and "Devanagari-derived."
  const previewSeedBase = deriveSeed(seedBase, hashString(`${params.scriptCategory}:${params.aesthetic}:${params.ancestorScript ?? "free"}`) ^ PREVIEW_SALT);
  const style = buildScriptStyle(params.aesthetic, previewSeedBase, params.ancestorScript);
  const geometry = buildGeometryProfile(previewSeedBase);
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
  const geometry = buildGeometryProfile(seedBase);
  return {
    id,
    kind: "syllable",
    strokes: buildSyllableStrokes(consonantId, vowelId, phonology, style, geometry, rng),
    seed,
    locked: false,
  };
}

/**
 * The stored glyph for `id`, or one built on demand when the script is
 * syllabic and the syllable simply wasn't attested at generation time (an
 * affix attachment routinely creates a CV mora the lexicon never had) —
 * "not yet materialized," not "unmapped," per buildGlyphForSyllable's own
 * contract. Every surface that renders a composed word needs exactly this
 * lookup, so it lives here rather than being reimplemented per panel.
 */
export function resolveGlyphById(id: string, data: OrthographyStageData, phonology: PhonologyData): Glyph | null {
  const stored = data.glyphs.find((g) => g.id === id);
  if (stored) return stored;
  if (data.mapping.kind !== "syllabic") return null;
  const [consonantPart, vowelId] = id.split("+");
  if (!vowelId) return null;
  return buildGlyphForSyllable(consonantPart === "_" ? null : consonantPart, vowelId, phonology, data.scriptStyle, data.seed.base);
}

// --- Glyph-set resolution (per script category, with locked-carryover/nudge-keep) ---

interface GlyphPlan {
  id: string;
  kind: GlyphKind;
  build: (rng: Rng) => Stroke[];
}

interface PlanResult {
  plan: GlyphPlan[];
  /** "always"-environment digraph rules from overflowStrategy="digraph" — phonemes here have no dedicated glyph in `plan`, only a rule. */
  rules: GraphemeRule[];
}

// --- Overflow strategy (OrthographyParams.overflowStrategy) ---

/** Base per-category glyph budget "extendedInventory" ignores — evokes a Latin-sized alphabet (~20 consonant letters, ~10 vowel letters) as the point past which a script needs an overflow strategy at all. */
const CONSONANT_GLYPH_BUDGET = 20;
const VOWEL_GLYPH_BUDGET = 10;
const DIGRAPH_SALT = 0x0d19ab;

const PHONEME_TIER_RANK: Record<PhonemeTier, number> = { core: 0, common: 1, marked: 2 };

/** Splits by budget with core/common tier phonemes preferred in-budget and marked (rarer) ones overflowing first — matches the intuition that a script's base letters cover the common inventory and exotic additions are what run out of room. Stable within a tier (catalog order preserved). */
function splitByBudget<T extends { tier: PhonemeTier }>(items: T[], budget: number): { inBudget: T[]; overflow: T[] } {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => PHONEME_TIER_RANK[a.item.tier] - PHONEME_TIER_RANK[b.item.tier] || a.index - b.index)
    .map(({ item }) => item);
  return { inBudget: sorted.slice(0, budget), overflow: sorted.slice(budget) };
}

/** "digraph" overflow rule: an overflow phoneme borrows a deterministic pair of DISTINCT in-budget glyph ids as its spelling, everywhere ("always") — like English "th"/"sh" reusing existing letters rather than inventing a new one. */
function buildDigraphRules(overflow: Array<{ id: string }>, inBudgetIds: string[], seedBase: number): GraphemeRule[] {
  if (inBudgetIds.length < 2) return [];
  return overflow.map(({ id }) => {
    const rng = new Rng(deriveSeed(seedBase, hashString(`digraph:${id}`) ^ DIGRAPH_SALT));
    const first = rng.pick(inBudgetIds);
    let second = rng.pick(inBudgetIds);
    for (let guard = 0; second === first && guard < 10; guard++) second = rng.pick(inBudgetIds);
    return { phonemeId: id, environment: "always" as const, glyphIds: [first, second] };
  });
}

/**
 * Applies overflowStrategy to one phoneme set (consonants, or vowels for
 * alphabetic): "extendedInventory" (v1's default, and any set that fits the
 * budget regardless of strategy) gives every phoneme a dedicated glyph plan
 * entry, uncapped. "digraph" caps at `budget` and gives overflow phonemes a
 * rule instead of a glyph. "diacriticStacking" also caps at `budget` but
 * still builds a glyph for every phoneme — `buildPlan`'s `markOverflow` flag
 * tells overflow entries to render with one extra guaranteed mark.
 */
function planWithOverflow<T extends { id: string; tier: PhonemeTier }>(
  items: T[],
  budget: number,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
  buildPlan: (item: T, markOverflow: boolean) => GlyphPlan,
): PlanResult {
  if (overflowStrategy === "extendedInventory" || items.length <= budget) {
    return { plan: items.map((item) => buildPlan(item, false)), rules: [] };
  }
  const { inBudget, overflow } = splitByBudget(items, budget);
  if (overflowStrategy === "digraph") {
    return {
      plan: inBudget.map((item) => buildPlan(item, false)),
      rules: buildDigraphRules(
        overflow,
        inBudget.map((i) => i.id),
        seedBase,
      ),
    };
  }
  return {
    plan: [...inBudget.map((item) => buildPlan(item, false)), ...overflow.map((item) => buildPlan(item, true))],
    rules: [],
  };
}

// --- Orthographic depth (OrthographyParams.orthographicDepth) ---

const DEPTH_SALT = 0x0d3974;
const DEPTH_ENVIRONMENTS: Exclude<GraphemeRuleEnvironment, "always">[] = ["wordInitial", "wordMedial", "wordFinal"];

/**
 * depth 0 = pure 1:1 mapping (today's v1 behavior, unchanged). Higher depth
 * gives a random subset of otherwise-regular phonemes (proportional to
 * depth, up to ~30% at depth 1) a positional irregularity: in one
 * environment, that phoneme borrows a DIFFERENT phoneme's existing glyph
 * instead of its own — a "homograph" pattern (English's inconsistent
 * digraphs/silent letters, Spanish's near-total absence of this). Only
 * phonemes that already have a dedicated glyph are eligible — overflow
 * phonemes get their irregularity from overflowStrategy instead, never
 * both (the two mechanisms are kept disjoint by construction).
 */
function buildDepthRules(candidateIds: string[], depth: number, seedBase: number): GraphemeRule[] {
  if (depth <= 0 || candidateIds.length < 2) return [];
  const rng = new Rng(deriveSeed(seedBase, DEPTH_SALT));
  const count = Math.round(depth * 0.3 * candidateIds.length);
  const chosen = rng.shuffle(candidateIds).slice(0, count);
  return chosen.map((phonemeId) => {
    const environment = rng.pick(DEPTH_ENVIRONMENTS);
    const others = candidateIds.filter((id) => id !== phonemeId);
    return { phonemeId, environment, glyphIds: [rng.pick(others)] };
  });
}

/** Depth rules only ever borrow within the same plan-entry kind (a consonant borrows another consonant's glyph, a vowel another vowel's) — separate seeded draws per kind keep that partition without depth rules and overflow rules colliding on the same phoneme. */
function buildDepthRulesForPlan(plan: GlyphPlan[], depth: number, seedBase: number): GraphemeRule[] {
  const consonantIds = plan.filter((p) => p.kind === "consonant").map((p) => p.id);
  const vowelIds = plan.filter((p) => p.kind === "vowel").map((p) => p.id);
  return [
    ...buildDepthRules(consonantIds, depth, deriveSeed(seedBase, hashString("depth:consonant"))),
    ...buildDepthRules(vowelIds, depth, deriveSeed(seedBase, hashString("depth:vowel"))),
  ];
}

function alphabeticPlan(
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
): PlanResult {
  const consonants = planWithOverflow(phonology.consonants, CONSONANT_GLYPH_BUDGET, overflowStrategy, seedBase, (c, markOverflow) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng, markOverflow),
  }));
  const vowels = planWithOverflow(phonology.vowels, VOWEL_GLYPH_BUDGET, overflowStrategy, seedBase, (v, markOverflow) => ({
    id: v.id,
    kind: "vowel" as const,
    build: (rng: Rng) => buildVowelStrokes(v, style, geometry, rng, markOverflow),
  }));
  return { plan: [...consonants.plan, ...vowels.plan], rules: [...consonants.rules, ...vowels.rules] };
}

function abjadPlan(
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
): PlanResult {
  return planWithOverflow(phonology.consonants, CONSONANT_GLYPH_BUDGET, overflowStrategy, seedBase, (c, markOverflow) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng, markOverflow),
  }));
}

/** Vowel diacritics never overflow — they're cheap marks modifying a base consonant, not competing "letters," so unlike the consonant side there's no budget cap here regardless of overflowStrategy. */
function abugidaPlan(
  phonology: PhonologyData,
  style: ScriptStyle,
  geometry: GeometryProfile,
  overflowStrategy: OverflowStrategy,
  seedBase: number,
): PlanResult {
  const consonants = planWithOverflow(phonology.consonants, CONSONANT_GLYPH_BUDGET, overflowStrategy, seedBase, (c, markOverflow) => ({
    id: c.id,
    kind: "consonant" as const,
    build: (rng: Rng) => buildConsonantStrokes(c, style, geometry, rng, markOverflow),
  }));
  const vowelPlan: GlyphPlan[] = phonology.vowels.map((v) => ({
    id: `diacritic:${v.id}`,
    kind: "vowelDiacritic" as const,
    build: (rng: Rng) => buildVowelDiacriticStrokes(v, style, geometry, rng),
  }));
  return { plan: [...consonants.plan, ...vowelPlan], rules: consonants.rules };
}

function syllabicPlan(
  phonology: PhonologyData,
  lexiconItems: LexiconItemData[],
  style: ScriptStyle,
  geometry: GeometryProfile,
): PlanResult {
  const plan = extractAttestedSyllables(lexiconItems, phonology).map(({ consonantId, vowelId }) => ({
    id: syllableGlyphId(consonantId, vowelId),
    kind: "syllable" as const,
    build: (rng: Rng) => buildSyllableStrokes(consonantId, vowelId, phonology, style, geometry, rng),
  }));
  return { plan, rules: [] };
}

function logographicPlan(lexiconItems: LexiconItemData[], style: ScriptStyle, geometry: GeometryProfile): PlanResult {
  const plan = lexiconItems.map((item) => ({
    id: item.id,
    kind: "concept" as const,
    build: (rng: Rng) => buildConceptStrokes(style, geometry, rng),
  }));
  return { plan, rules: [] };
}

/**
 * How many times a glyph will be redrawn to get away from a shape another
 * glyph in the same script already took. The armature/attachment space is
 * finite by design — a script that used every shape would not read as a
 * script — so a large glyph set on a narrow vocabulary can genuinely run out
 * of distinct forms, and this has to give up rather than loop forever. It
 * degrades to "duplicate present," never to "hung."
 *
 * Measured: raising this to 32 moved the mean duplicate rate by 0.09pp and
 * the worst case not at all, so whatever still collides at 12 is exhausted
 * space rather than unlucky draws. Spending more attempts on it just burns
 * cycles; the lever that actually works is the attachment budget (see
 * SYLLABLE_ATTACHMENT_BUDGET / CONCEPT_ATTACHMENT_BUDGET in content.ts).
 */
const MAX_DEDUP_ATTEMPTS = 12;

/**
 * A glyph's visual identity, order- and direction-independent: two glyphs
 * with the same strokes drawn in a different sequence, or the same line
 * drawn end-to-start, are the same letter to a reader. Coordinates round to
 * 2dp so float noise from the shear can't pass two identical glyphs off as
 * distinct.
 *
 * Deliberately computed here rather than by comparing render.ts's path
 * output: rendering is a separate, always-re-derivable step (see that file's
 * header), and generation shouldn't take a dependency on it. Canonicalizing
 * the strokes is also strictly stricter — glyphToSvgPath's own subpath
 * merging can make two different stroke sets share a `d` string.
 */
function glyphSignature(strokes: Stroke[]): string {
  const n = (value: number) => Math.round(value * 100) / 100;
  const at = (point: Point) => `${n(point.x)},${n(point.y)}`;
  return strokes
    .map((stroke) => {
      switch (stroke.kind) {
        case "line":
          return `l:${[at(stroke.from), at(stroke.to)].sort().join(">")}`;
        case "curve":
          return `c:${[at(stroke.from), at(stroke.to)].sort().join(">")}:${at(stroke.control)}`;
        case "dot":
          return `d:${at(stroke.center)}:${n(stroke.radius)}`;
        case "hook":
          return `h:${at(stroke.anchor)}:${n(stroke.angle)}:${n(stroke.length)}:${n(stroke.curvature)}`;
      }
    })
    .sort()
    .join("|");
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
  // An alphabet whose letters aren't telling each other apart isn't an
  // alphabet. Feature-driven placement alone can't guarantee this: place of
  // articulation maps 11 values onto 5-7 anchor stops and manner maps 12
  // onto a 3-4 shape vocabulary, so collisions are expected by construction
  // rather than exceptional. Every emitted glyph claims its shape here and
  // later ones redraw around it.
  const claimed = new Set<string>();
  for (const planned of plan) {
    const prev = previousById.get(planned.id);
    // Locked and nudge-kept glyphs are carried through untouched — they
    // still claim their shape so later glyphs steer around them, but they
    // are never themselves redrawn to resolve a collision.
    if (prev?.locked || (mode === "nudge" && prev && rng.chance(keepProbability))) {
      glyphs.push(prev);
      claimed.add(glyphSignature(prev.strokes));
      continue;
    }

    let itemSeed: Seed =
      mode === "nudge" && prev
        ? { base: prev.seed.base, variation: prev.seed.variation + 1 }
        : { base: deriveSeed(seed.base, hashString(planned.id)), variation: 0 };
    let strokes = planned.build(new Rng(deriveSeed(itemSeed.base, itemSeed.variation)));

    // `variation` advances rather than a private dedup counter so the stored
    // seed still reproduces the stored strokes on its own — the whole point
    // of persisting a seed per glyph. Nudge just continues from wherever
    // dedup left off, which is exactly what it already does.
    for (let attempt = 0; attempt < MAX_DEDUP_ATTEMPTS && claimed.has(glyphSignature(strokes)); attempt++) {
      itemSeed = { base: itemSeed.base, variation: itemSeed.variation + 1 };
      strokes = planned.build(new Rng(deriveSeed(itemSeed.base, itemSeed.variation)));
    }

    glyphs.push({ id: planned.id, kind: planned.kind, strokes, seed: itemSeed, locked: false });
    claimed.add(glyphSignature(strokes));
  }
  return glyphs;
}

function buildMapping(category: ScriptCategory, glyphs: Glyph[], rules: GraphemeRule[]): SoundToSymbolMapping {
  switch (category) {
    case "alphabetic": {
      const phonemeToGlyph: Record<string, string> = {};
      for (const g of glyphs) phonemeToGlyph[g.id] = g.id;
      return { kind: "alphabetic", phonemeToGlyph, rules };
    }
    case "abjad": {
      const consonantToGlyph: Record<string, string> = {};
      for (const g of glyphs) consonantToGlyph[g.id] = g.id;
      return { kind: "abjad", consonantToGlyph, rules };
    }
    case "abugida": {
      const baseConsonantToGlyph: Record<string, string> = {};
      const vowelToDiacritic: Record<string, string> = {};
      for (const g of glyphs) {
        if (g.kind === "vowelDiacritic") vowelToDiacritic[g.id.replace(/^diacritic:/, "")] = g.id;
        else baseConsonantToGlyph[g.id] = g.id;
      }
      return { kind: "abugida", baseConsonantToGlyph, vowelToDiacritic, rules };
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
  // The version guard is the one exception: a pre-v2 style carries no
  // armature at all, and every builder below reads one, so carrying it
  // forward would mean building v2 glyphs against a v1 grid. A nudge on a
  // pre-v2 language rebuilds the style instead — the glyphs are getting
  // regenerated by this patch either way (see queries.ts's staleness check).
  const canReuseStyle = mode === "nudge" && previous?.scriptStyle?.version === 2;
  const scriptStyle = canReuseStyle ? previous.scriptStyle : buildScriptStyle(params.aesthetic, seed.base, params.ancestorScript);
  // Geometry is a pure function of seed.base, and nudge keeps seed.base fixed
  // (only variation advances) — so this stays stable across nudges for the
  // same reason scriptStyle does, without needing its own branch.
  const geometry = buildGeometryProfile(seed.base);

  const previousGlyphsById = new Map((previous?.glyphs ?? []).map((g) => [g.id, g] as const));

  const planResult: PlanResult =
    params.scriptCategory === "alphabetic"
      ? alphabeticPlan(phonology, scriptStyle, geometry, params.overflowStrategy, seed.base)
      : params.scriptCategory === "abjad"
        ? abjadPlan(phonology, scriptStyle, geometry, params.overflowStrategy, seed.base)
        : params.scriptCategory === "abugida"
          ? abugidaPlan(phonology, scriptStyle, geometry, params.overflowStrategy, seed.base)
          : params.scriptCategory === "syllabic"
            ? syllabicPlan(phonology, lexiconItems, scriptStyle, geometry)
            : logographicPlan(lexiconItems, scriptStyle, geometry);

  const glyphs = resolveGlyphs(planResult.plan, seed, previousGlyphsById, mode, rng, keepProbability);
  const depthRules = buildDepthRulesForPlan(planResult.plan, params.orthographicDepth, seed.base);
  const mapping = buildMapping(params.scriptCategory, glyphs, [...planResult.rules, ...depthRules]);

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
  /** Additional glyphs rendered right after `glyphId`, same phoneme span — a GraphemeRule's digraph/homograph substitution, not a separate morpheme. */
  extraGlyphIds?: string[];
}

function wordEnvironment(index: number, length: number): Exclude<GraphemeRuleEnvironment, "always"> {
  if (index === 0) return "wordInitial";
  if (index === length - 1) return "wordFinal";
  return "wordMedial";
}

/** Depth/overflow irregularity lookup — an "always" rule (digraph overflow) matches regardless of position; a positional rule (depth irregularity) only matches its own environment. Rule generation keeps these disjoint per phoneme (see buildDepthRules/buildDigraphRules), so at most one rule ever matches. */
function findGraphemeRule(rules: GraphemeRule[] | undefined, phonemeId: string, index: number, length: number): GraphemeRule | undefined {
  if (!rules || rules.length === 0) return undefined;
  const env = wordEnvironment(index, length);
  return rules.find((r) => r.phonemeId === phonemeId && (r.environment === "always" || r.environment === env));
}

/** Resolves a phoneme to the glyph id sequence it actually renders as — its plain mapped glyph, or a rule's borrowed/digraph sequence when one applies. */
function resolvePhonemeGlyphIds(
  defaultGlyphId: string,
  phonemeId: string,
  index: number,
  length: number,
  rules: GraphemeRule[] | undefined,
): string[] {
  const rule = findGraphemeRule(rules, phonemeId, index, length);
  return rule ? rule.glyphIds : [defaultGlyphId];
}

function groupIntoGraphemes(resolved: Array<ConsonantPhoneme | VowelPhoneme>, mapping: SoundToSymbolMapping): GraphemeGroup[] {
  const groups: GraphemeGroup[] = [];
  // Logographic scripts render a whole word as one concept glyph — there's
  // no per-phoneme grapheme story to walk, so boundary composition simply
  // doesn't apply (see boundary-preview-panel's scope note).
  if (mapping.kind === "logographic") return groups;

  if (mapping.kind === "alphabetic") {
    resolved.forEach((p, i) => {
      const [glyphId, ...extraGlyphIds] = resolvePhonemeGlyphIds(mapping.phonemeToGlyph[p.id] ?? p.id, p.id, i, resolved.length, mapping.rules);
      groups.push({ start: i, end: i + 1, glyphId, extraGlyphIds });
    });
    return groups;
  }

  if (mapping.kind === "abjad") {
    resolved.forEach((p, i) => {
      if (isVowel(p)) return;
      const [glyphId, ...extraGlyphIds] = resolvePhonemeGlyphIds(
        mapping.consonantToGlyph[p.id] ?? p.id,
        p.id,
        i,
        resolved.length,
        mapping.rules,
      );
      groups.push({ start: i, end: i + 1, glyphId, extraGlyphIds });
    });
    return groups;
  }

  if (mapping.kind === "abugida") {
    let i = 0;
    while (i < resolved.length) {
      const p = resolved[i];
      if (!isVowel(p)) {
        const [glyphId, ...extraGlyphIds] = resolvePhonemeGlyphIds(
          mapping.baseConsonantToGlyph[p.id] ?? p.id,
          p.id,
          i,
          resolved.length,
          mapping.rules,
        );
        const next = resolved[i + 1];
        if (next && isVowel(next)) {
          groups.push({
            start: i,
            end: i + 2,
            glyphId,
            extraGlyphIds,
            diacriticGlyphId: mapping.vowelToDiacritic[next.id],
          });
          i += 2;
          continue;
        }
        groups.push({ start: i, end: i + 1, glyphId, extraGlyphIds });
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
  /** A GraphemeRule's digraph/homograph substitution — additional glyphs rendered right after glyphId, same phoneme, no junction between them. */
  extraGlyphIds?: string[];
  junctionBefore: BoundaryTreatment | null;
  /**
   * This step's vowel-nucleus tone level, 0..rootToneValues length-implied
   * levels-1 — set only for a vowel-bearing step whose vowel falls within
   * the root's own WordSegment (composeWordGlyphSequence's `rootToneValues`
   * param). Affix-introduced vowels never carry a tone value (see
   * LexiconItemData.toneValues — affix-level tone is out of scope for now).
   * Render with buildToneMarkStrokes, same "compose live, don't build a
   * stored glyph for it" treatment as everything else in this file that
   * depends on more than the phoneme catalog alone.
   */
  toneLevel?: number;
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
 * originating affix. `rootToneValues` is the source root's own
 * LexiconItemData.toneValues (undefined when tone isn't enabled, or the
 * root predates the field) — mapped onto the root's WordSegment span only,
 * since affix-introduced vowels have no tone value of their own yet.
 */
export function composeWordGlyphSequence(
  assembled: AssembledWord,
  affixesUsed: MorphologyAffixData[],
  phonology: PhonologyData,
  mapping: SoundToSymbolMapping,
  aesthetic: Aesthetic,
  rootToneValues?: number[],
): ComposedWord {
  const resolved = resolvePhonemes(assembled.phonemeIds, phonology);
  if (!resolved) return { steps: [], nonSegmentalTreatment: null };

  const groups = groupIntoGraphemes(resolved, mapping);
  const affixesById = new Map(affixesUsed.map((a) => [a.id, a] as const));
  const rootSegment = assembled.segments.find((s) => s.source === "root");
  let rootVowelCount = 0;

  const steps: GlyphSequenceStep[] = groups.map((group, i) => {
    let junctionBefore: BoundaryTreatment | null = null;
    if (i > 0) {
      const segmentAtStart = assembled.segments.find((s) => s.start === group.start && s.source !== "root");
      const affix = segmentAtStart ? affixesById.get(segmentAtStart.source) : undefined;
      junctionBefore = affix ? resolveBoundaryTreatment(affix.strategy, aesthetic) : "adjacency";
    }
    // A group's own vowel (if it has one) always resolves to the last
    // phoneme in its span — true across every mapping kind: alphabetic's
    // single-phoneme groups, abugida/syllabic's CV pairs, and bare-V groups
    // alike. A consonant-only group (an abugida/syllabic coda with no
    // following vowel) has no tone-bearing position, so isVowel guards it.
    let toneLevel: number | undefined;
    if (rootToneValues && rootSegment) {
      const vowelIndex = group.end - 1;
      const vowel = resolved[vowelIndex];
      if (vowel && isVowel(vowel) && vowelIndex >= rootSegment.start && vowelIndex < rootSegment.end) {
        toneLevel = rootToneValues[rootVowelCount];
        rootVowelCount++;
      }
    }
    return { glyphId: group.glyphId, diacriticGlyphId: group.diacriticGlyphId, extraGlyphIds: group.extraGlyphIds, junctionBefore, toneLevel };
  });

  const nonSegmental = affixesUsed.find((a) => a.strategy === "ablaut" || a.strategy === "templatic");
  const nonSegmentalTreatment = nonSegmental ? resolveBoundaryTreatment(nonSegmental.strategy, aesthetic) : null;

  return { steps, nonSegmentalTreatment };
}
