// Phoneme → articulatory gesture data and schedule-building for the Pink
// Trombone engine (pink-trombone-engine.ts). This is the "content" layer —
// analogous to the old audio.ts's BURST_HZ/FRICATIVE_HZ tables, but driving
// a real vocal-tract shape instead of a noise-filter frequency.
//
// Tract shape is a 44-point diameter array from throat (0) to lips (43);
// landmarks per the engine's own init: bladeStart≈10, tipStart≈32,
// lipStart≈39. Vowel shaping (tongue-curve model) and consonant place
// positions (PLACE_INDEX) and stop timing (VOT_BY_PLACE) are now fit
// against real data — see each one's own comment for sources. Constriction
// widths, closure/frication durations, and other manner-level timing not
// called out in a specific table's comment are still first-pass
// approximations, tunable by ear like everything else in this engine.
//
// One real, verified gap in @seansleblanc/pink-trombone: its Tract.runStep
// accepts a `turbulenceNoise` parameter but never uses it anywhere in the
// function body, so narrowing the tract alone produces no frication hiss.
// Fricatives/affricates/clicks therefore get a `noiseEvent` here, layered in
// separately by audio.ts using the same noise-burst synthesis already tuned
// for the previous engine, mixed alongside the tract's own resonance.

import type { ConsonantManner, ConsonantPhoneme, ConsonantPlace, VowelPhoneme } from "../../../convex/phonology/types";
import { fadeGlottisIn, fadeGlottisOut, GLOTTIS_MUTE_DELAY } from "./pink-trombone-engine";
import type { GestureStep, PinkTromboneModule } from "./pink-trombone-engine";

function isVowelUnit(unit: ConsonantPhoneme | VowelPhoneme): unit is VowelPhoneme {
  return "height" in unit.features;
}

const N = 44;

function restShape(): number[] {
  const d = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    if (i < 6.5) d[i] = 0.6;
    else if (i < 12) d[i] = 1.1;
    else d[i] = 1.5;
  }
  return d;
}

/** The engine's own neutral tract shape — used as "no consonant/vowel here" context. */
export const REST_SHAPE = restShape();

/** Apply a smooth (raised-cosine) constriction to a copy of `base` around `center`. */
function constrict(base: number[], center: number, width: number, minDiameter: number): number[] {
  const d = base.slice();
  for (let i = 0; i < d.length; i++) {
    const dist = Math.abs(i - center);
    if (dist > width) continue;
    const t = dist / width;
    const factor = 0.5 * (1 + Math.cos(Math.PI * t));
    d[i] = d[i] * (1 - factor) + minDiameter * factor;
  }
  return d;
}

/**
 * Vowel shaping uses Pink Trombone's own tongue-curve model (Neil Thapen's
 * original, not something we invented) instead of constrict()'s single
 * local dip: a raised-cosine hump driven by two parameters — tongueIndex
 * (where along the tract it peaks) and tongueDiameter (how far it stays
 * from the palate) — that shapes the WHOLE oral cavity from bladeStart to
 * lipStart at once. @seansleblanc/pink-trombone (this project's actual
 * engine) strips this out as UI-only code (its README: "the original UI
 * modifies the tract shape with radial deformers to simulate a tongue"), so
 * it's reimplemented here to drive Tract.targetDiameter directly. Formula
 * and the bladeStart/tipStart/lipStart indices below are verified line-for-
 * line against github.com/zakaton/Pink-Trombone's
 * Tract._updateDiameterRest (reference material Coru logged to Tangle,
 * project:conlanglab / topic:pink-trombone) — that fork uses the same
 * bladeStart=10/tipStart=32/lipStart=39 as our own package's Tract.init
 * defaults, so the formula transfers directly onto our diameter array.
 *
 * This replaced the previous constrict()-based vowel table (single
 * cosine dip, one parameter set per vowel grid-searched against real
 * formant data) after Nae reported /i/ specifically sounding wrong despite
 * that table's own probe measuring it as a good fit. Re-verifying with a
 * corrected probe (see below) showed the old /i/ shape actually measured
 * ~1720/1870/2020Hz — nowhere near /i/ — meaning the previous session's
 * probe had its own bug and those "good fit" numbers were never real. The
 * tongue-curve model isn't just a different parameterization of the same
 * shape family; it also resolves the previously-documented open/close
 * ceilings (/a/,/ɑ/ capped ~600-645Hz, /i/,/y/ floored ~345-370Hz) — those
 * turned out to be an artifact of constrict()'s narrow local dip, not a
 * physical limit of this tube: the wider tongue-curve hump reaches /a/'s
 * F1 up to ~684-727Hz and /i/'s down to ~280-291Hz, both much closer to
 * real targets (806/781 and 294/283 respectively) with the same REST_SHAPE.
 */
const TONGUE_BLADE_START = 10;
const TONGUE_TIP_START = 32;
const TONGUE_LIP_START = 39;

/** Valid range for VowelArticulation.tongueIndex — bladeStart+2 to tipStart-3, per the original model's own UI bounds. */
export const TONGUE_INDEX_RANGE: readonly [number, number] = [12, 29];
/** Valid range for VowelArticulation.tongueDiameter — lower = more constricted/higher vowel. */
export const TONGUE_DIAMETER_RANGE: readonly [number, number] = [2.05, 3.5];

function tongueShape(base: number[], tongueIndex: number, tongueDiameter: number): number[] {
  const d = base.slice();
  for (let index = TONGUE_BLADE_START; index < TONGUE_LIP_START; index++) {
    const interpolation = (tongueIndex - index) / (TONGUE_TIP_START - TONGUE_BLADE_START);
    const angle = 1.1 * Math.PI * interpolation;
    const diameter = 2 + (tongueDiameter - 2) / 1.5;
    let curve = (1.5 - diameter + 1.7) * Math.cos(angle);
    if (index === TONGUE_BLADE_START - 2 || index === TONGUE_LIP_START - 1) curve *= 0.8;
    if (index === TONGUE_BLADE_START || index === TONGUE_LIP_START - 2) curve *= 0.94;
    d[index] = 1.5 - curve;
  }
  return d;
}

