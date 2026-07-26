// Client-only wrapper around @seansleblanc/pink-trombone — a true
// articulatory (physical vocal-tract waveguide) model, not a trained voice
// or a filtered-noise approximation. It self-initializes a real AudioContext
// and attaches document listeners at *import* time, so this module must
// NEVER be imported eagerly anywhere that could run during SSR — only ever
// loaded lazily, inside a call that only happens client-side after a user
// gesture (a phoneme play button click).
//
// It's also a single continuous voice (a real singleton, not something you
// can instantiate multiple of) — "playing a phoneme" here means driving
// that one voice through a scripted sequence of articulatory gestures over
// time, not scheduling independent one-shot sounds the way the old
// formant/noise synthesis did.

import { REST_SHAPE } from "./articulation";

export interface PinkTromboneModule {
  AudioSystem: {
    audioContext: AudioContext;
    started: boolean;
    scriptProcessor: ScriptProcessorNode;
    startSound: () => void;
    /**
     * Inserted by loadEngine() between scriptProcessor and destination.
     * Glottis.intensity/UITenseness/UIFrequency are plain numbers read live
     * per-sample, not real AudioParams — there's nothing to
     * linearRampToValueAtTime on the engine itself. This gain node is the
     * one place we DO have a real AudioParam, so consonant scheduling
     * (articulation.ts) fades through it to mask the hard Glottis.intensity
     * writes voiceless closures still need for correctness (see that file's
     * fadeGlottisOut/In usage).
     */
    masterGain: GainNode;
  };
  Glottis: {
    isTouched: boolean;
    UIFrequency: number;
    UITenseness: number;
    vibratoAmount: number;
    /** Ramps toward 0 at ~0.05/block (≈230ms) when not touched — far slower than most consonant durations, so voiceless segments must zero this directly rather than rely on decay (see articulation.ts). */
    intensity: number;
    /** Resolved per-glottal-cycle pitch (Hz), set by setupWaveform from the block-rate oldFrequency/newFrequency crossfade. */
    frequency: number;
    /**
     * Block-rate (~11.6ms) smoothed approach toward UIFrequency — finishBlock
     * moves this at most ×1.1 (or /1.1) per block rather than snapping, so
     * a UIFrequency change several times the current value away (e.g. the
     * vendor's own 140Hz default vs. this engine's ~205Hz target register)
     * takes multiple blocks to actually arrive. oldFrequency/newFrequency
     * are the same block-rate crossfade's endpoints, read by setupWaveform.
     * None of the three are reset by runGestures on their own — see its
     * comment for why that made playback itself non-deterministic.
     */
    smoothFrequency: number;
    oldFrequency: number;
    newFrequency: number;
    /** Same block-rate smoothing as smoothFrequency, but for UITenseness — see finishBlock's oldTenseness/newTenseness crossfade. */
    oldTenseness: number;
    newTenseness: number;
    /** 1/frequency — read by runStep to detect the next cycle boundary. */
    waveformLength: number;
    /** Seconds since this voice started; the vendor's own vibrato uses it as a phase clock, and so does our jitter/shimmer wrapper (see attachCycleNaturalness). */
    totalTime: number;
    /** Pure per-cycle output multiplier, declared by the vendor but never otherwise written to — repurposed by attachCycleNaturalness as the shimmer/energy-drift hook. */
    loudness: number;
    /** Vendor per-cycle hook, called fresh every time a new glottal pulse begins — wrapped by attachCycleNaturalness to layer in jitter/shimmer the vendor doesn't otherwise provide. */
    setupWaveform: (lambda: number) => void;
  };
  Tract: {
    n: number;
    diameter: Float64Array;
    restDiameter: Float64Array;
    targetDiameter: Float64Array;
    velumTarget: number;
    movementSpeed: number;
  };
}

