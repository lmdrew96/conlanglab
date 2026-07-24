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

function rounded(base: number[]): number[] {
  return constrict(base, LIP_INDEX, 3, 0.5);
}

interface VowelArticulation {
  center: number;
  width: number;
  diameter: number;
  rounded?: boolean;
}

const VOWEL_ARTICULATION: Record<string, VowelArticulation> = {
  i: { center: 30, width: 6, diameter: 0.35 },
  e: { center: 28, width: 7, diameter: 0.75 },
  ɛ: { center: 26, width: 7, diameter: 1.05 },
  a: { center: 20, width: 8, diameter: 1.3 },
  ɑ: { center: 14, width: 7, diameter: 1.3 },
  ɔ: { center: 16, width: 7, diameter: 0.9, rounded: true },
  o: { center: 15, width: 6, diameter: 0.6, rounded: true },
  u: { center: 14, width: 6, diameter: 0.35, rounded: true },
  ə: { center: 20, width: 10, diameter: 1.4 },
  ɪ: { center: 29, width: 6, diameter: 0.55 },
  ʊ: { center: 15, width: 6, diameter: 0.55, rounded: true },
  y: { center: 30, width: 6, diameter: 0.35, rounded: true },
  ø: { center: 28, width: 7, diameter: 0.75, rounded: true },
};

export function vowelShape(ipa: string): number[] {
  const art = VOWEL_ARTICULATION[ipa];
  if (!art) return REST_SHAPE.slice();
  const d = constrict(REST_SHAPE, art.center, art.width, art.diameter);
  return art.rounded ? rounded(d) : d;
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

const VOICED_PITCH = 115;
const NEUTRAL_TENSENESS = 0.55;

export interface NoiseEvent {
  /** Seconds from the start of this schedule. */
  atOffset: number;
  dur: number;
  place: ConsonantPlace;
  voiced: boolean;
  kind: "fricative" | "click" | "stopBurst";
}

interface Cursor {
  time: number;
  steps: GestureStep[];
  noiseEvents: NoiseEvent[];
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
function scheduleVowel(cursor: Cursor, phoneme: VowelPhoneme, dur: number): void {
  const shape = vowelShape(phoneme.ipa);
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    e.Glottis.UIFrequency = VOICED_PITCH;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    setShape(e, shape);
  });
  cursor.time += dur;
}

function scheduleStop(cursor: Cursor, place: ConsonantPlace, voiced: boolean, closeInto: number[]): void {
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
      e.Glottis.isTouched = true;
      e.Glottis.UITenseness = NEUTRAL_TENSENESS;
      setShape(e, closeInto);
    });
    cursor.time += 0.11;
    return;
  }

  // A voiceless stop's release isn't silence-to-voicing — there's a brief
  // breathy (low-tenseness, maximizing the model's aspiration term) puff
  // before voicing engages. That gap is what "aspirated" actually is
  // acoustically; without it the release read as a near-silent transient.
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.isTouched = true;
    e.Glottis.UITenseness = 0.05;
    setShape(e, closeInto);
  });
  cursor.time += 0.05;
  at(cursor, (e) => {
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  cursor.time += 0.06;
}

function scheduleEjective(cursor: Cursor, place: ConsonantPlace, closeInto: number[]): void {
  // Ejectives use a glottalic (not pulmonic) airstream — the glottis itself
  // closes and drives the release, not the lungs — so the closure carries
  // no voicing at all, and release is a sharp glottal pulse rather than
  // gradually re-engaging voicing the way a plain stop's release does.
  const closure = 0.1;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = false;
    closeFast(e, constrict(closeInto, index, 3, 0));
  });
  cursor.time += closure;
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.isTouched = true;
    e.Glottis.UITenseness = 1.0;
    setShape(e, closeInto);
  });
  cursor.time += 0.035;
  at(cursor, (e) => {
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  cursor.time += 0.04;
}

function scheduleImplosive(cursor: Cursor, place: ConsonantPlace, closeInto: number[]): void {
  const closure = 0.1;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    e.Glottis.UIFrequency = 80; // low, resonant pre-voicing — the closest approximation available to true ingressive voicing
    closeFast(e, constrict(closeInto, index, 3, 0));
  });
  cursor.time += closure;
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24;
    e.Glottis.UIFrequency = VOICED_PITCH;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    setShape(e, closeInto);
  });
  cursor.time += 0.09;
}

function scheduleNasal(cursor: Cursor, place: ConsonantPlace, closeInto: number[]): void {
  const dur = 0.18;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    e.Glottis.UIFrequency = VOICED_PITCH;
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
  at(cursor, (e) => {
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
}

function scheduleAffricate(cursor: Cursor, place: ConsonantPlace, voiced: boolean, closeInto: number[]): void {
  scheduleStop(cursor, place, voiced, closeInto);
  const dur = 0.07;
  const index = PLACE_INDEX[place];
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
  at(cursor, (e) => {
    e.Glottis.isTouched = true;
    e.Glottis.UIFrequency = VOICED_PITCH;
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
    setShape(e, shape);
  });
  cursor.time += dur;
}

function scheduleTapOrTrill(cursor: Cursor, place: ConsonantPlace, manner: ConsonantManner, closeInto: number[]): void {
  const pulses = manner === "trill" ? 3 : 1;
  // Closing and opening aren't symmetric (see the comment above
  // scheduleVowel) — an even split meant the reopening half never actually
  // finished before the next phoneme redirected the target, so the tap
  // never registered as a distinct contact, just a blip inside whatever
  // came next.
  const closeDur = 0.018;
  const openDur = 0.045;
  const index = PLACE_INDEX[place];
  at(cursor, (e) => {
    e.Tract.movementSpeed = 55; // real trills involve unusually fast articulator movement, faster still than the already-raised baseline (see pink-trombone-engine.ts)
    e.Glottis.UITenseness = NEUTRAL_TENSENESS;
  });
  for (let i = 0; i < pulses; i++) {
    at(cursor, (e) => {
      e.Glottis.isTouched = true;
      setShape(e, constrict(closeInto, index, 2, 0.1));
    });
    cursor.time += closeDur;
    at(cursor, (e) => setShape(e, closeInto));
    cursor.time += openDur;
  }
  at(cursor, (e) => {
    e.Tract.movementSpeed = 24; // back to the baseline set in runGestures, not the library's original default
  });
  cursor.time += 0.04;
}

/** Build one continuous gesture schedule (+ noise-layer events) for a sequence of phonemes. */
export function scheduleUnits(units: Array<ConsonantPhoneme | VowelPhoneme>): { steps: GestureStep[]; noiseEvents: NoiseEvent[]; totalDuration: number } {
  const cursor: Cursor = { time: 0, steps: [], noiseEvents: [] };

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (isVowelUnit(unit)) {
      const isLast = i === units.length - 1;
      scheduleVowel(cursor, unit, isLast ? 0.32 : 0.24);
      continue;
    }

    const next = units[i + 1];
    const closeInto = next ? anticipatedShape(next) : REST_SHAPE;
    const { manner, place, voiced } = unit.features;
    switch (manner) {
      case "stop":
        scheduleStop(cursor, place, voiced, closeInto);
        break;
      case "ejective":
        scheduleEjective(cursor, place, closeInto);
        break;
      case "implosive":
        scheduleImplosive(cursor, place, closeInto);
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
        scheduleTapOrTrill(cursor, place, manner, closeInto);
        break;
    }
  }

  at(cursor, (e) => {
    e.Glottis.isTouched = false;
  });

  return { steps: cursor.steps, noiseEvents: cursor.noiseEvents, totalDuration: cursor.time };
}