/** Narrows the lip region (tipStart..end) for rounded vowels — a direct clamp, not a taper, matching how the fits below were actually measured. */
function applyLipRounding(base: number[], lipDiameter: number): number[] {
  const d = base.slice();
  for (let i = TONGUE_LIP_START; i < d.length; i++) d[i] = Math.min(d[i], lipDiameter);
  return d;
}

interface VowelArticulation {
  tongueIndex: number;
  tongueDiameter: number;
  rounded?: "front" | "back";
  /** Lip constriction diameter for rounded vowels — see applyLipRounding. Only meaningful when rounded is set. */
  lipDiameter?: number;
}

/**
 * Every vowel below is grid-searched (tongueIndex/tongueDiameter/
 * lipDiameter, search script not committed — this table is the output)
 * against the same real measured F1/F2/F3 data as before (Wavesurfer LPC
 * analysis, see `vowels info/` in the repo root — not committed, just
 * working reference), now fit against the tongue-curve model instead of
 * constrict(). F1/F2 are weighted as the primary fit target, F3 as a
 * lighter tiebreaker — every vowel below overshoots F3 by 300-600Hz, a
 * consistent pattern across the whole table (likely this simplified
 * single-tube model's own limit, not a per-vowel fit failure), so F3 error
 * isn't called out per-vowel below the way F1/F2 are.
 */
const VOWEL_ARTICULATION: Record<string, VowelArticulation> = {
  // target F1/F2 = 294/2343; got 280/2385
  i: { tongueIndex: 27.5, tongueDiameter: 2.2 },
  // target 360/2187; was 323/2186 (diameter 2.29) — F1 undershot its own
  // target by 37Hz, which also shrank the i/ɪ height contrast (F1 is the
  // primary height cue) from the real 66Hz gap down to 43Hz, reading as
  // "almost indistinguishable." Raised diameter using the local diameter->F1
  // slope observed between ɪ and e (~200Hz/unit) to close most of that gap;
  // not re-measured against the live engine, so worth an ear-check.
  ɪ: { tongueIndex: 26.75, tongueDiameter: 2.48 },
  // target 434/2148; got 431/2132 — excellent fit
  e: { tongueIndex: 28.5, tongueDiameter: 2.83 },
  // target 581/1840; got 538/1836
  ɛ: { tongueIndex: 25.75, tongueDiameter: 3.13 },
  // target 806/1632; got 684/1572 — F1 at tongueIndex's lower bound (12), the closest this model reaches to a real low front vowel (see file comment above)
  a: { tongueIndex: 12, tongueDiameter: 3.28 },
  // target 781/1065; got 727/1066 — F2 near-exact, F1 close, same lower-bound ceiling as /a/
  ɑ: { tongueIndex: 12, tongueDiameter: 2.31 },
  // target 500/1500 (see below); the old fit (tongueIndex 24.95) chased
  // 486/1826 — a target derived by averaging ɘ/ɜ from the reference chart,
  // whose own author flagged those central-vowel measurements as unreliable.
  // That average's F2 landed within 14Hz of /ɛ/'s F2 (1840), so this schwa
  // read as an /ɛ/-adjacent front vowel instead of neutral central "uh".
  // Refit against the textbook neutral-vowel target instead (F1~500/F2~1500
  // — the resonances of a uniform, unconstricted vocal tract, i.e. what a
  // tract at rest actually sounds like): re-ran the same grid-search
  // approach (see file comment above) directly against 500/1500 — got
  // 506/1497, near-exact.
  ə: { tongueIndex: 22, tongueDiameter: 2.4 },
  // target 541/830; got 538/824 — near-exact
  ɔ: { tongueIndex: 12, tongueDiameter: 2.1, rounded: "back", lipDiameter: 0.95 },
  // target 406/727; got 409/738 — near-exact
  o: { tongueIndex: 12.6, tongueDiameter: 2.05, rounded: "back", lipDiameter: 0.69 },
  // target 295/750; got 291/759 — near-exact
  u: { tongueIndex: 12, tongueDiameter: 2.05, rounded: "back", lipDiameter: 0.53 },
  // target 334/910; got 328/915 — near-exact
  ʊ: { tongueIndex: 12, tongueDiameter: 2.21, rounded: "back", lipDiameter: 0.58 },
  // target 283/2170; got 296/2175 — near-exact
  y: { tongueIndex: 27.5, tongueDiameter: 2.25, rounded: "front", lipDiameter: 1.3 },
  // target 462/1659; got 490/1653 — close
  ø: { tongueIndex: 27.8, tongueDiameter: 3.4, rounded: "front", lipDiameter: 0.99 },
};

export function vowelShape(ipa: string): number[] {
  const art = VOWEL_ARTICULATION[ipa];
  if (!art) return REST_SHAPE.slice();
  const d = tongueShape(REST_SHAPE, art.tongueIndex, art.tongueDiameter);
  if (art.rounded && art.lipDiameter != null) return applyLipRounding(d, art.lipDiameter);
  return d;
}

/**
 * Where each place of articulation constricts the tract (throat=0 to
 * lips=43). Two real sources, not "first-pass approximation" guessing:
 *
 * 1. Ordering: the IPA chart's own column order (Bilabial, Labiodental,
 *    Dental, Alveolar, Postalveolar, Retroflex, Palatal, Velar, Uvular,
 *    Pharyngeal, Glottal — front to back) is authoritative and uncontroversial.
 *    The previous table had retroflex(30) and postalveolar(29) swapped —
 *    retroflex was placed in FRONT of postalveolar, when a curled-back
 *    retroflex constriction is genuinely further back. Every other adjacent
 *    pair was already in the right order.
 * 2. Absolute positions: Coru's zakaton/Pink-Trombone reference (Tangle
 *    note 01KY93EJ0Z7HJP8970SK09PV65, same source used for the vowel tongue-
 *    curve fix) gives real calibrated index values for four places on this
 *    SAME N=44 tract — bilabial 41, alveolar 36, postalveolar 31, velar 20 —
 *    adopted directly below. The rest (pharyngeal, uvular, palatal,
 *    retroflex, dental, labiodental) aren't in that reference; they're
 *    interpolated between the real anchors, preserving the previous table's
 *    relative spacing shifted onto the new anchor points, not re-guessed
 *    from scratch.
 */
