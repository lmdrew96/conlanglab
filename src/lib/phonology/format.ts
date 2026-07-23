import type { StressPattern } from "./engine";

const PLACE_LABELS: Record<string, string> = {
  bilabial: "Bilabial",
  labiodental: "Labiodental",
  dental: "Dental",
  alveolar: "Alveolar",
  postalveolar: "Postalveolar",
  retroflex: "Retroflex",
  palatal: "Palatal",
  velar: "Velar",
  uvular: "Uvular",
  pharyngeal: "Pharyngeal",
  glottal: "Glottal",
};

const MANNER_LABELS: Record<string, string> = {
  stop: "Stop",
  nasal: "Nasal",
  fricative: "Fricative",
  affricate: "Affricate",
  approximant: "Approximant",
  lateralApproximant: "Lateral approximant",
  trill: "Trill",
  tap: "Tap",
  lateralFricative: "Lateral fricative",
  click: "Click",
  ejective: "Ejective",
  implosive: "Implosive",
};

export function formatPlace(place: string): string {
  return PLACE_LABELS[place] ?? place;
}

export function formatManner(manner: string): string {
  return MANNER_LABELS[manner] ?? manner;
}

const STRESS_LABELS: Record<StressPattern, string> = {
  initial: "Initial (first syllable)",
  final: "Final (last syllable)",
  penultimate: "Penultimate (second-to-last)",
  weightSensitive: "Weight-sensitive (heavy syllables attract stress)",
  none: "No stress",
};

export function formatStressPattern(pattern: StressPattern): string {
  return STRESS_LABELS[pattern];
}
