// Phoneme → articulatory gesture data and schedule-building for the Pink
// Trombone engine (pink-trombone-engine.ts). This is the "content" layer —
// analogous to the old audio.ts's BURST_HZ/FRICATIVE_HZ tables, but driving
// a real vocal-tract shape instead of a noise-filter frequency.
//
// Tract shape is a 44-point diameter array from throat (0) to lips (43);
// landmarks per the engine's own init: bladeStart≈10, tipStart≈32,
// lipStart≈39. Constriction locations/widths below are a first-pass
// approximation from general place/height/backness phonetics, not a
// validated per-language area-function table (Story 2005 has real data for
// this) — tunable by ear, same as everything else in this engine.
//
// One real, verified gap in @seansleblanc/pink-trombone: its Tract.runStep
// accepts a `turbulenceNoise` parameter but never uses it anywhere in the
// function body, so narrowing the tract alone produces no frication hiss.
// Fricatives/affricates/clicks therefore get a `noiseEvent` here, layered in
// separately by audio.ts using the same noise-burst synthesis already tuned
// for the previous engine, mixed alongside the tract's own resonance.

import type { ConsonantManner, ConsonantPhoneme, ConsonantPlace, VowelPhoneme } from "../../../convex/phonology/types";
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

const LIP_INDEX = 41;

/**
 * Front and back rounded vowels need genuinely different rounding strengths
 * — measured via a real Kelly-Lochbaum impulse-response probe of this exact
 * model, one shared constant can't serve both. The original (3, 0.5) dropped
 * F2 by ~635Hz vs a vowel's unrounded counterpart, which is roughly 2x a
 * realistic front-rounded drop (200-400Hz) — /y/ and /ø/ ended up with
 * near-identical F2 despite being different heights. But softening it
 * uniformly broke the BACK rounded vowels, which lean on that same lip
 * constriction to stay properly close: /u/'s F1 jumped from 484 to 571 (right
 * where the STRUT/"uh" vowel sits) once the constriction weakened, which is
 * exactly why it read as "uh" instead of "oo." (2, 0.7) measures right for
 * front rounding; back rounding needs to stay strong — (5, 0.3) puts /u/ at
 * F1≈323/F2≈969, close to a real /u/'s ~300-350/~800-900.
 */
function frontRounded(base: number[]): number[] {
  return constrict(base, LIP_INDEX, 2, 0.7);
}
/**
 * One fixed lip diameter for every back-rounded vowel used to pin F1 for the
 * WHOLE series to ~390-420Hz regardless of height, since real rounding
 * tightness actually varies by height (u most protruded, ɔ least) — see the
 * VOWEL_ARTICULATION comment above o/ɔ/u/ʊ for how each one's value below
 * was actually fit (grid search against real measured formant data, not
 * tuned by ear). 0.3 remains only as a fallback for any future back-rounded
 * vowel that doesn't specify its own.
 */
function backRounded(base: number[], lipDiameter = 0.3): number[] {
  return constrict(base, LIP_INDEX, 5, lipDiameter);
}

interface VowelArticulation {
  center: number;
  width: number;
  diameter: number;
  rounded?: "front" | "back";
  /** Override for backRounded()'s lip constriction — see its comment. Only meaningful when rounded === "back". */
  lipDiameter?: number;
}

/**
 * Every vowel below is grid-searched (center/width/diameter/lipDiameter,
 * search script not committed — this table is the output) against real
 * measured F1/F2/F3 data Nae supplied for the whole IPA vowel space
 * (Wavesurfer LPC analysis, see `vowels info/` in the repo root — not
 * committed, just working reference), the same fix that first got the
 * back-rounded series (u/ʊ/o/ɔ) actually right instead of "sounds more X"
 * guessing. F1/F2 are weighted as the primary fit target, F3 as a lighter
 * tiebreaker (real, but perceptually secondary to F1/F2 for vowel identity).
 *
 * Two real ceilings showed up that no amount of searching gets past, given
 * this tube's fixed overall length/lip opening (REST_SHAPE is shared by
 * every phoneme, so widening it is out of scope for a vowel-formant pass —
 * it'd ripple into every consonant's coarticulation target too): even
 * REST_SHAPE completely unconstricted only measures F1≈600Hz, so /a/
 * (target 806Hz) and /ɑ/ (781Hz) can't get any more open than ~600-645Hz no
 * matter the shape searched — their F2/F3 are still fit precisely, just F1
 * is the closest this tube can reach. Symmetrically, /i/ and /y/ floor out
 * around F1≈345-370Hz (target 294/283) — a high vowel's F1 can't get much
 * lower here either. Relative ordering across the whole vowel space is
 * still correct (closes are lowest F1, opens are highest), just compressed
 * into a narrower absolute range (~345-645Hz) than real speech's (~250-800).
 */