const PLACE_INDEX: Record<ConsonantPlace, number> = {
  pharyngeal: 10,
  uvular: 15,
  velar: 20, // zakaton anchor (g/k/ŋ)
  palatal: 24,
  retroflex: 28,
  postalveolar: 31, // zakaton anchor (ʒ/ʃ)
  alveolar: 36, // zakaton anchor (d/t, z/s, n)
  dental: 38,
  labiodental: 40,
  bilabial: 41, // zakaton anchor (b/p, v/f, m) — labiodental kept 1 index behind rather than merged, since our model distinguishes them
  // No oral constriction — manner carried entirely by the glottis (see
  // scheduleFricative's isGlottal branch, the only place this is ever read
  // for). Value is never used for shaping; kept distinct from every real
  // place purely so this table has no accidental duplicate index.
  glottal: 4,
};

/**
 * Places whose constriction IS the tongue body — these are the ones real
 * coarticulation drags toward an adjacent vowel's tongue position.
 * Bilabial/labiodental use the lips as the primary articulator and glottal
 * has no oral constriction at all (see PLACE_INDEX's own comment), so
 * nudging their index by a vowel's tongue position wouldn't model anything
 * real; only lingual places get this treatment.
 */
const TONGUE_DRIVEN_PLACES: ReadonlySet<ConsonantPlace> = new Set([
  "pharyngeal", "uvular", "velar", "palatal", "retroflex", "postalveolar", "alveolar", "dental",
]);

/** Schwa's own fitted tongueIndex (see VOWEL_ARTICULATION) — the coarticulation zero-point. Front vowels sit above it, back vowels below, so `tongueIndex - NEUTRAL_TONGUE_INDEX` is already a signed front/back distance on the same 0(throat)-43(lips) axis PLACE_INDEX uses. */
const NEUTRAL_TONGUE_INDEX = VOWEL_ARTICULATION.ə.tongueIndex;
/** Fraction of a vowel's own front/back distance from neutral that a tongue-driven consonant's constriction center inherits. Birkholz-style coarticulation is partial assimilation, not full — this keeps the shift real but bounded (max observed shift across the vowel table is a few index positions, comparable to the gap between adjacent real place anchors). */
const COARTICULATION_STRENGTH = 0.2;

/**
 * Approximates Birkholz-style coarticulation: a tongue-driven consonant's
 * constriction center isn't one fixed spot regardless of context — it
 * drifts toward whatever vowel follows it, proportional to how far that
 * vowel's own tongue position sits from neutral (schwa). /d/ before /i/
 * (front, high tongueIndex) constricts further forward than /d/ before /u/
 * (back, low tongueIndex); before a near-neutral vowel it barely moves.
 * Forward-looking only (the following vowel, via `next` — already threaded
 * through scheduleUnits' main loop) — a consonant with no following vowel
 * (a coda, or followed by another consonant) keeps its plain PLACE_INDEX
 * position, same as before this existed.
 */
function coarticulatedIndex(place: ConsonantPlace, next: ConsonantPhoneme | VowelPhoneme | undefined): number {
  const base = PLACE_INDEX[place];
  if (!next || !isVowelUnit(next) || !TONGUE_DRIVEN_PLACES.has(place)) return base;
  const art = VOWEL_ARTICULATION[next.ipa];
  if (!art) return base;
  return base + COARTICULATION_STRENGTH * (art.tongueIndex - NEUTRAL_TONGUE_INDEX);
}

/**
 * Voiceless-stop aspiration duration (the breathy puff scheduleStop's
 * release fires before modal voicing resumes — see its comment) — real
 * Voice Onset Time, not a flat guess. Lisker & Abramson (1964), the classic
 * cross-linguistic VOT study, measured English aspirated stops averaging
 * p≈58ms, t≈70ms, k≈80ms: VOT lengthens systematically as place moves
 * further back (more time needed for the larger cavity behind a posterior
 * constriction to reach the pressure differential that triggers voicing).
 * The previous code used a flat 0.05s for every place — no variation at
 * all, the single biggest gap versus real place cues found so far. Only
 * bilabial/alveolar/velar have real published anchors; the rest are
 * piecewise-linear interpolated/extrapolated along those three points using
 * PLACE_INDEX (itself now evidence-based — see its comment) as the
 * position axis, not independently re-guessed.
 */
const VOT_BY_PLACE: Record<ConsonantPlace, number> = {
  pharyngeal: 0.086,
  uvular: 0.083,
  velar: 0.08, // Lisker & Abramson anchor (k)
  palatal: 0.0775,
  retroflex: 0.075,
  postalveolar: 0.073,
  alveolar: 0.07, // Lisker & Abramson anchor (t)
  dental: 0.065,
  labiodental: 0.06,
  bilabial: 0.058, // Lisker & Abramson anchor (p)
  glottal: 0.05, // no real pulmonic VOT concept for glottal manner — kept at the old flat default
};

/** Approximants reuse vowel-adjacent shapes (j≈i, w≈u) rather than the place table — semivowels ARE vowel-like articulations. */
const APPROXIMANT_VOWEL_LIKE: Record<string, string> = { j: "i", w: "u" };

function approximantShape(phoneme: ConsonantPhoneme, base: number[]): number[] {
  const vowelLike = APPROXIMANT_VOWEL_LIKE[phoneme.ipa];
  if (vowelLike) {
    const art = VOWEL_ARTICULATION[vowelLike];
    // A semivowel is a more open version of its vowel counterpart — widen
    // toward (but not past) the model's own open-vowel bound.
    const openedDiameter = Math.min(TONGUE_DIAMETER_RANGE[1], art.tongueDiameter + 0.15);
    const shaped = tongueShape(base, art.tongueIndex, openedDiameter);
    return art.rounded && art.lipDiameter != null ? applyLipRounding(shaped, art.lipDiameter) : shaped;
  }
  return constrict(base, PLACE_INDEX[phoneme.features.place], 4, 0.9);
}

/**
 * What the tract should be moving TOWARD in anticipation of `unit` —
 * coarticulation, in other words: a consonant's release target should be
 * shaped by whatever comes next, not just "open toward a vowel or give up
 * and go to REST." Previously only a following vowel was considered; a
 * following consonant fell through to REST_SHAPE regardless of what it
 * actually was, so a cluster like "vlz" swung wide open between every pair
 * of consonants instead of moving directly from one constriction to the
 * next — the seam that read as "hacked together."
 */
