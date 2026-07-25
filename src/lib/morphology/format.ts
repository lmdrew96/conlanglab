import { CATEGORY_MAP } from "./engine";
import type {
  AffixStrategy,
  AffixValueRef,
  CategoryId,
  DerivationalAffixData,
  GrammaticalDomain,
  MorphologicalType,
  MorphologyAffixData,
} from "./engine";

const TYPOLOGY_LABELS: Record<MorphologicalType, string> = {
  isolating: "Isolating",
  agglutinative: "Agglutinative",
  fusional: "Fusional",
  polysynthetic: "Polysynthetic",
};

const TYPOLOGY_INFO: Record<MorphologicalType, string> = {
  isolating: "Little to no bound morphology — grammatical meaning stays close to bare roots, marked sparingly if at all.",
  agglutinative: "One affix per grammatical category, chained together with a clear 1:1 form-meaning mapping.",
  fusional: "A single affix simultaneously encodes multiple categories at once (e.g. case + number fused into one ending).",
  polysynthetic: "Many categories marked per word, heavy on agreement. Non-linear strategies and noun incorporation arrive in M4.",
};

export function formatTypology(typology: MorphologicalType): string {
  return TYPOLOGY_LABELS[typology] ?? typology;
}

export function typologyInfo(typology: MorphologicalType): string {
  return TYPOLOGY_INFO[typology] ?? "";
}

const DOMAIN_LABELS: Record<GrammaticalDomain, string> = {
  nominal: "Nominal",
  verbal: "Verbal",
};

export function formatDomain(domain: GrammaticalDomain): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function formatCategoryLabel(categoryId: CategoryId): string {
  return CATEGORY_MAP.get(categoryId)?.label ?? categoryId;
}

const STRATEGY_LABELS: Record<AffixStrategy, string> = {
  prefix: "Prefix",
  suffix: "Suffix",
  infix: "Infix",
  circumfix: "Circumfix",
  reduplicationFull: "Full reduplication",
  reduplicationPartial: "Partial reduplication",
  ablaut: "Ablaut",
  templatic: "Templatic",
};

export function formatStrategy(strategy: AffixStrategy): string {
  return STRATEGY_LABELS[strategy] ?? strategy;
}

/** Resolves a phoneme id to its IPA symbol for display — used by ablaut/templatic, which store phoneme ids rather than a precomputed form string (their surface form depends on whichever root they attach to). Falls back to "?" if the language's inventory has since changed (Section 10.2a staleness — same "regenerate to fix" contract as playback). */
function resolveIpa(phonemeId: string, phonology: { consonants: Array<{ id: string; ipa: string }>; vowels: Array<{ id: string; ipa: string }> }): string {
  return phonology.consonants.find((p) => p.id === phonemeId)?.ipa ?? phonology.vowels.find((p) => p.id === phonemeId)?.ipa ?? "?";
}

/**
 * Renders an affix's form using the notational convention for its strategy
 * — a hyphen on the attaching side for prefix/suffix (e.g. "-ta"/"ta-"),
 * angle brackets for an infix, both pieces for a circumfix, a RED- tag for
 * reduplication (its actual copied material is root-dependent, computed at
 * apply-time — see convex/morphology/generate.ts's applyAffixesToRoot), and
 * an arrow notation for ablaut/templatic's vowel change.
 */
export function formatAffixForm(
  item: MorphologyAffixData,
  phonology: { consonants: Array<{ id: string; ipa: string }>; vowels: Array<{ id: string; ipa: string }> },
): string {
  switch (item.strategy) {
    case "prefix":
      return `${item.form}-`;
    case "suffix":
      return `-${item.form}`;
    case "infix":
      return `-⟨${item.form}⟩-`;
    case "circumfix":
      return `${item.form}- -${item.circumfixClosing ?? ""}`;
    case "reduplicationFull":
      return item.reduplicationPlacement === "after" ? "-RED" : "RED-";
    case "reduplicationPartial": {
      const shape = (item.reduplicationShape ?? ["C", "V"]).join("");
      return item.reduplicationPlacement === "after" ? `-${shape}~` : `~${shape}-`;
    }
    case "ablaut":
      return item.ablautFrom && item.ablautTo
        ? `${resolveIpa(item.ablautFrom, phonology)}→${resolveIpa(item.ablautTo, phonology)}`
        : "ablaut";
    case "templatic":
      return item.templaticMelody && item.templaticMelody.length > 0
        ? `C_${item.templaticMelody.map((id) => resolveIpa(id, phonology)).join("_")}`
        : "templatic";
  }
}

/** Same hyphen convention as formatAffixForm's prefix/suffix cases — derivational affixes are linear-only (Section 5.5's v1 scope, see DerivationalAffixData). */
export function formatDerivationalAffixForm(item: DerivationalAffixData): string {
  return item.slot === "prefix" ? `${item.form}-` : `-${item.form}`;
}

export function formatCategoryList(categories: CategoryId[]): string {
  return categories.map(formatCategoryLabel).join(" + ");
}

/** Plain-English text for one (category, value) pair, e.g. {category:"number",value:"plural"} → "Plural". Falls back to the raw value id if the catalog entry can't be found (shouldn't happen for real data). */
export function formatValueLabel(ref: AffixValueRef): string {
  return CATEGORY_MAP.get(ref.category)?.values.find((v) => v.id === ref.value)?.label ?? ref.value;
}

/** Plain-English text for a set of (category, value) pairs, e.g. an affix's or a preview word's marked values → "Plural, Class I". This is the primary, default-visible text — see `formatLeipzigGloss` for the technical abbreviation form (secondary/tooltip use only, e.g. future academic PDF export). */
export function formatHumanGloss(values: AffixValueRef[]): string {
  return values.map(formatValueLabel).join(", ");
}

/** Standard Leipzig-glossing abbreviation for a set of (category, value) pairs, e.g. "PL.I". Technical — meant as a small secondary tag for linguist users, not primary UI text (that's `formatHumanGloss`). */
export function formatLeipzigGloss(values: AffixValueRef[]): string {
  return values
    .map((ref) => CATEGORY_MAP.get(ref.category)?.values.find((v) => v.id === ref.value)?.gloss ?? ref.value)
    .join(".");
}