// The vendor engine's own "vibrato" (Glottis.finishBlock, block-rate) is a
// slow correlated wander — a sinusoid plus simplex noise sampled at slow
// time-scales, so adjacent cycles drift together. That reads as vibrato, not
// jitter/shimmer: real jitter/shimmer is independent, roughly uncorrelated
// variation from ONE glottal cycle to the NEXT, which needs a hook at cycle
// granularity. setupWaveform is that hook (the vendor calls it fresh every
// time a new pulse begins, from Glottis.runStep) — nothing else outside its
// closed per-sample loop runs at the right rate. Amounts are deliberately
// small: research on synthetic voice naturalness ratings, and the zakaton
// fork this project has referenced before for other tuning (Tangle
// project:conlanglab / topic:pink-trombone), both note that too much
// shimmer/jitter reads as harsh/pathological, while zero reads as dead — a
// pure tone with no cycle-to-cycle variation is exactly what a sustained
// vowel test isn't supposed to sound like.
const JITTER_AMOUNT = 0.006; // ~0.6% of the period, independent per cycle
const SHIMMER_AMOUNT = 0.025; // ~2.5% amplitude, independent per cycle
const ENERGY_DRIFT_AMOUNT = 0.04; // slow overall loudness wander, on top of shimmer
const ENERGY_DRIFT_HZ = 0.3;

function attachCycleNaturalness(engine: PinkTromboneModule): void {
  const glottis = engine.Glottis;
  const original = glottis.setupWaveform.bind(glottis);
  glottis.setupWaveform = (lambda: number) => {
    original(lambda);
    // Re-perturb frequency AFTER the vendor's own smooth block-rate value is
    // set, so this jitter doesn't get smoothed away with it — each cycle
    // gets its own independent nudge instead of inheriting the previous
    // cycle's.
    glottis.frequency *= 1 + JITTER_AMOUNT * (Math.random() * 2 - 1);
    glottis.waveformLength = 1 / glottis.frequency;
    const energyDrift = 1 + ENERGY_DRIFT_AMOUNT * Math.sin(2 * Math.PI * glottis.totalTime * ENERGY_DRIFT_HZ);
    glottis.loudness = energyDrift * (1 + SHIMMER_AMOUNT * (Math.random() * 2 - 1));
  };
}

let modulePromise: Promise<PinkTromboneModule> | null = null;

function loadEngine(): Promise<PinkTromboneModule> {
  if (typeof window === "undefined") return Promise.reject(new Error("Pink Trombone is client-only"));
  if (!modulePromise) {
    modulePromise = import("@seansleblanc/pink-trombone").then((mod) => {
      const engine = mod as unknown as PinkTromboneModule;
      // Bypass the library's own pointerup/keydown "unmute" gate — that's an
      // autoplay-policy workaround for the case where sound starts with no
      // prior interaction. Every call into this module already originates
      // from a real click (a phoneme play button), so the gesture
      // requirement is already satisfied; wiring into their gate would just
      // add an extra layer of indirection for no benefit.
      engine.AudioSystem.started = true;
      engine.AudioSystem.startSound();
      // The vendor engine wires scriptProcessor straight to destination —
      // splice a gain node in between so we have one real AudioParam to
      // automate (see the masterGain field comment above).
      const masterGain = engine.AudioSystem.audioContext.createGain();
      engine.AudioSystem.scriptProcessor.disconnect();
      engine.AudioSystem.scriptProcessor.connect(masterGain);
      masterGain.connect(engine.AudioSystem.audioContext.destination);
      engine.AudioSystem.masterGain = masterGain;
      attachCycleNaturalness(engine);
      return engine;
    });
  }
  return modulePromise;
}

// ~8ms is long enough for a linear ramp to mask the sample-level jump a
// direct Glottis.intensity=0 write would otherwise cause (intensity has no
// crossfade of its own — it's multiplied straight into the output every
// sample), short enough to disappear inside any real consonant's duration.
const DECLICK_SECONDS = 0.008;

function rampMasterGain(engine: PinkTromboneModule, target: number, seconds: number): void {
  const ctx = engine.AudioSystem.audioContext;
  const gainParam = engine.AudioSystem.masterGain.gain;
  const now = ctx.currentTime;
  gainParam.cancelScheduledValues(now);
  gainParam.setValueAtTime(gainParam.value, now);
  gainParam.linearRampToValueAtTime(target, now + seconds);
}

/** Ramp the tract's output toward silence — call this BEFORE hard-zeroing Glottis.intensity so that zeroing happens while output is already inaudible instead of mid-waveform. */
export function fadeGlottisOut(engine: PinkTromboneModule): void {
  rampMasterGain(engine, 0, DECLICK_SECONDS);
}