function anticipatedShape(unit: ConsonantPhoneme | VowelPhoneme): number[] {
  if (isVowelUnit(unit)) return vowelShape(unit.ipa);
  const { manner, place } = unit.features;
  const index = PLACE_INDEX[place];
  switch (manner) {
    case "stop":
    case "ejective":
    case "implosive":
    case "click":
    case "nasal":
      return constrict(REST_SHAPE, index, 3, 0);
    case "fricative":
    case "lateralFricative":
      return constrict(REST_SHAPE, index, 3, 0.15);
    case "trill":
    case "tap":
      return constrict(REST_SHAPE, index, 2, 0.1);
    case "approximant":
    case "lateralApproximant":
      return approximantShape(unit, REST_SHAPE);
    case "affricate":
      return constrict(REST_SHAPE, index, 3, 0);
    default:
      return REST_SHAPE.slice();
  }
}

/**
 * The base a consonant's OWN closure (stop/ejective/implosive/nasal/
 * affricate/click) is built on top of — `closeInto` only when `next` is a
 * vowel, REST_SHAPE otherwise.
 *
 * Anticipatory coarticulation toward a following VOWEL during a closure is
 * real: the tongue is free to start moving toward the vowel while only the
 * closure point itself has to stay sealed, so building the hold on top of
 * the vowel's own shape is physically motivated. But when `next` is ANOTHER
 * CONSONANT, `anticipatedShape(next)` is already a narrow constriction at
 * ITS OWN place (see anticipatedShape) — using that as the closure's base
 * pre-narrows the tract at a second point for the entire hold, splitting
 * what should be one continuous resonant cavity into two. A back place
 * (velar/uvular/pharyngeal) gets its whole acoustic identity from a large,
 * undivided front cavity between the closure and the lips; pinching that
 * cavity at the next consonant's place makes it resonate like a much
 * smaller, fronter cavity instead — reported as "/g/ sounds like /b/"
 * specifically in coda clusters like /gɾ/ (bilabial's own front cavity is
 * already tiny, so the same pre-narrowing barely changes anything there,
 * which is why /bɾ/ sounded normal). The next consonant's place still gets
 * anticipated — at the RELEASE step, which already targets `closeInto`
 * directly — just not baked into the hold itself.
 */
function closureBase(closeInto: number[], next: ConsonantPhoneme | VowelPhoneme | undefined): number[] {
  return next && isVowelUnit(next) ? closeInto : REST_SHAPE;
}

// 115Hz sits dead-center of the adult-male F0 range (~85-180Hz); adult female
// averages ~200-220Hz. We can't shorten the modeled vocal tract without
// invalidating the hand-measured vowel formant table above, so pitch (+ a
// touch more vocal tension, i.e. less breathy/"soft-spoken") is the only
// lever available for shifting the perceived voice younger/more feminine.
// Was 175 — reported as sounding "mopey"/depressed, and 175 sat below the
// 200-220 average this comment already names as the target; splitting that
// range lands the register somewhere a listener reads as awake rather than
// low-and-flat.
const VOICED_PITCH = 205;
const NEUTRAL_TENSENESS = 0.6;

/**
 * A dead-flat F0 across the whole word was the single biggest "robot" cue —
 * bigger than any segmental (place/manner) detail. Real declarative speech
 * does two things pitch-wise: it drifts gently downward syllable-to-syllable
 * (declination) and drops further on the last syllable (the "statement fall"
 * that signals "utterance complete"). vowelIndex/totalVowels stands in for
 * time-through-the-word since vowels are the prosodically prominent nuclei
 * and are roughly evenly spaced — a real duration-weighted timeline isn't
 * worth the complexity here.
 */
function contourPitch(vowelIndex: number, totalVowels: number): number {
  if (totalVowels <= 1) return VOICED_PITCH * 1.01;
  const t = vowelIndex / (totalVowels - 1);
  return VOICED_PITCH * (1.02 - 0.04 * t);
}

export interface NoiseEvent {
  /** Seconds from the start of this schedule. */
  atOffset: number;
  dur: number;
  place: ConsonantPlace;
  voiced: boolean;
  kind: "fricative" | "click" | "stopBurst" | "ejectiveBurst" | "tapBurst";
}

interface Cursor {
  time: number;
  steps: GestureStep[];
  noiseEvents: NoiseEvent[];
  /**
   * Pitch most recently voiced, captured at schedule-build time (not read
   * live inside a gesture closure — by playback time every gesture for the
   * whole word has already been built, so a closure reading `cursor.lastPitch`
   * directly would see the LAST vowel's pitch, not "whatever was current when
   * this consonant was scheduled"). Lets voiced consonants between vowels
   * (nasals, approximants, implosive release) continue the same contour
   * instead of snapping back to a flat baseline every time.
   */
  lastPitch: number;
}

function at(cursor: Cursor, apply: (engine: PinkTromboneModule) => void): void {
  cursor.steps.push({ at: cursor.time, apply });
}

function setShape(engine: PinkTromboneModule, shape: number[]): void {
  engine.Tract.targetDiameter.set(shape);
}

/**
 * Hard-zeroing Glottis.intensity mid-waveform is a genuine sample-level
 * discontinuity (a click) — fadeGlottisOut masks it, but the zero itself
 * still has to happen (intensity's own natural decay is ~230ms, far slower
 * than most consonants, so without this a voiceless closure would still
 * sound voiced for its whole duration). Schedule the zero to land just after
 * the fade completes instead of in the same instant.
 */
function scheduleMuteZero(cursor: Cursor): void {
  cursor.steps.push({ at: cursor.time + GLOTTIS_MUTE_DELAY, apply: (e) => { e.Glottis.intensity = 0; } });
}

/**
 * targetDiameter is a target the tract *moves toward*, not an instant jump
 * — at the normal baseline speed, closing takes long enough that the tract
 * spends ~50-70ms audibly narrowing while still voiced, which sounds like a
 * brief approximant glide before the actual closure (e.g. a "l"-ish onset
 * before a /g/). Snapping the closing speed way up collapses that window.
 */
function closeFast(engine: PinkTromboneModule, shape: number[]): void {
  engine.Tract.movementSpeed = 60;
  setShape(engine, shape);
}

