// Click-to-preview audio for affixes — reuses the phonology engine's audio
// player as-is, same rationale as src/lib/lexicon/audio.ts. Affixes carry
// no stress mark of their own (word-level stress is a whole-word concern,
// out of scope until affixes actually attach to real words in a later
// milestone), so playback is uniform-timing, unlike playRoot.

import { playSequence } from "@/lib/phonology/audio";
import { resolveRootPhonemes } from "@/lib/lexicon/audio";
import type { PhonologyData } from "@/lib/phonology/engine";

/** Resolve and play an affix in one call. Returns false (and plays nothing) if any phoneme couldn't be resolved — same "stale means no playback" contract as playRoot. */
export function playAffix(phonemeIds: string[], phonology: PhonologyData): boolean {
  const resolved = resolveRootPhonemes(phonemeIds, phonology);
  if (!resolved) return false;
  playSequence(resolved);
  return true;
}
