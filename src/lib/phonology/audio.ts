// Client-only phoneme audio playback. Vowels, stops, nasals, approximants,
// and taps/trills are driven by a real articulatory physical model (Pink
// Trombone — a vocal-tract waveguide, not a trained voice or a filtered-
// noise approximation; see pink-trombone-engine.ts + articulation.ts).
//
// Fricative/click frication noise is layered in separately using a
// noise-burst synth: @seansleblanc/pink-trombone's Tract.runStep accepts a
// turbulenceNoise parameter but never actually uses it (verified by reading
// the source), so narrowing the tract alone produces no hiss. This is a
// deliberate hybrid, not a fallback — the tract still shapes the resonance
// correctly during a fricative, this just supplies the noise component it's
// missing.

import type { ConsonantPhoneme, ConsonantPlace, VowelPhoneme } from "../../../convex/phonology/types";
import { scheduleUnits } from "./articulation";
import { runGestures } from "./pink-trombone-engine";

// --- Fricative/click noise layer (retained from the previous engine — tuned across several rounds) ---

const FRICATIVE_HZ: Record<ConsonantPlace, number> = {
  bilabial: 1000,
  // Was 7600 — that high and this narrow (non-sibilant Q, see
  // playFricativeNoise) read as a thin high-pitched whistle rather than a
  // diffuse "fffff" hiss. Real /f/ noise is weak and spread out with no
  // strong peak in the first place; 5000 keeps it a touch brighter than
  // dental (they're famously hard to tell apart acoustically anyway)
  // without landing in whistle territory.
  labiodental: 5000,
  dental: 4800,
  // Was 6500 — real measured /s,z/ spectral peaks (Jongman, Wayland & Wong
  // 2000, the standard reference for this) center around 4-5kHz, not
  // 6.5kHz. postalveolar's 3000 already lands right on their measured
  // ʃ/ʒ peak (~2.5-3kHz) — no change needed there.
  alveolar: 5000,
  postalveolar: 3000,
  retroflex: 2800,
  palatal: 3200,
  velar: 2000,
  uvular: 1300,
  pharyngeal: 1000,
  // Was 4000 — /h/ now gets its primary "breathy" texture from the tract's
  // own aspiration term (see scheduleFricative's isGlottal branch); this
  // external layer is just a quiet supplementary texture underneath, so it's
  // pulled down and warmed up (see the reduced peak in playFricativeNoise
  // too) instead of being the dominant bright "static" layer it used to be.
  glottal: 2400,
};

/** Where a voiceless stop's release burst is spectrally centered — same table shape as the old formant-synth engine's, reintroduced because the tract model's own transient turned out too weak to tell places apart by ear. */
const BURST_HZ: Record<ConsonantPlace, number> = {
  // bilabial's 700 and velar's 1800 (below) already land right in published
  // ranges (~600-800Hz and ~1800-2000Hz respectively — see Macquarie
  // University's oral-stops acoustics reference) — no change needed there.
  bilabial: 700,
  labiodental: 1100,
  dental: 1400,
  // Was 3700 — real /t,d/ burst energy sits above 4000Hz (same high-frequency
  // region as /s/'s burst spectrum), not below it.
  alveolar: 4200,
  postalveolar: 2600,
  retroflex: 2200,
  palatal: 2700,
  velar: 1800,
  uvular: 1000,
  pharyngeal: 900,
  glottal: 1500,
};

/**
 * True sibilants (s,z,ʃ,ʒ...) have a real, strong, narrow resonant peak —
 * the tongue channels air through a groove, producing genuine acoustic
 * focus. Non-sibilant fricatives (θ,f,v,h,x...) are just diffuse turbulence
 * with no comparable peak. The Q gap between the two needs to be large to
 * read as a real category difference, not a subtle EQ tilt — the previous,
 * much smaller gap (1.5 vs 1.8) is why θ/f were indistinguishable from s.
 */
const SIBILANT_PLACES = new Set<ConsonantPlace>(["alveolar", "postalveolar", "retroflex"]);

function whiteNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function envelope(gainNode: GainNode, startAt: number, dur: number, peak: number): void {
  const attack = Math.min(0.02, dur * 0.3);
  const release = Math.min(0.05, dur * 0.3);
  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(peak, startAt + attack);
  gainNode.gain.setValueAtTime(peak, startAt + dur - release);
  gainNode.gain.linearRampToValueAtTime(0, startAt + dur);
}

