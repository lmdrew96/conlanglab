import { CATEGORY_MAP } from "./engine";
import type { AffixValueRef, CategoryId, GrammaticalDomain, MorphologicalType, MorphologyAffixData } from "./engine";

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

/** Renders an affix's raw IPA form with a hyphen on the attaching side, e.g. "-ta" for a suffix, "ta-" for a prefix. */
export function formatAffixForm(item: MorphologyAffixData): string {
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
