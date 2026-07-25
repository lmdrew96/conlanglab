// Client/server boundary, made explicit in one place — same rationale as
// src/lib/lexicon/engine.ts. Only pure, zero-Convex-import modules from
// convex/morphology/* are re-exported here; UI components import from here.

export {
  applyAffixesToRoot,
  buildAffixForm,
  buildAllomorphy,
  dedupeAffixesByCategorySignature,
  generateMorphology,
  generateTypologyPreview,
  regenerateSingleItem,
  suggestTypology,
} from "../../../convex/morphology/generate";
export { CATEGORY_CATALOG, CATEGORY_MAP, DERIVATIONAL_RULE_CATALOG } from "../../../convex/morphology/content";
export { DEFAULT_MORPHOLOGY_PARAMS, MORPHOLOGICAL_TYPES } from "../../../convex/morphology/types";

export type { AssembledWord, GenerateMorphologyResult, RootLike, TypologyPreviewExample } from "../../../convex/morphology/generate";
export type {
  AffixStrategy,
  AffixValueRef,
  AllomorphyData,
  CategoryDef,
  CategoryId,
  CategoryValue,
  DerivationalAffixData,
  GrammaticalDomain,
  MorphologicalType,
  MorphologyAffixData,
  MorphologyParams,
  MorphologyStageData,
  SuppletionData,
} from "../../../convex/morphology/types";