/** See prior tuning notes: pre-roll lets a resonant filter settle before the envelope opens (avoids a "click"/"fuzz" transient), and the cascade+ceiling stops raw white noise's energy above ~10kHz reading as "static." */
const FILTER_PRE_ROLL = 0.04;

function playNoiseBurst(ctx: AudioContext, dest: AudioNode, centerHz: number, q: number, startAt: number, dur: number, peak: number): void {
  const noiseStart = Math.max(0, startAt - FILTER_PRE_ROLL);
  const noise = ctx.createBufferSource();
  noise.buffer = whiteNoiseBuffer(ctx, startAt - noiseStart + dur + 0.02);

  const bp1 = ctx.createBiquadFilter();
  bp1.type = "bandpass";
  bp1.frequency.value = centerHz;
  bp1.Q.value = q;
  const bp2 = ctx.createBiquadFilter();
  bp2.type = "bandpass";
  bp2.frequency.value = centerHz;
  bp2.Q.value = q;
  const ceiling = ctx.createBiquadFilter();
  ceiling.type = "lowpass";
  ceiling.frequency.value = 9000;
  ceiling.Q.value = 0.5;

  const env = ctx.createGain();
  // Without this, the gain param has no automation before `startAt` and
  // holds its default value (1, i.e. full volume) for the entire pre-roll —
  // verified by rendering this exact chain offline: the pre-roll played at
  // gain 1 (louder than even the loudest peak here, 0.75), then hard-cut to
  // 0 right at the intended attack instead of fading in. That's an audible
  // burst-then-click before every fricative/stop/click's real onset, which
  // is exactly what read as hissy/buzzy and smeared clusters together.
  env.gain.setValueAtTime(0, noiseStart);
  envelope(env, startAt, dur, peak);
  noise.connect(bp1);
  bp1.connect(bp2);
  bp2.connect(ceiling);
  ceiling.connect(env);
  env.connect(dest);
  noise.start(noiseStart);
  noise.stop(startAt + dur + 0.02);
}

// The frication noise recipe no longer varies by voicing at all — voiced
// fricatives got their own Q/gain treatment across a few tuning rounds to
// try to cut through the tract's simultaneous voiced resonance, but that
// was solving the wrong problem. The tract is now silenced for every
// fricative regardless of voicing (see scheduleFricative) and voicing is
// supplied separately below (playVoiceHum) — so voiced and voiceless
// versions of the same place should just be this same noise, one with a hum
// under it and one without. Same recipe that already made s/f sound right.
function playFricativeNoise(ctx: AudioContext, dest: AudioNode, place: ConsonantPlace, startAt: number, dur: number): void {
  const isSibilant = SIBILANT_PLACES.has(place);
  const q = isSibilant ? 2.6 : 0.6;
  // Glottal gets a quieter external layer than other non-sibilants — it's a
  // supplement to the tract-driven aspiration now (scheduleFricative), not
  // the whole sound, so it shouldn't compete with that for presence.
  const peak = isSibilant ? 0.42 : place === "glottal" ? 0.12 : 0.22;
  playNoiseBurst(ctx, dest, FRICATIVE_HZ[place], q, startAt, dur, peak);
}

/**
 * Voicing for a voiced fricative — deliberately NOT routed through the
 * physical tract model. A resonating tract (even quieted) has an inherent
 * timbre that reads as a glide/approximant no matter its volume, because
 * "voiced + narrow oral resonance" *is* what that sounds like. This is the
 * same simple, decoupled low hum the pre-Pink-Trombone engine used
 * successfully — just a low oscillator, no articulatory resonance to fight.
 */
