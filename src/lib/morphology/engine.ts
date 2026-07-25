// Client/server boundary, made explicit in one place — same rationale as
// src/lib/lexicon/engine.ts. Only pure, zero-Convex-import modules from
// convex/morphology/* are re-exported here; UI components import from here.

export {
  buildAffixForm,
  generateMorphology,
  generateTypologyPreview,
  regenerateSingleItem,
  suggestTypology,
} from "../../../convex/morphology/generate";
export { CATEGORY_CATALOG, CATEGORY_MAP } from "../../../convex/morphology/content";
export { DEFAULT_MORPHOLOGY_PARAMS, MORPHOLOGICAL_TYPES } from "../../../convex/morphology/types";

export type { GenerateMorphologyResult, TypologyPreviewExample } from "../../../convex/morphology/generate";
export type {
  AffixSlot,
  AffixValueRef,
  CategoryDef,
  CategoryId,
  CategoryValue,
  GrammaticalDomain,
  MorphologicalType,
  MorphologyAffixData,
  MorphologyParams,
  MorphologyStageData,
} from "../../../convex/morphology/types";
