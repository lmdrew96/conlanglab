// Section 4.3: Sonority Sequencing Principle as the default elegance grader.
// Sonority-violating clusters are suppressed by default, never banned
// outright — an explicit violationRate lets a user deliberately choose a
// harsher cluster inventory rather than getting one by generation noise.

import type { ConsonantManner, ConsonantPhoneme, SonorityGradingData, SonorityScale } from "./types";

/** Canonical scale: obstruents < nasals < liquids < glides. Higher = more sonorous. */
export const DEFAULT_SONORITY_SCALE: SonorityScale = {
  stop: 1,
  affricate: 1,
  click: 1,
  ejective: 1,
  implosive: 1,
  fricative: 2,
  lateralFricative: 2,
  nasal: 3,
  trill: 4,
  tap: 4,
  lateralApproximant: 4,
  approximant: 5,
};

export function defaultSonorityGrading(): SonorityGradingData {
  return {
    scaleRank: DEFAULT_SONORITY_SCALE,
    allowViolations: false,
    violationRate: 0,
    locked: false,
  };
}

function rankOf(manner: ConsonantManner, scale: SonorityScale): number {
  return scale[manner];
}

/**
 * Grade a consonant cluster against SSP. Onset clusters must rise (or hold
 * flat) in sonority toward the nucleus; coda clusters must fall (or hold
 * flat) moving away from it. Both are read left-to-right in the order the
 * phonemes actually appear in the string, with the nucleus vowel implicitly
 * adjacent to the *last* element of an onset and the *first* element of a coda.
 */
export function gradeCluster(
  phonemes: ConsonantPhoneme[],
  position: "onset" | "coda",
  scale: SonorityScale,
): "elegant" | "violation" {
  if (phonemes.length <= 1) return "elegant";
  const ranks = phonemes.map((p) => rankOf(p.features.manner, scale));
  if (position === "onset") {
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] < ranks[i - 1]) return "violation";
    }
  } else {
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] > ranks[i - 1]) return "violation";
    }
  }
  return "elegant";
}
