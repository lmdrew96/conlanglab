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

export interface PinkTromboneModule {
  AudioSystem: {
    audioContext: AudioContext;
    started: boolean;
    scriptProcessor: ScriptProcessorNode;
    startSound: () => void;
  };
  Glottis: {
    isTouched: boolean;
    UIFrequency: number;
    UITenseness: number;
    vibratoAmount: number;
    /** Ramps toward 0 at ~0.05/block (≈230ms) when not touched — far slower than most consonant durations, so voiceless segments must zero this directly rather than rely on decay (see articulation.ts). */
    intensity: number;
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
      return engine;
    });
  }
  return modulePromise;
}

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
  for (const step of steps) {
    const id = setTimeout(() => step.apply(engine), Math.max(0, step.at * 1000));
    pendingTimeouts.push(id);
  }
  return engine;
}