const VOWEL_ARTICULATION: Record<string, VowelArticulation> = {
  // target F1/F2/F3 = 294/2343/3251; got 350/2350/3130 — F1 at this tube's close-vowel floor (see file comment above)
  i: { center: 30, width: 7, diameter: 0.05 },
  // target 360/2187/2830; got 370/2190/3130
  ɪ: { center: 30, width: 7, diameter: 0.1 },
  // target 434/2148/2763; got 430/2150/3110
  e: { center: 31, width: 9, diameter: 0.3 },
  // target 581/1840/2429; got 590/1830/2430 — excellent fit across all three
  ɛ: { center: 27, width: 5, diameter: 0.85 },
  // target 806/1632/2684; got 600/1635/2670 — F1 at this tube's open-vowel ceiling, F2/F3 land almost exactly
  a: { center: 22.5, width: 10, diameter: 0.9 },
  // target 781/1065/2158; got 645/990/2715 — same F1 ceiling as /a/ above
  ɑ: { center: 13.5, width: 16, diameter: 0.9 },
  // The back-rounded series went through several rounds of "make it sound
  // more X" guessing (loosen the lip constriction, narrow the oral one...)
  // before switching to fitting real data — every earlier attempt here had
  // back-rounded F2 pinned around 1000-1400Hz, genuinely too central/
  // forward, because center/width/diameter/lipDiameter all move F1 *and* F2
  // together in this model, so nudging one lever at a time by ear was never
  // going to land all four correctly at once.
  // target 541/830/2221; got 540/810/2610
  ɔ: { center: 15, width: 9, diameter: 0.3, rounded: "back", lipDiameter: 0.55 },
  // target 406/727/2090; got 405/735/1935
  o: { center: 11, width: 4, diameter: 0.15, rounded: "back", lipDiameter: 0.25 },
  // target 295/750/2342; got 300/750/2115 — near-exact F1/F2
  u: { center: 12, width: 7, diameter: 0.2, rounded: "back", lipDiameter: 0.1 },
  // target 334/910/2300; got 330/900/2370 — near-exact across all three
  ʊ: { center: 15, width: 6, diameter: 0.35, rounded: "back", lipDiameter: 0.2 },
  // target 486/1826/2422 (defined in the reference chart as "halfway between
  // ɘ and ɜ", the two central-unrounded mid vowels — the closest real
  // anchor for a stressless schwa); got 540/1830/2370
  ə: { center: 26.5, width: 7, diameter: 0.5 },
  // target 283/2170/2417; got 345/2175/3165 — F1 at the same close-vowel floor as /i/, not a rounding failure
  y: { center: 32, width: 4, diameter: 0.08, rounded: "front", lipDiameter: 1.1 },
  // target 462/1659/2127; got 490/1650/2210
  ø: { center: 28, width: 5, diameter: 0.4, rounded: "front", lipDiameter: 0.9 },
};

export function vowelShape(ipa: string): number[] {
  const art = VOWEL_ARTICULATION[ipa];
  if (!art) return REST_SHAPE.slice();
  const d = constrict(REST_SHAPE, art.center, art.width, art.diameter);
  if (art.rounded === "front") return frontRounded(d);
  if (art.rounded === "back") return backRounded(d, art.lipDiameter);
  return d;
}

/** Where each place of articulation constricts the tract (throat=0 to lips=43). */
const PLACE_INDEX: Record<ConsonantPlace, number> = {
  pharyngeal: 8,
  uvular: 13,
  velar: 18,
  palatal: 25,
  postalveolar: 29,
  retroflex: 30,
  alveolar: 31,
  dental: 35,
  labiodental: 39,
  bilabial: 41,
  glottal: 20, // no oral constriction — manner carried entirely by the glottis
};

/** Approximants reuse vowel-adjacent shapes (j≈i, w≈u) rather than the place table — semivowels ARE vowel-like articulations. */
const APPROXIMANT_VOWEL_LIKE: Record<string, string> = { j: "i", w: "u" };

