// Client/server boundary, made explicit in one place — same rationale as
// src/lib/phonology/engine.ts. Only pure, zero-Convex-import modules from
// convex/lexicon/* are re-exported here; UI components import from here.

export { generateLexicon, regenerateSingleItem, samplePreviewRoots } from "../../../convex/lexicon/generate";
export { COMPOUND_LIST, CORE_LIST, FLEXIBLE_LIST } from "../../../convex/lexicon/content";
export { DEFAULT_LEXICON_PARAMS, FLEXIBLE_DOMAINS, ROOT_TARGET } from "../../../convex/lexicon/types";

export type { GenerateLexiconResult } from "../../../convex/lexicon/generate";
export type {
  ConceptKind,
  FlexibleDomain,
  LexiconItemData,
  LexiconParams,
  LexiconStageData,
  PartOfSpeech,
} from "../../../convex/lexicon/types";