// Opening/releasing moves at roughly half the rate closing does in this
// model (a real articulatory asymmetry — see Tract.reshapeTract's
// amountUp/amountDown split), and back-of-tongue places (velar, uvular,
// pharyngeal) open slower still. Every "settle" window below accounts for
// that instead of using one uniform short tail — without it the tract gets
// redirected toward the next target before it ever reaches this one.
//
// `isStressed` applies the classic three correlates of lexical stress
// (duration, pitch, intensity — Fry 1955) as a prominence boost on top of
// the declination contour: duration is lengthened by the caller (see
// scheduleUnits), pitch and tenseness are boosted here. Every multi-syllable
// word previously had every vowel treated identically regardless of where
// stress actually fell — reported directly as "not enough flow" — because
// the stress index buildRoot already computes for the display IPA string
// was discarded before reaching audio playback (see LexiconItemData's
// stressedPhonemeIndex).
function scheduleVowel(cursor: Cursor, phoneme: VowelPhoneme, dur: number, pitch: number, isLastVowel: boolean, isStressed: boolean): void {
  const shape = vowelShape(phoneme.ipa);
  const stressBoost = isStressed ? 1.07 : 1;
  // Small per-play randomization on top of the contour — real speech never
  // repeats a word with bit-identical pitch/effort, and without this every
  // replay of the same root sounds like the exact same recording looping.
  const jitteredPitch = pitch * stressBoost * (1 + (Math.random() - 0.5) * 0.02);
  const jitteredTenseness = NEUTRAL_TENSENESS + (isStressed ? 0.05 : 0) + (Math.random() - 0.5) * 0.04;
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    fadeGlottisIn(e);
    e.Glottis.UIFrequency = jitteredPitch;
    e.Glottis.UITenseness = jitteredTenseness;
    setShape(e, shape);
  });
  if (isLastVowel) {
    // Statement-final fall: pitch tapers down through the back half of the
    // word's last voiced nucleus. Spread over several small steps rather
    // than one jump — the engine's pitch smoothing converges on a single
    // big jump in ~2 audio blocks (~24ms), which reads as a hard glide
    // ("autotune scoop") instead of a natural gradual fall.
    const fallStartFrac = 0.4;
    const fallSteps = 4;
    for (let s = 1; s <= fallSteps; s++) {
      const stepFrac = s / fallSteps;
      // Was 0.06 — stacked on top of the declination contour's own droop,
      // that read as the voice sagging away rather than a plain statement
      // fall (reported as "dragging"/"mopey"). 0.045 keeps the fall audible
      // as an end-of-utterance cue without compounding into a slump.
      const target = jitteredPitch * (1 - 0.045 * stepFrac);
      cursor.steps.push({ at: cursor.time + dur * (fallStartFrac + (1 - fallStartFrac) * stepFrac), apply: (e) => { e.Glottis.UIFrequency = target; } });
    }
  }
  cursor.time += dur;
  cursor.lastPitch = jitteredPitch;
}

/**
 * `isFinal` (nothing follows this consonant — it ends the syllable) matters
 * because the release phase below opens the tract into `closeInto`, which
 * for a syllable-final consonant is REST_SHAPE (see scheduleUnits) — a wide
 * open tube. Keeping the glottis voiced while releasing into an open shape
 * is exactly what a vowel *is* acoustically, so that's correct for an onset
 * (a real vowel genuinely follows) but wrong for a coda (nothing does) —
 * without this it reads as an appended schwa after every syllable-final stop.
 */
function scheduleStop(cursor: Cursor, place: ConsonantPlace, voiced: boolean, closeInto: number[], isFinal: boolean, next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  const closure = 0.09;
  const index = coarticulatedIndex(place, next);
  at(cursor, (e) => {
    e.Glottis.isTouched = voiced;
    if (voiced) fadeGlottisIn(e);
    else fadeGlottisOut(e);
    closeFast(e, constrict(closureBase(closeInto, next), index, 3, 0));
  });
  if (!voiced) scheduleMuteZero(cursor);
  cursor.time += closure;

  // The physical transient the model fires on release is real, but its
  // place-coloring turned out too weak to tell places apart by ear (p/t
  // sounded nearly identical) — a short place-colored burst layered on top
  // (same pattern as the fricative noise layer) makes the distinction
  // reliable instead of hoping the tract's own reflection carries it.
  cursor.noiseEvents.push({ atOffset: cursor.time, dur: 0.016, place, voiced, kind: "stopBurst" });

  if (voiced) {
    at(cursor, (e) => {
      e.Tract.movementSpeed = 24;
      e.Glottis.isTouched = !isFinal;
      if (!isFinal) e.Glottis.UITenseness = NEUTRAL_TENSENESS;
      setShape(e, closeInto);
    });
    // 0.11s of open glide is right for a following VOWEL (a real,
    // gradual articulatory move into an open target) but far too long
    // when `next` is ANOTHER CONSONANT — there's no vowel to glide into,
    // so spending 110ms passing through REST_SHAPE-like open values
    // before the next consonant's own closure even starts reads as a
    // whole extra vowel inserted between the two (reported as "/bɾ/
    // sounds like /əbɛɾ/" — a phantom vowel right before the tap; a
    // previous attempt at fixing this by inserting an intermediate
    // release shape here made it WORSE, adding an audible extra
    // consonant-like transient of its own). Real CC transitions run tens
    // of ms, not 110 — cutting straight to the next consonant's own
    // scheduling (which starts its own closing gesture immediately)
    // removes the gap instead of trying to fill it with more content.
    cursor.time += next !== undefined && !isVowelUnit(next) ? 0.02 : 0.11;
    return;
  }

  // A voiceless stop's release isn't silence-to-voicing — there's a brief
  // breathy (low-tenseness, maximizing the model's aspiration term) puff
  // before voicing engages. That gap is what "aspirated" actually is
  // acoustically; without it the release read as a near-silent transient.
  // This puff itself is fine even syllable-finally (it's breathy noise, not
  // a vowel) — only the modal-voicing resumption after it needs suppressing.
  // Duration is real VOT, not a flat guess — see VOT_BY_PLACE.
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.isTouched = true;
    fadeGlottisIn(e);
    e.Glottis.UITenseness = 0.05;
    setShape(e, closeInto);
  });
  cursor.time += VOT_BY_PLACE[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = !isFinal;
    if (!isFinal) e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  cursor.time += 0.06;
}

