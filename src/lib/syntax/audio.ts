// Click-to-preview audio for full example sentences — reuses the phonology
// engine's audio player, same rationale as src/lib/lexicon/audio.ts and
// src/lib/morphology/audio.ts. The new piece here is playWordSequence
// (phonology/audio.ts), which sequences MULTIPLE words back to back as one
// utterance instead of a single word/phoneme.

import { playWordSequence } from "@/lib/phonology/audio";
import { resolveRootPhonemes } from "@/lib/lexicon/audio";
import type { ConsonantPhoneme, PhonologyData, VowelPhoneme } from "@/lib/phonology/engine";
import type { ExampleWord } from "./engine";

/**
 * Resolve and play every word of an example phrase in sequence. Returns
 * false (and plays nothing) if ANY word's phonemes can't be resolved
 * against the current inventory — same "stale means no playback" contract
 * as playRoot, extended to the whole phrase since a sentence with one
 * silently-missing word would be a worse experience than no playback.
 */
export async function playExamplePhrase(words: ExampleWord[], phonology: PhonologyData): Promise<boolean> {
  const resolvedPhonemes = words.map((w) => resolveRootPhonemes(w.phonemeIds, phonology));
  if (resolvedPhonemes.some((p) => p === null)) return false;

  const items = words.map((w, i) => ({
    phonemes: resolvedPhonemes[i] as Array<ConsonantPhoneme | VowelPhoneme>,
    stressedIndex: w.stressedPhonemeIndex,
  }));
  return playWordSequence(items);
}