function approximantShape(phoneme: ConsonantPhoneme, base: number[]): number[] {
  const vowelLike = APPROXIMANT_VOWEL_LIKE[phoneme.ipa];
  if (vowelLike) {
    const art = VOWEL_ARTICULATION[vowelLike];
    return constrict(base, art.center, art.width, art.diameter + 0.15);
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

// 115Hz sits dead-center of the adult-male F0 range (~85-180Hz); adult female
// averages ~200-220Hz. We can't shorten the modeled vocal tract without
// invalidating the hand-measured vowel formant table above, so pitch (+ a
// touch more vocal tension, i.e. less breathy/"soft-spoken") is the only
// lever available for shifting the perceived voice younger/more feminine.
const VOICED_PITCH = 175;
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
  kind: "fricative" | "click" | "stopBurst" | "ejectiveBurst";
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
function scheduleVowel(cursor: Cursor, phoneme: VowelPhoneme, dur: number, pitch: number, isLastVowel: boolean): void {
  const shape = vowelShape(phoneme.ipa);
  // Small per-play randomization on top of the contour — real speech never
  // repeats a word with bit-identical pitch/effort, and without this every
  // replay of the same root sounds like the exact same recording looping.
  const jitteredPitch = pitch * (1 + (Math.random() - 0.5) * 0.02);
  const jitteredTenseness = NEUTRAL_TENSENESS + (Math.random() - 0.5) * 0.04;
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
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
      const target = jitteredPitch * (1 - 0.06 * stepFrac);
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
function scheduleStop(cursor: Cursor, place: ConsonantPlace, voiced: boolean, closeInto: number[], isFinal: boolean): void {
  const closure = 0.09;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = voiced;
    if (!voiced) e.Glottis.intensity = 0;
    closeFast(e, constrict(closeInto, index, 3, 0));
  });
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
    cursor.time += 0.11;
    return;
  }

  // A voiceless stop's release isn't silence-to-voicing — there's a brief
  // breathy (low-tenseness, maximizing the model's aspiration term) puff
  // before voicing engages. That gap is what "aspirated" actually is
  // acoustically; without it the release read as a near-silent transient.
  // This puff itself is fine even syllable-finally (it's breathy noise, not
  // a vowel) — only the modal-voicing resumption after it needs suppressing.
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.isTouched = true;
    e.Glottis.UITenseness = 0.05;
    setShape(e, closeInto);
  });
  cursor.time += 0.05;
  at(cursor, (e) => {
    e.Glottis.isTouched = !isFinal;
    if (!isFinal) e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  cursor.time += 0.06;
}

function scheduleEjective(cursor: Cursor, place: ConsonantPlace, closeInto: number[], isFinal: boolean): void {
  // Ejectives use a glottalic (not pulmonic) airstream — the glottis itself
  // closes and drives the release, not the lungs — so the closure carries
  // no voicing at all, and release is a sharp glottal pulse rather than
  // gradually re-engaging voicing the way a plain stop's release does. The
  // pulse itself (first step below) is the ejective's own characteristic
  // release and fires regardless of position; only the settle-into-modal-
  // voicing step after it is suppressed when nothing follows (see
  // scheduleStop's isFinal comment — same reasoning).
  const closure = 0.1;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = false;
    closeFast(e, constrict(closeInto, index, 3, 0));
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

function scheduleImplosive(cursor: Cursor, place: ConsonantPlace, closeInto: number[], isFinal: boolean): void {
  const closure = 0.1;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    e.Glottis.UIFrequency = 80; // low, resonant pre-voicing — the closest approximation available to true ingressive voicing
    closeFast(e, constrict(closeInto, index, 3, 0));
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

function scheduleNasal(cursor: Cursor, place: ConsonantPlace, closeInto: number[]): void {
  const dur = 0.18;
  const index = PLACE_INDEX[place];
  const pitch = cursor.lastPitch;
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    e.Glottis.UIFrequency = pitch;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    e.Tract.velumTarget = 0.4;
    closeFast(e, constrict(closeInto, index, 3, 0));
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

function scheduleFricative(cursor: Cursor, place: ConsonantPlace, voiced: boolean, manner: "fricative" | "lateralFricative"): void {
  const dur = 0.13;
  const index = PLACE_INDEX[place];
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
    e.Glottis.intensity = 0;
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
function scheduleAffricate(cursor: Cursor, place: ConsonantPlace, voiced: boolean, closeInto: number[]): void {
  const closure = 0.09;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = voiced;
    if (!voiced) e.Glottis.intensity = 0;
    closeFast(e, constrict(closeInto, index, 3, 0));
  });
  cursor.time += closure;
  cursor.noiseEvents.push({ atOffset: cursor.time, dur: 0.016, place, voiced, kind: "stopBurst" });

  const dur = 0.07;
  at(cursor, (e) => {
    // See scheduleFricative — tract fully silent, base is REST_SHAPE (not
    // the anticipated next shape) for the same reason: keeps this brief
    // frication tail's own identity intact instead of diluting it.
    e.Glottis.isTouched = false;
    e.Glottis.intensity = 0;
    setShape(e, constrict(REST_SHAPE, index, 3, 0.15));
  });
  cursor.noiseEvents.push({ atOffset: cursor.time, dur, place, voiced, kind: "fricative" });
  cursor.time += dur;
}

function scheduleClick(cursor: Cursor, place: ConsonantPlace, closeInto: number[]): void {
  // Clicks use a velaric (tongue-generated suction) airstream with no lung
  // involvement at all — fundamentally outside what a pulmonic tube model
  // can produce. The tract still closes (for visual/shape coherence into
  // whatever follows), but the actual click sound is the noise layer alone,
  // with the glottis silent throughout.
  const dur = 0.02;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = false;
    e.Glottis.intensity = 0;
    setShape(e, constrict(closeInto, index, 3, 0));
  });
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
    e.Glottis.UIFrequency = pitch;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    setShape(e, shape);
  });
  cursor.time += dur;
}