function scheduleEjective(cursor: Cursor, place: ConsonantPlace, closeInto: number[], isFinal: boolean, next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  // Ejectives use a glottalic (not pulmonic) airstream — the glottis itself
  // closes and drives the release, not the lungs — so the closure carries
  // no voicing at all, and release is a sharp glottal pulse rather than
  // gradually re-engaging voicing the way a plain stop's release does. The
  // pulse itself (first step below) is the ejective's own characteristic
  // release and fires regardless of position; only the settle-into-modal-
  // voicing step after it is suppressed when nothing follows (see
  // scheduleStop's isFinal comment — same reasoning).
  const closure = 0.1;
  const index = coarticulatedIndex(place, next);
  at(cursor, (e) => {
    e.Glottis.isTouched = false;
    closeFast(e, constrict(closureBase(closeInto, next), index, 3, 0));
  });
  cursor.time += closure;
  // Ejectives build up oral pressure behind a glottalic closure rather than
  // just lung pressure, so the release is genuinely sharper than a plain
  // pulmonic stop's — never quieter. A prior fix gave this the exact same
  // `stopBurst` rendering scheduleStop uses (fixing "quieter than /p/") but
  // that made /pʼ/ and /p/ indistinguishable instead — same noise burst,
  // same everything. `ejectiveBurst` is its own rendering (see audio.ts) so
  // the two are audibly distinct again, not just equally loud.
  cursor.noiseEvents.push({ atOffset: cursor.time, dur: 0.016, place, voiced: false, kind: "ejectiveBurst" });
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.isTouched = true;
    fadeGlottisIn(e);
    e.Glottis.UITenseness = 1.0;
    setShape(e, closeInto);
  });
  cursor.time += 0.035;
  at(cursor, (e) => {
    e.Glottis.isTouched = !isFinal;
    if (!isFinal) e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  cursor.time += 0.04;
}

function scheduleImplosive(cursor: Cursor, place: ConsonantPlace, closeInto: number[], isFinal: boolean, next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  const closure = 0.1;
  const index = coarticulatedIndex(place, next);
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    fadeGlottisIn(e);
    e.Glottis.UIFrequency = 80; // low, resonant pre-voicing — the closest approximation available to true ingressive voicing
    closeFast(e, constrict(closureBase(closeInto, next), index, 3, 0));
  });
  cursor.time += closure;
  const pitch = cursor.lastPitch;
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.isTouched = !isFinal;
    e.Glottis.UIFrequency = pitch;
    if (!isFinal) e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    setShape(e, closeInto);
  });
  cursor.time += 0.09;
}

function scheduleNasal(cursor: Cursor, place: ConsonantPlace, closeInto: number[], next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  const dur = 0.18;
  const index = coarticulatedIndex(place, next);
  const pitch = cursor.lastPitch;
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    fadeGlottisIn(e);
    e.Glottis.UIFrequency = pitch;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    e.Tract.velumTarget = 0.4;
    closeFast(e, constrict(closureBase(closeInto, next), index, 3, 0));
  });
  cursor.time += 0.05;
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
  });
  cursor.time += dur - 0.05;
  at(cursor, (e) => {
    e.Tract.velumTarget = 0.01;
  });
}

function scheduleFricative(cursor: Cursor, place: ConsonantPlace, voiced: boolean, manner: "fricative" | "lateralFricative", next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  const dur = 0.13;
  const index = coarticulatedIndex(place, next);
  const isGlottal = place === "glottal";
  const pitch = cursor.lastPitch;
  at(cursor, (e) => {
    // /h/ has no independent oral constriction (see PLACE_INDEX's comment —
    // "manner carried entirely by the glottis"), so unlike every other
    // fricative it shouldn't be rendered as tract-silenced + external noise
    // only. That's exactly why it read as generic "static" instead of
    // breathy: real /h/ IS the model's own aspiration term (intensity *
    // (1-sqrt(tenseness)) * noise, in Glottis.runStep) resonating through
    // whatever tract shape is already there — driving that directly, tract
    // shape untouched, is what makes it sound like breath instead of hiss.
    if (isGlottal) {
      e.Glottis.isTouched = true;
      fadeGlottisIn(e);
      e.Glottis.UIFrequency = pitch;
      e.Glottis.UITenseness = 0.05;
      return;
    }
    // The tract is silenced here regardless of voicing, full stop — not
    // just quieted. Voiceless s/f sounded "perfect" precisely because the
    // tract contributes zero output when unexcited (intensity=0), so the
    // whole sound is purely the clean noise layer below with no interaction
    // at all. A resonating tract, even quieted, still has an inherent
    // timbre — narrow oral shape + any real voicing IS what a resonant
    // approximant is, by definition; no amount of turning it down changes
    // that identity, only its volume. Voicing for voiced fricatives is
    // supplied entirely separately (playVoiceHum in audio.ts) — a simple
    // decoupled hum, not the physical tract — so it can't reintroduce this.
    e.Glottis.isTouched = false;
    fadeGlottisOut(e);
    // REST_SHAPE, not the anticipated next shape — that's deliberate. Baking
    // the next consonant's target in as the base here (like stops correctly
    // do) diluted this phoneme's own identity for its *entire* hold, not
    // just at the handoff, since a fricative's constriction (0.15) is open
    // enough for the base's other regions to still audibly show through —
    // unlike a stop's full closure to 0, which wipes the base out entirely.
    // The transition to whatever comes next still happens naturally: the
    // moment the following gesture sets a new target, the tract starts
    // moving there on its own.
    setShape(e, constrict(REST_SHAPE, index, 3, 0.15));
  });
  if (!isGlottal) scheduleMuteZero(cursor);
  cursor.noiseEvents.push({ atOffset: cursor.time, dur, place, voiced, kind: "fricative" });
  void manner;
  cursor.time += dur;
  if (isGlottal) cursor.lastPitch = pitch;
}

