// Click-to-preview audio for lexicon roots — reuses the phonology engine's
// audio player as-is (same Pink Trombone articulatory model, same
// scheduleUnits/playSequence). The only new piece here is resolving a
// root's flat `phonemeIds` (design doc Section 10.2a — stored precisely so
// staleness can be detected) back into real phoneme objects via the
// language's current inventory.

import { playSequence } from "@/lib/phonology/audio";
import type { ConsonantPhoneme, PhonologyData, VowelPhoneme } from "@/lib/phonology/engine";

/**
 * Resolve a root's phoneme-id sequence against the current phonology
 * inventory. Returns null if any id can't be found — a root goes stale
 * (Section 10.2a) precisely when this would happen, so callers can use a
 * failed resolution as "don't offer playback until this is regenerated"
 * without a separate check.
 */
export function resolveRootPhonemes(
  phonemeIds: string[],
  phonology: PhonologyData,
): Array<ConsonantPhoneme | VowelPhoneme> | null {
  const byId = new Map<string, ConsonantPhoneme | VowelPhoneme>();
  for (const c of phonology.consonants) byId.set(c.id, c);
  for (const v of phonology.vowels) byId.set(v.id, v);

  const resolved: Array<ConsonantPhoneme | VowelPhoneme> = [];
  for (const id of phonemeIds) {
    const phoneme = byId.get(id);
    if (!phoneme) return null;
    resolved.push(phoneme);
  }
  return resolved;
}

/** Resolve and play a root in one call. Returns false (and plays nothing) if any phoneme couldn't be resolved. */
export function playRoot(phonemeIds: string[], phonology: PhonologyData): boolean {
  const resolved = resolveRootPhonemes(phonemeIds, phonology);
  if (!resolved) return false;
  playSequence(resolved);
  return true;
}
