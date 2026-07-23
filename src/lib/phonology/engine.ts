// Client/server boundary, made explicit in one place: only pure,
// zero-Convex-import modules from convex/phonology/* are re-exported here.
// UI components import from here, not from convex/phonology/* directly, so
// it's always obvious what's safe to run in the browser for live preview
// (Section 13.5) versus what belongs to the server (convex/phonology/mutations.ts,
// queries.ts — never imported client-side).

export { generatePhonology, sampleClusters, sampleSyllables } from "../../../convex/phonology/generate";
export { ALL_TARGETS, DEFAULT_PARAMS } from "../../../convex/phonology/types";

export type {
  ConsonantPhoneme,
  InventorySize,
  PhonologyData,
  PhonologyParams,
  PhonologyTarget,
  StressPattern,
  VowelPhoneme,
} from "../../../convex/phonology/types";