/**
 * An affricate is a stop released DIRECTLY into a same-place fricative — not
 * a stop that first settles into whatever comes *after* the affricate and
 * only then adds a frication tail. The previous version delegated to the
 * full scheduleStop, whose release phase opens the tract toward the
 * following phoneme (e.g. a vowel) and holds it there for ~0.1s before this
 * function's own frication step snapped the tract back to a narrow
 * constriction at the affricate's own place. Audibly that's: closure, open
 * toward the vowel, yank back to a fricative, open toward the vowel again —
 * two competing consonants, not one merged affricate. Inlining just the
 * closure (mirroring scheduleStop's own closure step) and going straight
 * into frication fixes the handoff: the transition to whatever comes next is
 * left entirely to that next unit's own scheduling, exactly like a
 * standalone fricative already does.
 */
function scheduleAffricate(cursor: Cursor, place: ConsonantPlace, voiced: boolean, closeInto: number[], next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  const closure = 0.09;
  const index = coarticulatedIndex(place, next);
  at(cursor, (e) => {
    e.Glottis.isTouched = voiced;
    if (voiced) fadeGlottisIn(e);
    else fadeGlottisOut(e);
    closeFast(e, constrict(closureBase(closeInto, next), index, 3, 0));
  });
  if (!voiced) scheduleMuteZero(cursor);
  cursor.time += closure;
  cursor.noiseEvents.push({ atOffset: cursor.time, dur: 0.016, place, voiced, kind: "stopBurst" });

  const dur = 0.07;
  at(cursor, (e) => {
    // See scheduleFricative — tract fully silent, base is REST_SHAPE (not
    // the anticipated next shape) for the same reason: keeps this brief
    // frication tail's own identity intact instead of diluting it.
    e.Glottis.isTouched = false;
    fadeGlottisOut(e);
    setShape(e, constrict(REST_SHAPE, index, 3, 0.15));
  });
  scheduleMuteZero(cursor);
  cursor.noiseEvents.push({ atOffset: cursor.time, dur, place, voiced, kind: "fricative" });
  cursor.time += dur;
}

function scheduleClick(cursor: Cursor, place: ConsonantPlace, closeInto: number[], next: ConsonantPhoneme | VowelPhoneme | undefined): void {
  // Clicks use a velaric (tongue-generated suction) airstream with no lung
  // involvement at all — fundamentally outside what a pulmonic tube model
  // can produce. The tract still closes (for visual/shape coherence into
  // whatever follows), but the actual click sound is the noise layer alone,
  // with the glottis silent throughout.
  const dur = 0.02;
  const index = coarticulatedIndex(place, next);
  at(cursor, (e) => {
    e.Glottis.isTouched = false;
    fadeGlottisOut(e);
    setShape(e, constrict(closureBase(closeInto, next), index, 3, 0));
  });
  scheduleMuteZero(cursor);
  cursor.noiseEvents.push({ atOffset: cursor.time, dur, place, voiced: false, kind: "click" });
  cursor.time += dur;
  at(cursor, (e) => setShape(e, closeInto));
  cursor.time += 0.06;
}

function scheduleApproximant(cursor: Cursor, phoneme: ConsonantPhoneme): void {
  const dur = 0.15;
  // REST_SHAPE, not the anticipated next shape — same reasoning as
  // scheduleFricative: an approximant's constriction (0.9, or vowel-like
  // +0.15) is open enough that baking in what comes next would blend its
  // own identity away for the whole hold instead of just handing off at
  // the boundary.
  const shape = approximantShape(phoneme, REST_SHAPE);
  const pitch = cursor.lastPitch;
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    fadeGlottisIn(e);
    // The vendor engine's own Glottis.intensity climbs by +0.13 per
    // 512-sample block (~90-100ms to reach 1 from 0 — see finishBlock in
    // @seansleblanc/pink-trombone's index.js) rather than snapping to 1 the
    // moment isTouched flips true. scheduleMuteZero already bypasses this
    // same mechanism in the other direction (a hard write instead of
    // waiting on the model's own ~230ms decay) for exactly this reason.
    // Without the same bypass here, an approximant immediately following a
    // voiceless consonant (no isTouched=true head start of its own — see
    // scheduleFricative) spends most or all of its short hold still
    // ramping up from near-silence: reported as a "pop of silence" in
    // clusters like /pl/.
    e.Glottis.intensity = 1;
    e.Glottis.UIFrequency = pitch;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    setShape(e, shape);
  });
  cursor.time += dur;
}