function scheduleTapOrTrill(cursor: Cursor, place: ConsonantPlace, manner: ConsonantManner, closeInto: number[], isFinal: boolean): void {
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
  const index = PLACE_INDEX[place];
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
      setShape(e, constrict(REST_SHAPE, index, 2, 0.1));
    });
    cursor.time += closeDur;
    at(cursor, (e) => setShape(e, isLastPulse ? closeInto : REST_SHAPE));
    cursor.time += openDur;
  }
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24; // back to the baseline set in runGestures, not the library's original default
    // Same reasoning as scheduleStop's isFinal: the last pulse's `openDur`
    // settles into `closeInto`, which is REST_SHAPE when nothing follows —
    // holding voicing into that open shape reads as an appended vowel.
    if (isFinal) e.Glottis.isTouched = false;
  });
  cursor.time += 0.04;
}

/** Build one continuous gesture schedule (+ noise-layer events) for a sequence of phonemes. */
export function scheduleUnits(units: Array<ConsonantPhoneme | VowelPhoneme>): { steps: GestureStep[]; noiseEvents: NoiseEvent[]; totalDuration: number } {
  const cursor: Cursor = { time: 0, steps: [], noiseEvents: [], lastPitch: VOICED_PITCH };
  const vowelPositions: number[] = [];
  units.forEach((u, idx) => { if (isVowelUnit(u)) vowelPositions.push(idx); });
  const totalVowels = vowelPositions.length;
  const lastVowelPosition = vowelPositions[vowelPositions.length - 1];
  let vowelIndex = 0;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (isVowelUnit(unit)) {
      const isLast = i === units.length - 1;
      const pitch = contourPitch(vowelIndex, totalVowels);
      scheduleVowel(cursor, unit, isLast ? 0.32 : 0.24, pitch, i === lastVowelPosition);
      vowelIndex++;
      continue;
    }

    const next = units[i + 1];
    const isFinal = next === undefined;
    const closeInto = next ? anticipatedShape(next) : REST_SHAPE;
    const { manner, place, voiced } = unit.features;
    switch (manner) {
      case "stop":
        scheduleStop(cursor, place, voiced, closeInto, isFinal);
        break;
      case "ejective":
        scheduleEjective(cursor, place, closeInto, isFinal);
        break;
      case "implosive":
        scheduleImplosive(cursor, place, closeInto, isFinal);
        break;
      case "nasal":
        scheduleNasal(cursor, place, closeInto);
        break;
      case "fricative":
      case "lateralFricative":
        scheduleFricative(cursor, place, voiced, manner);
        break;
      case "affricate":
        scheduleAffricate(cursor, place, voiced, closeInto);
        break;
      case "click":
        scheduleClick(cursor, place, closeInto);
        break;
      case "approximant":
      case "lateralApproximant":
        scheduleApproximant(cursor, unit);
        break;
      case "trill":
      case "tap":
        scheduleTapOrTrill(cursor, place, manner, closeInto, isFinal);
        break;
    }
  }

  at(cursor, (e) => {
    e.Glottis.isTouched = false;
  });

  return { steps: cursor.steps, noiseEvents: cursor.noiseEvents, totalDuration: cursor.time };
}
