// Client/server boundary, made explicit in one place — same rationale as
// src/lib/syntax/engine.ts. Only pure, zero-Convex-import modules from
// convex/translate/* are re-exported here; UI components import from here,
// not from convex/translate/* directly.

export { buildGlossIndex, translate } from "../../../convex/translate/translate";
export { STARTER_PHRASES } from "../../../convex/translate/content";

export type {
  DetectedFeature,
  GlossIndex,
  TranslateArgs,
  TranslatedSentence,
  TranslatedWord,
  TranslationResult,
  WordRole,
} from "../../../convex/translate/translate";