function scheduleTapOrTrill(
  cursor: Cursor,
  place: ConsonantPlace,
  manner: ConsonantManner,
  closeInto: number[],
  isFinal: boolean,
  opensIntoNasal: boolean,
  next: ConsonantPhoneme | VowelPhoneme | undefined,
): void {
  const pulses = manner === "trill" ? 3 : 1;
  // Closing and opening aren't symmetric (see the comment above
  // scheduleVowel) — an even split meant the reopening half never actually
  // finished before the next phoneme redirected the target, so the tap
  // never registered as a distinct contact, just a blip inside whatever
  // came next.
  const closeDur = 0.018;
  // A real alveolar trill vibrates at ~25-30Hz (~35-40ms per contact-to-
  // contact cycle) — trills need a much shorter reopen than a tap's single,
  // deliberate contact, or the roll drags. Left at the tap's 0.045 for both,
  // this rolled noticeably slower than a real trill; only trills speed up.
  const openDur = manner === "trill" ? 0.025 : 0.045;
  const index = coarticulatedIndex(place, next);
  at(cursor, (e) => {
    e.Tract.movementSpeed = 55; // real trills involve unusually fast articulator movement, faster still than the already-raised baseline (see pink-trombone-engine.ts)
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  for (let i = 0; i < pulses; i++) {
    const isLastPulse = i === pulses - 1;
    // Every pulse but the last opens toward REST_SHAPE, not `closeInto` — a
    // trill needs real room to open between taps to actually roll. When the
    // next unit in a cluster is another consonant (e.g. a following stop),
    // `closeInto` is already a near-total closure (see anticipatedShape), so
    // opening "toward" it left the tract with nowhere to go — the trill read
    // as swallowed/cut off instead of rolling. Only the LAST pulse hands off
    // into `closeInto`, same as a stop's own release into what follows.
    at(cursor, (e) => {
      e.Glottis.isTouched = true;
      fadeGlottisIn(e);
      // Same bypass as scheduleApproximant's — the vendor's own intensity
      // ramp (~90-100ms to climb from 0) is longer than a tap's entire
      // closeDur+openDur, so without forcing it here a tap right after a
      // voiceless consonant (e.g. /fr/, /bɾ/) could finish before its
      // voicing ever caught up — the reported "pop of silence."
      if (i === 0) e.Glottis.intensity = 1;
      setShape(e, constrict(REST_SHAPE, index, 2, 0.1));
    });
    // Every other manner gets a place-colored transient at its moment of
    // contact/release (stopBurst/ejectiveBurst/fricative/click, all pushed
    // elsewhere in this file) — taps/trills were the one category with
    // none at all, relying purely on the tract's own resonance dip during
    // closeDur. That dip alone read as a soft blip, not a distinct contact
    // — reported as "doesn't sound rhotic at all." playTapBurst (audio.ts)
    // gives each pulse a light, quiet, dull click (same place-centered
    // frequency as a stop's burst, but shorter/quieter/less peaky — a tap
    // is a brief touch, not a released pressure buildup like a stop).
    cursor.noiseEvents.push({ atOffset: cursor.time, dur: closeDur, place, voiced: true, kind: "tapBurst" });
    cursor.time += closeDur;
    at(cursor, (e) => setShape(e, isLastPulse ? closeInto : REST_SHAPE));
    cursor.time += openDur;
  }
  at(cursor, (e) => {
    // Dropping straight to the 24 baseline here is fine when there's little
    // ground left to cover (e.g. r->n, both alveolar — the last pulse's
    // openDur already basically arrived). But when the handoff crosses
    // places (e.g. ɾ->ŋ, alveolar->velar), the tract is still mid-reshape
    // when this fires; slowing it to 24 stalls that reshape right before the
    // nasal's own closeFast (speed 60) yanks it the rest of the way — an
    // inconsistent slow-then-abrupt motion that reads as a scrape. Staying
    // at the pulse's own speed through the handoff keeps it moving instead.
    e.Tract.movementSpeed = opensIntoNasal ? 55 : 24; // back to the baseline set in runGestures, not the library's original default, unless a nasal handoff still needs the runway
    // Same reasoning as scheduleStop's isFinal: the last pulse's `openDur`
    // settles into `closeInto`, which is REST_SHAPE when nothing follows —
    // holding voicing into that open shape reads as an appended vowel.
    if (isFinal) e.Glottis.isTouched = false;
    // Real nasal coarticulation is anticipatory — the velum starts lowering
    // before the nasal consonant's own oral closure even forms, not in sync
    // with it. Without this, a trill/tap handing directly into a nasal (e.g.
    // r->n in "burn") sits fully sealed at both the mouth AND the velum,
    // still voiced, for this entire settle window — a dead end for the
    // airstream that reads as a creaky "roughness" right before the nasal's
    // release. Opening the velum here, rather than waiting for the nasal's
    // own onset step, gives the voiced air somewhere to go immediately.
    if (opensIntoNasal) e.Tract.velumTarget = 0.4;
  });
  cursor.time += 0.04;
}

/** Build one continuous gesture schedule (+ noise-layer events) for a sequence of phonemes. */
/**
 * `stressedIndex` (absolute index into `units`, from LexiconItemData's
 * stressedPhonemeIndex) marks the primary-stressed vowel. Only applied when
 * the word actually has more than one vowel — stress is a relational,
 * contrastive property between syllables, meaningless (and left as a no-op)
 * for a single-syllable word even though pickStressIndex vacuously returns
 * 0 for those too.
 */
export function scheduleUnits(units: Array<ConsonantPhoneme | VowelPhoneme>, stressedIndex?: number): { steps: GestureStep[]; noiseEvents: NoiseEvent[]; totalDuration: number } {
  const cursor: Cursor = { time: 0, steps: [], noiseEvents: [], lastPitch: VOICED_PITCH };
  const vowelPositions: number[] = [];
  units.forEach((u, idx) => { if (isVowelUnit(u)) vowelPositions.push(idx); });
  const totalVowels = vowelPositions.length;
  const lastVowelPosition = vowelPositions[vowelPositions.length - 1];
  const hasStressContrast = totalVowels > 1 && stressedIndex !== undefined;
  let vowelIndex = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (isVowelUnit(unit)) {
      const isLast = i === units.length - 1;
      const pitch = contourPitch(vowelIndex, totalVowels);
      const isStressed = hasStressContrast && i === stressedIndex;
      // Was 0.32/0.24 — reported as "slow and drawn out; dragging." Trimmed
      // by about a fifth, same final/non-final ratio, still long enough to
      // read as deliberate articulation rather than clipped.
      let dur = isLast ? 0.25 : 0.19;
      if (hasStressContrast) dur *= isStressed ? 1.25 : 0.85;
      scheduleVowel(cursor, unit, dur, pitch, i === lastVowelPosition, isStressed);
      vowelIndex++;
      continue;
    }

    const next = units[i + 1];
    const isFinal = next === undefined;
    const closeInto = next ? anticipatedShape(next) : REST_SHAPE;
    const { manner, place, voiced } = unit.features;
    switch (manner) {
      case "stop":
        scheduleStop(cursor, place, voiced, closeInto, isFinal, next);
        break;
      case "ejective":
        scheduleEjective(cursor, place, closeInto, isFinal, next);
        break;
      case "implosive":
        scheduleImplosive(cursor, place, closeInto, isFinal, next);
        break;
      case "nasal":
        scheduleNasal(cursor, place, closeInto, next);
        break;
      case "fricative":
      case "lateralFricative":
        scheduleFricative(cursor, place, voiced, manner, next);
        break;
      case "affricate":
        scheduleAffricate(cursor, place, voiced, closeInto, next);
        break;
      case "click":
        scheduleClick(cursor, place, closeInto, next);
        break;
      case "approximant":
      case "lateralApproximant":
        scheduleApproximant(cursor, unit);
        break;
      case "trill":
      case "tap": {
        const opensIntoNasal = next !== undefined && !isVowelUnit(next) && next.features.manner === "nasal";
        scheduleTapOrTrill(cursor, place, manner, closeInto, isFinal, opensIntoNasal, next);
        break;
      }
    }
  }

  at(cursor, (e) => {
    e.Glottis.isTouched = false;
  });

  return { steps: cursor.steps, noiseEvents: cursor.noiseEvents, totalDuration: cursor.time };
}
