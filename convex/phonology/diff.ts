import { diffAtomic, diffKeyedArray, type DiffOp } from "../lib/history";
import type { PhonologyData } from "./types";

export function diffPhonology(prev: PhonologyData, next: PhonologyData): DiffOp[] {
  return [
    ...diffKeyedArray(prev.consonants, next.consonants, "consonants"),
    ...diffKeyedArray(prev.vowels, next.vowels, "vowels"),
    ...diffAtomic(prev.phonotactics, next.phonotactics, "phonotactics"),
    ...diffAtomic(prev.sonorityGrading, next.sonorityGrading, "sonorityGrading"),
    ...diffAtomic(prev.stress, next.stress, "stress"),
    ...diffAtomic(prev.tone, next.tone, "tone"),
    ...diffAtomic(prev.params, next.params, "params"),
    ...diffAtomic(prev.seed, next.seed, "seed"),
  ];
}
