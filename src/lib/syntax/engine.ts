// Client/server boundary, made explicit in one place — same rationale as
// src/lib/phonology/engine.ts and src/lib/morphology/engine.ts. Only pure,
// zero-Convex-import modules from convex/syntax/* are re-exported here; UI
// components import from here, not from convex/syntax/* directly.

export {
  buildExampleSentences,
  computeWordOrderWeights,
  derivePhraseStructure,
  generateSyntax,
  generateWordOrderPreview,
  pickExampleConcepts,
  suggestWordOrder,
} from "../../../convex/syntax/generate";
export { DEFAULT_SYNTAX_PARAMS, WORD_ORDERS } from "../../../convex/syntax/types";

export type { BuildExampleSentencesArgs, GenerateSyntaxArgs, WordOrderPreviewExample } from "../../../convex/syntax/generate";
export type {
  AdjectiveOrder,
  AdpositionOrder,
  ExampleConceptRefs,
  ExamplePhrase,
  ExampleWord,
  GenitiveOrder,
  PhraseStructureData,
  Seed,
  SyntaxParams,
  SyntaxStageData,
  WordOrder,
} from "../../../convex/syntax/types";