function playVoiceHum(ctx: AudioContext, dest: AudioNode, startAt: number, dur: number): void {
  const osc = ctx.createOscillator();
  osc.type = "triangle"; // sawtooth's dense harmonics were what read as "buzz" in earlier tuning rounds — triangle's fall off much faster
  // A dead-flat oscillator was itself the remaining "buzz" — every other
  // voiced source in this engine (the glottal tract model, via
  // attachCycleNaturalness in pink-trombone-engine.ts) has cycle-to-cycle
  // jitter/shimmer; this hum had none, so it read as the one perfectly
  // mechanical tone in an otherwise natural voice. Same small magnitudes as
  // that jitter/shimmer.
  osc.frequency.value = 110 * (1 + (Math.random() - 0.5) * 0.012);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  // Was 220 — right at the 2nd harmonic of a 110Hz fundamental, letting
  // enough of it through to add a buzzy edge instead of a warm hum. 165
  // sits between the fundamental and that harmonic, damping the harmonic
  // further without dulling the fundamental itself.
  lp.frequency.value = 165;
  lp.Q.value = 0.5;
  const env = ctx.createGain();
  const shimmer = 1 + (Math.random() - 0.5) * 0.05;
  envelope(env, startAt, dur, 0.22 * shimmer);
  osc.connect(lp);
  lp.connect(env);
  env.connect(dest);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

function playStopBurst(ctx: AudioContext, dest: AudioNode, place: ConsonantPlace, startAt: number, dur: number): void {
  playNoiseBurst(ctx, dest, BURST_HZ[place], 1.6, startAt, dur, 0.55);
}

/**
 * Taps/trills had no transient of their own at all (every other manner gets
 * one — see scheduleTapOrTrill's comment) and read as "doesn't sound
 * rhotic," just a soft dip in the tract's own resonance. A tap is a single
 * light touch with no pressure built up behind it the way a stop's closure
 * has, so this reuses the stop's own place-centered frequency (same
 * articulator, same place) but duller (lower Q — less spectrally peaky),
 * quieter, and shorter than playStopBurst, so it reads as a brief contact
 * rather than a released plosive.
 */
function playTapBurst(ctx: AudioContext, dest: AudioNode, place: ConsonantPlace, startAt: number, dur: number): void {
  playNoiseBurst(ctx, dest, BURST_HZ[place], 0.9, startAt, dur, 0.32);
}

/**
 * Ejectives previously reused playStopBurst verbatim, which fixed an old
 * "quieter than /p/" bug but at the cost of making ejectives and plain stops
 * sound identical — same burst, same everything. Real ejectives build oral
 * pressure behind a glottalic closure on top of the oral one, so the release
 * is a harder, brighter, more percussive transient than a pulmonic stop's:
 * higher-Q (sharper focus), shifted up in frequency, louder, and shorter.
 */
function playEjectiveBurst(ctx: AudioContext, dest: AudioNode, place: ConsonantPlace, startAt: number, dur: number): void {
  playNoiseBurst(ctx, dest, BURST_HZ[place] * 1.35, 2.4, startAt, dur * 0.5, 0.95);
}

/**
 * Click place determines the size of the anterior cavity sealed off before
 * release — smaller (further forward) cavities ring brighter, larger
 * (further back) ones ring lower and more resonant. Was a single hardcoded
 * 4500Hz for every place, so dental /ǀ/ and alveolar /ǃ/ (the only two
 * clicks currently in the catalog) were acoustically identical.
 */
const CLICK_HZ: Record<ConsonantPlace, number> = {
  bilabial: 1400,
  labiodental: 1400,
  dental: 6500,
  alveolar: 2200,
  postalveolar: 2000,
  retroflex: 1800,
  palatal: 1600,
  velar: 1400,
  uvular: 1200,
  pharyngeal: 1000,
  glottal: 1000,
};

function playClickNoise(ctx: AudioContext, dest: AudioNode, place: ConsonantPlace, startAt: number): void {
  playNoiseBurst(ctx, dest, CLICK_HZ[place], 0.6, startAt, 0.008, 0.75);
}

// --- Orchestration ---

/** Synthetic neutral vowel appended/prepended around a lone consonant or bare cluster for audio context only — never a claim about the language's actual phonotactics. */
const CONTEXT_SCHWA: VowelPhoneme = {
  id: "_context_schwa",
  ipa: "ə",
  features: { height: "mid", backness: "central", rounded: false },
  tier: "core",
  prerequisites: [],
  locked: false,
};

/**
 * Bumped by every entry point below that starts a new gesture sequence
 * (single phoneme, single word/cluster, or the next word of a
 * playWordSequence loop) — playWordSequence checks this between words so
 * a superseded multi-word loop stops scheduling further words instead of
 * fighting a newer click for the single shared voice (see
 * pink-trombone-engine.ts's "single continuous voice" file header).
 */
let currentPlayId = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function play(units: Array<ConsonantPhoneme | VowelPhoneme>, stressedIndex?: number): Promise<number> {
  const { steps, noiseEvents, totalDuration } = scheduleUnits(units, stressedIndex);
  const engine = await runGestures(steps);
  const ctx = engine.AudioSystem.audioContext;
  // ctx.destination, not scriptProcessor — the processor treats its inputs
  // as algorithm parameters (aspiration/turbulence sources), not a
  // pass-through mix, so this has to join the signal path in parallel at
  // the same point scriptProcessor itself connects to, not feed into it.
  const dest = ctx.destination;
  const startAt = ctx.currentTime;
  for (const event of noiseEvents) {
    if (event.kind === "click") playClickNoise(ctx, dest, event.place, startAt + event.atOffset);
    else if (event.kind === "stopBurst") playStopBurst(ctx, dest, event.place, startAt + event.atOffset, event.dur);
    else if (event.kind === "ejectiveBurst") playEjectiveBurst(ctx, dest, event.place, startAt + event.atOffset, event.dur);
    else if (event.kind === "tapBurst") playTapBurst(ctx, dest, event.place, startAt + event.atOffset, event.dur);
    else {
      playFricativeNoise(ctx, dest, event.place, startAt + event.atOffset, event.dur);
      if (event.voiced) playVoiceHum(ctx, dest, startAt + event.atOffset, event.dur);
    }
  }
  return totalDuration;
}

/** Play a single phoneme (consonant or vowel) immediately. A vowel plays alone; a consonant gets a trailing neutral vowel so the ear hears a real articulatory release instead of an isolated burst. */
export function playPhoneme(phoneme: ConsonantPhoneme | VowelPhoneme): void {
  currentPlayId++;
  const isVowel = "height" in phoneme.features;
  void play(isVowel ? [phoneme] : [phoneme, CONTEXT_SCHWA]);
}

/** Play a sampled syllable or root (always contains at least one real vowel). `stressedIndex` (absolute index into `phonemes`) marks the primary-stressed vowel — see scheduleUnits for how it affects timing/pitch. */
export function playSequence(phonemes: Array<ConsonantPhoneme | VowelPhoneme>, stressedIndex?: number): void {
  currentPlayId++;
  void play(phonemes, stressedIndex);
}

/** Play a bare onset/coda cluster preview — these have no real vowel (see sampleClusters), so a neutral vowel is attached at the edge adjacent to where a syllable nucleus would sit. */
export function playCluster(phonemes: ConsonantPhoneme[], position: "onset" | "coda"): void {
  currentPlayId++;
  void play(position === "onset" ? [...phonemes, CONTEXT_SCHWA] : [CONTEXT_SCHWA, ...phonemes]);
}

/** Seconds of silence between words in playWordSequence — long enough to read as a word boundary, short enough to still sound like one utterance. */
const WORD_GAP_SECONDS = 0.15;

/**
 * Play multiple word-sequences back to back — the first time this engine
 * plays more than one word as a single utterance (Section 7's example
 * sentences). Same single-voice constraint as every other function here:
 * a newer playPhoneme/playSequence/playCluster/playWordSequence call bumps
 * currentPlayId, and this loop checks it between words so a superseded
 * sentence stops scheduling further words instead of fighting a newer
 * click for the voice — plain interruption (like any two rapid single-word
 * clicks already do) isn't enough on its own because this loop's own
 * `await`s would otherwise keep firing more `play()` calls afterward.
 * Resolves true if every word played to completion, false if superseded.
 */
export async function playWordSequence(
  words: Array<{ phonemes: Array<ConsonantPhoneme | VowelPhoneme>; stressedIndex?: number }>,
): Promise<boolean> {
  const playId = ++currentPlayId;
  for (const word of words) {
    if (playId !== currentPlayId) return false;
    const duration = await play(word.phonemes, word.stressedIndex);
    if (playId !== currentPlayId) return false;
    await sleep((duration + WORD_GAP_SECONDS) * 1000);
  }
  return true;
}