/** Ramp the tract's output back up — call this at every point voicing resumes, even when the immediately preceding unit didn't mute (cheap no-op if gain is already 1), since scheduling can't know in general what came before. */
export function fadeGlottisIn(engine: PinkTromboneModule): void {
  rampMasterGain(engine, 1, DECLICK_SECONDS);
}

/** Seconds to delay a hard Glottis.intensity=0 write after calling fadeGlottisOut, so the zero lands after the fade completes. */
export const GLOTTIS_MUTE_DELAY = DECLICK_SECONDS;

export interface GestureStep {
  /** Seconds from the start of this gesture sequence. */
  at: number;
  apply: (engine: PinkTromboneModule) => void;
}

let pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

function clearPending(): void {
  for (const id of pendingTimeouts) clearTimeout(id);
  pendingTimeouts = [];
}

/**
 * Run a scripted sequence of articulatory gestures against the single
 * shared voice. A new call interrupts whatever the previous one was doing
 * — there's only one voice, so overlapping playback isn't meaningful here
 * the way it was with independently-scheduled one-shot nodes.
 */
export async function runGestures(steps: GestureStep[]): Promise<PinkTromboneModule> {
  const engine = await loadEngine();
  clearPending();
  void engine.AudioSystem.audioContext.resume();
  engine.Glottis.isTouched = false;
  // The library's default (15) is tuned for continuous mouse-drag input,
  // where the target is always nearby. Our gestures jump between much
  // larger, more distant targets (full closure → open vowel), so at the
  // default speed the tract never actually caught up before the next
  // gesture yanked it somewhere else — audibly "loose," never settling on
  // an articulation. Reset every call in case a trill's temporary boost
  // (see articulation.ts) leaked through.
  engine.Tract.movementSpeed = 24;
  // This is a shared singleton voice (see file header) — without this reset,
  // a new sequence starts moving from whatever shape the PREVIOUS button
  // click happened to leave the tract at, not from silence/rest the way a
  // real isolated utterance would. If that leftover shape was open and the
  // first gesture here is a voiced closure (e.g. a nasal), the audible
  // transition from "wherever it was left open" to "closed" plays as a
  // phantom vowel before the actual first consonant (reported: /mtʃ/ as
  // /ɛmtʃ/). Snapping both diameter and targetDiameter — not just the
  // target — means there's no leftover interpolation to catch either.
  engine.Tract.diameter.set(REST_SHAPE);
  engine.Tract.targetDiameter.set(REST_SHAPE);
  // A prior sequence interrupted mid-voiceless-consonant could leave gain
  // faded down (see fadeGlottisOut) — snap it back immediately, same as the
  // diameter reset above, so a new utterance always starts from a clean
  // deterministic state rather than wherever the last one left off.
  engine.AudioSystem.masterGain.gain.cancelScheduledValues(engine.AudioSystem.audioContext.currentTime);
  engine.AudioSystem.masterGain.gain.value = 1;
  // Same "shared singleton voice" reasoning as the diameter/gain resets
  // above, extended to pitch/tenseness/intensity — three MORE fields the
  // vendor smooths at block rate (~11.6ms) rather than snapping to their
  // target (see the Glottis type's own comments), that setting
  // UIFrequency/UITenseness alone doesn't touch. Left unreset, a fresh page
  // load starts from the vendor's own defaults (140Hz/0.6 tenseness/0
  // intensity) and audibly ramps toward this engine's actual ~205Hz voiced
  // register and full intensity over the first ~50-90ms — while every
  // replay after that inherits whatever the PREVIOUS play's last segment
  // left behind (already close to target) and starts instantly instead.
  // Same phoneme sequence, audibly different first play vs. every play
  // after — reported directly (a click right after refresh sounds
  // different from every click after that). 205 mirrors articulation.ts's
  // VOICED_PITCH and 0.6 its NEUTRAL_TENSENESS (not imported directly —
  // that file already imports FROM this one, and this module stays
  // phoneme-model-agnostic).
  engine.Glottis.smoothFrequency = 205;
  engine.Glottis.oldFrequency = 205;
  engine.Glottis.newFrequency = 205;
  engine.Glottis.oldTenseness = 0.6;
  engine.Glottis.newTenseness = 0.6;
  engine.Glottis.intensity = 1;
  for (const step of steps) {
    const id = setTimeout(() => step.apply(engine), Math.max(0, step.at * 1000));
    pendingTimeouts.push(id);
  }
  return engine;
}
